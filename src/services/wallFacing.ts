/**
 * Which way does a wall face?
 *
 * A traced wall is two points. Nothing in the data says which of its two faces
 * meets the weather and which one you paint — but several layers need to agree on
 * the answer, and they MUST agree: the envelope puts sheathing on the outside,
 * drywall goes on the inside, and if the two disagree you get a wall that is
 * sheathed and boarded on the same face and bare on the other.
 *
 * So the rule lives here once, and every layer asks this module.
 *
 * The footprint's centroid answers it: a wall's outward normal is whichever of
 * its perpendiculars points AWAY from the middle of the building. Exact for a
 * convex footprint, right almost everywhere on a real one. An L-shaped plan can
 * put one short wall's faces the wrong way round — visible and fixable, rather
 * than silently wrong.
 *
 * Centroids are taken PER STOREY so a smaller upper floor is judged against its
 * own outline rather than the floor below.
 */

export interface FacingWall {
  x1: number; y1: number; x2: number; y2: number
  level?: number
}

/** Mean wall-midpoint per level, in the walls' own (pixel) space. */
export function footprintCentroids(walls: FacingWall[]): Record<number, { x: number; y: number }> {
  const acc: Record<number, { x: number; y: number; n: number }> = {}
  for (const w of walls) {
    const lv = w.level ?? 0
    const a = (acc[lv] ??= { x: 0, y: 0, n: 0 })
    a.x += (w.x1 + w.x2) / 2
    a.y += (w.y1 + w.y2) / 2
    a.n += 1
  }
  const out: Record<number, { x: number; y: number }> = {}
  for (const [lv, a] of Object.entries(acc)) {
    if (a.n > 0) out[Number(lv)] = { x: a.x / a.n, y: a.y / a.n }
  }
  return out
}

/**
 * +1 or -1: which local Z face of this wall is the OUTSIDE.
 *
 * The wall's local +Z is the left-hand perpendicular of its direction. If the
 * centroid lies on that side, the outside is the other one. Falls back to +1 when
 * there is no centroid to compare against (a single wall has no "inside" yet).
 */
export function outwardSign(wall: FacingWall, centroid?: { x: number; y: number }): 1 | -1 {
  if (!centroid) return 1
  const mx = (wall.x1 + wall.x2) / 2
  const my = (wall.y1 + wall.y2) / 2
  const dirX = wall.x2 - wall.x1
  const dirY = wall.y2 - wall.y1
  // 2D cross product: which side of the wall's direction the centroid sits on.
  const side = dirX * (centroid.y - my) - dirY * (centroid.x - mx)
  return side > 0 ? -1 : 1
}

/** The face you stand on and paint — always the opposite of the weather face. */
export function inwardSign(wall: FacingWall, centroid?: { x: number; y: number }): 1 | -1 {
  return outwardSign(wall, centroid) === 1 ? -1 : 1
}
