/**
 * Shared explode runtime — one coherent exploded view across every layer.
 *
 * BuildingModel's explode driver is authoritative: each frame it eases the
 * progress toward the slider and computes the model centre, then publishes both
 * here. The other world-space layers (MEP runs, HVAC ducts, devices, drywall)
 * read the SAME centre + eased progress via useExplodeChildren and fan their own
 * components out from it — so the wires/pipes/ducts/board literally float out of
 * the walls and ceilings together, then settle back as one.
 */
import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useConfigStore } from '../../store/useConfigStore'

export const explodeRuntime = {
  /** Smoothstep-eased explode progress (0 assembled … 1 fully exploded). */
  eased: 0,
  /** Global spread multiplier (Settings → Explode → Spread). */
  spread: 1,
  /** World-space centre every layer fans out from. */
  center: new THREE.Vector3(),
}

// Assembled base position per child, kept off the (ref-derived) object itself so
// it isn't a tracked mutation. Stale entries fall out as objects are GC'd.
const baseMap = new WeakMap<THREE.Object3D, THREE.Vector3>()

// Extra vertical gap added PER STOREY at full explode, so the floors separate
// floor-by-floor (an object tagged userData.level = N lifts N gaps). Exported so
// BuildingModel's own (authoritative) explode driver lifts by the same amount.
export const FLOOR_SEP = 3.2

// Per-SYSTEM push DIRECTION. Radial explode alone keeps co-located systems
// overlapping (a pipe still runs through the wall it sits in). Pushing each
// system a distinct way pulls them into their OWN zone so each can be inspected
// on its own — nothing running through anything. Walls stay central (reference);
// framing lifts up out of the walls; floors/subfloor/foundation stack below;
// ceiling/roof rise above; MEP and openings/furniture pull to the sides.
export const SYSTEM_DIR: Record<string, [number, number, number]> = {
  walls:            [0, 0, 0],
  structure:        [0, 0.3, 0],
  framing:          [0, 1, 0],
  ceiling:          [0, 1.4, 0],
  roof:             [0, 2, 0],
  floors:           [0, -1, 0],
  'floor-sheeting': [0, -1.5, 0],
  foundation:       [0, -2, 0],
  mep:              [1.6, 0.2, 0],
  'doors-windows':  [0, 0.2, 1.6],
  products:         [0, 0, -1.6],
}
/** Metres of system separation per unit direction at full explode. */
export const SYSTEM_SEP = 2.6

/** The extra per-system offset at the current explode progress (metres). */
export function systemOffset(key: string, out: THREE.Vector3): THREE.Vector3 {
  const d = SYSTEM_DIR[key]
  const s = SYSTEM_SEP * explodeRuntime.spread * explodeRuntime.eased
  if (!d) return out.set(0, 0, 0)
  return out.set(d[0] * s, d[1] * s, d[2] * s)
}

/**
 * Fan a group's direct children out from the shared explode centre each frame,
 * scaled by the layer's explode-system multiplier. Children's assembled
 * positions are tracked automatically (and kept in sync while not exploded, so
 * draggable items still move freely).
 */
export function useExplodeChildren(
  groupRef: React.RefObject<THREE.Group | null>,
  systemKey: string,
) {
  const mults = useConfigStore((s) => s.explodeSystemMultipliers)
  const tmp = useRef(new THREE.Vector3())
  const off = useRef(new THREE.Vector3())
  useFrame(() => {
    const g = groupRef.current
    if (!g) return
    const mult = (mults[systemKey] ?? 1) * explodeRuntime.spread * explodeRuntime.eased
    // Per-storey vertical separation (floor-by-floor) — independent of the radial
    // multiplier so storeys peel apart even when a system's spread is dialled low.
    const sep = explodeRuntime.spread * explodeRuntime.eased * FLOOR_SEP
    // Distinct per-system push so this system separates into its own zone.
    systemOffset(systemKey, off.current)
    const c = explodeRuntime.center
    for (const child of g.children) {
      let base = baseMap.get(child)
      if (!base) { base = new THREE.Vector3().copy(child.position); baseMap.set(child, base) }
      if (mult < 1e-4 && sep < 1e-4) {
        // Assembled: track the (possibly just-moved) real position as the base.
        base.copy(child.position)
        continue
      }
      const level = (child.userData.level as number) ?? 0

      /**
       * ALONG ITS OWN AXIS WHERE THE PART HAS ONE — never a radial scatter.
       *
       * `(base - centre) * mult` pushes every part straight away from the middle
       * of the model. For a pipe or a fixture that is fine. For a WALL it is the
       * one thing the build rules forbid: "parts travel along their real
       * assembly axis — the direction they would actually come off in the shop.
       * Never a radial scatter." A wall thrown along the line from the building's
       * centre to its own centre leaves at a diagonal, tipped off square, and a
       * storey of them reads as a starburst — a screensaver, not a building
       * coming apart.
       *
       * A wall comes away from the building PERPENDICULAR TO ITS OWN FACE. Give
       * it that axis (LiveWallsLayer does, from the wall's own bearing) and the
       * same explode reads as a box unfolding: every wall square to itself the
       * whole way out, which is what it would do if you pulled it off the deck.
       *
       * The axis is stored unsigned, because which of the two perpendiculars
       * points AWAY from the building depends on where the centre is, and the
       * centre moves. Sign it here against the live centre instead.
       *
       * Magnitude matches what radial would have given, so a wall travels as far
       * as it always did and a big plan still spreads further than a small one.
       */
      const axis = child.userData.explodeAxis as [number, number, number] | undefined
      let px: number, pz: number
      if (axis) {
        const rx = base.x - c.x
        const rz = base.z - c.z
        const reach = Math.hypot(rx, rz) * mult
        const facing = rx * axis[0] + rz * axis[2] >= 0 ? 1 : -1
        px = base.x + axis[0] * reach * facing
        pz = base.z + axis[2] * reach * facing
      } else {
        px = base.x + (base.x - c.x) * mult
        pz = base.z + (base.z - c.z) * mult
      }
      tmp.current.set(
        px + off.current.x,
        base.y + (base.y - c.y) * mult + level * sep + off.current.y,
        pz + off.current.z,
      )
      child.position.copy(tmp.current)
    }
  })
}
