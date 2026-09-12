import type { ParsedWall } from '../types'

/**
 * WHERE ANOTHER WALL LANDS ON THIS ONE'S FACE — the tees.
 *
 * A corner is two wall ENDS meeting. A tee is one wall's END landing on
 * another wall's SPAN, and it is a different piece of framing: the wall being
 * met carries the pack (studs either side of the landing point plus a nailer
 * between), and the arriving wall just runs into it. Same bargain as a corner,
 * which is why this reports the hit against the wall being MET.
 *
 * Returned per wall, as fractions along that wall (0..1), so the caller can
 * scale them to whatever length it finally frames at — wall ends get extended
 * into corners, so metres worked out here would be wrong by half a thickness.
 *
 * Lives here, not inside the layer, because a hit test that only runs inside a
 * React component can only be debugged by driving a browser. It cost a round of
 * exactly that to learn the arithmetic was never the problem.
 */
export function teesForWalls(walls: readonly ParsedWall[], tolPx = 6): number[][] {
  return walls.map((wall) => {
    const dx = wall.x2 - wall.x1
    const dy = wall.y2 - wall.y1
    const len2 = dx * dx + dy * dy
    if (len2 < 1) return []
    const out: number[] = []
    for (const other of walls) {
      if (other === wall) continue
      // A wall on the storey above sits directly over this one; not a tee.
      if ((other.level ?? 0) !== (wall.level ?? 0)) continue
      for (const [ex, ey] of [[other.x1, other.y1], [other.x2, other.y2]] as const) {
        const t = ((ex - wall.x1) * dx + (ey - wall.y1) * dy) / len2
        if (t <= 0.02 || t >= 0.98) continue     // that end is at a corner
        const px = wall.x1 + t * dx
        const py = wall.y1 + t * dy
        if (Math.hypot(ex - px, ey - py) > tolPx) continue
        if (!out.some((u) => Math.abs(u - t) < 0.01)) out.push(t)
      }
    }
    return out
  })
}
