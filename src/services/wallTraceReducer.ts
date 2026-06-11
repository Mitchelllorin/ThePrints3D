import type { ParsedWall } from '../types'

export interface StrokePoint {
  x: number
  y: number
}

export interface WallTraceOptions {
  defaultThicknessPx?: number
  minLengthPx?: number
}

export function reduceStrokeToWall(
  points: StrokePoint[],
  options: WallTraceOptions = {},
): ParsedWall | null {
  const { defaultThicknessPx = 8, minLengthPx = 12 } = options
  if (points.length < 2) return null

  const start = points[0]
  const end = points[points.length - 1]
  const dx = end.x - start.x
  const dy = end.y - start.y
  const length = Math.hypot(dx, dy)
  if (length < minLengthPx) return null

  const angle = Math.atan2(dy, dx)
  const deg = (angle * 180) / Math.PI
  const nearHorizontal = Math.abs(deg) <= 20 || Math.abs(Math.abs(deg) - 180) <= 20
  const nearVertical   = Math.abs(Math.abs(deg) - 90) <= 20

  let x2 = end.x
  let y2 = end.y
  if (nearHorizontal) {
    y2 = start.y
  } else if (nearVertical) {
    x2 = start.x
  } else {
    // Snap to nearest 45° increment
    const snap = Math.round(deg / 45) * 45
    const rad  = (snap * Math.PI) / 180
    x2 = start.x + Math.cos(rad) * length
    y2 = start.y + Math.sin(rad) * length
  }

  return {
    x1: start.x,
    y1: start.y,
    x2,
    y2,
    thickness: defaultThicknessPx,
    source: 'user',
    detectionConfidence: 1,
  }
}

// ── Geometry helpers ───────────────────────────────────────────────────────────

function overlap1D(a1: number, a2: number, b1: number, b2: number) {
  return Math.min(Math.max(a1, a2), Math.max(b1, b2)) - Math.max(Math.min(a1, a2), Math.min(b1, b2))
}

function areConflicting(a: ParsedWall, b: ParsedWall): boolean {
  const aHoriz = Math.abs(a.y2 - a.y1) <= Math.abs(a.x2 - a.x1)
  const bHoriz = Math.abs(b.y2 - b.y1) <= Math.abs(b.x2 - b.x1)
  if (aHoriz !== bHoriz) return false
  const axisDelta = aHoriz ? Math.abs(a.y1 - b.y1) : Math.abs(a.x1 - b.x1)
  if (axisDelta > Math.max(a.thickness, b.thickness, 8) * 1.5) return false
  const runOverlap = aHoriz
    ? overlap1D(a.x1, a.x2, b.x1, b.x2)
    : overlap1D(a.y1, a.y2, b.y1, b.y2)
  return runOverlap > 8
}

/** Closest point on segment AB to point P */
function closestPointOnSegment(
  px: number, py: number,
  ax: number, ay: number,
  bx: number, by: number,
): { x: number; y: number; t: number } {
  const abx = bx - ax, aby = by - ay
  const len2 = abx * abx + aby * aby
  if (len2 === 0) return { x: ax, y: ay, t: 0 }
  const t = Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / len2))
  return { x: ax + t * abx, y: ay + t * aby, t }
}

/** Nearest endpoint (start or end) of any existing wall within tolerance */
function nearestEndpoint(
  px: number, py: number,
  walls: ParsedWall[],
  tolerance: number,
): { x: number; y: number } | null {
  let best: { x: number; y: number } | null = null
  let bestD = tolerance
  for (const w of walls) {
    for (const pt of [{ x: w.x1, y: w.y1 }, { x: w.x2, y: w.y2 }]) {
      const d = Math.hypot(pt.x - px, pt.y - py)
      if (d < bestD) { bestD = d; best = pt }
    }
  }
  return best
}

/**
 * Nearest point ON any wall segment (for T-joins).
 * Only snaps if the point is in the *interior* of the wall (not near an endpoint,
 * which is handled by nearestEndpoint), so we get clean T-intersections.
 */
function nearestPointOnWallLine(
  px: number, py: number,
  walls: ParsedWall[],
  tolerance: number,
): { x: number; y: number } | null {
  let best: { x: number; y: number } | null = null
  let bestD = tolerance
  for (const w of walls) {
    const cp = closestPointOnSegment(px, py, w.x1, w.y1, w.x2, w.y2)
    // Only use interior points (t not near 0 or 1) to avoid double-snapping endpoints
    if (cp.t < 0.05 || cp.t > 0.95) continue
    const d = Math.hypot(cp.x - px, cp.y - py)
    if (d < bestD) { bestD = d; best = { x: cp.x, y: cp.y } }
  }
  return best
}

/**
 * Snap a single point to nearby existing wall endpoints or wall lines.
 * Endpoint snapping takes priority over line snapping.
 */
function snapPoint(
  px: number, py: number,
  walls: ParsedWall[],
  endpointTolerance: number,
  lineTolerance: number,
): { x: number; y: number } {
  const ep = nearestEndpoint(px, py, walls, endpointTolerance)
  if (ep) return ep
  const lp = nearestPointOnWallLine(px, py, walls, lineTolerance)
  if (lp) return lp
  return { x: px, y: py }
}

export function mergeAutoAndUserWalls(
  autoWalls: ParsedWall[],
  userWalls: ParsedWall[],
): ParsedWall[] {
  if (userWalls.length === 0) return autoWalls
  const filteredAuto = autoWalls.filter((a) => !userWalls.some((u) => areConflicting(a, u)))
  return [...filteredAuto, ...userWalls]
}

/**
 * Snap both endpoints of a newly traced wall to nearby existing walls.
 * - Start/end points snap to existing endpoints first (L-join / continuation)
 * - then to wall interiors (T-join)
 * Tolerances are generous so the user doesn't have to be pixel-perfect.
 */
export function snapTraceWallToExisting(
  wall: ParsedWall,
  walls: ParsedWall[],
  endpointTolerance = 28,
  lineTolerance = 18,
): ParsedWall {
  const s = snapPoint(wall.x1, wall.y1, walls, endpointTolerance, lineTolerance)
  const e = snapPoint(wall.x2, wall.y2, walls, endpointTolerance, lineTolerance)
  return { ...wall, x1: s.x, y1: s.y, x2: e.x, y2: e.y }
}

/**
 * Corner inference: if two perpendicular walls share an endpoint within
 * tolerance, extend/trim them so they meet exactly (clean 90° corner).
 * Returns the adjusted wall list.
 */
export function inferCorners(walls: ParsedWall[], tolerancePx = 20): ParsedWall[] {
  const result = walls.map((w) => ({ ...w }))
  for (let i = 0; i < result.length; i++) {
    for (let j = i + 1; j < result.length; j++) {
      const a = result[i]
      const b = result[j]
      const aHoriz = Math.abs(a.y2 - a.y1) < Math.abs(a.x2 - a.x1)
      const bHoriz = Math.abs(b.y2 - b.y1) < Math.abs(b.x2 - b.x1)
      if (aHoriz === bHoriz) continue // parallel — skip

      // Find which endpoints are close and form the corner
      const pairs: Array<{ ai: 'start' | 'end'; bi: 'start' | 'end'; d: number }> = []
      const aPts = { start: { x: a.x1, y: a.y1 }, end: { x: a.x2, y: a.y2 } }
      const bPts = { start: { x: b.x1, y: b.y1 }, end: { x: b.x2, y: b.y2 } }
      for (const ai of ['start', 'end'] as const) {
        for (const bi of ['start', 'end'] as const) {
          const d = Math.hypot(aPts[ai].x - bPts[bi].x, aPts[ai].y - bPts[bi].y)
          pairs.push({ ai, bi, d })
        }
      }
      const closest = pairs.sort((x, y) => x.d - y.d)[0]
      if (closest.d > tolerancePx) continue

      // Compute the exact intersection of the two wall lines
      // Horizontal wall: y = a.y1, Vertical wall: x = b.x1
      const hWall = aHoriz ? a : b
      const vWall = aHoriz ? b : a
      const ix = vWall.x1  // vertical wall x
      const iy = hWall.y1  // horizontal wall y

      // Snap the meeting endpoints to the intersection
      if (aHoriz) {
        if (closest.ai === 'start') { result[i].x1 = ix; result[i].y1 = iy }
        else                        { result[i].x2 = ix; result[i].y2 = iy }
        if (closest.bi === 'start') { result[j].x1 = ix; result[j].y1 = iy }
        else                        { result[j].x2 = ix; result[j].y2 = iy }
      } else {
        if (closest.ai === 'start') { result[i].x1 = ix; result[i].y1 = iy }
        else                        { result[i].x2 = ix; result[i].y2 = iy }
        if (closest.bi === 'start') { result[j].x1 = ix; result[j].y1 = iy }
        else                        { result[j].x2 = ix; result[j].y2 = iy }
      }
    }
  }
  return result
}
