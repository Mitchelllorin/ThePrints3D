/**
 * THE LOAD BENCH — stress a real beam until its maker's own numbers run out.
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
/** Ramp step. Small enough that the failure lands within 1% of its true load. */
export const RAMP_STEP = 0.05
/** The app's own serviceability limit. Not a maker's figure, and labelled so. */
export const DEFLECTION_DIVISOR = 360

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

/** The three things a beam can do wrong on this bench. */
export type CheckId = 'bending' | 'shear' | 'deflection'

export const CHECK_LABEL: Record<CheckId, string> = {
  bending: 'Bending',
  shear: 'Shear',
  deflection: 'Deflection',
}

/**
 * THE FAILURE, IN F.U.S.E.'s VOICE.
 *
 * One mode per check, written the way the engine writes its modes: what is
 * physically happening inside the member, and the one thing that answers it. The
 * deflection entry is deliberately not a break — a beam that sags past L/360 has
 * failed a serviceability limit and is still standing, and saying otherwise
 * would teach the wrong thing.
 */
const MODES: Record<CheckId, { name: string; why: string; fix: string }> = {
  bending: {
    name: 'Bending rupture at midspan',
    why:
      'The bottom fibre is carrying more tension than the maker rated it for. In an LVL or a PSL that is the tension lamination or the strand bundle letting go first, not the whole section — the beam takes a permanent set, then it goes, and it goes at midspan where the moment peaks, not where it looks weakest.',
    fix:
      'Go deeper before you go wider. Depth is squared in the section modulus and width is not, so the next depth up buys far more than a second ply of the same depth — and check the depth factor, because a deeper member is not rated at the same stress.',
  },
  shear: {
    name: 'Horizontal shear at the support',
    why:
      'The load is running out of the beam at the bearing. Shear peaks at the ends, not at midspan, and engineered timber has less of it than its bending number suggests — the member splits along the grain just above the plate, and the end drops.',
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

/** The maker's depth factor, applied — `(12 / d) ^ n`. The plate's expression,
 *  not our approximation of it. 1.0 when the depth is the 12" it is quoted at. */
export function depthFactorFor(s: ArenaSpecimen): number {
  const n = s.limits.depthExponent
  if (n == null) return 1
  return Math.pow(12 / s.member.depthIn, n)
}

/** The stress the member is actually allowed to carry at its own depth, psi. */
export function adjustedBending(s: ArenaSpecimen): number {
  return (s.limits.fbPsi ?? 0) * depthFactorFor(s)
}

/** Total uniform load on one member at a given multiple of the entered load. */
export function loadPlf(setup: BenchSetup, multiple: number): number {
  return (setup.liveLoadPsf + setup.deadLoadPsf) * setup.spacingFt * multiple
}

export interface Demand {
  spanIn: number
  loadPlf: number
  momentLbIn: number
  shearLb: number
  bendingPsi: number
  shearPsi: number
  deflectionIn: number
  /** The L/360 the deflection is held to, inches. The app's limit, not a maker's. */
  allowIn: number
}

export function demandAt(s: ArenaSpecimen, setup: BenchSetup, multiple: number): Demand {
  const L = setup.spanFt * 12
  const wIn = loadPlf(setup, multiple) / 12
  const { areaIn2, sIn3, iIn4 } = sectionOf(s)
  const moment = (wIn * L * L) / 8
  const shear = (wIn * L) / 2
  const e = s.limits.ePsi ?? 0
  return {
    spanIn: L,
    loadPlf: loadPlf(setup, multiple),
    momentLbIn: moment,
    shearLb: shear,
    bendingPsi: sIn3 > 0 ? moment / sIn3 : Number.POSITIVE_INFINITY,
    // Rectangular section: the average shear is 2V/3A and the peak is 3V/2A,
    // which is the one the tabulated Fv is compared against.
    shearPsi: areaIn2 > 0 ? (1.5 * shear) / areaIn2 : Number.POSITIVE_INFINITY,
    deflectionIn: iIn4 > 0 && e > 0 ? (5 * wIn * Math.pow(L, 4)) / (384 * e * iIn4) : Number.POSITIVE_INFINITY,
    allowIn: L / DEFLECTION_DIVISOR,
  }
}

export interface Capacity {
  bendingPsi: number
  shearPsi: number
  allowIn: number
}

export function capacityOf(s: ArenaSpecimen, setup: BenchSetup): Capacity {
  return {
    bendingPsi: adjustedBending(s),
    shearPsi: s.limits.fvPsi ?? 0,
    allowIn: (setup.spanFt * 12) / DEFLECTION_DIVISOR,
  }
}

export interface ArenaVerdict {
  specimen: ArenaSpecimen
  multiple: number
  phase: ArenaPhase
  severity: number
  /** Share of each limit being used, 1.0 = at the number on the plate. */
  utilisation: Record<CheckId, number>
  /** The check that is closest to its limit — the one that will take it. */
  governing: CheckId
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
  const severity = severityFor(utilisation[governing])
  const mode = MODES[governing]
  return {
    specimen: s,
    multiple,
    phase: phaseFor(severity),
    severity,
    utilisation,
    governing,
    demand,
    capacity,
    mode: mode.name,
    why: mode.why,
    fix: mode.fix,
  }
}

/** The load multiple at which each grade is first reached, or null if the beam
 *  never gets there inside the ramp. This is the solo bench's answer: where the
 *  beam is comfortable, where it starts to go, and where it lets go. */
export interface Envelope {
  stressedAt: number | null
  criticalAt: number | null
  failedAt: number | null
}

export function envelopeOf(s: ArenaSpecimen, setup: BenchSetup): Envelope {
  assertRateable(s)
  const env: Envelope = { stressedAt: null, criticalAt: null, failedAt: null }
  for (let m = RAMP_STEP; m <= RAMP_MAX + 1e-9; m += RAMP_STEP) {
    const v = verdictAt(s, setup, m)
    if (env.stressedAt == null && v.severity >= 0.45) env.stressedAt = m
    if (env.criticalAt == null && v.severity >= 1.2) env.criticalAt = m
    if (env.failedAt == null && v.severity >= 2) { env.failedAt = m; break }
  }
  return env
}

/** One line for the bench card: where this beam goes, or that it does not. */
export function envelopeLine(env: Envelope): string {
  if (env.failedAt == null) return `Holds to ${RAMP_MAX}× — nothing on this plate takes it.`
  if (env.criticalAt != null && env.criticalAt < env.failedAt) {
    return `Goes at ${env.failedAt.toFixed(1)}× · critical from ${env.criticalAt.toFixed(1)}×`
  }
  return `Goes at ${env.failedAt.toFixed(1)}×`
}

export interface DuelEntry {
  specimen: ArenaSpecimen
  envelope: Envelope
  /** Where it lets go, or the top of the ramp when it does not. */
  endurance: number
  /** The verdict at the moment it failed, or at the top of the ramp. */
  at: ArenaVerdict
}

export interface Duel {
  entries: DuelEntry[]
  /** The part still standing longest. Null when nothing could be run. */
  winnerId: string | null
  /** True when every part on the bench failed — the usual case on this ramp. */
  allFailed: boolean
}

/**
 * A VERSUS RUN.
 *
 * Both parts share one ramp, exactly as CircuiTry3D's battle does, and the one
 * whose own numbers run out last wins. It is not a beauty contest: the beam that
 * endures higher is the one a framer can span further, and the number it endured
 * to is on its own plate.
 */
export function duelFor(specimens: readonly ArenaSpecimen[], setup: BenchSetup): Duel {
  const entries: DuelEntry[] = specimens.map((specimen) => {
    const envelope = envelopeOf(specimen, setup)
    const endurance = envelope.failedAt ?? RAMP_MAX
    return { specimen, envelope, endurance, at: verdictAt(specimen, setup, endurance) }
  })
  const ranked = [...entries].sort((a, b) => b.endurance - a.endurance)
  const winner = ranked[0] ?? null
  const allFailed = entries.length > 0 && entries.every((e) => e.envelope.failedAt != null)
  // A tie is a tie — the bench does not invent a tiebreak it cannot defend.
  const tied = ranked.length > 1 && ranked[0].endurance === ranked[1].endurance
  return {
    entries: ranked,
    winnerId: tied ? null : winner?.specimen.id ?? null,
    allFailed,
  }
}
