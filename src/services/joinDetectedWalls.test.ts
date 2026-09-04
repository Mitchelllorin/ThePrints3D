import { describe, it, expect } from 'vitest'
import { joinDetectedWalls } from './joinDetectedWalls'
import type { ParsedWall } from '../types'

const w = (x1: number, y1: number, x2: number, y2: number): ParsedWall =>
  ({ x1, y1, x2, y2, thickness: 6, source: 'auto' } as ParsedWall)

/** Four walls of a room, each stopping `gap` px short of its neighbours. */
function openBox(gap: number, size = 400): ParsedWall[] {
  const a = gap, b = size - gap
  return [
    w(a, 0, b, 0),        // top
    w(size, a, size, b),  // right
    w(a, size, b, size),  // bottom
    w(0, a, 0, b),        // left
  ]
}

/** Does this set of walls enclose anything? Ray-free proxy: do ends coincide? */
function openEndpoints(walls: ParsedWall[], tol = 1.5): number {
  const pts = walls.flatMap((s) => [[s.x1, s.y1], [s.x2, s.y2]] as const)
  let open = 0
  for (const [x, y] of pts) {
    const touching = pts.filter((q) => Math.hypot(q[0] - x, q[1] - y) <= tol).length
    if (touching < 2) open++
  }
  return open
}

describe('joinDetectedWalls', () => {
  it('closes the corners of a box whose walls stop short', () => {
    const before = openBox(12)
    expect(openEndpoints(before)).toBe(8)          // every corner open
    const after = joinDetectedWalls(before)
    expect(openEndpoints(after.walls)).toBeLessThan(8)
    expect(after.joined).toBeGreaterThan(0)
  })

  it('leaves an already-closed box untouched', () => {
    const closed = openBox(0)
    const after = joinDetectedWalls(closed)
    expect(after.walls).toEqual(closed)
    expect(after.joined).toBe(0)
  })

  it('scales its tolerance with the drawing, not with pixels', () => {
    // The same plan at two resolutions must behave the same — the failure mode
    // that has dogged every absolute-pixel constant in this pipeline.
    const small = joinDetectedWalls(openBox(12, 400))
    const large = joinDetectedWalls(openBox(24, 800))
    expect(openEndpoints(small.walls)).toBe(openEndpoints(large.walls))
    expect(large.maxExtendPx).toBeCloseTo(small.maxExtendPx * 2, 0)
  })

  it('does not reach across a gap that is large relative to the walls', () => {
    // Two short stubs far apart are not a corner, and welding them would invent
    // a wall the drawing does not have.
    const far = [w(0, 0, 40, 0), w(300, 0, 340, 0), w(0, 300, 40, 300), w(300, 300, 340, 300)]
    const after = joinDetectedWalls(far)
    expect(after.joined).toBe(0)
  })

  it('returns the input unchanged when there are too few walls to measure', () => {
    const two = [w(0, 0, 100, 0), w(100, 10, 100, 90)]
    expect(joinDetectedWalls(two).walls).toEqual(two)
  })
})
