import { describe, it, expect } from 'vitest'
import { suggestLineSnap, type Seg } from './lineSnapInference'

const s = (x1: number, y1: number, x2: number, y2: number): Seg => ({ x1, y1, x2, y2 })

describe('suggestLineSnap', () => {
  it('offers to align a wall a few px off a parallel neighbour', () => {
    const wall = s(0, 50, 100, 50)
    const other = s(0, 42, 100, 42) // 8px above, overlapping
    const r = suggestLineSnap(wall, [other])
    expect(r).not.toBeNull()
    expect(r!.offsetPx).toBe(8)
    expect(r!.rect).toEqual({ x1: 0, y1: 42, x2: 100, y2: 42 })
  })

  it('works vertically', () => {
    const wall = s(50, 0, 50, 100)
    const other = s(44, 0, 44, 100) // 6px left
    const r = suggestLineSnap(wall, [other])
    expect(r!.offsetPx).toBe(6)
    expect(r!.rect).toEqual({ x1: 44, y1: 0, x2: 44, y2: 100 })
  })

  it('stays quiet when already aligned', () => {
    expect(suggestLineSnap(s(0, 50, 100, 50), [s(0, 50, 100, 50)])).toBeNull()
  })

  it('stays quiet when too far (intentional separate wall)', () => {
    expect(suggestLineSnap(s(0, 50, 100, 50), [s(0, 10, 100, 10)])).toBeNull()
  })

  it('ignores parallel lines that do not run alongside (no overlap)', () => {
    const wall = s(0, 50, 40, 50)
    const other = s(200, 44, 300, 44) // parallel & near in Y, but far along X
    expect(suggestLineSnap(wall, [other])).toBeNull()
  })

  it('ignores perpendicular walls', () => {
    expect(suggestLineSnap(s(0, 50, 100, 50), [s(50, 0, 50, 100)])).toBeNull()
  })

  it('picks the nearest parallel neighbour', () => {
    const wall = s(0, 50, 100, 50)
    const r = suggestLineSnap(wall, [s(0, 40, 100, 40), s(0, 46, 100, 46)])
    expect(r!.offsetPx).toBe(4) // 46 is nearer than 40
    expect(r!.rect.y1).toBe(46)
  })
})
