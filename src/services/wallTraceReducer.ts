import type { ParsedWall } from '../types'

export interface StrokePoint {
  x: number
  y: number
}

export interface WallTraceOptions {
  defaultThicknessPx?: number
  minLengthPx?: number
}

/** Snap the segment start→end to horizontal/vertical/45°, returning the adjusted end. */
function snapSegmentAngle(start: StrokePoint, end: StrokePoint): StrokePoint {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const length = Math.hypot(dx, dy)
  const deg = (Math.atan2(dy, dx) * 180) / Math.PI
  const nearHorizontal = Math.abs(deg) <= 20 || Math.abs(Math.abs(deg) - 180) <= 20
  const nearVertical   = Math.abs(Math.abs(deg) - 90) <= 20

  if (nearHorizontal) return { x: end.x, y: start.y }
  if (nearVertical)   return { x: start.x, y: end.y }
  const snap = Math.round(deg / 45) * 45
  const rad  = (snap * Math.PI) / 180
  return { x: start.x + Math.cos(rad) * length, y: start.y + Math.sin(rad) * length }
}

export function reduceStrokeToWall(
  points: StrokePoint[],
  options: WallTraceOptions = {},
): ParsedWall | null {
  const { defaultThicknessPx = 8, minLengthPx = 12 } = options
  if (points.length < 2) return null

  const start = points[0]
  const end = points[points.length - 1]
  if (Math.hypot(end.x - start.x, end.y - start.y) < minLengthPx) return null

  const snapped = snapSegmentAngle(start, end)
  return {
    x1: start.x,
    y1: start.y,
    x2: snapped.x,
    y2: snapped.y,
    thickness: defaultThicknessPx,
    source: 'user',
    detectionConfidence: 1,
  }
}

// ── Multi-segment stroke reduction ─────────────────────────────────────────────

/** Perpendicular distance of point P to the line through A–B. */
function perpDistance(p: StrokePoint, a: StrokePoint, b: StrokePoint): number {
  const abx = b.x - a.x, aby = b.y - a.y
  const len = Math.hypot(abx, aby)
  if (len === 0) return Math.hypot(p.x - a.x, p.y - a.y)
  return Math.abs((p.x - a.x) * aby - (p.y - a.y) * abx) / len
}

/** Ramer–Douglas–Peucker polyline simplification. */
export function simplifyStroke(points: StrokePoint[], tolerancePx = 8): StrokePoint[] {
  if (points.length <= 2) return points.slice()
  let maxDist = 0
  let maxIdx = 0
  const first = points[0]
  const last = points[points.length - 1]
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpDistance(points[i], first, last)
    if (d > maxDist) { maxDist = d; maxIdx = i }
  }
  if (maxDist <= tolerancePx) return [first, last]
  const left = simplifyStroke(points.slice(0, maxIdx + 1), tolerancePx)
  const right = simplifyStroke(points.slice(maxIdx), tolerancePx)
  return [...left.slice(0, -1), ...right]
}

export interface StrokeToWallsOptions extends WallTraceOptions {
  /** RDP simplification tolerance. @default 8 */
  simplifyTolerancePx?: number
  /** Adjacent segments within this angle merge into one. @default 12 */
  collinearToleranceDeg?: number
  /** Segments shorter than this are treated as hand jitter. @default 30 */
  minSegmentPx?: number
}

/**
 * Reduce a freehand stroke into one or more straight wall segments.
 *
 * Understands corners: an L-shaped stroke becomes two walls that share an
 * exact corner point, not one diagonal. Each segment is angle-snapped to
 * horizontal/vertical/45° while preserving chain connectivity, so traced
 * corners stay closed.
 */
export function reduceStrokeToWalls(
  points: StrokePoint[],
  options: StrokeToWallsOptions = {},
): ParsedWall[] {
  const {
    defaultThicknessPx = 8,
    simplifyTolerancePx = 8,
    collinearToleranceDeg = 12,
    minSegmentPx = 30,
  } = options
  if (points.length < 2) return []

  // 1. Straighten the stroke into its essential vertices
  let verts = simplifyStroke(points, simplifyTolerancePx)

  // 2. Drop jitter vertices too close to the previously kept one
  const spaced: StrokePoint[] = [verts[0]]
  for (let i = 1; i < verts.length; i++) {
    const prev = spaced[spaced.length - 1]
    const isLast = i === verts.length - 1
    const d = Math.hypot(verts[i].x - prev.x, verts[i].y - prev.y)
    if (d >= minSegmentPx) {
      spaced.push(verts[i])
    } else if (isLast && spaced.length > 1) {
      // Fold a short tail into the final vertex instead of adding a stub
      spaced[spaced.length - 1] = verts[i]
    }
  }
  verts = spaced
  if (verts.length < 2) return []

  // 3. Merge near-collinear neighbours (slight hand drift, not a corner)
  const merged: StrokePoint[] = [verts[0]]
  for (let i = 1; i < verts.length - 1; i++) {
    const a = merged[merged.length - 1]
    const b = verts[i]
    const c = verts[i + 1]
    const angAB = Math.atan2(b.y - a.y, b.x - a.x)
    const angBC = Math.atan2(c.y - b.y, c.x - b.x)
    let diff = Math.abs(angAB - angBC) * (180 / Math.PI)
    if (diff > 180) diff = 360 - diff
    if (diff > collinearToleranceDeg) merged.push(b)
  }
  merged.push(verts[verts.length - 1])

  // 4. Chain segments with angle snapping — each wall starts exactly where
  //    the previous one ended, so corners are closed by construction.
  const walls: ParsedWall[] = []
  let cursor = merged[0]
  for (let i = 1; i < merged.length; i++) {
    const end = snapSegmentAngle(cursor, merged[i])
    if (Math.hypot(end.x - cursor.x, end.y - cursor.y) >= minSegmentPx) {
      walls.push({
        x1: cursor.x,
        y1: cursor.y,
        x2: end.x,
        y2: end.y,
        thickness: defaultThicknessPx,
        source: 'user',
        detectionConfidence: 1,
      })
      cursor = end
    }
  }
  return walls
}

// ── Snap a traced segment onto the nearest print line ───────────────────────────

/** Acute angle (deg, 0..90) between two directions given as (dx,dy). */
function lineAngleDiffDeg(ax: number, ay: number, bx: number, by: number): number {
  const a = Math.atan2(ay, ax)
  const b = Math.atan2(by, bx)
  let d = Math.abs(a - b) * (180 / Math.PI)
  d = d % 180
  if (d > 90) d = 180 - d
  return d
}

/**
 * Snap a freshly traced segment onto the nearest detected wall ("print line")
 * that runs roughly parallel and close by — so tracing a hair off the printed
 * wall lands exactly ON it, at whatever angle the print line actually is (not
 * forced to square). Returns the segment projected onto that line, or null when
 * no print line qualifies (caller then falls back to ortho angle-snapping).
 */
export function snapWallToPrintLine(
  x1: number, y1: number, x2: number, y2: number,
  walls: ParsedWall[],
  parallelToleranceDeg = 22,
  distanceTolerancePx = 22,
): { x1: number; y1: number; x2: number; y2: number } | null {
  const dx = x2 - x1, dy = y2 - y1
  const len = Math.hypot(dx, dy)
  if (len < 1e-3) return null
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2

  let best: ParsedWall | null = null
  let bestD = distanceTolerancePx
  for (const w of walls) {
    const wdx = w.x2 - w.x1, wdy = w.y2 - w.y1
    if (Math.hypot(wdx, wdy) < 1e-3) continue
    if (lineAngleDiffDeg(dx, dy, wdx, wdy) > parallelToleranceDeg) continue // not parallel
    // Perpendicular distance of the traced midpoint to the print line's infinite line.
    const len2 = wdx * wdx + wdy * wdy
    const t = ((mx - w.x1) * wdx + (my - w.y1) * wdy) / len2
    const cx = w.x1 + t * wdx, cy = w.y1 + t * wdy
    const d = Math.hypot(mx - cx, my - cy)
    if (d < bestD) { bestD = d; best = w }
  }
  if (!best) return null

  // Project both endpoints onto the chosen print line's *infinite* line, so the
  // traced wall lies on it while keeping the user's extent along the line.
  const wdx = best.x2 - best.x1, wdy = best.y2 - best.y1
  const wlen2 = wdx * wdx + wdy * wdy
  const proj = (px: number, py: number) => {
    const t = ((px - best!.x1) * wdx + (py - best!.y1) * wdy) / wlen2
    return { x: best!.x1 + t * wdx, y: best!.y1 + t * wdy }
  }
  const a = proj(x1, y1), b = proj(x2, y2)
  return { x1: a.x, y1: a.y, x2: b.x, y2: b.y }
}

// ── Tie-in extension ───────────────────────────────────────────────────────────

/**
 * If a traced wall stops short of another wall, extend it along its own
 * direction until it meets that wall's line — the "I stopped short of the
 * line, it should know to go to the line" behaviour. Each endpoint extends
 * independently, up to `maxExtendPx`.
 */
export function extendWallToNearbyWall(
  wall: ParsedWall,
  walls: ParsedWall[],
  maxExtendPx = 45,
): ParsedWall {
  const dx = wall.x2 - wall.x1
  const dy = wall.y2 - wall.y1
  const len = Math.hypot(dx, dy)
  if (len === 0) return wall
  const ux = dx / len
  const uy = dy / len

  /** Nearest forward intersection of ray (origin, dir) with any wall segment. */
  const rayHit = (ox: number, oy: number, dirX: number, dirY: number): { x: number; y: number } | null => {
    let bestT = maxExtendPx
    let best: { x: number; y: number } | null = null
    for (const w of walls) {
      if (w === wall) continue
      const sx = w.x2 - w.x1
      const sy = w.y2 - w.y1
      const denom = dirX * sy - dirY * sx
      if (Math.abs(denom) < 1e-9) continue // parallel
      const t = ((w.x1 - ox) * sy - (w.y1 - oy) * sx) / denom
      const u = Math.abs(sx) > Math.abs(sy)
        ? (ox + t * dirX - w.x1) / sx
        : (oy + t * dirY - w.y1) / sy
      if (t > 1 && t <= bestT && u >= -0.05 && u <= 1.05) {
        bestT = t
        best = { x: ox + t * dirX, y: oy + t * dirY }
      }
    }
    return best
  }

  const result = { ...wall }
  const startHit = rayHit(wall.x1, wall.y1, -ux, -uy)
  if (startHit) { result.x1 = startHit.x; result.y1 = startHit.y }
  const endHit = rayHit(wall.x2, wall.y2, ux, uy)
  if (endHit) { result.x2 = endHit.x; result.y2 = endHit.y }
  return result
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
 * Exported for the rubber-band trace tool, which snaps each tap as it lands.
 */
export function snapPointToWalls(
  px: number, py: number,
  walls: ParsedWall[],
  endpointTolerance = 28,
  lineTolerance = 18,
): { x: number; y: number } {
  return snapPoint(px, py, walls, endpointTolerance, lineTolerance)
}

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
      // Different storeys never form a corner — a 2nd-floor wall must not snap to
      // the ground-floor wall directly beneath it (same footprint, other level).
      if ((a.level ?? 0) !== (b.level ?? 0)) continue
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
