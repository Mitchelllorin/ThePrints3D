/**
 * BREAK IT — the bench as a thing you break on purpose.
 *
 * The load bench already answers "where do the maker's numbers stop this beam".
 * This is the other half: the same ramp, run until it breaks, with the break
 * itself made into the interface. Three things live here, and all three are pure
 * so they can be tested without a scene, a phone or a frame:
 *
 *   • the PRESETS — named jobs, each a specimen plus a span and a load, each one
 *     proven by a test to reach factored resistance at a stated multiple and to
 *     hold at the step just under it.
 *   • the BREAK — what failed, at what reading, against what limit, and whose
 *     number that limit is. The failure card and the camera both read this; it
 *     is the one description of the moment.
 *   • the POSE — where the camera ends the sweep, computed from the beam's own
 *     length so the part fills the middle third of the frame at any aspect.
 *
 * WHY THE PRESET DATA IS SEPARATE FROM THE SCREEN. A preset is a claim: "this
 * will break, here". If the claim lives in a button's onClick it is a claim
 * nobody can check, and the first time a factor changes it silently stops being
 * true. Written as data with a test beside it, the claim fails the build when it
 * stops being true — which is the only way a demo stays honest.
 *
 * The rule from the arena holds here without exception: nothing is rounded to
 * make a break happen. A preset lands on the ramp step where the beam actually
 * reaches its factored resistance, and if that step moves, the preset's own test
 * says so.
 */

import { DEFAULT_SETUP, RAMP_STEP, envelopeOf, verdictAt } from './stress'
import type { ArenaVerdict, BenchSetup, StrengthCheckId } from './stress'
import type { ArenaSpecimen } from './specimen'
import { arenaRoster, isRateable } from './specimen'

/* ─────────────────────────────────────────────────────────────────────────────
 * THE FIVE LEVELS
 *
 * F.U.S.E.'s shared scale, not a fourth vocabulary. The arena's own phase has
 * four bands because a strength limit state only has four: holding, stressed,
 * critical, broken. A gauge needs five, because "warning" is the band where the
 * load is past the comfortable margin and short of the limit — the one a framer
 * wants a colour for.
 *
 * Deflection is capped at critical on purpose. Sag past L/360 is a springy
 * floor, not a broken beam, and a bar for it must never print the word failed —
 * that distinction is the whole of order 3 from 8 Nov and it is enforced here,
 * in the function every gauge calls, rather than in each screen's wording.
 * ────────────────────────────────────────────────────────────────────────────*/

export type BenchLevel = 'safe' | 'stressed' | 'warning' | 'critical' | 'failed'

export const BENCH_LEVEL_COLOR: Record<BenchLevel, string> = {
  safe: '#3fbf6e',
  stressed: '#c8b33a',
  warning: '#e0a03a',
  critical: '#f0883e',
  failed: '#f85149',
}

export const BENCH_LEVEL_LABEL: Record<BenchLevel, string> = {
  safe: 'SAFE',
  stressed: 'STRESSED',
  warning: 'WARNING',
  critical: 'CRITICAL',
  failed: 'FAILED',
}

/** Where a utilisation sits on the five-level scale, for a STRENGTH limit. */
export function benchLevelFor(utilisation: number): BenchLevel {
  if (!Number.isFinite(utilisation)) return 'failed'
  if (utilisation >= 1) return 'failed'
  if (utilisation >= 0.9) return 'critical'
  if (utilisation >= 0.7) return 'warning'
  if (utilisation >= 0.45) return 'stressed'
  return 'safe'
}

/** The same scale for a SERVICEABILITY limit — never worse than critical. */
export function serviceLevelFor(utilisation: number): BenchLevel {
  const level = benchLevelFor(utilisation)
  return level === 'failed' ? 'critical' : level
}

/* ─────────────────────────────────────────────────────────────────────────────
 * THE PRESETS
 * ────────────────────────────────────────────────────────────────────────────*/

export interface BenchPreset {
  id: string
  /** The chip. Short enough for a 208 px column. */
  label: string
  /** What it is, in one line, for the panel under the chips. */
  note: string
  specimenId: string
  setup: BenchSetup
  /** The strength limit this case reaches, and the ramp step where it does. */
  breaks: { check: StrengthCheckId; at: number }
}

/**
 * PARALLAM ON 24 FT — the first preset, and the one this bench was built for.
 *
 * 3-1/2 × 19 PSL on a 24 ft clear span under the ordinary residential case
 * (40 psf live, 15 psf dead, 4 ft tributary). It reaches factored bending
 * resistance at 3.55× and has already gone past L/360 at 2.15× — so the run
 * shows both limits, in the right order, and the failure is a rupture at
 * midspan rather than a bouncy floor. Both figures are the bench's own output
 * for these inputs; the test beside this file drives it and holds the numbers.
 */
const PARALLAM_24: BenchPreset = {
  id: 'parallam-24-ft',
  label: 'PSL beam · 24 ft span',
  note: '24 ft span. Bending rupture at midspan; sags past L/360 first.',
  specimenId: 'weyerhaeuser-parallam-2_2e-3_1_2x19',
  setup: { ...DEFAULT_SETUP, spanFt: 24 },
  breaks: { check: 'bending', at: 3.55 },
}

/**
 * WEST FRASER LVL ON 12 FT — the short run.
 *
 * Same floor, the member at its ordinary span. It breaks at 2.85×, which makes
 * it the preset for a clip that has to land in four seconds: two sags and a
 * rupture inside one push. It is a different maker and a different span on
 * purpose — the bench never ranks the two, it runs each on its own plate.
 */
const WEST_FRASER_12: BenchPreset = {
  id: 'west-fraser-12-ft',
  label: 'LVL beam · 12 ft span',
  note: '12 ft span. Bending rupture at 2.85×.',
  specimenId: 'west-fraser-lvl-3000fb-1_9e',
  setup: { ...DEFAULT_SETUP, spanFt: 12 },
  breaks: { check: 'bending', at: 2.85 },
}

/** Branded parts first, and the Parallam 24 first of all. */
export const PRESETS: readonly BenchPreset[] = [PARALLAM_24, WEST_FRASER_12]

export function presetById(id: string): BenchPreset | null {
  return PRESETS.find((p) => p.id === id) ?? null
}

/** The specimen a preset runs, or null when that part is not on the bench. */
export function specimenForPreset(p: BenchPreset): ArenaSpecimen | null {
  const s = arenaRoster().find((x) => x.id === p.specimenId)
  return s && isRateable(s) ? s : null
}

/** The part a fresh bench starts on: the first rateable specimen. */
export function defaultSpecimenId(): string | null {
  const first = arenaRoster().find(isRateable)
  return first ? first.id : null
}

/* ─────────────────────────────────────────────────────────────────────────────
 * THE BREAK
 * ────────────────────────────────────────────────────────────────────────────*/

/**
 * The isolate state the scene must adopt when a part fails.
 *
 * Written as data rather than as three booleans in three components, because
 * the order asks for the behaviour to be identical in every app and testable:
 * `target` is the part the camera lands on, `hideOthers` is the fade, `card`
 * is the failure card. A test asserts all three off a real preset run.
 */
export interface BenchIsolate {
  target: string
  hideOthers: true
  card: true
}

export interface BenchBreak {
  /** The specimen that broke — the scene's isolate target. */
  specimenId: string
  label: string
  manufacturer: string
  product: string
  /** The designation a specifier would write: '3-1/2 × 19'. */
  partNumber: string
  sourceLabel: string
  sourceUrl: string
  /** Which strength limit state was reached. Deflection can never be this. */
  check: StrengthCheckId
  /** F.U.S.E.'s name for it: 'Bending rupture at midspan'. */
  mode: string
  /** The reading at the moment of failure, in the check's own unit. */
  reading: number
  readingUnit: 'psi' | 'lb'
  /** The limit it reached — the maker's factored resistance. */
  limit: number
  /** Whose number the limit is. Always the maker's for a break. */
  limitOwner: 'maker'
  /** The ramp multiple and the job it was on. */
  multiple: number
  spanFt: number
  /** Total load on the member at the break, plf — specified, as entered. */
  loadPlf: number
  /** The factor chain, so the card can be checked against the report. */
  factorLine: string
  at: number
  isolate: BenchIsolate
}

/**
 * The break, or null when nothing has reached factored resistance.
 *
 * Only a strength limit state can produce one. A member sagging past L/360 is
 * still standing, and the bench will not hand the camera a failure for it —
 * `exceedsL360` is carried on the verdict for the serviceability chip and goes
 * no further than that.
 */
export function breakFor(v: ArenaVerdict, at = Date.now()): BenchBreak | null {
  if (!v.strengthFailed || v.strengthGoverning == null) return null
  const check = v.strengthGoverning
  const reading = check === 'bending' ? v.demand.bendingPsi : v.demand.shearLb
  const limit = check === 'bending' ? v.capacity.bendingPsi : v.capacity.shearLb
  const s = v.specimen
  return {
    specimenId: s.id,
    label: s.label,
    manufacturer: s.manufacturer,
    product: s.product,
    partNumber: s.designation,
    sourceLabel: s.source.label,
    sourceUrl: s.source.url,
    check,
    mode: v.mode,
    reading,
    readingUnit: check === 'bending' ? 'psi' : 'lb',
    limit,
    limitOwner: 'maker',
    multiple: v.multiple,
    spanFt: v.spanFt,
    loadPlf: v.demand.loadPlf,
    factorLine: factorLineOf(v),
    at,
    isolate: { target: s.id, hideOthers: true, card: true },
  }
}

/** The factor chain in one line, in the order the report lists it. */
function factorLineOf(v: ArenaVerdict): string {
  const f = v.capacity.factors
  const n = (x: number) => x.toFixed(2)
  return `φ ${n(f.phi)} · KD ${n(f.kd)} · KH ${n(f.kh)} · KS ${n(f.ks)} · KT ${n(f.kt)} · KL ${n(f.kl)} · depth ×${f.depth.toFixed(4)}`
}

/* ─────────────────────────────────────────────────────────────────────────────
 * THE CAMERA
 * ────────────────────────────────────────────────────────────────────────────*/

export interface BenchPose {
  position: [number, number, number]
  target: [number, number, number]
}

/** The share of the frame the part should fill when the sweep ends. */
export const BENCH_FILL = 0.7
/** Sweep length. Around a second, eased — the order's number, not a guess. */
export const BENCH_SWEEP_SECONDS = 1
/** How far above the ground plane the bench stands, metres. */
export const BENCH_Y = 1.35
/** Inches to metres — the catalogue is in inches, the scene is in metres. */
export const IN_TO_M = 0.0254

/** The beam as the scene draws it, from the catalogue's own inches. */
export function benchBeam(specimen: ArenaSpecimen, spanFt: number) {
  return {
    lengthM: spanFt * 0.3048,
    depthM: specimen.member.depthIn * IN_TO_M,
    widthM: specimen.member.widthIn * IN_TO_M,
  }
}

/**
 * Where the camera stands to see the part fill the middle third.
 *
 * Solved, not eyeballed: the beam's length is the dimension that has to fit, so
 * the distance is the one at which it subtends `BENCH_FILL` of the frame's width
 * at this aspect. Portrait phones get a wider horizontal half-angle per metre of
 * height, so the same part needs the camera further back in landscape — the
 * formula handles both, which is why this is not a constant.
 */
export function benchPose(
  centre: [number, number, number],
  lengthM: number,
  aspect: number,
  fovDeg = 55,
): BenchPose {
  const safeAspect = Number.isFinite(aspect) && aspect > 0.1 ? aspect : 1
  const vHalf = (fovDeg * Math.PI) / 360
  const hHalf = Math.atan(Math.tan(vHalf) * safeAspect)
  const distance = lengthM / (2 * BENCH_FILL * Math.tan(hHalf))
  // A three-quarter view: far enough round to read the depth of the section,
  // high enough to see the break across the top, and never straight down the
  // span — a beam seen end-on is a dot.
  const dir = normalise([0.55, 0.34, 0.76])
  return {
    position: [
      centre[0] + dir[0] * distance,
      centre[1] + dir[1] * distance,
      centre[2] + dir[2] * distance,
    ],
    target: [centre[0], centre[1], centre[2]],
  }
}

/**
 * HOW FAR UP THE FRAME THE PART SITS WHEN CHROME OWNS THE FOOT.
 *
 * The canvas is the whole viewport; the strip and the failure card are DOM
 * surfaces over its bottom edge. Centring the part in the raw viewport puts it
 * behind that chrome, so the projection is shifted up by half the chrome's
 * height: the full-image centre then lands at the centre of the band that is
 * actually visible. Zero chrome is zero shift, and the shift is capped at half
 * the canvas so a sheet cannot push the part off the top.
 */
export function benchViewOffsetPx(canvasHeightPx: number, chromeBottomPx: number): number {
  if (!Number.isFinite(canvasHeightPx) || canvasHeightPx <= 0) return 0
  const chrome = Math.max(0, Math.min(canvasHeightPx, Number.isFinite(chromeBottomPx) ? chromeBottomPx : 0))
  return chrome / 2
}

/**
 * WHERE TO SHIFT THE PROJECTION SO THE PART'S BOX LANDS DEAD CENTRE.
 *
 * The chrome shift (benchViewOffsetPx) moves the frame up, but perspective does
 * not put the box's centre exactly on the target's projection: the near end of
 * a long member projects larger than the far end, so the box creeps toward the
 * near side. Fifteen pixels is not a framing error, but "centred" is a claim
 * about the box, so the offset is solved from the box itself: project it, see
 * where its centre landed, and move the projection by that much. Both axes,
 * because the same asymmetry leans the box sideways as well.
 */
export interface BenchViewOffsets { x: number; y: number }

export function benchViewOffsets(
  pose: BenchPose,
  beam: { lengthM: number; depthM: number; widthM: number },
  frame: { widthPx: number; heightPx: number; fovDeg?: number; chromeBottomPx?: number },
): BenchViewOffsets {
  const W = Math.max(1, frame.widthPx)
  const H = Math.max(1, frame.heightPx)
  const requested = Number.isFinite(frame.chromeBottomPx ?? 0) ? frame.chromeBottomPx ?? 0 : 0
  const chrome = Math.max(0, Math.min(H, requested))
  const box = projectBenchBox(pose, beam, { widthPx: W, heightPx: H, fovDeg: frame.fovDeg })
  return { x: box.cx - W / 2, y: box.cy - (H - chrome) / 2 }
}

/** What a projected bounding box looks like on the canvas, in CSS px. */
export interface BenchBoxOnScreen {
  left: number
  right: number
  top: number
  bottom: number
  width: number
  height: number
  cx: number
  cy: number
}

/**
 * PROJECT THE PART'S BOX TO THE SCREEN — the acceptance test for the sweep.
 *
 * "The part ends centred in the visible canvas, filling about the middle third"
 * is a claim about pixels, so it is checked in pixels rather than asserted in a
 * comment. The eight corners of the beam's own box are transformed onto the
 * camera plane and through the same perspective divide the renderer uses
 * (fov, aspect, and the view offset the sweep applies), and the result is the
 * rectangle a screenshot would show.
 *
 * For a long, thin member the length is the axis that has to fit: a 24 ft beam
 * at a three-quarter view projects its depth to a few pixels, so "a third of
 * the height" would mean putting the ends off screen. The box is therefore
 * measured against the frame's WIDTH, which is the tight axis on a phone.
 */
export function projectBenchBox(
  pose: BenchPose,
  beam: { lengthM: number; depthM: number; widthM: number },
  frame: { widthPx: number; heightPx: number; fovDeg?: number; offsetXPx?: number; offsetYPx?: number },
): BenchBoxOnScreen {
  const W = Math.max(1, frame.widthPx)
  const H = Math.max(1, frame.heightPx)
  const fov = frame.fovDeg ?? 55
  const offX = frame.offsetXPx ?? 0
  const offY = frame.offsetYPx ?? 0
  const tanV = Math.tan((fov * Math.PI) / 360)
  const tanH = tanV * (W / H)

  const [px, py, pz] = pose.position
  const [tx, ty, tz] = pose.target
  const forward = normalise([tx - px, ty - py, tz - pz])
  const right = normalise(cross(forward, [0, 1, 0]))
  const up = cross(right, forward)

  const hx = beam.lengthM / 2
  const hy = beam.depthM / 2
  const hz = beam.widthM / 2
  let left = Infinity, rightPx = -Infinity, top = Infinity, bottom = -Infinity

  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    const dx = tx + sx * hx - px
    const dy = ty + sy * hy - py
    const dz = tz + sz * hz - pz
    const zc = dx * forward[0] + dy * forward[1] + dz * forward[2]
    if (zc <= 1e-4) continue
    const xc = dx * right[0] + dy * right[1] + dz * right[2]
    const yc = dx * up[0] + dy * up[1] + dz * up[2]
    const x = W / 2 + (xc / (zc * tanH)) * (W / 2) - offX
    const y = H / 2 - (yc / (zc * tanV)) * (H / 2) - offY
    if (x < left) left = x
    if (x > rightPx) rightPx = x
    if (y < top) top = y
    if (y > bottom) bottom = y
  }

  return {
    left, right: rightPx, top, bottom,
    width: rightPx - left, height: bottom - top,
    cx: (left + rightPx) / 2, cy: (top + bottom) / 2,
  }
}

function cross(a: [number, number, number], b: [number, number, number]): [number, number, number] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

function normalise(v: [number, number, number]): [number, number, number] {
  const m = Math.hypot(v[0], v[1], v[2]) || 1
  return [v[0] / m, v[1] / m, v[2] / m]
}

/** Cubic ease-in-out, 0→1. The sweep is eased at both ends and quick between. */
export function easeInOut(k: number): number {
  const x = Math.min(1, Math.max(0, k))
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2
}

export function lerpPose(a: BenchPose, b: BenchPose, k: number): BenchPose {
  const mix = (i: 0 | 1 | 2) => a.position[i] + (b.position[i] - a.position[i]) * k
  const tgt = (i: 0 | 1 | 2) => a.target[i] + (b.target[i] - a.target[i]) * k
  return { position: [mix(0), mix(1), mix(2)], target: [tgt(0), tgt(1), tgt(2)] }
}

/** The load a preset holds at: one ramp step below its break. */
export function holdsAt(p: BenchPreset): number {
  return Math.max(1, Math.round((p.breaks.at - RAMP_STEP) * 100) / 100)
}

/** The envelope a preset's job produces — used by the panel and its test. */
export function presetEnvelope(p: BenchPreset) {
  const s = specimenForPreset(p)
  return s ? { specimen: s, envelope: envelopeOf(s, p.setup) } : null
}

/** The verdict at the preset's break step. */
export function presetBreakVerdict(p: BenchPreset): ArenaVerdict | null {
  const s = specimenForPreset(p)
  return s ? verdictAt(s, p.setup, p.breaks.at) : null
}
