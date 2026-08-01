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

/**
 * Is this wall on the OUTSIDE of the building, judged by where it sits?
 *
 * Returns a predicate over the walls of one storey. A wall running along an edge
 * of the storey's footprint is exterior; one cutting across the middle is not.
 *
 * This exists because the wallRole LABEL cannot carry the question on its own:
 * every traced wall is stamped 'exterior-bearing' by default, so an interior wall
 * reads as exterior unless the user changed the picker — and then it gets
 * sheathed, and carried up to the next storey, both wrong. Geometry does not have
 * that failure mode.
 *
 * Deliberately a bounding-box test rather than a true outline: it is right for
 * the rectangular and L-shaped footprints people actually trace, and a wall that
 * is genuinely on the perimeter of a stranger shape can still be labelled by
 * hand. Being conservative here means a missed sheet, not a sheathed partition.
 */
/**
 * What ROLE a wall should get, decided by where you just drew it.
 *
 * Every traced wall used to be stamped with whatever the role picker last said,
 * and that picker defaults to exterior-bearing — so unless you changed it, every
 * partition in the building claimed to be an exterior bearing wall. Downstream
 * that meant partitions sheathed in plywood, partitions carried up to the next
 * storey, and 2x8 studs in a coat cupboard.
 *
 * The building already knows the answer. A wall drawn along the edge of what you
 * have traced so far is exterior; one drawn across the middle is interior. That
 * matches how people actually work — shell first, then divide it up.
 *
 * `existing` is the walls already on that storey; the new wall is included in the
 * footprint, so the very first wall of a plan is exterior, which is right.
 *
 * Interior comes back as INTERIOR-BEARING rather than partition: assuming a wall
 * carries load and being wrong costs a heavier stud, while assuming it does not
 * and being wrong is a structural mistake. Wrong in the recoverable direction,
 * and the picker still overrides it.
 */
export function inferWallRole(wall: FacingWall, existing: FacingWall[]): string {
  const sameLevel = existing.filter((w) => (w.level ?? 0) === (wall.level ?? 0))
  return perimeterTest([...sameLevel, wall])(wall) ? 'exterior-bearing' : 'interior-bearing'
}

export function perimeterTest(walls: FacingWall[]): (w: FacingWall) => boolean {
  if (walls.length === 0) return () => false
  const xs = walls.flatMap((w) => [w.x1, w.x2])
  const ys = walls.flatMap((w) => [w.y1, w.y2])
  const minX = Math.min(...xs), maxX = Math.max(...xs)
  const minY = Math.min(...ys), maxY = Math.max(...ys)
  // Generous enough for a hand-traced line that wanders off the edge.
  const tol = Math.max(12, Math.max(maxX - minX, maxY - minY) * 0.04)
  return (w) =>
    (Math.abs(w.x1 - minX) < tol && Math.abs(w.x2 - minX) < tol) ||
    (Math.abs(w.x1 - maxX) < tol && Math.abs(w.x2 - maxX) < tol) ||
    (Math.abs(w.y1 - minY) < tol && Math.abs(w.y2 - minY) < tol) ||
    (Math.abs(w.y1 - maxY) < tol && Math.abs(w.y2 - maxY) < tol)
}
