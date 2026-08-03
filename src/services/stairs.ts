/**
 * Stair solver — turns "how far up do I need to go" into a real, code-checked
 * flight.
 *
 * The stair drawn in the model used to be shaped by eye: a flight was split into
 * fractions of the object's bounding box (`d * 0.6`, `w * 0.46`) with a riser
 * assumed at 0.18 m. That looks like stairs but is not a stair — the risers do
 * not divide the actual storey height, the treads are whatever is left over, and
 * nothing checks whether a person could legally or comfortably climb it.
 *
 * This module does the arithmetic a carpenter does, and it is the reason the
 * configurator can exist at all: you pick the shape and the storey height, and
 * the riser count, riser height, tread run and total run follow from code.
 *
 * Numbers are IRC R311.7 (residential). They are the limits, not suggestions:
 * risers must all be within 3/8" of each other, which is exactly why you divide
 * the rise by a whole number of risers instead of stacking a fixed one until you
 * get there and fudging the last step.
 */

/** Max riser height — 7-3/4". */
export const MAX_RISER_M = 0.19685
/** Min tread depth — 10". */
export const MIN_TREAD_M = 0.254
/** Min clear stair width — 36". */
export const MIN_WIDTH_M = 0.9144
/** Min headroom — 6'-8". */
export const MIN_HEADROOM_M = 2.032
/** Min landing length in the direction of travel — 36". */
export const MIN_LANDING_M = 0.9144
/** Max rise between landings — 12'-7". */
export const MAX_FLIGHT_RISE_M = 3.835
/** A comfortable riser to aim for before code forces the issue — 7". */
export const TARGET_RISER_M = 0.1778

export type StairShape = 'straight' | 'l-shaped' | 'u-shaped' | 'switchback'

/** Map the catalog's SUBTYPE label ('L-shaped', 'Switchback', …) to a shape.
 *  Shared so the rendered stair and the floor opening it needs can never be
 *  computed from different shapes. */
export function stairShapeFromSubtype(subtype?: string): StairShape {
  const s = (subtype ?? '').toLowerCase()
  if (s.startsWith('l')) return 'l-shaped'
  if (s.startsWith('u')) return 'u-shaped'
  if (s.startsWith('sw')) return 'switchback'
  return 'straight'
}

export interface StairInput {
  /** Floor-to-floor height the stair has to climb. */
  totalRiseM: number
  shape?: StairShape
  /** Tread depth (run of one step). Defaults to the 10" minimum. */
  treadM?: number
  /** Clear width. Defaults to the 36" minimum. */
  widthM?: number
  /** Riser to aim for; the solver lands on or below MAX_RISER_M regardless. */
  targetRiserM?: number
  /** Landing length in the direction of travel. Defaults to the stair width,
   *  which is what a turn actually needs. Ignored by a straight flight unless
   *  the rise forces an intermediate landing. */
  landingM?: number | null
}

export interface StairSolution {
  shape: StairShape
  /** Number of RISERS — always one more than the number of treads in a flight. */
  riserCount: number
  /** Actual riser height: the rise divided equally, so every step matches. */
  riserM: number
  treadM: number
  widthM: number
  /** Horizontal run of the stair's flights, excluding landings. */
  totalRunM: number
  /** Landing lengths in travel order (empty for a straight run with no landing). */
  landingsM: number[]
  /** Risers in each flight, in order. */
  flightRisers: number[]
  /** Footprint the stair needs, including landings — what the floor opening and
   *  the room have to accommodate. */
  footprint: { lengthM: number; widthM: number }
}

/** A code problem with a solved stair, in words a person can act on. */
export interface StairIssue {
  code: string
  message: string
}

const flightsFor = (shape: StairShape): number =>
  shape === 'straight' ? 1 : 2

/**
 * Solve a stair for a given rise.
 *
 * Riser count is `ceil(rise / maxRiser)` — the fewest equal risers that stay
 * legal — then the rise is divided equally between them. That is the whole trick:
 * you never place a fixed riser and fudge the remainder, because unequal risers
 * are both a code violation and the classic way people fall down stairs.
 */
export function solveStair(input: StairInput): StairSolution {
  const shape = input.shape ?? 'straight'
  const totalRiseM = Math.max(0.05, input.totalRiseM)
  const treadM = Math.max(0.05, input.treadM ?? MIN_TREAD_M)
  const widthM = Math.max(0.05, input.widthM ?? MIN_WIDTH_M)
  const target = Math.max(0.05, input.targetRiserM ?? TARGET_RISER_M)

  // Enough risers to keep every one of them legal, aiming at the target first.
  const byTarget = Math.round(totalRiseM / target)
  const byCode = Math.ceil(totalRiseM / MAX_RISER_M)
  const riserCount = Math.max(1, byTarget, byCode)
  const riserM = totalRiseM / riserCount

  const flights = flightsFor(shape)
  const flightRisers: number[] = []
  let left = riserCount
  for (let i = 0; i < flights; i++) {
    const n = i === flights - 1 ? left : Math.ceil(left / (flights - i))
    flightRisers.push(n)
    left -= n
  }

  // The TOP riser of a flight lands on the floor (or the landing) above it, so a
  // flight of n risers only has n-1 treads on the way up.
  const runOf = (n: number) => Math.max(0, n - 1) * treadM
  const totalRunM = flightRisers.reduce((a, n) => a + runOf(n), 0)

  const landingLen = input.landingM === null
    ? 0
    : (input.landingM ?? widthM)
  const landingsM = flights > 1 ? [Math.max(MIN_LANDING_M, landingLen)] : []

  // Footprint: a straight run is end to end; a turn folds the flights so the
  // longest single leg plus the landing governs.
  const footprint = shape === 'straight'
    ? { lengthM: totalRunM, widthM }
    : shape === 'l-shaped'
      ? { lengthM: runOf(flightRisers[0]) + (landingsM[0] ?? 0), widthM: widthM + runOf(flightRisers[1] ?? 0) }
      // U / switchback: flights double back side by side.
      : { lengthM: Math.max(runOf(flightRisers[0]), runOf(flightRisers[1] ?? 0)) + (landingsM[0] ?? 0), widthM: widthM * 2 }

  return { shape, riserCount, riserM, treadM, widthM, totalRunM, landingsM, flightRisers, footprint }
}

/**
 * Check a solved stair against the code limits and say what is wrong in plain
 * language. Empty array means it passes the checks this module knows about.
 */
export function stairIssues(s: StairSolution, headroomM?: number): StairIssue[] {
  const out: StairIssue[] = []
  const inches = (m: number) => `${(m / 0.0254).toFixed(2)}"`

  if (s.riserM > MAX_RISER_M + 1e-9) {
    out.push({ code: 'R311.7.5.1', message: `Riser ${inches(s.riserM)} exceeds the ${inches(MAX_RISER_M)} maximum.` })
  }
  if (s.treadM < MIN_TREAD_M - 1e-9) {
    out.push({ code: 'R311.7.5.2', message: `Tread ${inches(s.treadM)} is under the ${inches(MIN_TREAD_M)} minimum.` })
  }
  if (s.widthM < MIN_WIDTH_M - 1e-9) {
    out.push({ code: 'R311.7.1', message: `Width ${inches(s.widthM)} is under the ${inches(MIN_WIDTH_M)} minimum.` })
  }
  for (const len of s.landingsM) {
    if (len < MIN_LANDING_M - 1e-9) {
      out.push({ code: 'R311.7.6', message: `Landing ${inches(len)} is under the ${inches(MIN_LANDING_M)} minimum in the direction of travel.` })
    }
  }
  // A single flight may not climb more than 12'-7" without a landing.
  const tallestFlight = Math.max(...s.flightRisers) * s.riserM
  if (tallestFlight > MAX_FLIGHT_RISE_M + 1e-9) {
    out.push({ code: 'R311.7.3', message: `Flight rises ${(tallestFlight / 0.3048).toFixed(1)} ft — a landing is required past ${(MAX_FLIGHT_RISE_M / 0.3048).toFixed(1)} ft.` })
  }
  if (headroomM != null && headroomM < MIN_HEADROOM_M - 1e-9) {
    out.push({ code: 'R311.7.2', message: `Headroom ${(headroomM / 0.3048).toFixed(2)} ft is under the 6'-8" minimum.` })
  }
  return out
}

/**
 * The floor opening a stair needs above it.
 *
 * Not the stair's own footprint: the hole has to run back far enough that
 * somebody climbing still has headroom where the floor edge cuts across. Working
 * back from the top: the opening must extend until the space above a tread is at
 * least MIN_HEADROOM_M, which is `headroom / riser` treads back from the top.
 */
export function stairOpeningM(s: StairSolution, floorAssemblyM = 0.32): { lengthM: number; widthM: number } {
  const clearNeeded = MIN_HEADROOM_M + floorAssemblyM
  const treadsBack = Math.ceil(clearNeeded / Math.max(0.01, s.riserM))
  const lengthM = Math.min(s.footprint.lengthM, treadsBack * s.treadM)
  return { lengthM: Math.max(s.treadM, lengthM), widthM: s.footprint.widthM }
}

/**
 * WHERE that opening goes, and how big its axis-aligned footprint is.
 *
 * `stairOpeningM` answers how long the hole is; this answers where it sits. The
 * two were separated and only the first one was used, so the deck above got a
 * correctly-sized opening centred on the middle of the stair — half of it over
 * treads that never needed opening, and the top of the flight still under solid
 * deck. The hole did not line up with the stairs.
 *
 * The opening is measured BACK FROM THE TOP, so it belongs against the top end
 * of the run. A stair climbs along its own local +Z, which means the shift is
 * (footprint − opening) / 2 carried out along wherever the object is facing.
 *
 * The returned w/d are the bounding box of the turned opening, because a floor
 * hole is axis-aligned: exact at 0/90/180/270 — the angles people build at — and
 * generous rather than wrong in between.
 */
export function stairHolePlacement(opts: {
  /** Opening length along the run, from stairOpeningM. */
  openingLengthM: number
  /** Opening width across the run, from stairOpeningM. */
  openingWidthM: number
  /** The stair's full run, from the solution's footprint. */
  footprintLengthM: number
  /** The object's yaw in radians. */
  yaw?: number
}): { shiftX: number; shiftZ: number; w: number; d: number } {
  const { openingLengthM: d, openingWidthM: w, footprintLengthM, yaw = 0 } = opts
  const runShift = Math.max(0, footprintLengthM - d) / 2
  const ca = Math.abs(Math.cos(yaw)), sa = Math.abs(Math.sin(yaw))
  return {
    shiftX: Math.sin(yaw) * runShift,
    shiftZ: Math.cos(yaw) * runShift,
    w: w * ca + d * sa,
    d: w * sa + d * ca,
  }
}
