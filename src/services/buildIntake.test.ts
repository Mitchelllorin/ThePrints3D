import { describe, it, expect } from 'vitest'
import { planIntake, scaleFromFloorArea, type IntakeState } from './buildIntake'

/** A drawing that read cleanly: nothing left to ask. */
const known: IntakeState = {
  scaleKnown: true,
  ceilingM: 2.44,
  storeys: 1,
  fragmented: false,
  ambiguousOpenings: 0,
  buildType: 'residential-single',
}
const state = (over: Partial<IntakeState>): IntakeState => ({ ...known, ...over })
const ids = (s: IntakeState) => planIntake(s).map((q) => q.id)

describe('planIntake — asks only what is still unknown', () => {
  it('asks nothing at all when the print read cleanly', () => {
    expect(planIntake(known)).toEqual([])
  })

  it('asks one question when only the scale is missing', () => {
    expect(ids(state({ scaleKnown: false }))).toEqual(['intake-area'])
  })

  it('asks everything it needs on a phone photo that read badly', () => {
    const all = ids(state({ scaleKnown: false, ceilingM: null, storeys: null, fragmented: true, ambiguousOpenings: 8 }))
    expect(all).toEqual(['intake-area', 'intake-ceiling', 'intake-outline', 'intake-storeys', 'intake-openings'])
  })

  it('orders by leverage — scale before ceiling before openings', () => {
    const qs = planIntake(state({ scaleKnown: false, ceilingM: null, ambiguousOpenings: 3 }))
    expect(qs.map((q) => q.leverage)).toEqual([...qs.map((q) => q.leverage)].sort((a, b) => b - a))
  })
})

describe('planIntake — every question is answerable in one tap', () => {
  it('pre-fills a residential ceiling at 8 feet', () => {
    const q = planIntake(state({ ceilingM: null })).find((x) => x.id === 'intake-ceiling')
    expect(q?.suggested).toBe('8')
    expect(q?.unit).toBe('ft')
  })

  it('starts commercial higher', () => {
    const q = planIntake(state({ ceilingM: null, buildType: 'commercial-retail' })).find((x) => x.id === 'intake-ceiling')
    expect(q?.suggested).toBe('10')
  })

  it('defaults to a single storey', () => {
    expect(planIntake(state({ storeys: null })).find((x) => x.id === 'intake-storeys')?.suggested).toBe('1')
  })

  it('leaves only the square footage blank — the one thing we cannot guess', () => {
    const qs = planIntake(state({ scaleKnown: false, ceilingM: null, storeys: null }))
    expect(qs.filter((q) => q.suggested === '').map((q) => q.id)).toEqual(['intake-area'])
  })

  it('gives every question a reason, so it reads as a colleague not a form', () => {
    const qs = planIntake(state({ scaleKnown: false, ceilingM: null, storeys: null, fragmented: true, ambiguousOpenings: 2 }))
    for (const q of qs) expect(q.because.length).toBeGreaterThan(10)
  })
})

describe('planIntake — the openings pass is batched, never one prompt each', () => {
  it('asks once about eight openings', () => {
    const qs = planIntake(state({ ambiguousOpenings: 8 })).filter((q) => q.id === 'intake-openings')
    expect(qs).toHaveLength(1)
    expect(qs[0].prompt).toContain('8 openings')
  })

  it('reads naturally for a single opening', () => {
    const q = planIntake(state({ ambiguousOpenings: 1 })).find((x) => x.id === 'intake-openings')
    expect(q?.prompt).toContain('1 opening I')
    expect(q?.prompt).not.toContain('openings')
  })
})

describe('scaleFromFloorArea', () => {
  it('recovers a known scale', () => {
    // 1000 sq ft drawn over 1,000,000 px² → 1 sq ft per 1000 px².
    // 1 sq ft = 92903.04 mm², so mm/px = sqrt(92903.04/1000) ≈ 9.639
    expect(scaleFromFloorArea(1_000_000, 1000)).toBeCloseTo(9.6386, 3)
  })

  it('round-trips: a scale applied to an area gives that area back', () => {
    const px2 = 640_000
    const sqft = 1800
    const mmPerPx = scaleFromFloorArea(px2, sqft)!
    const backSqFt = (px2 * mmPerPx * mmPerPx) / 92903.04
    expect(backSqFt).toBeCloseTo(sqft, 6)
  })

  it('is forgiving — 10% out on the area is only ~5% out on a length', () => {
    const truth = scaleFromFloorArea(500_000, 2000)!
    const sloppy = scaleFromFloorArea(500_000, 2200)!
    expect(sloppy / truth).toBeCloseTo(Math.sqrt(1.1), 6)
    expect(sloppy / truth).toBeLessThan(1.05)
  })

  it('refuses rather than inventing a number', () => {
    expect(scaleFromFloorArea(0, 1000)).toBeNull()
    expect(scaleFromFloorArea(1000, 0)).toBeNull()
    expect(scaleFromFloorArea(-5, 1000)).toBeNull()
    expect(scaleFromFloorArea(1000, Number.NaN)).toBeNull()
  })
})
