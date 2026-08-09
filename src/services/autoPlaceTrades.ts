/**
 * "The General" — study the build, place the devices where the trade says.
 *
 * The knowledge to do this has been in `tradeRules.ts` all along, wired only to
 * `AskAI`: the app could TELL you an outlet sits 12" off the finished floor and
 * could not place one. This is the hands to that mouth.
 *
 * Nothing here invents a standard. Mount heights, spacing and service origin all
 * come from tradeRules; this module only works out WHERE on a given building
 * those rules land. That split matters — a code change should be a one-line edit
 * to the rules, never a hunt through placement maths.
 *
 * What it deliberately does NOT do is take control away. Everything it emits is
 * an ordinary placed object: selectable, draggable, deletable, the same as one
 * the user dropped by hand. Auto-placement is a first pass, not a lock.
 */
import type { ParsedWall } from '../types'
import {
  DEFAULT_HEATING, ELECTRICAL_MOUNTS, HEATING_SYSTEMS, OUTLET_MAX_SPACING_M,
  electricalMountM, heatingBlocksReceptacles, type HeatingType,
} from './tradeRules'

/** A device the General wants placed, in the drawing's pixel space. */
export interface AutoDevice {
  /** Catalog type — 'duplex-outlet', 'switch', … */
  type: string
  /** Position along the wall, in image pixels (same space as ParsedWall). */
  pxX: number
  pxY: number
  /** Facing, radians about Y. Points INTO the building. */
  rotationY: number
  /** Height above finished floor, metres — straight from tradeRules. */
  mountM: number
  /** Storey. */
  level: number
  /** Why this one is here, for the user to read. */
  reason: string
}

export interface AutoPlaceInput {
  walls: ParsedWall[]
  /** Drawing scale. Without it there is no way to honour a spacing rule
   *  expressed in feet, so placement is refused rather than guessed. */
  scaleMmPerPx: number | null
  level?: number
  /**
   * How the house is heated. It has to be known HERE, not decided later: an
   * electric baseboard lives under a window, a receptacle may not sit directly
   * above one, and under-the-window is exactly where receptacle spacing wants
   * to put a device. Placing electrical first and heating second guarantees the
   * clash.
   */
  heating?: HeatingType
  /**
   * Window openings on this storey, in the same pixel space as the walls —
   * where the emitters go, and therefore where receptacles must not.
   */
  windows?: Array<{ pxX: number; pxY: number }>
}

/** Keep-out radius around a baseboard emitter, in metres along the wall. A
 *  typical unit is 3–8ft long; half of a mid-size one, either side of centre. */
const EMITTER_KEEPOUT_M = 1.2

/** A wall too short to be a "wall space" under NEC 210.52 — 2ft. */
const MIN_WALL_SPACE_M = 2 * 0.3048

function lengthPx(w: ParsedWall): number {
  return Math.hypot(w.x2 - w.x1, w.y2 - w.y1)
}

/** Centre of everything, used to decide which way is indoors. */
function centroid(walls: ParsedWall[]): { x: number; y: number } {
  let sx = 0
  let sy = 0
  for (const w of walls) {
    sx += (w.x1 + w.x2) / 2
    sy += (w.y1 + w.y2) / 2
  }
  const n = Math.max(1, walls.length)
  return { x: sx / n, y: sy / n }
}

/**
 * Which way does a device on this wall face?
 *
 * A receptacle faces the room, not the yard. The wall has two normals; the one
 * that points towards the middle of the building is the indoor side. Crude on a
 * complicated footprint and right on the overwhelming majority of walls — and
 * being wrong only means a device faces the wrong way, which the user can spin.
 */
function facingInward(w: ParsedWall, mid: { x: number; y: number }): number {
  const dx = w.x2 - w.x1
  const dy = w.y2 - w.y1
  const len = Math.hypot(dx, dy) || 1
  // Left-hand normal.
  const nx = -dy / len
  const ny = dx / len
  const cx = (w.x1 + w.x2) / 2
  const cy = (w.y1 + w.y2) / 2
  const towardsMiddle = (mid.x - cx) * nx + (mid.y - cy) * ny
  const sx = towardsMiddle >= 0 ? nx : -nx
  const sy = towardsMiddle >= 0 ? ny : -ny
  // Image Y runs down; negate so the angle reads as a normal world heading.
  return Math.atan2(sx, -sy)
}

/**
 * Receptacles along one wall, per NEC 210.52(A).
 *
 * The rule is not "one every 12 feet" — it is that no point along the floor
 * line may be more than 6ft from a receptacle, which is a stricter thing at the
 * ENDS of a wall. Dividing the wall into equal parts and placing one in the
 * middle of each satisfies both at once: the gap between neighbours is L/n and
 * the gap to either end is only half that, so the ends can never be the
 * violation. Spacing them a fixed 12ft from one end cannot make that claim.
 */
export function outletPositionsAlong(lengthM: number): number[] {
  if (lengthM < MIN_WALL_SPACE_M) return []
  const count = Math.max(1, Math.ceil(lengthM / OUTLET_MAX_SPACING_M))
  const step = lengthM / count
  return Array.from({ length: count }, (_, i) => (i + 0.5) * step)
}

/**
 * Place general-purpose receptacles around a storey.
 *
 * Returns an empty list rather than a guess when the drawing has no scale: a
 * spacing rule in feet is meaningless without one, and inventing a scale to
 * satisfy the code would put devices in confidently wrong places.
 */
export function autoPlaceOutlets({
  walls, scaleMmPerPx, level = 0, heating = DEFAULT_HEATING, windows = [],
}: AutoPlaceInput): AutoDevice[] {
  if (!scaleMmPerPx || !Number.isFinite(scaleMmPerPx) || scaleMmPerPx <= 0) return []

  const onLevel = walls.filter((w) => (w.level ?? 0) === level)
  if (onLevel.length === 0) return []

  const mid = centroid(onLevel)
  const mountM = electricalMountM('outlet') ?? ELECTRICAL_MOUNTS.outlet.heightM
  const mPerPx = scaleMmPerPx / 1000
  const keepClearOfEmitters = heatingBlocksReceptacles(heating) && windows.length > 0
  const out: AutoDevice[] = []

  for (const w of onLevel) {
    const lenPx = lengthPx(w)
    const lenM = lenPx * mPerPx
    const positions = outletPositionsAlong(lenM)
    if (positions.length === 0) continue

    // Where along THIS wall an emitter will sit — under each window on it.
    const emittersAlongM = keepClearOfEmitters ? emitterOffsetsOnWall(w, windows, mPerPx) : []

    const rotationY = facingInward(w, mid)
    for (const alongM of positions) {
      // A receptacle may not sit directly above a baseboard heater. Nudge it
      // clear rather than dropping it — the wall still needs covering, and a
      // silently missing outlet is a code violation of its own.
      const placedM = keepClearOfEmitters
        ? nudgeClear(alongM, emittersAlongM, lenM)
        : alongM
      if (placedM === null) continue

      const t = placedM / lenM
      out.push({
        type: 'duplex-outlet',
        pxX: w.x1 + (w.x2 - w.x1) * t,
        pxY: w.y1 + (w.y2 - w.y1) * t,
        rotationY,
        mountM,
        level,
        reason: placedM === alongM
          ? `NEC 210.52 — no point on this wall is more than ${(OUTLET_MAX_SPACING_M / 2).toFixed(1)}m from a receptacle`
          : `NEC 210.52, shifted clear of the ${HEATING_SYSTEMS[heating].label.toLowerCase()} under the window`,
      })
    }
  }

  return out
}

/** How far along a wall each window centre falls, in metres. */
function emitterOffsetsOnWall(
  w: ParsedWall,
  windows: Array<{ pxX: number; pxY: number }>,
  mPerPx: number,
): number[] {
  const dx = w.x2 - w.x1
  const dy = w.y2 - w.y1
  const lenPx = Math.hypot(dx, dy) || 1
  const offsets: number[] = []
  for (const win of windows) {
    // Project the window onto the wall, and only keep it if it actually sits ON
    // this wall rather than merely near its infinite line.
    const t = ((win.pxX - w.x1) * dx + (win.pxY - w.y1) * dy) / (lenPx * lenPx)
    if (t < 0 || t > 1) continue
    const perpPx = Math.abs((win.pxX - w.x1) * dy - (win.pxY - w.y1) * dx) / lenPx
    if (perpPx * mPerPx > 0.3) continue
    offsets.push(t * lenPx * mPerPx)
  }
  return offsets
}

/**
 * Move a receptacle out from under an emitter, or give up on it.
 *
 * Tries each side of the obstruction and takes the nearer one that still lands
 * on the wall. Returns null only when the wall is so crowded there is nowhere
 * legal to go — better an honest gap the user can see than a device sitting
 * where it may not be installed.
 */
export function nudgeClear(alongM: number, emittersM: number[], wallLenM: number): number | null {
  const clash = emittersM.find((e) => Math.abs(e - alongM) < EMITTER_KEEPOUT_M)
  if (clash === undefined) return alongM

  for (const candidate of [clash - EMITTER_KEEPOUT_M, clash + EMITTER_KEEPOUT_M]) {
    if (candidate < 0 || candidate > wallLenM) continue
    if (emittersM.some((e) => Math.abs(e - candidate) < EMITTER_KEEPOUT_M - 1e-6)) continue
    return candidate
  }
  return null
}
