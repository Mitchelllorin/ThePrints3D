import { describe, it, expect } from 'vitest'
import { planFloorSupports, bearingLines, maxJoistSpanM, flushLvlDepthIn, supportsAt } from './floorSupports'
import { buildFloorJoists } from './framingGeometry'

const I = 0.302 // I-joist depth
const W = (x1: number, z1: number, x2: number, z2: number) => ({ x1, z1, x2, z2, t: 0.14 })

describe('floor supports', () => {
  it('a short floor needs nothing', () => {
    // 4 m across, 10 m long: I-joists span the 4 m.
    const plan = planFloorSupports({ lenX: 4, lenZ: 10, element: 'I-Joist', ocM: 0.406, joistDepthM: I, wallsBelow: [] })
    expect(plan.spanAlongX).toBe(true)
    expect(plan.beams).toHaveLength(0)
  })

  it('a wide floor with no wall under it gets a flush LVL down the middle', () => {
    // 8 m across: past 5.5 m, so one beam halves it.
    const plan = planFloorSupports({ lenX: 8, lenZ: 12, element: 'I-Joist', ocM: 0.406, joistDepthM: I, wallsBelow: [] })
    expect(plan.beams).toHaveLength(1)
    const b = plan.beams[0]
    expect(Math.abs(b.s)).toBeLessThan(0.3)
    // Wall to wall along the run, so its ends bear on the outside walls.
    expect(b.p0).toBeCloseTo(-6)
    expect(b.p1).toBeCloseTo(6)
    expect(b.label).toContain('11-7/8')
    // 12 m is too far for one LVL: posts under it.
    expect(b.posts.length).toBeGreaterThan(0)
    expect(b.spanM).toBeLessThanOrEqual(6.1)
  })

  it('an inside wall below across the joists carries them — no beam', () => {
    const plan = planFloorSupports({
      lenX: 8, lenZ: 12, element: 'I-Joist', ocM: 0.406, joistDepthM: I,
      wallsBelow: [W(0.2, -6, 0.2, 6)],
    })
    expect(plan.bearings).toHaveLength(1)
    expect(plan.beams).toHaveLength(0)
  })

  it('a wall that only carries part of the run leaves a beam for the rest', () => {
    // The wall below covers the back half only; the front half needs a beam.
    const plan = planFloorSupports({
      lenX: 8, lenZ: 12, element: 'I-Joist', ocM: 0.406, joistDepthM: I,
      wallsBelow: [W(0, -6, 0, 0)],
    })
    expect(plan.beams).toHaveLength(1)
    expect(plan.beams[0].p0).toBeGreaterThan(-0.5)
    expect(plan.beams[0].p1).toBeCloseTo(6)
    // The end that stops in the middle of the floor comes down on a post.
    expect(plan.beams[0].posts.some((p) => p < 0.5)).toBe(true)
  })

  it('walls running with the joists, or on the outside, do not count', () => {
    const lines = bearingLines([W(-4, -6, -4, 6), W(-2, -1, 2, -1)], 8, 12)
    expect(lines).toHaveLength(0)
  })

  it('a wall broken by a door is still one bearing line', () => {
    const lines = bearingLines([W(1, -6, 1, -0.5), W(1, 0.4, 1, 6)], 8, 12)
    expect(lines).toHaveLength(1)
    expect(lines[0].p0).toBeCloseTo(-6)
    expect(lines[0].p1).toBeCloseTo(6)
  })

  it('2x10s go less far than I-joists; closer spacing goes further', () => {
    expect(maxJoistSpanM('2x10', 0.406)).toBeLessThan(maxJoistSpanM('I-Joist', 0.406))
    expect(maxJoistSpanM('2x10', 0.305)).toBeGreaterThan(maxJoistSpanM('2x10', 0.406))
    expect(flushLvlDepthIn(0.235)).toBe(9.25)
    expect(flushLvlDepthIn(0.286)).toBe(11.25)
  })

  it('the joists break at the beam and hang off it', () => {
    const plan = planFloorSupports({ lenX: 8, lenZ: 6, element: 'I-Joist', ocM: 0.406, joistDepthM: I, wallsBelow: [] })
    // 6 m along z is the short way here: joists span z, 6 > 5.5, one beam.
    expect(plan.spanAlongX).toBe(false)
    expect(plan.beams).toHaveLength(1)
    expect(supportsAt(plan, 0)).toHaveLength(1)
    const g = buildFloorJoists({ lenX: 8, lenZ: 6, element: 'I-Joist', ocM: 0.406, supports: plan, postDropM: 2.6 })
    const beams = g.children.filter((c) => String(c.userData.id).includes('-beam-'))
    expect(beams.length).toBe(plan.beams[0].plies)
    const hangers = g.children.filter((c) => c.userData.label === 'Joist hanger')
    const none = buildFloorJoists({ lenX: 8, lenZ: 6, element: 'I-Joist', ocM: 0.406 })
    // Each joist now has two more ends, at the beam, and each is hung.
    expect(hangers.length).toBeGreaterThan(none.children.filter((c) => c.userData.label === 'Joist hanger').length)
  })
})
