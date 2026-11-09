import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SETUP, capacityOf, depthFactorFor, envelopeLine, envelopeOf,
  factoredLoadPlf, factorsFor, isRateable, loadPlf, phaseForStrength, sectionOf,
  verdictAt,
  type ArenaSpecimen,
} from './index'
import { arenaRoster, specimenFor } from './specimen'
import { getManufacturerPart } from '../../data/manufacturerParts'

const roster = arenaRoster()
const byId = (id: string) => roster.find((s) => s.id === id) as ArenaSpecimen

const WEST_FRASER = 'west-fraser-lvl-3000fb-1_9e'
const NORDIC = 'nordic-lam-24f-e-es1m1-7x18'
const PARALLAM = 'weyerhaeuser-parallam-2_2e-3_1_2x19'
const LP = 'lp-lsl-1_35e-1_3_4x9-1_2'

describe('the arena roster', () => {
  it('puts every branded part that may be run on a card', () => {
    expect(roster).toHaveLength(3)
    expect(roster.map((s) => s.id)).toEqual([NORDIC, WEST_FRASER, PARALLAM])
    // Two of the three can be run: the LVL and the PSL. Nordic's report prints no
    // strength values at all, so it sits on the roster saying what it needs.
    expect(roster.filter(isRateable)).toHaveLength(2)
  })

  it('keeps the rim board off the bench, in the catalogue', () => {
    // LP's own cited guide is its rim-board guide. A rim board is not a floor
    // beam, so it does not get a FAILED chip for a job it was never sold for.
    expect(roster.map((s) => s.id)).not.toContain(LP)
    expect(getManufacturerPart(LP)).toBeTruthy()
  })

  it('reads the Canadian plate as a real rating', () => {
    const wf = byId(WEST_FRASER)
    expect(isRateable(wf)).toBe(true)
    expect(wf.basis).toBe('canadian-verified')
    expect(wf.limits.fbPsi).toBe(5544)
    expect(wf.limits.fvPsi).toBe(554)
    expect(wf.limits.ePsi).toBe(1_900_000)
    expect(wf.limits.depthExponent).toBeCloseTo(1 / 7.35, 10)
    expect(wf.member.widthIn).toBe(1.75)
    expect(wf.member.depthIn).toBe(11.5)
  })

  it('refuses a plate with no strength values on it, and names what it needs', () => {
    const nordic = byId(NORDIC)
    expect(isRateable(nordic)).toBe(false)
    expect(nordic.basis).toBe('insufficient')
    expect(nordic.missing).toContain('Bending stress (Fb)')
    expect(nordic.missing).toContain('Shear stress (Fv)')
    expect(nordic.missing).toContain('Modulus of elasticity (E)')
  })

  it("applies a maker's depth-dependent factor on Fb where the report gives one", () => {
    // PR-L294(C) note (6): over 381 mm deep, tabulated Fbx × 0.88. Nordic has no
    // Fb on its plate today, so give it one and check the factor is applied —
    // it must not wait on somebody remembering the note when an Fb is added.
    const base = getManufacturerPart(NORDIC)!
    const withFb = { ...base, rated: [...base.rated, { label: 'Bending stress', value: '1000', unit: 'psi' }] }
    // 18" = 457.2 mm, over the 381 mm trigger.
    expect(specimenFor(withFb).limits.fbPsi).toBeCloseTo(880, 10)
    // A member under the trigger takes the tabulated figure as it stands.
    expect(specimenFor({ ...withFb, memberId: 'sawn-2x12' }).limits.fbPsi).toBe(1000)
  })

  it('rates Parallam on its Canadian specified strengths, and lands on its own table', () => {
    const psl = byId(PARALLAM)
    expect(isRateable(psl)).toBe(true)
    expect(psl.basis).toBe('canadian-verified')
    expect(psl.limits.fbPsi).toBe(5360)
    expect(psl.limits.fvPsi).toBe(540)
    expect(psl.limits.ePsi).toBe(2_200_000)
    expect(psl.limits.depthExponent).toBeCloseTo(0.111, 10)

    // The proof that the chain is right: TJ-9505 page 4 prints Mr 80,445 ft-lb
    // and Vr 21,545 lb for 3-1/2 × 19, and the bench derives the same two
    // numbers from Fb, Fv, φ and the depth factor. Either both are right or the
    // reading of the table is wrong — so this is the test that guards the read.
    const c = capacityOf(psl, DEFAULT_SETUP)
    expect(c.momentLbIn / 12).toBeCloseTo(80_445, -1)
    expect(c.shearLb).toBeCloseTo(21_545, -1)
  })
})

describe('the bench', () => {
  it('takes the section from the catalogue inches', () => {
    const { areaIn2, sIn3, iIn4 } = sectionOf(byId(WEST_FRASER))
    expect(areaIn2).toBeCloseTo(20.125, 6)
    expect(sIn3).toBeCloseTo(38.5729, 4)
    expect(iIn4).toBeCloseTo(221.794, 3)
  })

  it("applies the maker's depth factor rather than rounding it away", () => {
    // (12 / 11.5) ^ (1 / 7.35) — a bit over 1 because the beam is shallower than
    // the 12" the tabulated value is quoted at.
    expect(depthFactorFor(byId(WEST_FRASER))).toBeCloseTo(1.005807, 6)
  })

  it('carries the factor chain on every member, and names the depth as the maker\'s', () => {
    const f = factorsFor(byId(WEST_FRASER))
    expect(f.phi).toBe(0.9)
    expect(f.kd).toBe(1)
    expect(f.kh).toBe(1)
    expect(f.ks).toBe(1)
    expect(f.kt).toBe(1)
    expect(f.kl).toBe(1)
    expect(f.depthIsMaker).toBe(true)
    // Factored resistance is the tabulated strength, its depth factor, and φ.
    expect(capacityOf(byId(WEST_FRASER), DEFAULT_SETUP).bendingPsi)
      .toBeCloseTo(5544 * 1.005807 * 0.9, 1)
  })

  it('resists shear on two-thirds of the section, not the whole of it', () => {
    // Vr = φ Fv (2/3) A — the 1.5V/A comparison is the peak fibre, so the
    // resistance as a force is two-thirds of the area at the tabulated stress.
    const c = capacityOf(byId(WEST_FRASER), DEFAULT_SETUP)
    expect(c.shearLb).toBeCloseTo(0.9 * 554 * (2 / 3) * 20.125, 6)
    expect(c.shearPsi).toBeCloseTo(0.9 * 554, 6)
  })

  it('loads strength on 1.25D + 1.5L and deflection on the load as entered', () => {
    expect(loadPlf(DEFAULT_SETUP, 1)).toBe(220)
    expect(loadPlf(DEFAULT_SETUP, 2)).toBe(440)
    // 1.25 × 15 + 1.5 × 40 = 78.75 psf, over a 4 ft tributary.
    expect(factoredLoadPlf(DEFAULT_SETUP, 1)).toBe(315)
    expect(factoredLoadPlf(DEFAULT_SETUP, 2)).toBe(630)
  })

  it('compares factored demand with factored resistance, and sag with L/360', () => {
    const v = verdictAt(byId(WEST_FRASER), DEFAULT_SETUP, 1)
    expect(v.utilisation.bending).toBeCloseTo(v.demand.bendingPsi / v.capacity.bendingPsi, 10)
    expect(v.utilisation.shear).toBeCloseTo(v.demand.shearPsi / v.capacity.shearPsi, 10)
    // Deflection is the SPECIFIED load — not the factored one.
    expect(v.demand.loadPlf).toBe(220)
    expect(v.demand.factoredLoadPlf).toBe(315)
  })

  it('grades only a strength limit as failed', () => {
    expect(phaseForStrength(0.69)).toBe('nominal')
    expect(phaseForStrength(0.7)).toBe('stressed')
    expect(phaseForStrength(0.9)).toBe('critical')
    expect(phaseForStrength(0.999)).toBe('critical')
    expect(phaseForStrength(1)).toBe('failed')
    expect(phaseForStrength(1.4)).toBe('failed')
  })

  it('never calls sag past L/360 a failure', () => {
    const wf = byId(WEST_FRASER)
    // 1.75×: past L/360, nowhere near factored resistance.
    const v = verdictAt(wf, DEFAULT_SETUP, 1.75)
    expect(v.utilisation.deflection).toBeGreaterThan(1)
    expect(v.utilisation.bending).toBeLessThan(1)
    expect(v.utilisation.shear).toBeLessThan(1)
    expect(v.exceedsL360).toBe(true)
    expect(v.strengthFailed).toBe(false)
    expect(v.phase).not.toBe('failed')
  })

  it('holds a beam at the entered load and breaks it at four times', () => {
    const wf = byId(WEST_FRASER)
    const light = verdictAt(wf, DEFAULT_SETUP, 1)
    const heavy = verdictAt(wf, DEFAULT_SETUP, 4)
    expect(heavy.severity).toBeGreaterThan(light.severity)
    expect(heavy.phase).toBe('failed')
    expect(heavy.strengthFailed).toBe(true)
    expect(heavy.demand.bendingPsi).toBeCloseTo(light.demand.bendingPsi * 4, 6)
  })

  it('names the check that takes it, not an arbitrary one', () => {
    const wf = byId(WEST_FRASER)
    const v = verdictAt(wf, DEFAULT_SETUP, 1)
    const worst = Math.max(...Object.values(v.utilisation))
    expect(v.utilisation[v.governing]).toBeCloseTo(worst, 10)
    // A 12-ft floor member on this load sags before it reaches resistance.
    expect(v.governing).toBe('deflection')
    expect(v.strengthGoverning).toBe('bending')
  })

  it('reports the break and the sag separately, and never merges them', () => {
    const wf = byId(WEST_FRASER)
    const env = envelopeOf(wf, DEFAULT_SETUP)
    expect(env.exceedsL360At).not.toBeNull()
    expect(env.failedAt).not.toBeNull()
    // The floor bounces before the member reaches factored resistance.
    expect(env.exceedsL360At!).toBeLessThan(env.failedAt!)
    expect(env.failedAt!).toBeGreaterThan(1)
    expect(env.failedAt!).toBeLessThanOrEqual(4)
    expect(envelopeLine(env)).toMatch(/Factored resistance at \d\.\d\d×/)
    expect(envelopeLine(env)).toMatch(/over L\/360 from \d\.\d\d×/)
  })

  it('will not rate a part it has no plate for', () => {
    expect(() => verdictAt(byId(NORDIC), DEFAULT_SETUP, 1)).toThrow(/not on the bench/)
    expect(() => envelopeOf(byId(NORDIC), DEFAULT_SETUP)).toThrow(/not on the bench/)
  })
})
