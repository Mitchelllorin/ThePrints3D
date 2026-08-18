import { describe, it, expect } from 'vitest'
import {
  solveStair, stairIssues, stairOpeningM, stairHolePlacement,
  MAX_RISER_M, MIN_TREAD_M, MIN_WIDTH_M, MIN_LANDING_M, MAX_FLIGHT_RISE_M,
} from './stairs'

// A typical residential storey: 8' ceiling + floor assembly ≈ 2.76 m.
const STOREY = 2.76

describe('stair solver', () => {
  it('divides the rise into EQUAL risers, never a fixed riser plus a remainder', () => {
    const s = solveStair({ totalRiseM: STOREY })
    // Every riser identical is the whole point — unequal risers are both a code
    // violation and the classic way people fall down stairs.
    expect(s.riserCount * s.riserM).toBeCloseTo(STOREY, 9)
    expect(s.riserM).toBeLessThanOrEqual(MAX_RISER_M + 1e-9)
  })

  it('uses the fewest legal risers for an awkward rise', () => {
    // 3.0 m at 7-3/4" max needs at least 16 risers.
    const s = solveStair({ totalRiseM: 3.0, targetRiserM: 0.35 })
    expect(s.riserCount).toBeGreaterThanOrEqual(Math.ceil(3.0 / MAX_RISER_M))
    expect(s.riserM).toBeLessThanOrEqual(MAX_RISER_M + 1e-9)
  })

  it('gives a flight one fewer tread than risers', () => {
    // The top riser lands on the floor above; there is no tread up there.
    const s = solveStair({ totalRiseM: STOREY, shape: 'straight' })
    expect(s.totalRunM).toBeCloseTo((s.riserCount - 1) * s.treadM, 9)
  })

  it('defaults to the code minimums for tread and width', () => {
    const s = solveStair({ totalRiseM: STOREY })
    expect(s.treadM).toBeCloseTo(MIN_TREAD_M, 9)
    expect(s.widthM).toBeCloseTo(MIN_WIDTH_M, 9)
  })

  it('splits a turned stair into two flights with a landing between', () => {
    for (const shape of ['l-shaped', 'u-shaped', 'switchback'] as const) {
      const s = solveStair({ totalRiseM: STOREY, shape })
      expect(s.flightRisers.length).toBe(2)
      expect(s.flightRisers.reduce((a, b) => a + b, 0)).toBe(s.riserCount)
      expect(s.landingsM.length).toBe(1)
      expect(s.landingsM[0]).toBeGreaterThanOrEqual(MIN_LANDING_M - 1e-9)
    }
  })

  it('never lets a landing fall under the 36" minimum, even if asked', () => {
    const s = solveStair({ totalRiseM: STOREY, shape: 'l-shaped', landingM: 0.3 })
    expect(s.landingsM[0]).toBeCloseTo(MIN_LANDING_M, 9)
  })

  it('folds a turned stair into a shorter, wider footprint than a straight run', () => {
    const straight = solveStair({ totalRiseM: STOREY, shape: 'straight' })
    const u = solveStair({ totalRiseM: STOREY, shape: 'u-shaped' })
    expect(u.footprint.lengthM).toBeLessThan(straight.footprint.lengthM)
    expect(u.footprint.widthM).toBeGreaterThan(straight.footprint.widthM)
  })
})

describe('stair code checks', () => {
  it('passes a normal residential stair', () => {
    expect(stairIssues(solveStair({ totalRiseM: STOREY }))).toEqual([])
  })

  it('flags a tread that is too shallow and a stair that is too narrow', () => {
    const s = solveStair({ totalRiseM: STOREY, treadM: 0.2, widthM: 0.7 })
    const codes = stairIssues(s).map((i) => i.code)
    expect(codes).toContain('R311.7.5.2')   // tread
    expect(codes).toContain('R311.7.1')     // width
  })

  it('flags insufficient headroom when told the headroom', () => {
    const s = solveStair({ totalRiseM: STOREY })
    expect(stairIssues(s, 1.9).map((i) => i.code)).toContain('R311.7.2')
    expect(stairIssues(s, 2.2)).toEqual([])
  })

  it('flags a single flight that climbs too far without a landing', () => {
    const s = solveStair({ totalRiseM: MAX_FLIGHT_RISE_M + 0.5, shape: 'straight' })
    expect(stairIssues(s).map((i) => i.code)).toContain('R311.7.3')
    // Turning it puts a landing in and resolves that particular complaint.
    const turned = solveStair({ totalRiseM: MAX_FLIGHT_RISE_M + 0.5, shape: 'u-shaped' })
    expect(stairIssues(turned).map((i) => i.code)).not.toContain('R311.7.3')
  })

  it('reports problems in inches, which is how they are specified', () => {
    const s = solveStair({ totalRiseM: STOREY, treadM: 0.2 })
    expect(stairIssues(s)[0].message).toMatch(/"/)
  })
})

describe('stair floor opening', () => {
  it('runs the opening back far enough to keep headroom over the treads', () => {
    const s = solveStair({ totalRiseM: STOREY })
    const o = stairOpeningM(s)
    // Headroom is measured to the underside of the floor assembly, so the hole is
    // longer than the naive "just over the top few steps".
    expect(o.lengthM).toBeGreaterThan(s.treadM * 3)
    expect(o.widthM).toBeCloseTo(s.footprint.widthM, 9)
  })

  it('never asks for an opening longer than the stair itself', () => {
    const s = solveStair({ totalRiseM: STOREY })
    expect(stairOpeningM(s).lengthM).toBeLessThanOrEqual(s.footprint.lengthM + 1e-9)
  })

  it('needs a longer opening when the risers are shallower', () => {
    // Shallower risers climb slower, so you travel further before your head
    // clears the floor above.
    const steep = solveStair({ totalRiseM: STOREY, targetRiserM: MAX_RISER_M })
    const shallow = solveStair({ totalRiseM: STOREY, targetRiserM: 0.15 })
    expect(stairOpeningM(shallow).lengthM).toBeGreaterThanOrEqual(stairOpeningM(steep).lengthM)
  })
})

describe('the stairwell opening lines up with the stairs', () => {
  const straight = solveStair({ totalRiseM: 2.9, shape: 'straight' })
  const open = stairOpeningM(straight, 0.32)
  const place = (yaw = 0) => stairHolePlacement({
    openingLengthM: open.lengthM,
    openingWidthM: open.widthM,
    footprintLengthM: straight.footprint.lengthM,
    yaw,
  })

  it('pushes the hole to the TOP of the run, not the middle of it', () => {
    // The regression: the opening is a sub-span measured back from the top, so
    // centring it on the stair leaves the top of the flight under solid deck.
    expect(open.lengthM).toBeLessThan(straight.footprint.lengthM)
    expect(place().shiftZ).toBeCloseTo((straight.footprint.lengthM - open.lengthM) / 2, 6)
    expect(place().shiftZ).toBeGreaterThan(0)
  })

  it('lands the hole flush with the top end of the run', () => {
    // Top of the run sits at +footprint/2; the hole's far edge must reach it.
    const p = place()
    expect(p.shiftZ + open.lengthM / 2).toBeCloseTo(straight.footprint.lengthM / 2, 6)
  })

  it('does not shift a hole that already spans the whole run', () => {
    // A short flight needs its full footprint open — nothing to slide.
    const p = stairHolePlacement({
      openingLengthM: 3, openingWidthM: 1, footprintLengthM: 3,
    })
    expect(p.shiftZ).toBeCloseTo(0, 9)
  })

  it('carries the shift along the way the stair actually faces', () => {
    // Turned a quarter turn, the run points down world X, not Z.
    const p = place(Math.PI / 2)
    expect(p.shiftX).toBeCloseTo((straight.footprint.lengthM - open.lengthM) / 2, 6)
    expect(p.shiftZ).toBeCloseTo(0, 6)
  })

  it('swaps the hole’s sides when the stair is turned a quarter turn', () => {
    const flat = place(0), turned = place(Math.PI / 2)
    expect(turned.w).toBeCloseTo(flat.d, 6)
    expect(turned.d).toBeCloseTo(flat.w, 6)
  })

  it('never returns a hole smaller than the opening it has to clear', () => {
    for (const yaw of [0, 0.4, Math.PI / 4, 1.9, Math.PI]) {
      const p = place(yaw)
      expect(p.w).toBeGreaterThanOrEqual(Math.min(open.widthM, open.lengthM) - 1e-9)
      expect(p.d).toBeGreaterThanOrEqual(Math.min(open.widthM, open.lengthM) - 1e-9)
    }
  })
})
