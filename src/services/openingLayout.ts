/**
 * Where a door or window sits in its wall, as a number you can read and type.
 *
 * Placing an opening was a tap: aim at the wall, and it lands roughly there.
 * That is how you sketch, not how you frame. A print says "window, 4′-6″ to
 * centre from the corner", and the layout on the plate is marked off a tape to
 * that number — so the app has to be able to take the number.
 *
 * The measurement is to the CENTRE of the opening, the way plans dimension them,
 * and from the END OF THE FRAMED WALL — at a corner that is the outside face of
 * the building, which is where the tape hooks. It is taken along the framed wall
 * the framing plan already built, so the number typed here and the number the
 * cut list and the elevation read are the same number.
 *
 * Which end? The end that is left on the plan for a wall that runs across it,
 * the top end for one that runs up it. That stays put however the 3D view is
 * turned, and the other end is one tap away.
 *
 * Pure and world-space (metres), so it can be tested without a scene.
 */
import type { PlannedWall } from './wallFramingPlan'

export type WallEnd = 'left' | 'right' | 'top' | 'bottom'

export interface OpeningSpot {
  /** Which planned wall holds it — `index` is the selection/edit index. */
  wall: PlannedWall
  /** Framed length of that wall, metres. */
  lengthM: number
  /** Opening width, metres. */
  widthM: number
  /** Centre from the framed START of the wall, metres. */
  centreFromStartM: number
  /** Plan names of the wall's two ends: [near-end name, far-end name], where
   *  "near" is left for an across-the-plan wall and top for an up-the-plan one. */
  ends: [WallEnd, WallEnd]
  /** True when the framed start IS the near (left/top) end. */
  startIsNear: boolean
}

/** Find the wall a placed opening was framed into, and where along it. */
export function locateOpening(plans: readonly PlannedWall[], objectId: string): OpeningSpot | null {
  for (const wall of plans) {
    const k = wall.openings.findIndex((o) => o.objectId === objectId)
    if (k < 0) continue
    const framed = wall.opts.openings?.[k]
    if (!framed) return null
    const c = Math.cos(wall.angle), s = Math.sin(wall.angle)
    const across = Math.abs(c) >= Math.abs(s)
    return {
      wall,
      lengthM: wall.length,
      widthM: framed.widthM,
      centreFromStartM: framed.centerM,
      ends: across ? ['left', 'right'] : ['top', 'bottom'],
      // World +X is plan right and world +Z is plan down, so the start is the
      // near end when the wall heads right (across) or down (up the plan).
      startIsNear: across ? c >= 0 : s >= 0,
    }
  }
  return null
}

/** Centre distance from a named end: `fromNear` picks left/top, else right/bottom. */
export function centreFromEnd(spot: OpeningSpot, fromNear: boolean): number {
  const fromStart = spot.startIsNear === fromNear
  return fromStart ? spot.centreFromStartM : spot.lengthM - spot.centreFromStartM
}

/**
 * The world point an opening's centre moves to when its centre is typed as
 * `distM` from a named end.
 *
 * The opening is kept whole inside the wall — a centre closer to an end than
 * half its width would hang the jamb off the end of the plate — and it keeps
 * whatever small offset it had off the wall centreline, so typing a distance
 * slides it along the wall and does nothing else. Returns the clamped distance
 * too, so the field can show what was actually done.
 */
export function moveOpeningTo(
  spot: OpeningSpot,
  current: { x: number; z: number },
  distM: number,
  fromNear: boolean,
): { x: number; z: number; distM: number } {
  const { wall, lengthM, widthM } = spot
  const half = Math.min(widthM / 2, lengthM / 2)
  const d = Math.max(half, Math.min(lengthM - half, distM))
  const fromStart = spot.startIsNear === fromNear ? d : lengthM - d
  const ux = Math.cos(wall.angle), uz = Math.sin(wall.angle)
  const sx = wall.cx - ux * lengthM / 2, sz = wall.cz - uz * lengthM / 2
  // Keep the opening's own offset off the centreline (left-hand normal).
  const nx = -uz, nz = ux
  const perp = (current.x - sx) * nx + (current.z - sz) * nz
  return {
    x: sx + ux * fromStart + nx * perp,
    z: sz + uz * fromStart + nz * perp,
    distM: d,
  }
}
