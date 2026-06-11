import { describe, expect, it } from 'vitest'
import {
  extendWallToNearbyWall,
  inferCorners,
  mergeAutoAndUserWalls,
  reduceStrokeToWall,
  reduceStrokeToWalls,
  simplifyStroke,
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
