import { describe, expect, it } from 'vitest'
import {
  extendWallToNearbyWall,
  freeAnglePoint,
  inferCorners,
  mergeAutoAndUserWalls,
  reduceStrokeToWall,
  reduceStrokeToWalls,
  simplifyStroke,
  squarePointToAxis,
  squareWallToAxis,
  wallAngleOffSquareDeg,
} from './wallTraceReducer'
import type { ParsedWall } from '../types'

describe('reduceStrokeToWall', () => {
  it('snaps mostly horizontal strokes to horizontal walls', () => {
    const wall = reduceStrokeToWall([
      { x: 10, y: 20 },
      { x: 80, y: 24 },
    ])
    expect(wall).not.toBeNull()
    expect(wall!.y2).toBeCloseTo(wall!.y1)
    expect(wall!.source).toBe('user')
    expect(wall!.detectionConfidence).toBe(1)
  })

  it('returns null for tiny strokes', () => {
    const wall = reduceStrokeToWall([
      { x: 10, y: 20 },
      { x: 14, y: 22 },
    ])
    expect(wall).toBeNull()
  })
})

describe('simplifyStroke', () => {
  it('collapses a noisy straight stroke to its two endpoints', () => {
    const points = Array.from({ length: 30 }, (_, i) => ({
      x: i * 10,
      y: 50 + Math.sin(i) * 3, // ±3px hand jitter
    }))
    const simplified = simplifyStroke(points, 8)
    expect(simplified.length).toBe(2)
  })

  it('preserves a sharp corner', () => {
    const points = [
      ...Array.from({ length: 10 }, (_, i) => ({ x: i * 20, y: 0 })),
      ...Array.from({ length: 10 }, (_, i) => ({ x: 180, y: (i + 1) * 20 })),
    ]
    const simplified = simplifyStroke(points, 8)
    expect(simplified.length).toBe(3)
  })
})

describe('reduceStrokeToWalls', () => {
  it('turns an L-shaped stroke into two walls sharing an exact corner', () => {
    const points = [
      ...Array.from({ length: 12 }, (_, i) => ({ x: i * 20, y: 100 + (i % 2) * 2 })),
      ...Array.from({ length: 12 }, (_, i) => ({ x: 220 + (i % 2) * 2, y: 100 + (i + 1) * 20 })),
    ]
    const walls = reduceStrokeToWalls(points)
    expect(walls.length).toBe(2)
    // Chain connectivity: wall 2 starts exactly where wall 1 ends
    expect(walls[1].x1).toBe(walls[0].x2)
    expect(walls[1].y1).toBe(walls[0].y2)
    // Axis snapping: first is horizontal, second vertical
    expect(walls[0].y2).toBeCloseTo(walls[0].y1)
    expect(walls[1].x2).toBeCloseTo(walls[1].x1)
  })

  it('returns a single wall for a straight stroke', () => {
    const points = Array.from({ length: 20 }, (_, i) => ({ x: i * 15, y: 40 + Math.sin(i) * 2 }))
    const walls = reduceStrokeToWalls(points)
    expect(walls.length).toBe(1)
  })

  it('ignores accidental dots and tiny strokes', () => {
    expect(reduceStrokeToWalls([{ x: 5, y: 5 }, { x: 9, y: 7 }])).toEqual([])
    expect(reduceStrokeToWalls([{ x: 5, y: 5 }])).toEqual([])
  })
})

describe('extendWallToNearbyWall', () => {
  const target: ParsedWall = { x1: 300, y1: 0, x2: 300, y2: 400, thickness: 8 }

  it('extends a wall that stops short to meet the perpendicular wall', () => {
    const traced: ParsedWall = { x1: 0, y1: 200, x2: 270, y2: 200, thickness: 8, source: 'user' }
    const extended = extendWallToNearbyWall(traced, [target], 45)
    expect(extended.x2).toBeCloseTo(300)
    expect(extended.y2).toBeCloseTo(200)
  })

  it('leaves the wall alone when the gap exceeds the limit', () => {
    const traced: ParsedWall = { x1: 0, y1: 200, x2: 200, y2: 200, thickness: 8, source: 'user' }
    const extended = extendWallToNearbyWall(traced, [target], 45)
    expect(extended.x2).toBe(200)
  })

  it('extends the start endpoint backwards too', () => {
    const traced: ParsedWall = { x1: 330, y1: 200, x2: 600, y2: 200, thickness: 8, source: 'user' }
    const extended = extendWallToNearbyWall(traced, [target], 45)
    expect(extended.x1).toBeCloseTo(300)
  })
})

describe('inferCorners', () => {
  it('closes a near-miss L-corner to an exact intersection', () => {
    const walls: ParsedWall[] = [
      { x1: 0, y1: 100, x2: 195, y2: 100, thickness: 8 },   // horizontal, stops short
      { x1: 200, y1: 105, x2: 200, y2: 400, thickness: 8 }, // vertical, starts off
    ]
    const result = inferCorners(walls, 20)
    expect(result[0].x2).toBe(200)
    expect(result[0].y2).toBe(100)
    expect(result[1].x1).toBe(200)
    expect(result[1].y1).toBe(100)
  })
})

describe('mergeAutoAndUserWalls', () => {
  it('keeps user walls and removes conflicting auto walls', () => {
    const autoWalls: ParsedWall[] = [
      { x1: 10, y1: 20, x2: 100, y2: 20, thickness: 6, source: 'auto', detectionConfidence: 0.8 },
      { x1: 10, y1: 60, x2: 100, y2: 60, thickness: 6, source: 'auto', detectionConfidence: 0.8 },
    ]
    const userWalls: ParsedWall[] = [
      { x1: 15, y1: 22, x2: 95, y2: 22, thickness: 8, source: 'user', detectionConfidence: 1 },
    ]
    const merged = mergeAutoAndUserWalls(autoWalls, userWalls)
    expect(merged.some((w) => w.source === 'user')).toBe(true)
    expect(merged.some((w) => w.y1 === 60)).toBe(true)
    expect(merged.some((w) => w.y1 === 20)).toBe(false)
  })
})

describe('square by default', () => {
  it('pulls a point onto the axis it is closest to', () => {
    // Mostly horizontal, 40px off → flattened to horizontal.
    expect(squarePointToAxis(0, 0, 800, 40)).toEqual([800, 0])
    // Mostly vertical → flattened to vertical.
    expect(squarePointToAxis(0, 0, 40, 800)).toEqual([0, 800])
  })

  it('squares a BADLY off wall, not just a slightly off one', () => {
    // The old 7° tolerance let this through as "deliberate". 30° is a slip.
    const [x, y] = squarePointToAxis(0, 0, 800, 460)
    expect(y).toBe(0)
    expect(x).toBe(800)
  })

  it('keeps the dominant run length rather than shrinking the wall', () => {
    const [x, y] = squarePointToAxis(100, 100, 900, 160)
    expect(x).toBe(900)   // full horizontal run preserved
    expect(y).toBe(100)   // snapped back to the anchor's row
  })

  it('squares a true diagonal to whichever axis it leans on', () => {
    // Exactly 45°: ties go horizontal, deterministically.
    expect(squarePointToAxis(0, 0, 500, 500)).toEqual([500, 0])
  })

  it('a 45 degree tolerance squares every wall, which is the point', () => {
    const crooked = { x1: 0, y1: 0, x2: 800, y2: 300, thickness: 8, source: 'user' as const }
    expect(squareWallToAxis(crooked, 45).y2).toBe(0)
    // …and with squaring off, the wall is left exactly as drawn.
    expect(squareWallToAxis(crooked, 0)).toEqual(crooked)
  })
})

describe('free angle', () => {
  const angleOf = (ax: number, ay: number, [x, y]: [number, number]) =>
    (Math.atan2(y - ay, x - ax) * 180) / Math.PI

  it('keeps a real diagonal at the angle it was drawn, not 45', () => {
    // 30° — the old reducer forced this to 45°.
    const end = freeAnglePoint(0, 0, Math.cos(Math.PI / 6) * 500, Math.sin(Math.PI / 6) * 500)
    expect(angleOf(0, 0, end)).toBeCloseTo(30, 6)
  })

  it('rounds to a whole degree and keeps the length', () => {
    const end = freeAnglePoint(10, 10, 10 + Math.cos(0.4) * 300, 10 + Math.sin(0.4) * 300)
    expect(angleOf(10, 10, end)).toBeCloseTo(Math.round((0.4 * 180) / Math.PI), 6)
    expect(Math.hypot(end[0] - 10, end[1] - 10)).toBeCloseTo(300, 6)
  })

  it('a wall nearly square or nearly 45 lands exactly on it', () => {
    const r = (d: number) => (d * Math.PI) / 180
    const flat = freeAnglePoint(0, 0, Math.cos(r(2)) * 400, Math.sin(r(2)) * 400)
    expect(flat[1]).toBeCloseTo(0, 6)
    expect(angleOf(0, 0, freeAnglePoint(0, 0, Math.cos(r(47)) * 400, Math.sin(r(47)) * 400))).toBeCloseTo(45, 6)
  })

  it('reads the angle off square the way a print does', () => {
    expect(wallAngleOffSquareDeg(0, 0, 100, 0)).toBe(0)
    expect(wallAngleOffSquareDeg(0, 0, 0, -100)).toBe(90)
    expect(wallAngleOffSquareDeg(0, 0, -100, 58)).toBe(30)
  })
})

describe('inferCorners and angled walls', () => {
  it('leaves a diagonal alone when the next wall starts on its end', () => {
    const a: ParsedWall = { x1: 0, y1: 0, x2: 300, y2: 173, thickness: 8, source: 'user' }
    const b: ParsedWall = { x1: 300, y1: 173, x2: 350, y2: 60, thickness: 8, source: 'user' }
    const [ra, rb] = inferCorners([a, b], 20)
    expect(ra).toMatchObject({ x2: 300, y2: 173 })
    expect(rb).toMatchObject({ x1: 300, y1: 173 })
  })
})
