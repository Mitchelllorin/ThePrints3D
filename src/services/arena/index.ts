/**
 * THE ARENA — the public surface, deliberately small, the way the rest of F.U.S.E.
 * keeps it.
 *
 *   specimen.ts   what goes on the bench, and what each plate is allowed to be
 *                 stressed against.
 *   stress.ts     the ramp, the beam, the factor chain, the two limits.
 *
 * Read it the same way the years panel reads: give it a part and a span, push
 * the load, get a verdict. The only call a screen needs is `verdictAt` — one
 * part, one load. There is no versus run: strength figures are only comparable
 * on one basis, and the bench cannot police what a caller puts side by side, so
 * it does not offer the comparison at all.
 */

export {
  arenaRoster, benchExclusion, isRateable, rateableSpecimens, specimenFor,
  type ArenaBasis, type ArenaSpecimen, type SpecimenLimits,
} from './specimen'

export {
  CHECK_LABEL, DEAD_FACTOR, DEFAULT_SETUP, DEFLECTION_DIVISOR,
  KH_SINGLE, KL_ASSUMED_BRACED, KD_STANDARD, KS_DRY, KT_UNTREATED, LIVE_FACTOR,
  PHASE_COLOR, PHASE_LABEL, PHI, RAMP_MAX, RAMP_STEP, STRENGTH_CHECKS,
  adjustedBending, capacityOf, demandAt, depthFactorFor, envelopeLine, envelopeOf,
  factoredLoadPlf, factorNote, factorsFor, loadPlf, phaseFor, phaseForStrength, sectionOf,
  severityFor, verdictAt,
  type ArenaPhase, type ArenaVerdict, type BenchSetup, type Capacity, type CheckId,
  type Demand, type Envelope, type ResistanceFactors, type Section,
} from './stress'
