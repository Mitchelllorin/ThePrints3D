import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SETUP, arenaRoster, capacityOf, depthFactorFor, duelFor, envelopeOf,
  envelopeLine, isRateable, loadPlf, sectionOf, severityFor, verdictAt,
  type ArenaSpecimen,
} from './index'

const roster = arenaRoster()
const byId = (id: string) => roster.find((s) => s.id === id) as ArenaSpecimen

const WEST_FRASER = 'west-fraser-lvl-3000fb-1_9e'
const NORDIC = 'nordic-lam-24f-e-es1m1-6-3_4x18'
const PARALLAM = 'weyerhaeuser-parallam-2_2e-3_1_2x20'
const LP = 'lp-lsl-1_35e-1_3_4x9-1_2'

describe('the arena roster', () => {
  it('puts every branded part on a card', () => {
    expect(roster).toHaveLength(4)
    expect(roster.map((s) => s.id)).toEqual([NORDIC, WEST_FRASER, PARALLAM, LP])
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

  it('runs the U.S. plate, and says which basis it is on', () => {
    const lp = byId(LP)
    expect(isRateable(lp)).toBe(true)
    expect(lp.basis).toBe('us-reference')
    expect(lp.limits.fbPsi).toBe(1730)
    expect(lp.limits.depthExponent).toBeCloseTo(0.12, 10)
  })

  it('refuses a plate with no strength values on it, and names what it needs', () => {
    const nordic = byId(NORDIC)
    expect(isRateable(nordic)).toBe(false)
    expect(nordic.basis).toBe('insufficient')
    expect(nordic.missing).toContain('Bending stress (Fb)')
    expect(nordic.missing).toContain('Shear stress (Fv)')
    expect(nordic.missing).toContain('Modulus of elasticity (E)')
  })

  it('refuses a beam whose depth has no published factor behind it', () => {
    const psl = byId(PARALLAM)
    // The figures are on the plate under its own headings — flexural stress,
    // horizontal shear — so the only thing it is missing is the depth factor a
    // 20" member would need and TJ-7001 does not print here.
    expect(psl.missing).toEqual(['Bending depth factor'])
    expect(isRateable(psl)).toBe(false)
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
    expect(capacityOf(byId(WEST_FRASER), DEFAULT_SETUP).bendingPsi).toBeCloseTo(5576.2, 0)
  })

  it('scales the load linearly with the ramp', () => {
    expect(loadPlf(DEFAULT_SETUP, 1)).toBe(220)
    expect(loadPlf(DEFAULT_SETUP, 2)).toBe(440)
  })

  it('grades severity on the family bands', () => {
    expect(severityFor(0)).toBe(0)
    expect(severityFor(0.7)).toBeCloseTo(0.45, 6)
    expect(severityFor(1)).toBeCloseTo(1.2, 6)
    expect(severityFor(1.35)).toBeCloseTo(2, 6)
    expect(severityFor(3)).toBe(3)
    // Monotonic: more load never grades better.
    let prev = -1
    for (let u = 0; u <= 3; u += 0.05) {
      const s = severityFor(u)
      expect(s).toBeGreaterThanOrEqual(prev)
      prev = s
    }
  })

  it('holds a beam at the entered load and breaks it at four times', () => {
    const wf = byId(WEST_FRASER)
    const light = verdictAt(wf, DEFAULT_SETUP, 1)
    const heavy = verdictAt(wf, DEFAULT_SETUP, 4)
    expect(heavy.severity).toBeGreaterThan(light.severity)
    expect(heavy.phase).toBe('failed')
    expect(heavy.demand.bendingPsi).toBeCloseTo(light.demand.bendingPsi * 4, 6)
  })

  it('names the check that takes it, not an arbitrary one', () => {
    const wf = byId(WEST_FRASER)
    const v = verdictAt(wf, DEFAULT_SETUP, 1)
    const worst = Math.max(...Object.values(v.utilisation))
    expect(v.utilisation[v.governing]).toBeCloseTo(worst, 10)
    // A 12-ft floor member on this load is governed by how far it sags.
    expect(v.governing).toBe('deflection')
  })

  it('reports where the beam goes, and never claims a survivor broke', () => {
    const wf = byId(WEST_FRASER)
    const env = envelopeOf(wf, DEFAULT_SETUP)
    expect(env.failedAt).not.toBeNull()
    expect(env.failedAt!).toBeGreaterThan(1)
    expect(env.failedAt!).toBeLessThanOrEqual(4)
    expect(envelopeLine(env)).toMatch(/Goes at \d\.\d×/)
  })

  it('will not rate a part it has no plate for', () => {
    expect(() => verdictAt(byId(NORDIC), DEFAULT_SETUP, 1)).toThrow(/not on the bench/)
    expect(() => envelopeOf(byId(NORDIC), DEFAULT_SETUP)).toThrow(/not on the bench/)
  })
})

describe('a versus run', () => {
  it('puts the deeper beam last, on one shared ramp', () => {
    const duel = duelFor([byId(LP), byId(WEST_FRASER)], DEFAULT_SETUP)
    expect(duel.entries).toHaveLength(2)
    expect(duel.winnerId).toBe(WEST_FRASER)
    const lp = duel.entries.find((e) => e.specimen.id === LP)!
    const wf = duel.entries.find((e) => e.specimen.id === WEST_FRASER)!
    expect(wf.endurance).toBeGreaterThan(lp.endurance)
    expect(duel.allFailed).toBe(true)
  })
})
