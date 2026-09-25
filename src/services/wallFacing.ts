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
 * THE OUTSIDE IS WHERE YOU CAN WALK AWAY. Step a hand's width off each face of
 * a wall and look along a spread of straight lines: if one of them reaches open
 * ground without crossing another wall, that face is outside. A partition has
 * the building on both faces; a shell wall has the building on one. That holds
 * for an L, a T or a U — including the two walls at an L's inside corner, which
 * a bounding-box test called interior and so left bare of sheathing and cladding
 * while the rest of the section was clad.
 *
 * Where the walls do not close yet (half a shell traced), both faces can reach
 * open ground and nothing is decided that way; the older rules — the storey's
 * bounding box for "is it on the outside", its centroid for "which face" — take
 * over until the shell closes.
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

/** Walls that meet at a corner seldom meet to the pixel; a traced corner can be
 *  a few pixels short. Each wall is stretched this much at both ends for the
 *  "can I walk out" test, so a sloppy corner is not a door to the outside. */
const JOIN_FRAC = 0.012
/** Directions tried from each probe point. */
const RAYS = 16

type Seg = { ax: number; ay: number; bx: number; by: number }

/** Does a ray from (px, py) along (dx, dy) cross this segment? */
function rayHits(px: number, py: number, dx: number, dy: number, s: Seg): boolean {
  const ex = s.bx - s.ax, ey = s.by - s.ay
  const den = dx * ey - dy * ex
  if (Math.abs(den) < 1e-12) return false
  const qx = s.ax - px, qy = s.ay - py
  const t = (qx * ey - qy * ex) / den
  const u = (qx * dy - qy * dx) / den
  return t > 1e-9 && u >= 0 && u <= 1
}

/**
 * For one storey: which face of each wall reaches open ground.
 * Returns +1 / -1 (the outside face, in outwardSign's convention), 0 when
 * neither face does (an interior wall), or null when both do (the shell is not
 * closed around it, so this test cannot tell).
 */
export function openFaceTest(walls: FacingWall[]): (w: FacingWall) => 1 | -1 | 0 | null {
  if (walls.length === 0) return () => null
  const xs = walls.flatMap((w) => [w.x1, w.x2])
  const ys = walls.flatMap((w) => [w.y1, w.y2])
  const diag = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) || 1
  const join = Math.max(4, diag * JOIN_FRAC)
  const probe = Math.max(2, diag * 0.004)
  const segs: Array<Seg & { w: FacingWall }> = walls.map((w) => {
    const len = Math.hypot(w.x2 - w.x1, w.y2 - w.y1) || 1
    const ux = (w.x2 - w.x1) / len, uy = (w.y2 - w.y1) / len
    return { w, ax: w.x1 - ux * join, ay: w.y1 - uy * join, bx: w.x2 + ux * join, by: w.y2 + uy * join }
  })
  const dirs = Array.from({ length: RAYS }, (_, i) => {
    // Offset off the axes so a ray never runs exactly along a wall.
    const a = ((i + 0.37) / RAYS) * Math.PI * 2
    return [Math.cos(a), Math.sin(a)] as const
  })
  const escapes = (px: number, py: number) => dirs.some(([dx, dy]) => !segs.some((sg) => rayHits(px, py, dx, dy, sg)))
  return (w) => {
    const len = Math.hypot(w.x2 - w.x1, w.y2 - w.y1)
    if (len < 1e-9) return null
    const mx = (w.x1 + w.x2) / 2, my = (w.y1 + w.y2) / 2
    // Local +Z is the left-hand perpendicular of the wall's direction (y down).
    const nx = -(w.y2 - w.y1) / len, ny = (w.x2 - w.x1) / len
    const plus = escapes(mx + nx * probe, my + ny * probe)
    const minus = escapes(mx - nx * probe, my - ny * probe)
    if (plus && minus) return null
    if (!plus && !minus) return 0
    return plus ? 1 : -1
  }
}

/**
 * Which face of each wall is outside, for one storey: the open-ground test,
 * then the centroid rule where the shell is not closed around the wall.
 */
export function outwardTest(walls: FacingWall[]): (w: FacingWall) => 1 | -1 {
  const open = openFaceTest(walls)
  const centroids = footprintCentroids(walls)
  return (w) => {
    const f = open(w)
    return f === 1 || f === -1 ? f : outwardSign(w, centroids[w.level ?? 0])
  }
}

export function perimeterTest(walls: FacingWall[]): (w: FacingWall) => boolean {
  const open = openFaceTest(walls)
  const box = boxPerimeterTest(walls)
  return (w) => {
    const f = open(w)
    if (f === 1 || f === -1) return true
    if (f === 0) return false
    return box(w)
  }
}

function boxPerimeterTest(walls: FacingWall[]): (w: FacingWall) => boolean {
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
