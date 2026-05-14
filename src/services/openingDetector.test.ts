import { describe, it, expect } from 'vitest'
import { detectOpenings } from './openingDetector'
import type { ParsedWall } from '../types'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function wall(x1: number, y1: number, x2: number, y2: number): ParsedWall {
  return { x1, y1, x2, y2, thickness: 4, source: 'auto' }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('detectOpenings', () => {
  it('returns empty array for empty wall list', () => {
    expect(detectOpenings([])).toHaveLength(0)
  })

  it('detects a single horizontal opening between two co-linear wall segments', () => {
    const walls = [
      wall(0, 10, 100, 10),   // left wall segment, ends at x=100
      wall(150, 10, 300, 10), // right segment, starts at x=150 → gap = 50 px
    ]
    const openings = detectOpenings(walls, { minGapPx: 10, maxGapPx: 200 })
    expect(openings).toHaveLength(1)
    expect(openings[0].orientation).toBe('horizontal')
    expect(openings[0].widthPx).toBe(50)
    expect(openings[0].x).toBe(125) // mid of gap: 100 + 50/2
  })

  it('detects a single vertical opening between two co-linear wall segments', () => {
    const walls = [
      wall(20, 0, 20, 80),    // top segment, ends at y=80
      wall(20, 130, 20, 200), // bottom segment, starts at y=130 → gap = 50 px
    ]
    const openings = detectOpenings(walls, { minGapPx: 10, maxGapPx: 200 })
    expect(openings).toHaveLength(1)
    expect(openings[0].orientation).toBe('vertical')
    expect(openings[0].widthPx).toBe(50)
    expect(openings[0].y).toBe(105) // mid of gap: 80 + 50/2
  })

  it('ignores gaps smaller than minGapPx', () => {
    const walls = [
      wall(0, 10, 100, 10),
      wall(104, 10, 200, 10), // gap = 4 px
    ]
    const openings = detectOpenings(walls, { minGapPx: 10 })
    expect(openings).toHaveLength(0)
  })

  it('ignores gaps larger than maxGapPx', () => {
    const walls = [
      wall(0, 10, 100, 10),
      wall(500, 10, 600, 10), // gap = 400 px
    ]
    const openings = detectOpenings(walls, { minGapPx: 10, maxGapPx: 200 })
    expect(openings).toHaveLength(0)
  })

  it('classifies as door when gap falls in door-width range', () => {
    // scaleMmPerPx = 1 → 1 px = 1 mm; gap = 800 px = 800 mm → door (600–1800mm)
    const walls = [
      wall(0, 10, 100, 10),
      wall(900, 10, 1200, 10), // gap = 800 px
    ]
    const openings = detectOpenings(walls, { scaleMmPerPx: 1, minGapPx: 10, maxGapPx: 2000 })
    expect(openings).toHaveLength(1)
    expect(openings[0].type).toBe('door')
    expect(openings[0].widthMm).toBe(800)
  })

  it('classifies as window when gap falls in window-width range (but not door range)', () => {
    // gap = 400 px × 1 mm/px = 400 mm → window (250–3000 mm, outside door range 600–1800)
    const walls = [
      wall(0, 10, 100, 10),
      wall(500, 10, 800, 10), // gap = 400 px
    ]
    const openings = detectOpenings(walls, { scaleMmPerPx: 1, minGapPx: 10, maxGapPx: 2000 })
    expect(openings).toHaveLength(1)
    expect(openings[0].type).toBe('window')
    expect(openings[0].widthMm).toBe(400)
  })

  it('classifies as unknown when scale is not provided', () => {
    const walls = [
      wall(0, 10, 100, 10),
      wall(200, 10, 400, 10),
    ]
    const openings = detectOpenings(walls, { minGapPx: 10, maxGapPx: 500 })
    expect(openings).toHaveLength(1)
    expect(openings[0].type).toBe('unknown')
    expect(openings[0].widthMm).toBeNull()
  })

  it('groups walls within LINE_SNAP_PX tolerance as co-linear', () => {
    // With LINE_SNAP_PX = 16, bucket = Math.round(y / 16) * 16
    // y=4  → round(4/16)*16  = 0*16 = 0
    // y=7  → round(7/16)*16  = 0*16 = 0  (both in same bucket)
    const walls = [
      wall(0, 4, 100, 4),
      wall(150, 7, 300, 7), // y offset = 3px — same bucket as y=4
    ]
    const openings = detectOpenings(walls, { minGapPx: 10, maxGapPx: 200 })
    expect(openings).toHaveLength(1)
  })

  it('does not group walls beyond LINE_SNAP_PX tolerance', () => {
    // y=7  → bucket = round(7/16)*16  = 0*16 = 0
    // y=30 → bucket = round(30/16)*16 = 2*16 = 32  — different buckets
    const walls = [
      wall(0, 7, 100, 7),
      wall(150, 30, 300, 30),
    ]
    const openings = detectOpenings(walls, { minGapPx: 10, maxGapPx: 200 })
    expect(openings).toHaveLength(0)
  })

  it('detects multiple openings in the same wall line', () => {
    const walls = [
      wall(0, 10, 100, 10),
      wall(150, 10, 250, 10), // gap at 100–150
      wall(300, 10, 400, 10), // gap at 250–300
    ]
    const openings = detectOpenings(walls, { minGapPx: 10, maxGapPx: 200 })
    expect(openings).toHaveLength(2)
  })
})
