/**
 * THE ARENA ROSTER — what goes on the bench, and what it is allowed to be
 * stressed against.
 *
 * The Arena has the same chassis in every app in the family: real branded
 * parts, one shared load ramp, F.U.S.E. calling the failure, and the camera
 * landing on whatever let go. What changes per app is only the specimen and the
 * stressor. In ThePrints3D the specimen is a beam and the stressor is load on a
 * span, because that is what a framer is actually deciding between.
 *
 * THE RULE THAT BUILDS THE ROSTER.
 *
 * A part goes on the bench only with the numbers its maker published for it —
 * the same rule data/manufacturerParts.ts already keeps. Nothing here measures
 * anything; it reads the plate and says whether that is enough to break the
 * beam with. Three states, and the third one is the point:
 *
 *   canadian-verified  the plate is on the NBC / CSA O86 basis and carries
 *                      everything the bench needs. A real rating.
 *   us-reference       the plate is complete but on the U.S. ASD basis. It runs,
 *                      and every number it prints says which basis it is on —
 *                      the same distinction that moved four West Fraser figures.
 *   insufficient       the plate is missing a figure the bench cannot invent.
 *                      It does not run, and it names what it is waiting for.
 *
 * `insufficient` is not a failure of the app. It is the answer to "why is this
 * maker not on the bench yet", printed where the maker can read it.
 */

import { getMember, type MemberSpec } from '../../data/members'
import { MANUFACTURER_PARTS, type ManufacturerPart } from '../../data/manufacturerParts'

/** How the numbers on this plate are qualified. Never inferred — read off it. */
export type ArenaBasis = 'canadian-verified' | 'us-reference' | 'insufficient'

/** Everything the bench needs, or null where the plate does not carry it. */
export interface SpecimenLimits {
  /** Specified bending strength at a 12" depth, psi. */
  fbPsi: number | null
  /** Shear strength, psi — a flat figure in these guides, not depth-corrected. */
  fvPsi: number | null
  /** Modulus of elasticity, psi. */
  ePsi: number | null
  /**
   * Exponent of the maker's own depth factor, `(12 / d) ^ n`.
   *
   * West Fraser print it as (12/d)^(1/7.35); LP as (12/d)^0.120. Stored as the
   * exponent rather than as a rounded result, so the factor is the guide's and
   * not ours — and so a plate that omits it cannot silently get 1.0.
   */
  depthExponent: number | null
}

export interface ArenaSpecimen {
  /** The manufacturer part this came from. Stable — it is the bench's key. */
  id: string
  manufacturer: string
  product: string
  designation: string
  /** The catalogue row the bench builds its section from. */
  member: MemberSpec
  /** Short name for the card: 'West Fraser LVL 3000Fb 1.9E'. */
  label: string
  basis: ArenaBasis
  /** One line saying which basis, in the words the plate uses. */
  basisNote: string
  source: { label: string; url: string }
  limits: SpecimenLimits
  /**
   * The figures the bench needs and the plate does not carry, in the words of
   * the field. Empty means the part can be run.
   */
  missing: string[]
}

export function isRateable(s: ArenaSpecimen): boolean {
  return s.missing.length === 0
}

/** A printed figure as a number, or null. '1.9 × 10⁶' is not parseable and is
 *  read from the exponent instead — see readElasticity. */
function readNumber(value: string): number | null {
  const cleaned = value.replace(/,/g, '').trim()
  // A blank cell is a missing figure, not a zero. `Number('')` is 0, which would
  // have put a beam with no strength value on the bench at zero capacity and
  // called the resulting verdict "failed" — the worst kind of right answer.
  if (!cleaned) return null
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}

/** '1.9 × 10⁶' → 1_900_000. The plate prints the exponent as a character, so
 *  this reads it rather than trusting a plain number parse. */
function readElasticity(value: string | undefined): number | null {
  if (!value) return null
  const m = /^([\d.]+)\s*[×x]\s*10\s*([⁰¹²³⁴⁵⁶⁷⁸⁹]+)/.exec(value.replace(/,/g, ''))
  if (m) {
    const digits = '⁰¹²³⁴⁵⁶⁷⁸⁹'
    let exp = ''
    for (const ch of m[2]) exp += String(digits.indexOf(ch))
    const n = Number(m[1]) * Math.pow(10, Number(exp))
    return Number.isFinite(n) ? n : null
  }
  return readNumber(value)
}

/**
 * A figure, under any of the names a maker may print it as.
 *
 * The plates do not share one vocabulary: West Fraser and LP say 'Bending
 * stress' and 'Shear stress', Weyerhaeuser say 'Flexural stress' and 'Horizontal
 * shear'. Reading only the first spelling would file a complete plate as
 * missing, which is a bug that reads as a verdict — so every alias the plates in
 * this app actually use is listed here.
 */
const FIELD_ALIASES: Record<string, string[]> = {
  bending: ['Bending stress', 'Flexural stress'],
  shear: ['Shear stress', 'Horizontal shear'],
  modulus: ['Modulus of elasticity', 'Modulus'],
}

function field(part: ManufacturerPart, ...labels: string[]): string | undefined {
  for (const label of labels) {
    const hit = part.rated.find((r) => r.label === label)?.value
    if (hit != null) return hit
  }
  return undefined
}

/**
 * The depth factor's exponent, taken from the plate's own printed expression.
 * '(12/d)^(1/7.35)' → 1/7.35; '(12/d)^0.120' → 0.12. Returns undefined when the
 * plate has no such row at all, which the bench treats as "cannot rate this
 * depth" rather than as a factor of one.
 */
function readDepthExponent(part: ManufacturerPart): number | null | undefined {
  const raw = part.rated.find((r) => r.label === 'Bending depth factor')?.value
  if (raw == null) return undefined
  const ratio = /^\(12\/d\)\^\(1\/([\d.]+)\)/.exec(raw)
  if (ratio) return 1 / Number(ratio[1])
  const plain = /^\(12\/d\)\^([\d.]+)/.exec(raw)
  if (plain) return Number(plain[1])
  return null
}

/**
 * A plate becomes a specimen.
 *
 * The width and the depth come from the catalogue row — the beam the app will
 * actually draw — not from the plate's headline size, so the bench and the model
 * can never be looking at two different beams. Where they disagree the bench
 * says nothing; that is the catalogue's problem and members.ts already comments
 * on the rows that differ from the published stock.
 */
export function specimenFor(part: ManufacturerPart): ArenaSpecimen {
  const member = getMember(part.memberId)
  const missing: string[] = []

  // A part with no catalogue row cannot be built, let alone stressed.
  if (!member) {
    return {
      id: part.id, manufacturer: part.manufacturer, product: part.product,
      designation: part.designation, member: PLACEHOLDER_MEMBER, label: part.product,
      basis: 'insufficient', basisNote: 'No catalogue row to build the section from.',
      source: part.source,
      limits: { fbPsi: null, fvPsi: null, ePsi: null, depthExponent: null },
      missing: ['Member catalogue row'],
    }
  }

  const fb = readNumber(field(part, ...FIELD_ALIASES.bending) ?? '')
  const fv = readNumber(field(part, ...FIELD_ALIASES.shear) ?? '')
  // The plain modulus, not Parallam's 'Adjusted modulus' — an Emin, which is a
  // stability figure and would understate the beam's stiffness.
  const e = readElasticity(field(part, ...FIELD_ALIASES.modulus) ?? '')
  const depthExponent = readDepthExponent(part)

  if (fb == null) missing.push('Bending stress (Fb)')
  if (fv == null) missing.push('Shear stress (Fv)')
  if (e == null) missing.push('Modulus of elasticity (E)')
  // The depth factor is only needed away from the 12" the tabulated value is
  // quoted at. At 12" exactly, the factor is 1 whatever the guide says.
  if (member.depthIn !== 12 && (depthExponent == null)) {
    missing.push('Bending depth factor')
  }

  const basis: ArenaBasis = missing.length > 0
    ? 'insufficient'
    : part.verification === 'verified'
      ? 'canadian-verified'
      : 'us-reference'

  const basisNote = basis === 'canadian-verified'
    ? 'Canadian edition — NBC / CSA O86 specified strengths.'
    : basis === 'us-reference'
      ? 'U.S. edition — allowable stresses (ASD). Runs as a reference, not a Canadian rating.'
      : `Waiting on the plate: ${missing.join(', ')}.`

  return {
    id: part.id,
    manufacturer: part.manufacturer,
    product: part.product,
    designation: part.designation,
    member,
    label: `${part.product} ${part.designation}`,
    basis,
    basisNote,
    source: part.source,
    limits: { fbPsi: fb, fvPsi: fv, ePsi: e, depthExponent: depthExponent ?? null },
    missing,
  }
}

/**
 * The whole bench, branded parts first and in catalogue order, because the
 * roster's job is to put the makers' products in front of a framer — not to
 * list every stick the app can draw. Generic rows are not specimens: they are
 * the app's own sizes with no maker's numbers behind them, and a bench with no
 * plate to stand on has nothing to be honest about.
 */
export function arenaRoster(): ArenaSpecimen[] {
  return MANUFACTURER_PARTS.map(specimenFor)
}

/** The parts that can actually be run today. */
export function rateableSpecimens(): ArenaSpecimen[] {
  return arenaRoster().filter(isRateable)
}

/** Stand-in section for a part with no catalogue row, so the card can still be
 *  drawn and still say why it is not on the bench. */
const PLACEHOLDER_MEMBER: MemberSpec = {
  id: 'arena-missing-member', family: 'sawn', size: '—', name: '—',
  widthIn: 0, depthIn: 0, uses: [], grades: [], stockLengthsFt: [],
}
