import { describe, it, expect } from 'vitest'
import { segCoords, segPoint, opensInWall, followWall, segYawDelta } from './openingFollow'

const wall = { x1: 100, y1: 100, x2: 500, y2: 100 }   // 400px run, horizontal

describe('doors and windows move with the wall they are in', () => {
  it('reads a door as a fraction along the wall', () => {
    const c = segCoords(200, 100, wall)!
    expect(c.t).toBeCloseTo(0.25, 6)
    expect(c.perp).toBeCloseTo(0, 6)
  })

  it('round-trips a point through (t, perp) unchanged', () => {
    const c = segCoords(263, 108, wall)!
    const p = segPoint(c.t, c.perp, wall)
    expect(p.x).toBeCloseTo(263, 6)
    expect(p.y).toBeCloseTo(108, 6)
  })

  it('keeps the door a quarter along after the wall is rotated 90°', () => {
    // Same midpoint, swung to vertical.
    const after = { x1: 300, y1: -100, x2: 300, y2: 300 }
    const moved = followWall(200, 100, wall, after, 30)!
    const c = segCoords(moved.x, moved.y, after)!
    expect(c.t).toBeCloseTo(0.25, 6)
  })

  it('keeps the door a quarter along after the wall is stretched', () => {
    const after = { x1: 100, y1: 100, x2: 900, y2: 100 }   // twice as long
    const moved = followWall(200, 100, wall, after, 30)!
    expect(moved.x).toBeCloseTo(300, 6)   // a quarter of 800, from x=100
  })

  it('carries the door along when the wall is simply moved', () => {
    const after = { x1: 150, y1: 240, x2: 550, y2: 240 }
    const moved = followWall(200, 100, wall, after, 30)!
    expect(moved.x).toBeCloseTo(250, 6)
    expect(moved.y).toBeCloseTo(240, 6)
  })

  it('preserves which side of the wall it sat on, rather than snapping flush', () => {
    const off = followWall(200, 112, wall, wall, 30)!
    expect(off.y).toBeCloseTo(112, 6)
  })

  it('leaves alone a door that belongs to a DIFFERENT wall', () => {
    // Far off the centreline — this is some other wall's door.
    expect(followWall(200, 400, wall, wall, 30)).toBeNull()
  })

  it('accepts a door seated just past the end, where a traced gap puts it', () => {
    expect(opensInWall(96, 100, wall, 30)).toBe(true)     // barely off the start
    expect(opensInWall(20, 100, wall, 30)).toBe(false)    // genuinely past it
  })

  it('reports how far the wall turned', () => {
    const after = { x1: 100, y1: 100, x2: 100, y2: 500 }
    expect(segYawDelta(wall, after)).toBeCloseTo(Math.PI / 2, 6)
  })

  it('turns the SHORT way across the ±pi seam', () => {
    // Nearly-pi to nearly-minus-pi is a small turn, not a near-full revolution.
    const before = { x1: 0, y1: 0, x2: -100, y2: 1 }
    const after = { x1: 0, y1: 0, x2: -100, y2: -1 }
    expect(Math.abs(segYawDelta(before, after))).toBeLessThan(0.1)
  })

  it('does not explode on a zero-length wall', () => {
    const degenerate = { x1: 5, y1: 5, x2: 5, y2: 5 }
    expect(segCoords(10, 10, degenerate)).toBeNull()
    expect(followWall(10, 10, degenerate, wall, 30)).toBeNull()
  })
})
