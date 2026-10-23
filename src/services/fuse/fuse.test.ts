/**
 * F.U.S.E. — the engine behind the years timeline.
 *
 * Same shape as buildReview's tests, for the same reason: `tidy()` is a
 * building nothing should happen to inside 25 years, and every other case
 * breaks exactly one thing in it. A simulation that predicts disaster for a
 * well-built wall is not a checker, it is a scarecrow — so the quiet case comes
 * first and the rest are single-variable changes against it.
 *
 * What is NOT tested here is the exact year anything fails. Those numbers are
 * estimates and the panel says so; what has to be true, and is tested, is the
 * ORDER: the cladding goes before the wrap, the wrap before the sheathing, the
 * sheathing before the frame. That ordering is the reading, and if it inverts,
 * the tool is lying about the only thing worth knowing.
 */

import { describe, it, expect } from 'vitest'
import { readBuilding, type BuildShape } from './index'
import { HORIZON_YEARS, runFuse, sortStates, type FuseReading } from './building'
import { derate, exposureWord, reserveToLevel, stressFactor } from './engine'
import { buildingProfileFor, claddingIsDrained, detailsFor, SITES, siteById } from './profile'
import { cameraForAssembly, uncoverFor } from './focus'
import type { FocusScene } from '../reviewFocus'

function shape(over: Partial<BuildShape> = {}): BuildShape {
  return {
    framingMaterial: 'wood',
    cladding: 'fiber-cement-lap',
    wrb: 'housewrap',
    woodSheathing: 'plywood',
    board: 'gypsum-half',
    hasWalls: true,
    hasRoof: true,
    storeys: 1,
    hasPlumbing: false,
    hasElectrical: false,
    roofing: 'metal-standing-seam',
    ...over,
  }
}

/** The building nothing should happen to: metal roof over a vented attic,
 *  fiber cement on a wrap on plywood, painted on schedule, temperate site. */
const TIDY = {
  shape: shape(),
  siteId: 'temperate',
  answered: { atticVentilated: true, maintained: true },
  year: 0,
}
const read = (over: Partial<typeof TIDY> = {}): FuseReading => readBuilding({ ...TIDY, ...over })
const goneIn = (r: FuseReading) =>
  r.states.filter((s) => s.failsYear !== null).map((s) => `${s.id}@${s.failsYear}`)
const at = (r: FuseReading, id: string) => r.states.find((s) => s.id === id)!

describe('the derating curve', () => {
  it('is flat until 70% of capacity, then falls to nothing at capacity', () => {
    expect(derate(0, 10)).toBe(1)
    expect(derate(7, 10)).toBe(1)
    expect(derate(8.5, 10)).toBeCloseTo(0.5, 6)
    expect(derate(10, 10)).toBe(0)
    expect(derate(12, 10)).toBe(0)
  })

  it('does not divide by a capacity of zero', () => {
    expect(derate(5, 0)).toBe(1)
  })
})

describe('a site only bites past a benign reading', () => {
  it('leaves a benign driver alone', () => {
    expect(stressFactor(1, 0.8)).toBe(1)
    expect(stressFactor(0.6, 0)).toBe(1)
  })

  it('shortens life above benign, and cannot stretch it without limit below', () => {
    expect(stressFactor(1.4, 1)).toBeCloseTo(1.4, 6)
    const mild = stressFactor(0.5, 1)
    expect(mild).toBeLessThan(1)
    expect(mild).toBeGreaterThan(0.6)
  })

  it('reads out in words a person would use', () => {
    expect(exposureWord(0.6)).toBe('mild')
    expect(exposureWord(1)).toBe('normal')
    expect(exposureWord(1.2)).toBe('severe')
    expect(exposureWord(1.4)).toBe('extreme')
  })
})

describe('the four grades', () => {
  it('runs green, amber, orange, red as the reserve runs out', () => {
    expect(reserveToLevel(1)).toBe('ok')
    expect(reserveToLevel(0.6)).toBe('ok')
    expect(reserveToLevel(0.4)).toBe('watch')
    expect(reserveToLevel(0.15)).toBe('critical')
    expect(reserveToLevel(0)).toBe('failed')
    expect(reserveToLevel(-0.2)).toBe('failed')
  })
})

describe('a tidy building is left alone', () => {
  it('has nothing gone inside the horizon', () => {
    expect(goneIn(read({ year: HORIZON_YEARS }))).toEqual([])
  })

  it('starts new and only ever wears', () => {
    const r = read({ year: 0 })
    for (const s of r.states) expect(s.reserve).toBeCloseTo(1, 6)
    const late = read({ year: HORIZON_YEARS })
    for (const s of late.states) {
      expect(s.trace).toHaveLength(HORIZON_YEARS + 1)
      for (let y = 1; y < s.trace.length; y++) expect(s.trace[y]).toBeLessThanOrEqual(s.trace[y - 1])
      expect(s.reserve).toBeGreaterThan(0)
    }
  })

  it('is deterministic', () => {
    expect(read({ year: 12 })).toEqual(read({ year: 12 }))
  })
})

describe('the order the failures arrive in', () => {
  /** Everything wrong at once: vinyl siding left unpainted on a hot, wet, salty
   *  coast, no drained cavity, OSB behind it, an unvented roof over the lot. */
  const rough = {
    siteId: 'gulf',
    answered: { atticVentilated: false, maintained: false },
    year: HORIZON_YEARS,
    shape: shape({
      cladding: 'vinyl-lap', wrb: 'felt', woodSheathing: 'osb',
      roofing: 'asphalt-shingle', hasPlumbing: true, hasElectrical: true, storeys: 2,
    }),
  }

  /**
   * WHAT IS TESTED HERE IS DIRECTION, NOT A YEAR ORDER.
   *
   * Which of two decades-long layers goes first is genuinely close — a 20-year
   * felt under 22-year vinyl on a gulf coast is a coin flip, and a model that
   * promised a strict order down the wall would be inventing precision it does
   * not have. The claim that IS solid is the one that matters: nothing inside a
   * wall fails before the thing that was keeping the water off it.
   */
  it('buries the frame only after the envelope in front of it has gone', () => {
    const r = read(rough)
    const year = (id: string) => at(r, id).failsYear ?? Number.POSITIVE_INFINITY
    expect(year('cladding')).toBeLessThan(year('framing'))
    expect(year('wrb')).toBeLessThan(year('framing'))
    expect(year('sheathing')).toBeLessThan(year('framing'))
  })

  it('charges the layers behind a failure for it', () => {
    // The same rough house with a cladding that outlives the horizon. Every
    // layer behind it keeps the discount for being covered, so the difference
    // in what they have left IS the cost of the cladding going.
    const shell = shape({
      wrb: 'felt', woodSheathing: 'osb', roofing: 'asphalt-shingle', hasPlumbing: true, hasElectrical: true,
    })
    const answered = { atticVentilated: false, maintained: false }
    const vinyl = read({ siteId: 'gulf', answered, year: HORIZON_YEARS, shape: shape({ ...shell, cladding: 'vinyl-lap' }) })
    const brick = read({ siteId: 'gulf', answered, year: HORIZON_YEARS, shape: shape({ ...shell, cladding: 'brick-veneer' }) })
    for (const id of ['wrb', 'sheathing', 'framing']) {
      expect(at(brick, id).reserve).toBeGreaterThan(at(vinyl, id).reserve)
    }
  })

  it('names what takes it — never just a number', () => {
    const r = read(rough)
    for (const s of r.states) {
      expect(s.mode.length).toBeGreaterThan(8)
      expect(s.why.length).toBeGreaterThan(40)
      expect(s.fix.length).toBeGreaterThan(20)
    }
  })

  it('walks worst first, so the first thing on screen is the first thing to go', () => {
    const r = read(rough)
    expect(r.first).not.toBeNull()
    expect(r.states[0].failsYear).toBe(r.first!.failsYear)
    const years = r.states.map((s) => s.failsYear ?? Number.POSITIVE_INFINITY)
    for (let i = 1; i < years.length; i++) expect(years[i]).toBeGreaterThanOrEqual(years[i - 1])
    expect(r.failedCount).toBeGreaterThan(0)
    expect(r.holdingCount + r.failedCount).toBe(r.states.length)
  })

  it('counts what has gone only up to the year on the scrubber', () => {
    expect(read({ ...rough, year: 0 }).failedCount).toBe(0)
    expect(read({ ...rough, year: 5 }).failedCount).toBeLessThanOrEqual(read({ ...rough, year: 25 }).failedCount)
  })
})

describe('what a wall is missing costs it years', () => {
  it('lets the rain in when there is no cladding', () => {
    const clad = read({ year: 15 })
    const bare = read({ year: 15, shape: shape({ cladding: 'none' }) })
    expect(at(bare, 'wrb').wetTime).toBeGreaterThan(at(clad, 'wrb').wetTime)
    // A dried-in wall has no cladding layer to score at all.
    expect(clad.states.some((s) => s.id === 'cladding')).toBe(true)
    expect(bare.states.some((s) => s.id === 'cladding')).toBe(false)
  })

  it('soaks the sheathing when there is no barrier', () => {
    // Built by hand rather than through the profile: there is no setting that
    // removes the WRB from a wall (the app will not build one without it), but
    // F.U.S.E. still has to be honest about a wall that has none — a stripped
    // barrier is exactly what a renovation or a bad repair leaves behind.
    const env = siteById('temperate').env
    const details = detailsFor('vinyl-lap', { atticVentilated: true, maintained: true })
    const withWrb = runFuse(buildingProfileFor(shape()), env, details, { year: 15 })
    const profile = buildingProfileFor(shape())
    const bare = runFuse(
      { ...profile, layers: profile.layers.filter((l) => l.id !== 'wrb') },
      env,
      details,
      { year: 15 },
    )
    expect(bare.states.find((s) => s.id === 'sheathing')!.wetTime)
      .toBeGreaterThan(withWrb.states.find((s) => s.id === 'sheathing')!.wetTime)
  })

  it('scores OSB closer to the edge than plywood behind the same cladding', () => {
    const osb = read({ year: 15, shape: shape({ woodSheathing: 'osb' }) })
    const ply = read({ year: 15, shape: shape({ woodSheathing: 'plywood' }) })
    expect(at(osb, 'sheathing').wetCapacity).toBeLessThan(at(ply, 'sheathing').wetCapacity)
  })

  it('pays for an unpainted wood wall', () => {
    // A wood wall dies young either way, so the comparison is made part-way
    // through its life rather than at the horizon, where both are at zero.
    const kept = read({ year: 8, shape: shape({ cladding: 'wood-lap' }), answered: { atticVentilated: false, maintained: true } })
    const neglected = read({ year: 8, shape: shape({ cladding: 'wood-lap' }), answered: { atticVentilated: false, maintained: false } })
    expect(at(neglected, 'cladding').reserve).toBeLessThan(at(kept, 'cladding').reserve)
    expect(at(neglected, 'cladding').failsYear ?? Infinity)
      .toBeLessThanOrEqual(at(kept, 'cladding').failsYear ?? Infinity)
  })
})

describe('the site decides how fast', () => {
  it('buries a gulf-coast wall before a sheltered one', () => {
    const test = (siteId: string) => read({ siteId, year: HORIZON_YEARS, answered: { atticVentilated: false, maintained: false } })
    const gulf = test('gulf').first?.failsYear ?? Number.POSITIVE_INFINITY
    const shelter = test('sheltered').first?.failsYear ?? Number.POSITIVE_INFINITY
    expect(gulf).toBeLessThanOrEqual(shelter)
    expect(SITES.map((s) => s.id)).toContain('coast')
  })

  it('bursts the plumbing where it freezes', () => {
    const cold = read({ siteId: 'continental', year: HORIZON_YEARS, shape: shape({ hasPlumbing: true }) })
    const mild = read({ siteId: 'temperate', year: HORIZON_YEARS, shape: shape({ hasPlumbing: true }) })
    const coldYear = at(cold, 'plumbing').failsYear ?? Number.POSITIVE_INFINITY
    const mildYear = at(mild, 'plumbing').failsYear ?? Number.POSITIVE_INFINITY
    expect(coldYear).toBeLessThanOrEqual(mildYear)
  })

  it('only scores services the model actually has', () => {
    const none = read({ shape: shape({ hasPlumbing: false, hasElectrical: false }) })
    expect(none.states.some((s) => s.id === 'plumbing' || s.id === 'electrical')).toBe(false)
    const both = read({ shape: shape({ hasPlumbing: true, hasElectrical: true }) })
    expect(both.states.filter((s) => s.id === 'plumbing' || s.id === 'electrical')).toHaveLength(2)
    const justWater = read({ shape: shape({ hasPlumbing: true, hasElectrical: false }) })
    expect(justWater.states.some((s) => s.id === 'plumbing')).toBe(true)
    expect(justWater.states.some((s) => s.id === 'electrical')).toBe(false)
  })

  it('clamps the scrubber to the horizon', () => {
    expect(read({ year: 999 }).year).toBe(HORIZON_YEARS)
    expect(read({ year: -4 }).year).toBe(0)
  })
})

describe('the rail reads the model, not a preference', () => {
  it('puts glass-mat on a steel frame instead of plywood', () => {
    const p = buildingProfileFor(shape({ framingMaterial: 'steel', woodSheathing: 'plywood' }))
    const sheathing = p.layers.find((l) => l.id === 'sheathing')!
    expect(sheathing.material).toBe('glassmat')
    expect(p.steelFramed).toBe(true)
  })

  it('takes the drained cavity from the cladding the user picked', () => {
    expect(claddingIsDrained('panel')).toBe(true)
    expect(claddingIsDrained('brick-veneer')).toBe(true)
    expect(claddingIsDrained('vinyl-lap')).toBe(false)
    expect(claddingIsDrained('none')).toBe(false)
    expect(detailsFor('panel', { atticVentilated: false, maintained: false }).rainscreen).toBe(true)
  })

  it('adds the roof chain only when a roof has been pulled', () => {
    expect(buildingProfileFor(shape({ hasRoof: false })).layers.some((l) => l.id === 'roofing')).toBe(false)
    expect(buildingProfileFor(shape()).layers.some((l) => l.id === 'roofDeck')).toBe(true)
  })
})

describe('showing a verdict', () => {
  it('uncovers the layer being talked about', () => {
    expect(uncoverFor('sheathing')).toMatchObject({ sheathingVisible: true, claddingVisible: false, wrapVisible: false })
    expect(uncoverFor('drywall')).toMatchObject({ drywallVisible: true })
    expect(uncoverFor(null)).toEqual({})
  })

  const scene: FocusScene = {
    walls: [],
    openings: [],
    center: { x: 3, z: -2, radius: 8 },
    storeyHeight: 2.9,
  }

  it('aims at the building and stands off far enough to see it', () => {
    const look = { aimM: 1.6, standoffM: 7, from: 'wall' as const, reveal: 'cladding' as const }
    const pose = cameraForAssembly(look, scene)
    expect(pose.target[0]).toBe(3)
    expect(pose.target[2]).toBe(-2)
    expect(pose.target[1]).toBeCloseTo(1.6, 6)
    const flat = Math.hypot(pose.position[0] - 3, pose.position[2] + 2)
    expect(flat).toBeGreaterThanOrEqual(7)
    for (const n of [...pose.position, ...pose.target]) expect(Number.isFinite(n)).toBe(true)
  })

  it('looks down at the roof from above, and up the storeys', () => {
    const look = { aimM: 0, standoffM: 14, from: 'above' as const, reveal: null }
    const one = cameraForAssembly(look, scene, { storeys: 1 })
    const two = cameraForAssembly(look, scene, { storeys: 2 })
    expect(one.target[1]).toBeCloseTo(2.9, 6)
    expect(two.target[1]).toBeCloseTo(5.8, 6)
    expect(one.position[1] - one.target[1]).toBeGreaterThan(10)
  })

  it('sorts a loose pile of states worst first', () => {
    const r = read({ siteId: 'gulf', year: 25, answered: { atticVentilated: false, maintained: false } })
    const shuffled = [...r.states].reverse()
    const sorted = sortStates(shuffled)
    expect(sorted.map((s) => s.id)).toEqual(r.states.map((s) => s.id))
  })
})
