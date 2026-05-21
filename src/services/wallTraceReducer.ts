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
  const nearVertical = Math.abs(Math.abs(deg) - 90) <= 20

  let x2 = end.x
  let y2 = end.y
  if (nearHorizontal) {
    y2 = start.y
  } else if (nearVertical) {
    x2 = start.x
  } else {
    // Optional diagonal support by snapping to 45° increments.
    const snap = Math.round(deg / 45) * 45
    const rad = (snap * Math.PI) / 180
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

function overlap1D(a1: number, a2: number, b1: number, b2: number) {
  const left = Math.max(Math.min(a1, a2), Math.min(b1, b2))
  const right = Math.min(Math.max(a1, a2), Math.max(b1, b2))
  return right - left
}

function areConflicting(a: ParsedWall, b: ParsedWall): boolean {
  const aHoriz = Math.abs(a.y2 - a.y1) <= Math.abs(a.x2 - a.x1)
  const bHoriz = Math.abs(b.y2 - b.y1) <= Math.abs(b.x2 - b.x1)
  if (aHoriz !== bHoriz) return false

  const axisDelta = aHoriz ? Math.abs(a.y1 - b.y1) : Math.abs(a.x1 - b.x1)
  const thicknessAllowance = Math.max(a.thickness, b.thickness, 8)
  if (axisDelta > thicknessAllowance * 1.5) return false

  const runOverlap = aHoriz
    ? overlap1D(a.x1, a.x2, b.x1, b.x2)
    : overlap1D(a.y1, a.y2, b.y1, b.y2)
  return runOverlap > 8
}

export function mergeAutoAndUserWalls(
  autoWalls: ParsedWall[],
  userWalls: ParsedWall[],
): ParsedWall[] {
  if (userWalls.length === 0) return autoWalls
  const filteredAuto = autoWalls.filter((a) => !userWalls.some((u) => areConflicting(a, u)))
  return [...filteredAuto, ...userWalls]
}

function nearestEndpoint(
  point: { x: number; y: number },
  walls: ParsedWall[],
  tolerancePx: number,
): { x: number; y: number } | null {
  let best: { x: number; y: number } | null = null
  let bestDistance = tolerancePx
  for (const wall of walls) {
    const candidates = [
      { x: wall.x1, y: wall.y1 },
      { x: wall.x2, y: wall.y2 },
    ]
    for (const candidate of candidates) {
      const distance = Math.hypot(candidate.x - point.x, candidate.y - point.y)
      if (distance <= bestDistance) {
        bestDistance = distance
        best = candidate
      }
    }
  }
  return best
}

export function snapTraceWallToExisting(
  wall: ParsedWall,
  walls: ParsedWall[],
  tolerancePx = 18,
): ParsedWall {
  const start = nearestEndpoint({ x: wall.x1, y: wall.y1 }, walls, tolerancePx)
  const end = nearestEndpoint({ x: wall.x2, y: wall.y2 }, walls, tolerancePx)
  return {
    ...wall,
    x1: start?.x ?? wall.x1,
    y1: start?.y ?? wall.y1,
    x2: end?.x ?? wall.x2,
    y2: end?.y ?? wall.y2,
  }
}
