import { describe, it, expect } from 'vitest'
import { rejoinAcrossOpenings } from './openingDetector'
import type { ParsedWall } from '../types'

/** A horizontal wall segment on line y, from x1 to x2. */
const h = (x1: number, x2: number, y: number): ParsedWall => ({
  x1, y1: y, x2, y2: y, thickness: 8, source: 'auto', detectionConfidence: 0.9,
})

/** 23.5 mm/px is the app's fallback scale, so these gaps are real-world sized. */
const SCALE = 23.5

describe('rejoining walls across their openings', () => {
  it('welds two segments separated by a doorway into one wall', () => {
    // 900mm door ≈ 38px at 23.5 mm/px — the exact case that was splitting walls.
    const walls = [h(0, 200, 100), h(238, 500, 100)]
    const { walls: out, openings } = rejoinAcrossOpenings(walls, { scaleMmPerPx: SCALE })

    expect(out).toHaveLength(1)
    expect(out[0].x1).toBe(0)
    expect(out[0].x2).toBe(500)
    // The opening is not lost — it is carried, not swallowed.
    expect(openings.some((o) => o.type === 'door')).toBe(true)
  })

  it('welds across a window too', () => {
    // 1200mm window ≈ 51px.
    const walls = [h(0, 200, 60), h(251, 400, 60)]
    const { walls: out } = rejoinAcrossOpenings(walls, { scaleMmPerPx: SCALE })
    expect(out).toHaveLength(1)
    expect(out[0].x2).toBe(400)
  })

  it('leaves a gap it cannot identify alone', () => {
    // ~3.5m of nothing is not a door or a window — it is a missing wall, a
    // corridor, or a detection failure. Welding it would invent a wall that
    // does not exist, which is worse than leaving two.
    const walls = [h(0, 200, 30), h(350, 600, 30)]
    const { walls: out } = rejoinAcrossOpenings(walls, { scaleMmPerPx: SCALE })
    expect(out).toHaveLength(2)
  })

  it('does not weld segments on different walls', () => {
    // Same span, different lines — a door-sized gap between them means nothing.
    const walls = [h(0, 200, 100), h(238, 500, 400)]
    const { walls: out } = rejoinAcrossOpenings(walls, { scaleMmPerPx: SCALE })
    expect(out).toHaveLength(2)
  })

  it('keeps the wall it welds into, framing and all', () => {
    const walls: ParsedWall[] = [
      { ...h(0, 200, 100), framingType: 'wood-2x8', wallRole: 'exterior-bearing' },
      h(238, 500, 100),
    ]
    const { walls: out } = rejoinAcrossOpenings(walls, { scaleMmPerPx: SCALE })
    expect(out).toHaveLength(1)
    // A doorway does not change what the wall is made of.
    expect(out[0].framingType).toBe('wood-2x8')
    expect(out[0].wallRole).toBe('exterior-bearing')
  })

  it('welds across a doorway in an angled wall', () => {
    // The weld was axis-aligned too, so even once an angled doorway WAS found
    // the wall either side of it stayed split in two.
    const a: ParsedWall = { x1: 0, y1: 0, x2: 200, y2: 200, thickness: 8, source: 'auto' }
    const b: ParsedWall = { x1: 227, y1: 227, x2: 500, y2: 500, thickness: 8, source: 'auto' }
    const { walls: out, openings } = rejoinAcrossOpenings([a, b], { scaleMmPerPx: SCALE })

    expect(out).toHaveLength(1)
    expect(out[0].x1).toBeCloseTo(0, 6)
    expect(out[0].y1).toBeCloseTo(0, 6)
    expect(out[0].x2).toBeCloseTo(500, 6)
    expect(out[0].y2).toBeCloseTo(500, 6)
    expect(openings.some((o) => o.type === 'door')).toBe(true)
  })

  it('passes walls through untouched when there is nothing to bridge', () => {
    const walls = [h(0, 500, 100)]
    const { walls: out } = rejoinAcrossOpenings(walls, { scaleMmPerPx: SCALE })
    expect(out).toEqual(walls)
  })
})

describe('welding a doorway when the scale is unknown', () => {
  // One interior wall with three doorways in it: 4 segments, 3 door-sized gaps.
  const run = [h(0, 200, 100), h(238, 500, 100), h(538, 800, 100), h(838, 1100, 100)]

  it('WITH scale: welds back to one wall', () => {
    const { walls } = rejoinAcrossOpenings(run, { scaleMmPerPx: 23.5 })
    expect(walls).toHaveLength(1)
  })

  it('WITHOUT scale: still welds, using the wall thickness as the ruler', () => {
    const { walls, openings } = rejoinAcrossOpenings(run, {})
    expect(openings.length).toBe(3)          // the gaps are found
    expect(openings.every((o) => o.type === 'unknown')).toBe(true)  // still unclassified
    expect(walls).toHaveLength(1)            // ...and bridged anyway
  })

  it('WITHOUT scale: does NOT weld a gap far too wide to be an opening', () => {
    // 8px walls, 600px gap = 75x the thickness. A corridor, not a door.
    const wide = [h(0, 200, 100), h(800, 1000, 100)]
    const { walls } = rejoinAcrossOpenings(wide, { maxGapPx: 900 })
    expect(walls).toHaveLength(2)
  })
})
