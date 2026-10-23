/**
 * buildReview — "Check my build for mistakes", answered from the MODEL.
 *
 * The button existed before this file and it did not check anything. It
 * assembled a text summary of the plan, handed it to Gemini, and asked the model
 * to spot the mistakes. That is three different problems at once:
 *
 *   1. It needed a key. With no key on the device the button answered "turn on
 *      the AI", so the app's own review feature was unavailable offline — which
 *      is most of the time, on the phone, on a job.
 *   2. It could not use the 121 specs the app already ships. They are grounding
 *      cards for QUESTIONS; the review prompt was handed none of them, so the
 *      reviewer cited code from the model's memory rather than from the app.
 *   3. A summary is lossy in exactly the places that matter. It carried wall
 *      lengths and little else: no storey count, no rough openings, no ceiling,
 *      no stair, no board, no spacing. Ask a reviewer to find a missing ceiling
 *      and then do not tell it whether there IS a ceiling and it will guess.
 *
 * So the checking happens here, on the real state, in code. Everything below is
 * a rule with a threshold, a fix and a citation, and it runs with no network and
 * no key. The AI, when there is one, is layered ON TOP of these findings rather
 * than instead of them (see askBrain.reviewBuild) — it can add what a rule
 * cannot see, but it can no longer be the reason the button does nothing.
 *
 * The rules are deliberately conservative. Each one fires on something the model
 * can actually be wrong about, and says "verify" where the code itself depends
 * on a load, a span table or the AHJ. A checker that cries wolf gets ignored,
 * which is worse than no checker at all.
 */

import type { ParsedWall } from '../types'
import { roughOpening } from './roughOpening'
import { CEILING_TYPES } from '../data/traceLayers'

export type Severity = 'STOP' | 'CHECK' | 'FYI'

/**
 * WHERE a finding is, so the UI can take you to it instead of describing it.
 *
 * A finding that can only be read is half a finding: "3 walls inferred, not
 * drawn" is useless if you then have to hunt the plan for which three. These
 * indices are into the SAME arrays the caller passed to reviewBuildModel, so
 * whoever assembled the review already knows how to resolve them back to an
 * element — and the panel turns a row into a camera move with no lookup of its
 * own (see services/reviewFocus.ts).
 *
 * `focus` says what to aim at when the rule is about a condition rather than a
 * particular element — a missing roof is nowhere and everywhere, so it aims at
 * the building.
 */
export interface FindingTarget {
  focus: 'wall' | 'opening' | 'storey' | 'building'
  /** Index into the flat `walls` array the review was given. */
  wallIndex?: number
  /** Index into the `openings` array the review was given. */
  openingIndex?: number
  /** Storey the problem is on (0 = ground). Used by the site- and storey-wide rules. */
  level?: number
}

export interface Finding {
  /** Stable id — one rule fires once, however many walls prompted it. */
  id: string
  severity: Severity
  title: string
  /** What is wrong, in the model's own terms. */
  detail: string
  /** The one action that fixes it. */
  fix: string
  /** Code reference or span-table basis, when the rule has one. */
  citation?: string
  /** Where it is, so tapping the finding can fly the camera to it. */
  target?: FindingTarget
}

/** A placed door or window, already reduced to the two facts framing needs. */
export interface OpeningLite {
  type: string
  subtype?: string
  /** The leaf / nominal unit width in metres (NOT the rough opening). */
  widthM: number
  level?: number
}

export interface FloorAreaLite {
  level?: number
  elementType?: string
}

export interface BuildReviewInput {
  /** Millimetres per image pixel, or null when the scale was never set. */
  scaleMmPerPx: number | null
  walls: ParsedWall[]
  openings: OpeningLite[]
  floors: FloorAreaLite[]
  roofs: FloorAreaLite[]
  /** True when a stair, an elevator or a stairwell opening spans a storey. */
  hasVerticalCirculation: boolean
  ceilingM?: number
  studSpacingIn?: number
  framingMaterial?: 'wood' | 'steel'
}

const FT = 0.3048
const IN = 0.0254

/** IRC R305.1 — 7′-0″ minimum ceiling for habitable space, 6′-8″ for others. */
const CEILING_MIN_HABITABLE_M = 7 * FT
const CEILING_ABSOLUTE_MIN_M = 80 * IN

/**
 * Where a header stops being a header.
 *
 * A built-up header spans what its member and the load allow, and the span
 * table is the authority — IRC R602.7 gives it by member, spacing and the width
 * of the building it carries. What a checker can honestly say without those
 * inputs is where a normal built-up header runs out: past about six feet the
 * answer is routinely a bigger member, and past eight it is routinely
 * engineered. Both are "verify", not "wrong" — hence CHECK, not STOP.
 */
const HEADER_BUILT_UP_LIMIT_M = 6 * FT
const HEADER_ENGINEERED_LIMIT_M = 8 * FT

function storeys(walls: ParsedWall[]): number[] {
  const set = new Set<number>()
  for (const w of walls) set.add(w.level ?? 0)
  return [...set].sort((a, b) => a - b)
}

function hasAreaAt(areas: FloorAreaLite[], level: number): boolean {
  return areas.some((a) => (a.level ?? 0) === level)
}

/**
 * Review the current build. Returns findings, most important first — STOP, then
 * CHECK, then FYI, in the order the rules ran inside each grade (which is
 * deliberately the order a builder would walk the job: the shell, then the
 * storeys, then the openings in it).
 */
export function reviewBuildModel(input: BuildReviewInput): Finding[] {
  const {
    scaleMmPerPx, walls, openings, floors, roofs, hasVerticalCirculation,
    ceilingM, studSpacingIn, framingMaterial = 'wood',
  } = input

  const findings: Finding[] = []
  const add = (f: Finding) => findings.push(f)

  // ── Nothing to check yet ────────────────────────────────────────────────────
  if (walls.length === 0 && openings.length === 0) {
    add({
      id: 'empty',
      severity: 'FYI',
      title: 'Nothing to check yet',
      detail: 'There are no walls and nothing placed, so there is no build here to review.',
      fix: 'Draw an outline (Draw it), trace a plan, or open one of the samples, then check again.',
      target: { focus: 'building' },
    })
    return findings
  }

  // ── Scale ───────────────────────────────────────────────────────────────────
  // Everything a length-based check says is a guess without this, so it leads.
  if (scaleMmPerPx == null) {
    add({
      id: 'scale',
      severity: 'STOP',
      title: 'No scale set',
      detail: 'Nothing on this plan has a real length. Every wall, opening and span below is measured in pixels and cannot be checked against a code number.',
      fix: 'Calibrate: measure a known dimension between two points and type it in (Settings → Units & calibration → Recalibrate).',
      target: { focus: 'building' },
    })
  }

  const levels = storeys(walls)
  const topLevel = levels.length ? Math.max(...levels) : 0

  // ── The shell ───────────────────────────────────────────────────────────────
  if (walls.length > 0 && floors.length === 0) {
    add({
      id: 'floor-missing',
      severity: 'CHECK',
      title: 'No floor under the walls',
      detail: `The model has ${walls.length} wall${walls.length === 1 ? '' : 's'} and no floor area at all, so the walls stand on nothing — no deck, no joists, no slab.`,
      fix: 'Pull a floor: BUILD → Floors → Pull a floor, then tap opposite corners of the footprint.',
      target: { focus: 'building' },
    })
  }

  if (walls.length > 0 && !floors.some((f) => CEILING_TYPES.has(f.elementType ?? ''))) {
    add({
      id: 'ceiling-missing',
      severity: 'CHECK',
      title: 'No ceiling',
      detail: 'Nothing is typed as a ceiling, so the top of the wall is open — no joists over the rooms, and nothing above to board or hang a light from.',
      fix: 'Pull a ceiling the same way as a floor (BUILD → Floors → Pull a floor) and set its element to Ceiling joists. It seats itself on the wall top.',
      // Aim at the top of the walls on the ground storey: that is the plane the
      // missing ceiling would sit on, so the camera lands where you look for it.
      target: { focus: 'storey', level: 0 },
    })
  }

  if (walls.length > 0 && roofs.length === 0) {
    add({
      id: 'roof-missing',
      severity: 'CHECK',
      title: 'No roof',
      detail: 'The walls carry nothing. The building is open to the weather, and the eaves — which set the cladding, the soffit and the gutter — have nowhere to land.',
      fix: 'BUILD → Roof → Add roof, then pull the roof over the footprint and set the ridge.',
      target: { focus: 'storey', level: topLevel },
    })
  }

  // ── Storeys ─────────────────────────────────────────────────────────────────
  for (const level of levels) {
    if (level === 0) continue
    if (!hasAreaAt(floors, level)) {
      add({
        id: `storey-unsupported-${level}`,
        severity: 'STOP',
        title: `Storey ${level + 1} has no floor`,
        detail: `Walls are framed on storey ${level + 1} but no floor area exists at that level, so the storey is standing in the air. The joists that would carry it were never pulled.`,
        fix: `Pull a floor on storey ${level + 1} (the level picker is on the trace bar) so the walls above land on a deck.`,
        target: { focus: 'storey', level },
      })
    }
  }

  if (topLevel > 0 && !hasVerticalCirculation) {
    add({
      id: 'stair-missing',
      severity: 'STOP',
      title: 'No way up to the upper storey',
      detail: `This is a ${topLevel + 1}-storey building with no stair, no elevator and no stairwell opening in any deck, so the upper floor cannot be reached — and its joists have no hole framed through them for the run.`,
      fix: 'PLACE → Stairs, drop it on the ground storey; the run cuts and frames the opening through the decks above it.',
      citation: 'IRC R311.7 (stairways), R502.10 (floor openings framed)',
      target: { focus: 'storey', level: topLevel },
    })
  }

  // ── Between the storeys ─────────────────────────────────────────────────────
  // A wall that runs through a storey and a floor that lands on it cannot both be
  // right: the floor needs a rim and a top plate under it, the wall needs none.
  const balloonThroughFloor = walls.filter(
    (w) => (w.spanLevels ?? 1) > 1 && hasAreaAt(floors, (w.level ?? 0) + 1),
  )
  if (balloonThroughFloor.length > 0) {
    add({
      id: 'balloon-through-floor',
      severity: 'CHECK',
      title: `${balloonThroughFloor.length} wall${balloonThroughFloor.length === 1 ? '' : 's'} run past a floor`,
      detail: `A wall marked as running through the next storey has a floor area landing on it at that level. One of the two is wrong: either the floor stops at this wall, or the wall was meant to be platform-framed in two pieces with a plate and a rim band at the floor line.`,
      fix: 'Select the wall and set how many storeys it runs through to 1 — or delete the floor area over it, if the wall really does run past the floor.',
      target: { focus: 'wall', wallIndex: walls.indexOf(balloonThroughFloor[0]), level: balloonThroughFloor[0].level ?? 0 },
    })
  }

  // ── Height ──────────────────────────────────────────────────────────────────
  if (ceilingM != null) {
    if (ceilingM < CEILING_ABSOLUTE_MIN_M) {
      add({
        id: 'ceiling-height-stop',
        severity: 'STOP',
        title: `Ceiling height ${(ceilingM / FT).toFixed(2)} ft is under the minimum`,
        detail: `The walls are framed to ${ceilingM.toFixed(2)} m (${(ceilingM / FT).toFixed(2)} ft), under the 6′-8″ absolute floor for a ceiling height even in non-habitable space.`,
        fix: 'Raise Ceiling height in SETTINGS → Framing and re-frame, so the studs are cut to the higher wall.',
        citation: 'IRC R305.1 — 7′-0″ habitable, 6′-8″ elsewhere',
        target: { focus: 'storey', level: 0 },
      })
    } else if (ceilingM < CEILING_MIN_HABITABLE_M) {
      add({
        id: 'ceiling-height-low',
        severity: 'CHECK',
        title: `Ceiling height ${(ceilingM / FT).toFixed(2)} ft is below 7′-0″`,
        detail: `At ${ceilingM.toFixed(2)} m this clears the 6′-8″ absolute floor but not the 7′-0″ minimum for habitable rooms (bedrooms, living, kitchen, bath), so it is legal only for halls, closets and the like.`,
        fix: 'If any of this storey is habitable, raise Ceiling height in SETTINGS → Framing to at least 7′-0″ and re-frame.',
        citation: 'IRC R305.1',
        target: { focus: 'storey', level: 0 },
      })
    }
  }

  // ── The openings ────────────────────────────────────────────────────────────
  if (walls.length > 0 && openings.length === 0) {
    add({
      id: 'no-openings',
      severity: 'CHECK',
      title: 'No doors or windows placed',
      detail: 'Every wall is therefore a solid run with no rough opening framed in it — no door, no window, and no way into the building. The framing engine reads its openings from PLACED doors and windows, so a traced gap in the plan is not framed.',
      fix: 'PLACE → Door and PLACE → Window, then tap the wall you want them in. They cut the opening and hang the header, jacks and kings.',
      target: { focus: 'building' },
    })
  }

  // The opening's own index rides along, so the widest one can be pointed at
  // after the filter and the map have both reordered things.
  const wideOpenings = openings.map((o, index) => {
    const ro = roughOpening(o.type, o.subtype, o.widthM, heightFor(o))
    return { ...o, index, roWidthM: ro.widthM, rule: ro.rule }
  })

  /** The opening that drives a header finding, so the camera lands on it. */
  const widestOf = (list: typeof wideOpenings) =>
    list.reduce((a, b) => (b.roWidthM > a.roWidthM ? b : a))

  const engineered = wideOpenings.filter((o) => o.roWidthM > HEADER_ENGINEERED_LIMIT_M)
  if (engineered.length > 0) {
    const worst = widestOf(engineered)
    const widest = worst.roWidthM
    add({
      id: 'header-engineered',
      severity: 'CHECK',
      title: `${engineered.length} opening${engineered.length === 1 ? ' needs' : 's need'} an engineered header`,
      detail: `The widest frames a rough opening of ${(widest / FT).toFixed(2)} ft. Past about 8 ft a built-up dimensional-lumber header is no longer the answer; this is beam territory and the load it carries decides the member.`,
      fix: 'Confirm the header with the span table for the actual load, or specify an engineered beam (LVL) for these openings before anything is cut.',
      citation: 'IRC R602.7 — header spans depend on member, spacing and building width',
      target: { focus: 'opening', openingIndex: worst.index, level: worst.level ?? 0 },
    })
  } else {
    const big = wideOpenings.filter((o) => o.roWidthM > HEADER_BUILT_UP_LIMIT_M)
    if (big.length > 0) {
      const worst = widestOf(big)
      const widest = worst.roWidthM
      add({
        id: 'header-large',
        severity: 'CHECK',
        title: `${big.length} opening${big.length === 1 ? '' : 's'} past a normal built-up header`,
        detail: `The widest frames a rough opening of ${(widest / FT).toFixed(2)} ft${studSpacingIn ? ` at ${studSpacingIn}″ OC` : ''}. Under a floor or a roof, a header that wide is usually a deeper member or a doubled one rather than the default.`,
        fix: 'Size the header from the span table for the member, the spacing and what it carries — or double it up — then check the header in the cut list.',
        citation: 'IRC R602.7',
        target: { focus: 'opening', openingIndex: worst.index, level: worst.level ?? 0 },
      })
    }
  }

  const steelWide = wideOpenings.filter((o) => o.roWidthM > HEADER_BUILT_UP_LIMIT_M)
  if (framingMaterial === 'steel' && steelWide.length > 0) {
    const worstSteel = widestOf(steelWide)
    add({
      id: 'steel-header',
      severity: 'CHECK',
      title: 'Wide opening in a steel-framed wall',
      detail: 'A cold-formed box beam spans noticeably less than the equivalent built-up lumber header, and the track gauge is what sets how much.',
      fix: 'Keep the header within the box-beam span for the gauge and the load, or pick up the opening with a structural member.',
      citation: 'AISI S230 / manufacturer span tables',
      target: { focus: 'opening', openingIndex: worstSteel.index, level: worstSteel.level ?? 0 },
    })
  }

  // ── Walls that were never classified ────────────────────────────────────────
  // They still frame — the picker has a default — but a bearing wall and a
  // partition do not frame the same, and the default cannot tell them apart.
  const unclassified = walls.filter((w) => !w.framingType && !w.wallRole)
  if (unclassified.length > 0) {
    add({
      id: 'wall-unclassified',
      severity: 'FYI',
      title: `${unclassified.length} wall${unclassified.length === 1 ? '' : 's'} framed to the default`,
      detail: 'No wall type or structural role is set on these, so they were framed as ordinary walls. A load-bearing wall gets different corners, packs and headers than a partition.',
      fix: 'Select each wall and set its type and role (exterior bearing, interior bearing, partition) in the wall sheet.',
      target: { focus: 'wall', wallIndex: walls.indexOf(unclassified[0]), level: unclassified[0].level ?? 0 },
    })
  }

  const inferred = walls.filter((w) => w.roomDerived)
  if (inferred.length > 0) {
    add({
      id: 'walls-inferred',
      severity: 'FYI',
      title: `${inferred.length} wall${inferred.length === 1 ? '' : 's'} inferred, not drawn`,
      detail: 'These came from the room boundaries the extractor guessed at rather than from ink read off the print. They are an estimate, and they are placed where a room edge is, not necessarily where a wall is.',
      fix: 'Check them against the plan and correct or delete the ones that are not walls.',
      target: { focus: 'wall', wallIndex: walls.indexOf(inferred[0]), level: inferred[0].level ?? 0 },
    })
  }

  // ── Order: grade first, then the order the rules ran ────────────────────────
  const rank: Record<Severity, number> = { STOP: 0, CHECK: 1, FYI: 2 }
  return findings
    .map((f, i) => ({ f, i }))
    .sort((a, b) => rank[a.f.severity] - rank[b.f.severity] || a.i - b.i)
    .map(({ f }) => f)
}

/**
 * Height of a placed door/window, for the rough-opening rule. Only the vertical
 * allowance depends on it (a pocket door gains 4½″), so the catalog default is a
 * fine stand-in; the width is the fact that decides the finding.
 */
function heightFor(opening: OpeningLite): number {
  return opening.type === 'window' ? 1.2 : 2.032
}

/** One-line summary of what was looked at, for the head of the reply. */
export function summarizeChecked(input: BuildReviewInput): string {
  const levels = storeys(input.walls)
  const parts = [
    `${input.walls.length} wall${input.walls.length === 1 ? '' : 's'}`,
    `${input.openings.length} opening${input.openings.length === 1 ? '' : 's'}`,
    `${input.floors.length} floor area${input.floors.length === 1 ? '' : 's'}`,
    `${input.roofs.length} roof area${input.roofs.length === 1 ? '' : 's'}`,
    levels.length > 1 ? `${levels.length} storeys` : '1 storey',
  ]
  return `Checked ${parts.join(', ')}.`
}

/** The findings as the conversation shows them — same shape the AI reply uses. */
export function formatFindings(findings: Finding[]): string {
  const stops = findings.filter((f) => f.severity === 'STOP').length
  const checks = findings.filter((f) => f.severity === 'CHECK').length
  const head = findings.length === 0
    ? 'Nothing to flag. Nothing I can check is missing or outside a rule.'
    : `${findings.length} finding${findings.length === 1 ? '' : 's'}` +
      (stops ? ` — ${stops} to fix first` : '') +
      (checks ? `${stops ? ',' : ' —'} ${checks} to verify` : '') +
      '.'
  const lines = findings.map((f) => {
    const tail = [f.fix, f.citation ? `(${f.citation})` : ''].filter(Boolean).join(' ')
    return `• [${f.severity}] ${f.title} — ${f.detail} ${tail}`
  })
  return [head, ...lines].join('\n')
}
