import { describe, it, expect } from 'vitest'
import { suggestWallCorner, type Seg } from './cornerInference'

const s = (x1: number, y1: number, x2: number, y2: number): Seg => ({ x1, y1, x2, y2 })

describe('suggestWallCorner', () => {
  it('suggests trimming a small high-side overshoot to the corner', () => {
    const wall = s(0, 50, 120, 50)        // horizontal, ends at x=120
    const post = s(100, 50, 100, 200)     // vertical corner at x=100
    const r = suggestWallCorner(wall, [post])
    expect(r).not.toBeNull()
    expect(r!.overshootPx).toBe(20)
    expect(r!.rect).toEqual({ x1: 0, y1: 50, x2: 100, y2: 50 })
  })

  it('suggests trimming a low-side overshoot', () => {
    const wall = s(-20, 50, 100, 50)      // starts 20 before the corner at x=0
    const post = s(0, 0, 0, 100)          // vertical corner at x=0
    const r = suggestWallCorner(wall, [post])
    expect(r!.overshootPx).toBe(20)
    expect(r!.rect).toEqual({ x1: 0, y1: 50, x2: 100, y2: 50 })
  })

  it('works for a vertical wall too', () => {
    const wall = s(50, 0, 50, 120)        // vertical, ends at y=120
    const beam = s(0, 100, 200, 100)      // horizontal corner at y=100
    const r = suggestWallCorner(wall, [beam])
    expect(r!.overshootPx).toBe(20)
    expect(r!.rect).toEqual({ x1: 50, y1: 0, x2: 50, y2: 100 })
  })

  it('leaves a clean corner alone (no overshoot)', () => {
    const wall = s(0, 50, 100, 50)
    const post = s(100, 50, 100, 200)
    expect(suggestWallCorner(wall, [post])).toBeNull()
  })

  it('does NOT trim a genuine mid-span T-junction', () => {
    const wall = s(0, 50, 200, 50)        // long wall
    const post = s(100, 50, 100, 200)     // crosses at the MIDDLE (x=100)
    // Both sides are 100px — neither is a small stub → no suggestion.
    expect(suggestWallCorner(wall, [post])).toBeNull()
  })

  it('ignores an overshoot too large to be accidental', () => {
    const wall = s(0, 50, 400, 50)        // ends 300px past the corner
    const post = s(100, 50, 100, 200)
    expect(suggestWallCorner(wall, [post])).toBeNull()
  })

  it('needs a perpendicular partner (parallel walls do nothing)', () => {
    const wall = s(0, 50, 120, 50)
    const parallel = s(0, 80, 120, 80)
    expect(suggestWallCorner(wall, [parallel])).toBeNull()
  })

  it('ignores a perpendicular wall that does not reach the wall line', () => {
    const wall = s(0, 50, 120, 50)
    const post = s(100, 90, 100, 200)     // vertical, but starts at y=90 (below y=50)
    expect(suggestWallCorner(wall, [post])).toBeNull()
  })
})
