/**
 * F.U.S.E.™ — Failure Understanding Simulation Engine · the grading core.
 *
 * The engine is split the way the rest of the line splits it: this file is
 * domain-free. It knows about reserves, levels, derating curves and verdicts.
 * It knows nothing about buildings, or cars, or cells. Whatever runs F.U.S.E.
 * writes its own domain file against these primitives (see ./building.ts for
 * ThePrints3D's) — the same arrangement as CircuiTry3D, AutoMotive3D, TheCell3D
 * and TheOcean3D, so a reading from one app means the same thing in the next.
 *
 * What F.U.S.E. is NOT: a random number generator with a materials theme. Every
 * number below has a shape you could point at in a reference book —
 *
 *   • nothing wears at a constant rate for ever. Wear accelerates as a thing
 *     runs out of reserve, which is why the last two years of a roof are worse
 *     than the first two.
 *   • a driver only starts to bite past a THRESHOLD. Below it the thing is
 *     doing its job; above it the same load does damage that does not come
 *     back. That threshold shape — flat, then a straight fall to zero — is the
 *     derating curve every component in CircuiTry3D is graded on, and it is the
 *     same curve here, applied to years of weather instead of volts.
 *
 * The 0–3 severity scale is deliberately the one the rest of the line uses, so
 * "critical" is the same word in the arena, on the dyno and on a wall.
 */

/** The four grades, worst last. Order matters: it is also the sort order. */
export type RiskLevel = 'ok' | 'watch' | 'critical' | 'failed'

export const RISK_LEVELS: RiskLevel[] = ['ok', 'watch', 'critical', 'failed']

export const RISK_LABEL: Record<RiskLevel, string> = {
  ok: 'Holding',
  watch: 'Wearing',
  critical: 'Critical',
  failed: 'Failed',
}

/** Same palette as the rest of F.U.S.E.: green → amber → orange → red. */
export const RISK_COLOR: Record<RiskLevel, string> = {
  ok: '#3fb950',
  watch: '#d2a106',
  critical: '#f0883e',
  failed: '#f85149',
}

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x
}

export function clamp01(x: number): number {
  return clamp(x, 0, 1)
}

/**
 * Where a reserve sits on the four-grade scale.
 *
 * Reserve is the fraction of a thing's service life still in hand: 1 is new, 0
 * is gone. The bands are not even quarters on purpose — a roof at 40% has years
 * left and does not need a red badge, one at 15% is the thing you plan your
 * spring around, and 0 is 0.
 */
export function reserveToLevel(reserve: number): RiskLevel {
  if (reserve <= 0) return 'failed'
  if (reserve <= 0.2) return 'critical'
  if (reserve <= 0.5) return 'watch'
  return 'ok'
}

/** Worst first — the index of a level on the scale, for sorting. */
export function severityRank(level: RiskLevel): number {
  return RISK_LEVELS.indexOf(level)
}

/**
 * THE DERATING CURVE.
 *
 * `load` is what the thing is being asked to take, `capacity` what it can take.
 * Up to 70% of capacity the answer is 1 — no penalty at all, which is the whole
 * reason engineering derating is threshold-shaped rather than a straight line
 * from zero. Past 70% the margin is being spent, and it runs out at capacity:
 * the answer falls linearly to 0.
 *
 * A curve that started penalising at zero load would say every building decays
 * from the day it is finished, and that is not what happens — a dry, detailed
 * wall does not rot because it is old. It rots when the wet time passes what it
 * was built to shed.
 */
export function derate(load: number, capacity: number): number {
  if (capacity <= 0) return 1
  const t = load / capacity
  if (t <= 0.7) return 1
  return Math.max(0, 1 - (t - 0.7) / 0.3)
}

/**
 * How much a site shortens a life, as a multiplier on wear.
 *
 * `exposure` is the site's reading of one driver, normalised so 1 is a benign
 * temperate site — the value every nominal life is quoted at. `sensitivity` is
 * the material's own number: 0 means the driver does not touch it (brick does
 * not care about UV), 1 means it doubles the wear at twice a benign exposure.
 *
 * Below a benign site the thing does not get BETTER than its nominal life by
 * much, so the multiplier is floored rather than allowed to run to zero — a
 * desert roof beats a Seattle roof, it is not immortal.
 */
export function stressFactor(exposure: number, sensitivity: number): number {
  if (sensitivity <= 0) return 1
  const over = Math.max(0, exposure - 1)
  const under = Math.max(0, 1 - exposure)
  return (1 + sensitivity * over) / (1 + 0.35 * sensitivity * under)
}

/** The same reading, as a plain word, for the panel's own headline. */
export function exposureWord(exposure: number): string {
  if (exposure < 0.75) return 'mild'
  if (exposure < 1.1) return 'normal'
  if (exposure < 1.3) return 'severe'
  return 'extreme'
}
