/**
 * THE LOAD BENCH — stress a real beam until its factored resistance runs out.
 *
 * This is the half of F.U.S.E. the app did not have. The years panel scores how
 * a building ages; it never loads a member to its bending stress, which is
 * exactly why every manufacturer part is filed `reference-only`. The bench is
 * the other experiment: hold a span, push the load, and watch the beam reach the
 * figures printed on its own plate.
 *
 * HOW IT PUSHES. One scalar, the load multiple, exactly like the voltage fader
 * in CircuiTry3D and the RPM sweep on AutoMotive3D: the entered live + dead load
 * is multiplied 1× → 4× and every check is evaluated at that point. Same ramp,
 * same three-letter grades, same reading off the same engine, so a number that
 * says "CRITICAL" means one thing across the family.
 *
 * ONE BASIS, OR NO VERDICT. Everything here is CSA O86 limit states design:
 * factored load effect against factored resistance for strength, specified
 * (unfactored) load for deflection. Two parts cannot be compared across bases
 * and the bench no longer offers a comparison at all — one part, one ramp, one
 * number off its own plate. See FACTORS below for every factor used.
 *
 * STRENGTH AND SERVICEABILITY ARE NOT THE SAME THING, AND THE BENCH NOW SAYS SO.
 * A member reaches factored resistance when bending or shear takes it — that is
 * a failure. Sagging past L/360 is not: nothing has broken, the floor is springy
 * and the drywall below it cracks. The two are computed separately, reported
 * separately, and the word "failed" is only ever attached to the first.
 *
 * WHAT IT MAY USE. Only the plate. Bending, shear and modulus are the maker's;
 * the depth factor is the maker's own printed expression, applied rather than
 * folded in; the section is the catalogue's actual inches. The one number that
 * is not the maker's is the deflection limit, and it is labelled as the app's
 * own L/360 rather than passed off as theirs.
 *
 * WHERE IT STOPS. A part whose plate is missing a figure does not run at all —
 * `specimen.missing` names it and the bench declines. There is no fallback
 * strength and no default depth factor, because a made-up number with a verdict
 * attached is the worst thing this app could print.
 */

import { RISK_COLOR } from '../fuse/engine'
import type { ArenaSpecimen } from './specimen'

/** How far past the entered load the ramp is allowed to push before it gives
 *  up and calls the beam indestructible. */
export const RAMP_MAX = 4
/** Ramp step. Small enough that the limit lands within 1% of its true load. */
export const RAMP_STEP = 0.05
/** The app's own serviceability limit. Not a maker's figure, and labelled so. */
export const DEFLECTION_DIVISOR = 360

/* ─────────────────────────────────────────────────────────────────────────────
 * THE FACTORS — EVERY ONE OF THEM, AND WHERE IT COMES FROM
 *
 * Factored resistance is not the tabulated strength. CSA O86 multiplies the
 * specified strength by a resistance factor (φ) and by the modification factors
 * that apply to this member, this load and this service condition. Each maker's
 * Canadian guide says exactly that and no more: West Fraser's product report for
 * its LVL (APA PR-L349(C), rev. 2 Apr 2026) states that "design values provided
 * in this table are based on covered, dry conditions of use, as defined in CSA
 * O86, for the standard-term load duration", and Weyerhaeuser's Canadian
 * specifier's guide (TJ-9500, Feb 2026) says "to obtain factored resistances,
 * apply the appropriate formulae from CSA O86 to the specified strengths shown."
 * So the strengths are theirs and the factor chain is the code's; neither is
 * invented here.
 *
 *   φ  0.9   resistance factor for bending and for shear in a structural member
 *            of this kind — CSA O86:19 Cl. 6.5.3.1 (bending) and Cl. 6.5.4.3
 *            (shear). Applied to both, because both are strength limit states.
 *   KD 1.0   load-duration factor, standard term — CSA O86:19 Cl. 5.3.2. A
 *            residential floor's live load is the standard-term case, and
 *            Weyerhaeuser's own guide states KD = 1.0 "where the specified snow
 *            or live load is greater than the specified dead load", which is the
 *            bench's default (40 psf live over 15 psf dead). Change the loads so
 *            dead governs and KD stops being 1.0 — the bench does not silently
 *            keep the floor case.
 *   KH 1.0   system factor — CSA O86:19 Cl. 6.4.4. One member standing alone,
 *            not a repetitive assembly, a built-up member or a glulam layup, so
 *            there is no system effect to credit. (WoodWorks calls this the
 *            repetitive-member factor and gives it 1.4 for three or more joists
 *            sharing load; this bench spans one beam, so it takes none of it.)
 *   KS 1.0   service-condition factor, dry service — CSA O86:19 Cl. 6.4.2. The
 *            makers' tabulated values are already for covered, dry conditions
 *            (PR-L349(C) note (a); LP states dry-use only on its own plate), so
 *            the dry-service case is the one the plate describes and KS is 1.0
 *            there rather than being applied twice.
 *   KT 1.0   treatment factor — CSA O86:19 Cl. 6.4.3. Untreated. A preserved
 *            member takes a reduction and this bench has no treatment control.
 *   KL 1.0   lateral-stability factor — CSA O86:19 Cl. 6.5.3.7 / 7.5.6.4. ⚠ This
 *            one is an ASSUMPTION, not a checked condition: the bench has no
 *            bracing control, and both makers require lateral support at bearing
 *            and at 24 in o.c. along the span (TJ-9500). If the beam on the
 *            bench is not braced that way, Mr is lower than this figure and the
 *            bench overstates it. Listed for Mitchell rather than modelled,
 *            because modelling it needs a bracing input the bench does not have.
 *   KZb      the SIZE factor is the maker's own printed depth factor — West
 *            Fraser (12/d)^(1/7.35) for its 1.9E grades, LP (12/d)^0.120 — not a
 *            second code-depth factor on top of it. Applying both would count
 *            the same effect twice and understate the member.
 *
 * Load combination: 1.25D + 1.5L, the principal strength combination of NBCC
 * 2020 Table 4.1.3.2-A (CSA S408). Deflection stays on SPECIFIED loads — D + L,
 * unfactored — because a floor sags under the load it actually carries, not
 * under a factored one. That is CSA O86:19 Cl. 5.4.2 and the limit is the app's
 * L/360, not a published figure.
 *
 * ⚠ Mitchell checks this list before anything from the bench is filmed. He is
 * the framer; the numbers above are the reasoning, not a signed design.
 * ────────────────────────────────────────────────────────────────────────────*/

/** φ — resistance factor for bending (Cl. 6.5.3.1) and shear (Cl. 6.5.4.3). */
export const PHI = 0.9
/** KD — standard-term load duration (Cl. 5.3.2), live load above dead. */
export const KD_STANDARD = 1
/** KH — one member, no system effect (Cl. 6.4.4). */
export const KH_SINGLE = 1
/** KS — covered, dry service (Cl. 6.4.2), which is what the plate describes. */
export const KS_DRY = 1
/** KT — untreated (Cl. 6.4.3). */
export const KT_UNTREATED = 1
/** KL — lateral stability assumed, NOT checked. See FACTORS above. */
export const KL_ASSUMED_BRACED = 1
/** Dead load factor, NBCC 2020 Table 4.1.3.2-A. */
export const DEAD_FACTOR = 1.25
/** Live load factor, NBCC 2020 Table 4.1.3.2-A. */
export const LIVE_FACTOR = 1.5

/** The same chain in one line, for the bench card — every factor it applied. */
export function factorNote(f: ResistanceFactors): string {
  return `φ ${f.phi.toFixed(2)} · KD ${f.kd.toFixed(2)} · KH ${f.kh.toFixed(2)} · KS ${f.ks.toFixed(2)} · KT ${f.kt.toFixed(2)} · KL ${f.kl.toFixed(2)} · depth ×${f.depth.toFixed(4)}`
}

/** The full chain, as applied to one member. Reported, so it can be checked. */
export interface ResistanceFactors {
  phi: number
  kd: number
  kh: number
  ks: number
  kt: number
  kl: number
  /** The maker's own size factor at this depth. */
  depth: number
  /** True when the depth factor came off the maker's plate rather than defaulted. */
  depthIsMaker: boolean
}

export type ArenaPhase = 'nominal' | 'stressed' | 'critical' | 'failed'

/**
 * The same four bands the rest of the family uses, and the same colours — read
 * off F.U.S.E.'s own palette rather than retyped, so the bench and the years
 * panel can never drift apart on what "critical" looks like.
 */
export const PHASE_LABEL: Record<ArenaPhase, string> = {
  nominal: 'OK',
  stressed: 'STRESSED',
  critical: 'CRITICAL',
  failed: 'FAILED',
}

export const PHASE_COLOR: Record<ArenaPhase, string> = {
  nominal: RISK_COLOR.ok,
  stressed: RISK_COLOR.watch,
  critical: RISK_COLOR.critical,
  failed: RISK_COLOR.failed,
}

/** What the bench is being asked to span, and what is standing on it. */
export interface BenchSetup {
  spanFt: number
  /** Tributary width — how much floor one member carries. */
  spacingFt: number
  liveLoadPsf: number
  deadLoadPsf: number
}

/**
 * A starting set, not a rating. 40 psf live over a four-foot tributary is the
 * ordinary residential floor case, and it is the fast way onto the bench — every
 * figure is a control, so nothing here is decided for the user.
 */
export const DEFAULT_SETUP: BenchSetup = {
  spanFt: 12, spacingFt: 4, liveLoadPsf: 40, deadLoadPsf: 15,
}

/** The three things the bench checks. Two of them are strength, one is not. */
export type CheckId = 'bending' | 'shear' | 'deflection'

export const CHECK_LABEL: Record<CheckId, string> = {
  bending: 'Bending',
  shear: 'Shear',
  deflection: 'Deflection',
}

/** Strength limit states — reaching factored resistance. */
export const STRENGTH_CHECKS = ['bending', 'shear'] as const satisfies readonly CheckId[]

/** The strength checks as a union, so the governing one cannot be deflection. */
export type StrengthCheckId = (typeof STRENGTH_CHECKS)[number]

/**
 * THE LIMIT, IN F.U.S.E.'s VOICE.
 *
 * One mode per check, written the way the engine writes its modes: what is
 * physically happening inside the member, and the one thing that answers it. The
 * deflection entry is deliberately not a break — a beam that sags past L/360 has
 * exceeded a serviceability limit and is still standing, and saying otherwise
 * would teach the wrong thing.
 */
const MODES: Record<CheckId, { name: string; why: string; fix: string }> = {
  bending: {
    name: 'Bending rupture at midspan',
    why:
      'The bottom fibre is carrying more tension than its factored bending resistance allows. In an LVL or a PSL that is the tension lamination or the strand bundle letting go first, not the whole section — the beam takes a permanent set, then it goes, and it goes at midspan where the moment peaks, not where it looks weakest.',
    fix:
      'Go deeper before you go wider. Depth is squared in the section modulus and width is not, so the next depth up buys far more than a second ply of the same depth — and check the depth factor, because a deeper member is not rated at the same stress.',
  },
  shear: {
    name: 'Horizontal shear at the support',
    why:
      'The load is running out of the beam at the bearing and the shear exceeds its factored shear resistance. Shear peaks at the ends, not at midspan, and engineered timber has less of it than its bending number suggests — the member splits along the grain just above the plate, and the end drops.',
    fix:
      'Shorten the clear span, add a ply for width, or land it on a post rather than a header. Do not notch the end to make it fit: that is the one place the shear number cannot spare a section.',
  },
  deflection: {
    name: 'Sag past L/360',
    why:
      'Nothing has broken. The member is deflecting past the limit this app holds a floor to, which shows up as a springy floor, cracked drywall at the ceiling below, and doors that stop closing before anything looks wrong. It is the first thing a homeowner notices and the last thing a span table mentions.',
    fix:
      'This is where stiffness — E and the depth cubed — does the work, so a deeper member or a shorter span. A stronger beam of the same depth is still a bouncy floor.',
  },
}

/** The section, in the trade's inches. */
export interface Section {
  areaIn2: number
  /** Section modulus, in³ — what bending stress divides into. */
  sIn3: number
  /** Second moment of area, in⁴ — what deflection divides into. */
  iIn4: number
}

export function sectionOf(s: ArenaSpecimen): Section {
  const b = s.member.widthIn
  const d = s.member.depthIn
  return {
    areaIn2: b * d,
    sIn3: (b * d * d) / 6,
    iIn4: (b * d * d * d) / 12,
  }
}

/**
 * WHERE A UTILISATION SITS ON F.U.S.E.'s 0–3 SEVERITY SCALE.
 *
 * The break points are the engine's own: 0.7 is the threshold below which
 * `derate()` charges nothing, and the three grades land at 0.45 / 1.2 / 2.0 so
 * that a stressed, critical and failed beam read the same as a stressed,
 * critical and failed wall. Between the breaks the curve is a straight line, so
 * the load dial moves the verdict smoothly instead of stepping.
 *
 * Note this is the ENGINE's scale, used for the wall it sits in. The bench's own
 * phase does not use it — see `phaseForStrength`, because on a strength limit
 * state "failed" means utilisation 1.0 and nothing else.
 */
export function severityFor(utilisation: number): number {
  const u = utilisation
  if (!Number.isFinite(u) || u <= 0) return 0
  if (u <= 0.7) return 0.45 * (u / 0.7)
  if (u <= 1) return 0.45 + 0.75 * ((u - 0.7) / 0.3)
  if (u <= 1.35) return 1.2 + 0.8 * ((u - 1) / 0.35)
  if (u <= 1.6) return 2 + (u - 1.35) / 0.25
  return 3
}

export function phaseFor(severity: number): ArenaPhase {
  if (severity >= 2) return 'failed'
  if (severity >= 1.2) return 'critical'
  if (severity >= 0.45) return 'stressed'
  return 'nominal'
}

/**
 * The bench's own phase, from a STRENGTH utilisation.
 *
 * Failed is 1.0 exactly: factored resistance reached. Before that it is
 * critical from 0.9, stressed from 0.7 and nominal below — bands a framer reads
 * the same way on every member in the family. A beam that has only exceeded
 * L/360 never appears here as failed, whatever its deflection ratio.
 */
export function phaseForStrength(utilisation: number): ArenaPhase {
  if (!Number.isFinite(utilisation)) return 'failed'
  if (utilisation >= 1) return 'failed'
  if (utilisation >= 0.9) return 'critical'
  if (utilisation >= 0.7) return 'stressed'
  return 'nominal'
}

/** The maker's depth factor, applied — `(12 / d) ^ n`. The plate's expression,
 *  not our approximation of it. 1.0 when the depth is the 12" it is quoted at. */
export function depthFactorFor(s: ArenaSpecimen): number {
  const n = s.limits.depthExponent
  if (n == null) return 1
  return Math.pow(12 / s.member.depthIn, n)
}

/** The plate's bending strength at its own depth, before any resistance factor. */
export function adjustedBending(s: ArenaSpecimen): number {
  return (s.limits.fbPsi ?? 0) * depthFactorFor(s)
}

/** Every factor applied to this member, with the depth factor read off its plate. */
export function factorsFor(s: ArenaSpecimen): ResistanceFactors {
  const n = s.limits.depthExponent
  return {
    phi: PHI,
    kd: KD_STANDARD,
    kh: KH_SINGLE,
    ks: KS_DRY,
    kt: KT_UNTREATED,
    kl: KL_ASSUMED_BRACED,
    depth: depthFactorFor(s),
    depthIsMaker: n != null,
  }
}

/** Total uniform load on one member at a given multiple of the entered load,
 *  SPECIFIED — the load the floor actually carries, for deflection. */
export function loadPlf(setup: BenchSetup, multiple: number): number {
  return (setup.liveLoadPsf + setup.deadLoadPsf) * setup.spacingFt * multiple
}

/** The same load, FACTORED — 1.25D + 1.5L, for the strength checks. */
export function factoredLoadPlf(setup: BenchSetup, multiple: number): number {
  const factoredPsf = DEAD_FACTOR * setup.deadLoadPsf + LIVE_FACTOR * setup.liveLoadPsf
  return factoredPsf * setup.spacingFt * multiple
}

export interface Demand {
  spanIn: number
  /** Specified load, plf — what deflection is worked out on. */
  loadPlf: number
  /** Factored load, 1.25D + 1.5L, plf — what strength is worked out on. */
  factoredLoadPlf: number
  /** Factored moment, lb·in. */
  momentLbIn: number
  /** Factored shear, lb. */
  shearLb: number
  /** Factored bending stress on the section, psi. Compared with Mr/S. */
  bendingPsi: number
  /** Factored shear stress, 1.5V/A, psi. Compared with Vr·(2/3A)/A. */
  shearPsi: number
  /** Specified-load deflection, inches. */
  deflectionIn: number
  /** The L/360 the deflection is held to, inches. The app's limit, not a maker's. */
  allowIn: number
}

export function demandAt(s: ArenaSpecimen, setup: BenchSetup, multiple: number): Demand {
  const L = setup.spanFt * 12
  const { areaIn2, sIn3, iIn4 } = sectionOf(s)
  // Strength: factored load effect.
  const wFactoredIn = factoredLoadPlf(setup, multiple) / 12
  const moment = (wFactoredIn * L * L) / 8
  const shear = (wFactoredIn * L) / 2
  // Serviceability: specified load, unfactored.
  const wServiceIn = loadPlf(setup, multiple) / 12
  const e = s.limits.ePsi ?? 0
  return {
    spanIn: L,
    loadPlf: loadPlf(setup, multiple),
    factoredLoadPlf: factoredLoadPlf(setup, multiple),
    momentLbIn: moment,
    shearLb: shear,
    bendingPsi: sIn3 > 0 ? moment / sIn3 : Number.POSITIVE_INFINITY,
    // Rectangular section: the average shear is 2V/3A and the peak is 3V/2A,
    // which is the one the tabulated Fv is compared against.
    shearPsi: areaIn2 > 0 ? (1.5 * shear) / areaIn2 : Number.POSITIVE_INFINITY,
    deflectionIn: iIn4 > 0 && e > 0 ? (5 * wServiceIn * Math.pow(L, 4)) / (384 * e * iIn4) : Number.POSITIVE_INFINITY,
    allowIn: L / DEFLECTION_DIVISOR,
  }
}

export interface Capacity {
  /** Factored bending resistance on the section, psi — Mr / S. */
  bendingPsi: number
  /** Factored shear resistance, expressed on 1.5V/A so it divides demand. */
  shearPsi: number
  /** Factored bending resistance as a moment, lb·in. */
  momentLbIn: number
  /** Factored shear resistance as a force, lb. */
  shearLb: number
  allowIn: number
  factors: ResistanceFactors
}

export function capacityOf(s: ArenaSpecimen, setup: BenchSetup): Capacity {
  const { areaIn2, sIn3 } = sectionOf(s)
  const f = factorsFor(s)
  const chain = f.phi * f.kd * f.kh * f.ks * f.kt * f.kl
  const bendingPsi = (s.limits.fbPsi ?? 0) * f.depth * chain
  const shearPsi = (s.limits.fvPsi ?? 0) * chain
  return {
    bendingPsi,
    shearPsi,
    momentLbIn: bendingPsi * sIn3,
    // Vr = φ Fv (2/3) A, with KD KH KS KT on Fv — the 2/3 is the rectangular
    // section's average-to-peak conversion, not a factor on the material.
    shearLb: chain * (s.limits.fvPsi ?? 0) * (2 / 3) * areaIn2,
    allowIn: (setup.spanFt * 12) / DEFLECTION_DIVISOR,
    factors: f,
  }
}

export interface ArenaVerdict {
  specimen: ArenaSpecimen
  multiple: number
  /** Strength phase. Deflection never sets this — see `exceedsL360`. */
  phase: ArenaPhase
  severity: number
  /**
   * Share of each limit being used, 1.0 = at the limit.
   * Bending and shear are factored load over factored resistance; deflection is
   * specified sag over L/360.
   */
  utilisation: Record<CheckId, number>
  /** The check closest to its own limit of all three. */
  governing: CheckId
  /** The strength limit state that is closest — null when both are under 1.0. */
  strengthGoverning: 'bending' | 'shear' | null
  /** True when bending or shear has reached factored resistance. */
  strengthFailed: boolean
  /** True when the member sags past L/360. Serviceability — not a failure. */
  exceedsL360: boolean
  demand: Demand
  capacity: Capacity
  mode: string
  why: string
  fix: string
}

/** A part whose plate cannot support a rating is not run. Fail loudly here, so
 *  a caller that skipped `isRateable` cannot quietly print a verdict anyway. */
function assertRateable(s: ArenaSpecimen): void {
  if (s.missing.length > 0) {
    throw new Error(`Arena: ${s.label} is not on the bench — missing ${s.missing.join(', ')}`)
  }
}

export function verdictAt(s: ArenaSpecimen, setup: BenchSetup, multiple: number): ArenaVerdict {
  assertRateable(s)
  const demand = demandAt(s, setup, multiple)
  const capacity = capacityOf(s, setup)
  const utilisation: Record<CheckId, number> = {
    bending: capacity.bendingPsi > 0 ? demand.bendingPsi / capacity.bendingPsi : Number.POSITIVE_INFINITY,
    shear: capacity.shearPsi > 0 ? demand.shearPsi / capacity.shearPsi : Number.POSITIVE_INFINITY,
    deflection: capacity.allowIn > 0 ? demand.deflectionIn / capacity.allowIn : Number.POSITIVE_INFINITY,
  }
  const governing = (Object.keys(utilisation) as CheckId[])
    .reduce((worst, id) => (utilisation[id] > utilisation[worst] ? id : worst), 'bending' as CheckId)

  // Strength is judged on strength alone. This is the whole point of the split:
  // a springy floor is not a broken beam, and the bench must not print FAILED
  // for a member that has not reached its factored resistance.
  const worstStrength = STRENGTH_CHECKS.reduce<StrengthCheckId>(
    (worst, id) => (utilisation[id] > utilisation[worst] ? id : worst),
    'bending',
  )
  const strengthUtil = utilisation[worstStrength]
  const strengthFailed = strengthUtil >= 1
  const exceedsL360 = utilisation.deflection >= 1
  const phase = phaseForStrength(strengthUtil)
  const severity = severityFor(strengthUtil)

  // The mode named is the strength limit that is actually closest, unless the
  // floor has sagged and strength is nowhere near it — then the honest headline
  // is the sag, and `exceedsL360` carries the label that says so.
  const headline: CheckId = strengthFailed || strengthUtil >= utilisation.deflection
    ? worstStrength
    : 'deflection'
  const mode = MODES[headline]

  return {
    specimen: s,
    multiple,
    phase,
    severity,
    utilisation,
    governing,
    strengthGoverning: worstStrength,
    strengthFailed,
    exceedsL360,
    demand,
    capacity,
    mode: mode.name,
    why: mode.why,
    fix: mode.fix,
  }
}

/**
 * THE ENVELOPE. Two answers, kept apart.
 *
 *   failedAt        where bending or shear reaches factored resistance. A break.
 *   exceedsL360At   where the sag passes L/360. A serviceability limit — the
 *                   floor bounces, nothing has given way. Never "lets go".
 */
export interface Envelope {
  stressedAt: number | null
  criticalAt: number | null
  failedAt: number | null
  exceedsL360At: number | null
}

export function envelopeOf(s: ArenaSpecimen, setup: BenchSetup): Envelope {
  assertRateable(s)
  const env: Envelope = { stressedAt: null, criticalAt: null, failedAt: null, exceedsL360At: null }
  // Runs the whole ramp rather than stopping at the first limit, because the two
  // limits are independent: a beam can sag at 1.6× and still carry to 2.8×, and
  // stopping at the sag would hide the number a framer actually wants.
  for (let m = RAMP_STEP; m <= RAMP_MAX + 1e-9; m += RAMP_STEP) {
    const v = verdictAt(s, setup, m)
    if (env.stressedAt == null && v.phase !== 'nominal') env.stressedAt = m
    if (env.criticalAt == null && (v.phase === 'critical' || v.phase === 'failed')) env.criticalAt = m
    if (env.exceedsL360At == null && v.exceedsL360) env.exceedsL360At = m
    if (env.failedAt == null && v.strengthFailed) env.failedAt = m
  }
  return env
}

/** One line for the bench card. Strength first, sag second, never merged. */
export function envelopeLine(env: Envelope): string {
  const sag = env.exceedsL360At != null ? ` · over L/360 from ${env.exceedsL360At.toFixed(1)}×` : ''
  if (env.failedAt != null) return `Factored resistance at ${env.failedAt.toFixed(1)}×${sag}`
  if (env.exceedsL360At != null) return `Holds to ${RAMP_MAX}× in strength${sag}`
  return `Holds to ${RAMP_MAX}× — nothing on this plate takes it.`
}
