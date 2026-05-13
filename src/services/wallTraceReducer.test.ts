import { describe, expect, it } from 'vitest'
import { mergeAutoAndUserWalls, reduceStrokeToWall } from './wallTraceReducer'
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

