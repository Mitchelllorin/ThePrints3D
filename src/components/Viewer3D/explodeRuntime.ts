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
  useFrame(() => {
    const g = groupRef.current
    if (!g) return
    const mult = (mults[systemKey] ?? 1) * explodeRuntime.spread * explodeRuntime.eased
    const c = explodeRuntime.center
    for (const child of g.children) {
      let base = baseMap.get(child)
      if (!base) { base = new THREE.Vector3().copy(child.position); baseMap.set(child, base) }
      if (mult < 1e-4) {
        // Assembled: track the (possibly just-moved) real position as the base.
        base.copy(child.position)
        continue
      }
      tmp.current.set(
        base.x + (base.x - c.x) * mult,
        base.y + (base.y - c.y) * mult,
        base.z + (base.z - c.z) * mult,
      )
      child.position.copy(tmp.current)
    }
  })
}
