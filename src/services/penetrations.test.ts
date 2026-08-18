import { describe, it, expect } from 'vitest'
import { borePlan, notchPlan, cableNeedsNailPlate, NAIL_PLATE_CLEARANCE_MM } from './penetrations'
import type { Member } from './penetrations'

/** Actual dimensions, not nominal — a 2x4 is 38×89, a 2x10 is 38×235. */
const stud = (role: 'bearing' | 'nonbearing' = 'bearing'): Member =>
  ({ kind: 'stud', role, widthMm: 89 })
const joist = (spanMm = 4000): Member =>
  ({ kind: 'joist', role: 'bearing', widthMm: 235, spanMm })

describe('boring a stud', () => {
  it('allows a normal wire hole dead centre', () => {
    // 3/4" hole, centred in a 2x4 — the everyday case.
    expect(borePlan({ member: stud(), diameterMm: 19, fromEdgeMm: 44.5 }).ok).toBe(true)
  })

  it('needs the stud doubled past 40% in a bearing wall', () => {
    const v = borePlan({ member: stud('bearing'), diameterMm: 45, fromEdgeMm: 44.5 })
    expect(v.ok).toBe(true)
    expect(v.requires).toBe('doubled stud')
  })

  it('does not demand doubling in a non-bearing wall', () => {
    const v = borePlan({ member: stud('nonbearing'), diameterMm: 45, fromEdgeMm: 44.5 })
    expect(v.ok).toBe(true)
    expect(v.requires).toBeUndefined()
  })

  it('refuses past 60% however the wall is loaded', () => {
    expect(borePlan({ member: stud('nonbearing'), diameterMm: 60, fromEdgeMm: 44.5 }).ok).toBe(false)
  })

  it('refuses a hole crowding the edge', () => {
    // 2" pipe pushed to one side leaves under 5/8" of wood.
    expect(borePlan({ member: stud(), diameterMm: 50, fromEdgeMm: 30 }).ok).toBe(false)
  })
})

describe('boring a joist', () => {
  it('allows a third of the depth', () => {
    expect(borePlan({ member: joist(), diameterMm: 76, fromEdgeMm: 117 }).ok).toBe(true)
  })

  it('refuses more than a third', () => {
    expect(borePlan({ member: joist(), diameterMm: 90, fromEdgeMm: 117 }).ok).toBe(false)
  })

  it('refuses a hole within 2" of an edge', () => {
    expect(borePlan({ member: joist(), diameterMm: 50, fromEdgeMm: 60 }).ok).toBe(false)
  })

  it('allows a hole in the middle third of the span — the part people get wrong', () => {
    const v = borePlan({ member: joist(4000), diameterMm: 60, fromEdgeMm: 117, alongSpanMm: 2000 })
    expect(v.ok).toBe(true)
  })
})

describe('notching', () => {
  it('refuses to notch the middle third of a joist', () => {
    const v = notchPlan({ member: joist(4000), depthMm: 20, lengthMm: 40, alongSpanMm: 2000 })
    expect(v.ok).toBe(false)
    expect(v.reason).toMatch(/middle third/i)
  })

  it('allows a small notch near the bearing end', () => {
    expect(notchPlan({ member: joist(4000), depthMm: 20, lengthMm: 40, alongSpanMm: 300 }).ok).toBe(true)
  })

  it('holds a bearing stud to 25% and a partition to 40%', () => {
    // 30mm of an 89mm stud is 34% — too deep to bear, fine in a partition.
    expect(notchPlan({ member: stud('bearing'), depthMm: 30 }).ok).toBe(false)
    expect(notchPlan({ member: stud('nonbearing'), depthMm: 30 }).ok).toBe(true)
  })

  it('sends you to the drill rather than the saw', () => {
    expect(notchPlan({ member: stud('bearing'), depthMm: 30 }).reason).toMatch(/bore it instead/i)
  })
})

describe('nail plates', () => {
  it('a centred hole in a 2x4 lands exactly on the limit and needs no plate', () => {
    // 89 / 2 = 44.5 mm each side, against a 31.75 mm requirement.
    expect(cableNeedsNailPlate({ studWidthMm: 89, fromFaceMm: 44.5 })).toBe(false)
    expect(NAIL_PLATE_CLEARANCE_MM).toBeCloseTo(31.75, 2)
  })

  it('an off-centre hole needs one', () => {
    expect(cableNeedsNailPlate({ studWidthMm: 89, fromFaceMm: 20 })).toBe(true)
  })

  it('a 2x3 cannot satisfy it however you drill', () => {
    // 64mm actual: the best case is 32mm each side… which is under the limit
    // once the hole has any width at all.
    expect(cableNeedsNailPlate({ studWidthMm: 64, fromFaceMm: 25 })).toBe(true)
  })
})
