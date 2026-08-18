import { describe, it, expect } from 'vitest'
import { reviewDetection, topDoubt, type DetectionReviewInput, type ReviewWall } from './detectionReview'

/** A clean, believable run of walls: all roughly the same order of length. */
function cleanWalls(n = 12): ReviewWall[] {
  return Array.from({ length: n }, (_, i) => ({
    x1: 0, y1: i * 10, x2: 400, y2: i * 10, detectionConfidence: 0.9, source: 'auto' as const,
  }))
}

/** Scraps: far shorter than the median, the way lettering and tick marks read. */
function stubs(n: number): ReviewWall[] {
  return Array.from({ length: n }, (_, i) => ({
    x1: 0, y1: i * 3, x2: 6, y2: i * 3, detectionConfidence: 0.9, source: 'auto' as const,
  }))
}

const base: DetectionReviewInput = {
  scaleConfidence: 'parsed',
  scaleMmPerPx: 12.7,
  walls: cleanWalls(),
  roomCount: 6,
  openingCount: 9,
}
const input = (over: Partial<DetectionReviewInput>): DetectionReviewInput => ({ ...base, ...over })

describe('reviewDetection — stays quiet when the reading looks sound', () => {
  it('says nothing about a clean, scaled plan', () => {
    expect(reviewDetection(base)).toEqual([])
    expect(topDoubt(base)).toBeNull()
  })

  it('does not cry fragmentation on a small wall count', () => {
    // Four walls, one of them short, is a plausible little building — not noise.
    const walls = [...cleanWalls(3), ...stubs(1)]
    expect(reviewDetection(input({ walls })).map((d) => d.id)).not.toContain('doubt-fragmented')
  })

  it('ignores user-traced walls entirely — their line is ground truth', () => {
    const traced = stubs(20).map((w) => ({ ...w, source: 'user' as const, detectionConfidence: 0.1 }))
    expect(reviewDetection(input({ walls: [...cleanWalls(4), ...traced] }))).toEqual([])
  })
})

describe('reviewDetection — missing scale outranks everything', () => {
  it('flags a fallback scale', () => {
    const d = topDoubt(input({ scaleConfidence: 'fallback' }))
    expect(d?.id).toBe('doubt-scale')
    expect(d?.actionFix).toBe('calibrate')
  })

  it('flags a null scale even when the notation parsed', () => {
    expect(topDoubt(input({ scaleMmPerPx: null }))?.id).toBe('doubt-scale')
  })

  it('comes first when the plan is also fragmented', () => {
    const walls = [...cleanWalls(10), ...stubs(10)]
    const ids = reviewDetection(input({ scaleMmPerPx: null, walls })).map((d) => d.id)
    expect(ids[0]).toBe('doubt-scale')
    expect(ids).toContain('doubt-fragmented')
  })
})

describe('reviewDetection — the pile of offcuts', () => {
  it('flags a raster that is mostly scraps', () => {
    // 10 real walls + 10 stubs: half the segments are a quarter of the median.
    const d = reviewDetection(input({ walls: [...cleanWalls(10), ...stubs(10)] }))
      .find((x) => x.id === 'doubt-fragmented')
    expect(d).toBeDefined()
    expect(d?.actionFix).toBe('trace')
  })

  it('names the counts so the number is checkable, not a vibe', () => {
    const d = reviewDetection(input({ walls: [...cleanWalls(10), ...stubs(10)], roomCount: 18 }))
      .find((x) => x.id === 'doubt-fragmented')
    expect(d?.message).toContain('20 walls')
    expect(d?.message).toContain('18 rooms')
  })

  it('omits the room clause when no rooms were found', () => {
    const d = reviewDetection(input({ walls: [...cleanWalls(10), ...stubs(10)], roomCount: 0 }))
      .find((x) => x.id === 'doubt-fragmented')
    expect(d?.message).not.toContain('rooms')
  })
})

describe('reviewDetection — the detector doubting itself', () => {
  it('flags a shaky majority', () => {
    const shaky = cleanWalls(8).map((w) => ({ ...w, detectionConfidence: 0.2 }))
    const d = reviewDetection(input({ walls: [...cleanWalls(4), ...shaky] }))
      .find((x) => x.id === 'doubt-confidence')
    expect(d).toBeDefined()
  })

  it('tolerates a couple of guesses', () => {
    const walls = [...cleanWalls(11), { ...cleanWalls(1)[0], detectionConfidence: 0.1 }]
    expect(reviewDetection(input({ walls })).map((d) => d.id)).not.toContain('doubt-confidence')
  })

  it('says nothing when the detector reported no confidence at all', () => {
    const walls = cleanWalls(12).map(({ detectionConfidence: _drop, ...w }) => w)
    expect(reviewDetection(input({ walls })).map((d) => d.id)).not.toContain('doubt-confidence')
  })
})

describe('topDoubt — one question at a time', () => {
  it('returns the highest-leverage doubt only', () => {
    const shaky = cleanWalls(8).map((w) => ({ ...w, detectionConfidence: 0.2 }))
    const all = reviewDetection(input({ scaleMmPerPx: null, walls: [...shaky, ...stubs(10)] }))
    expect(all.length).toBeGreaterThan(1)
    expect(topDoubt(input({ scaleMmPerPx: null, walls: [...shaky, ...stubs(10)] }))).toEqual(all[0])
  })
})
