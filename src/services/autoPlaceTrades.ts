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
import { ELECTRICAL_MOUNTS, OUTLET_MAX_SPACING_M, electricalMountM } from './tradeRules'

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
}

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
export function autoPlaceOutlets({ walls, scaleMmPerPx, level = 0 }: AutoPlaceInput): AutoDevice[] {
  if (!scaleMmPerPx || !Number.isFinite(scaleMmPerPx) || scaleMmPerPx <= 0) return []

  const onLevel = walls.filter((w) => (w.level ?? 0) === level)
  if (onLevel.length === 0) return []

  const mid = centroid(onLevel)
  const mountM = electricalMountM('outlet') ?? ELECTRICAL_MOUNTS.outlet.heightM
  const mPerPx = scaleMmPerPx / 1000
  const out: AutoDevice[] = []

  for (const w of onLevel) {
    const lenPx = lengthPx(w)
    const lenM = lenPx * mPerPx
    const positions = outletPositionsAlong(lenM)
    if (positions.length === 0) continue

    const rotationY = facingInward(w, mid)
    for (const alongM of positions) {
      const t = alongM / lenM
      out.push({
        type: 'duplex-outlet',
        pxX: w.x1 + (w.x2 - w.x1) * t,
        pxY: w.y1 + (w.y2 - w.y1) * t,
        rotationY,
        mountM,
        level,
        reason: `NEC 210.52 — no point on this wall is more than ${(OUTLET_MAX_SPACING_M / 2).toFixed(1)}m from a receptacle`,
      })
    }
  }

  return out
}
