/**
 * THE ARENA — the public surface, deliberately small, the way the rest of F.U.S.E.
 * keeps it.
 *
 *   specimen.ts   what goes on the bench, and what each plate is allowed to be
 *                 stressed against.
 *   stress.ts     the ramp, the beam, the grades, the versus run.
 *
 * Read it the same way the years panel reads: give it a part and a span, push
 * the load, get a verdict. The only call a screen needs is `verdictAt` (one part,
 * one load) or `duelFor` (two parts, one ramp).
 */

export {
  arenaRoster, isRateable, rateableSpecimens, specimenFor,
  type ArenaBasis, type ArenaSpecimen, type SpecimenLimits,
} from './specimen'

export {
  CHECK_LABEL, DEFAULT_SETUP, DEFLECTION_DIVISOR, PHASE_COLOR, PHASE_LABEL,
  RAMP_MAX, RAMP_STEP, adjustedBending, capacityOf, demandAt, depthFactorFor,
  duelFor, envelopeLine, envelopeOf, loadPlf, phaseFor, sectionOf, severityFor,
  verdictAt,
  type ArenaPhase, type ArenaVerdict, type BenchSetup, type Capacity, type CheckId,
  type Demand, type Duel, type DuelEntry, type Envelope, type Section,
} from './stress'
