import { describe, it, expect } from 'vitest'
import { suggestFlushEdge, type Rect } from './flushInference'

const r = (x1: number, y1: number, x2: number, y2: number): Rect => ({ x1, y1, x2, y2 })

describe('suggestFlushEdge', () => {
  it('suggests closing a small gap to the neighbour on the left', () => {
    const existing = [r(0, 0, 100, 100)]      // neighbour occupies x 0..100
    const candidate = r(112, 10, 212, 90)      // 12px gap on its left edge
    const s = suggestFlushEdge(candidate, existing, 24)
    expect(s).not.toBeNull()
    expect(s!.edge).toBe('left')
    expect(s!.gapPx).toBe(12)
    expect(s!.rect.x1).toBe(100)             // snapped flush to neighbour's right
    expect(s!.rect.x2).toBe(200)             // width (100) preserved
  })

  it('suggests closing an overlap (candidate overlapping neighbour) too', () => {
    const existing = [r(0, 0, 100, 100)]
    const candidate = r(92, 10, 192, 90)       // 8px overlap on the left
    const s = suggestFlushEdge(candidate, existing, 24)
    expect(s!.edge).toBe('left')
    expect(s!.rect.x1).toBe(100)
  })

  it('works vertically (stacked in plan)', () => {
    const existing = [r(0, 0, 100, 100)]
    const candidate = r(10, 110, 90, 210)      // 10px gap below
    const s = suggestFlushEdge(candidate, existing, 24)
    expect(s!.edge).toBe('top')
    expect(s!.rect.y1).toBe(100)
  })

  it('returns null when already flush', () => {
    const existing = [r(0, 0, 100, 100)]
    const candidate = r(100, 0, 200, 100)      // perfectly flush
    expect(suggestFlushEdge(candidate, existing, 24)).toBeNull()
  })

  it('returns null when the gap exceeds tolerance', () => {
    const existing = [r(0, 0, 100, 100)]
    const candidate = r(160, 10, 260, 90)      // 60px away — not intentional
    expect(suggestFlushEdge(candidate, existing, 24)).toBeNull()
  })

  it('ignores a diagonal near-miss (no perpendicular overlap)', () => {
    const existing = [r(0, 0, 100, 100)]
    const candidate = r(112, 130, 212, 230)    // near on x, but below — no vert overlap
    expect(suggestFlushEdge(candidate, existing, 24)).toBeNull()
  })

  it('picks the nearest of several neighbours', () => {
    const existing = [r(0, 0, 100, 100), r(118, 0, 218, 100)]
    const candidate = r(106, 10, 116, 90)      // 6px from left nbr right(100), 2px from right nbr left(118)
    const s = suggestFlushEdge(candidate, existing, 24)
    expect(s!.gapPx).toBe(2)                   // nearest wins → snap right edge to 118
    expect(s!.edge).toBe('right')
  })
})
