/**
 * When a wall moves, the doors and windows in it move with it.
 *
 * A door is stored as its own object with its own position — it is not a child
 * of the wall. That is fine while you are placing things, and wrong the moment
 * you edit: rotate a wall on the edit rail and the wall swings away while every
 * opening in it stays behind, hanging in the air where the wall used to be. The
 * opening was never told the wall had moved.
 *
 * A wall is a segment, so an opening in it has only two meaningful numbers:
 *
 *   T     how far along the wall it sits, 0..1. Survives the wall being moved,
 *         turned, or made longer or shorter — a door one third of the way along
 *         is still one third of the way along.
 *   PERP  how far off the centreline it sits, signed. Normally about zero, and
 *         kept rather than zeroed so nothing quietly jumps flush when you
 *         nudge the wall it is near.
 *
 * Read those against the old segment, write them back against the new one, and
 * the opening lands where it should have been all along, with its facing turned
 * by however much the wall turned.
 */

export interface Seg { x1: number; y1: number; x2: number; y2: number }

/** Where a point sits relative to a segment: along it, and off it. */
export function segCoords(px: number, py: number, s: Seg): { t: number; perp: number } | null {
  const dx = s.x2 - s.x1, dy = s.y2 - s.y1
  const len2 = dx * dx + dy * dy
  if (len2 < 1e-9) return null
  const t = ((px - s.x1) * dx + (py - s.y1) * dy) / len2
  const len = Math.sqrt(len2)
  // Left-hand normal, so the sign of `perp` says which side and is stable under
  // rotation — the normal turns with the segment.
  const perp = ((px - s.x1) * -dy + (py - s.y1) * dx) / len
  return { t, perp }
}

/** Rebuild a point from (t, perp) against a segment. The inverse of segCoords. */
export function segPoint(t: number, perp: number, s: Seg): { x: number; y: number } {
  const dx = s.x2 - s.x1, dy = s.y2 - s.y1
  const len = Math.hypot(dx, dy)
  if (len < 1e-9) return { x: s.x1, y: s.y1 }
  const nx = -dy / len, ny = dx / len
  return { x: s.x1 + t * dx + perp * nx, y: s.y1 + t * dy + perp * ny }
}

/**
 * Does this point belong to this wall?
 *
 * Deliberately the same shape of test the framing and boarding layers use to
 * decide which wall an opening cuts, so an opening cannot be framed into one
 * wall and dragged around by another.
 *
 * `t` is allowed slightly past both ends because a door seated in a traced gap
 * legitimately sits just off the end of its run.
 */
export function opensInWall(
  px: number, py: number, s: Seg, thresholdPx: number,
): boolean {
  const c = segCoords(px, py, s)
  if (!c) return false
  return c.t >= -0.02 && c.t <= 1.02 && Math.abs(c.perp) < thresholdPx
}

/**
 * The new pixel position for an opening after its wall changed.
 *
 * Returns null when the opening does not belong to this wall, so callers can map
 * over every object and keep whatever comes back.
 */
export function followWall(
  px: number, py: number, before: Seg, after: Seg, thresholdPx: number,
): { x: number; y: number } | null {
  if (!opensInWall(px, py, before, thresholdPx)) return null
  const c = segCoords(px, py, before)
  if (!c) return null
  return segPoint(c.t, c.perp, after)
}

/** How much a wall turned, in radians — what its openings must turn by too. */
export function segYawDelta(before: Seg, after: Seg): number {
  const a = Math.atan2(before.y2 - before.y1, before.x2 - before.x1)
  const b = Math.atan2(after.y2 - after.y1, after.x2 - after.x1)
  // Normalise to (-pi, pi] so a wall crossing the +/-pi seam turns the short way
  // instead of spinning its doors most of a full revolution.
  let d = b - a
  while (d > Math.PI) d -= 2 * Math.PI
  while (d < -Math.PI) d += 2 * Math.PI
  return d
}
