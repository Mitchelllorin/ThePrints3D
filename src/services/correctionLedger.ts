/**
 * correctionLedger — every time we were wrong, written down where it can teach.
 *
 * THE PROBLEM THIS EXISTS TO FIX
 * ------------------------------
 * The app has always had a `correctionCount`. A number. It went up when the user
 * fixed something and it was never read by anything. The correction itself — the
 * one piece of ground truth a tradesperson hands us for free, every time they
 * tap a wall and say "no, that's a 2x6" — was applied to the model and thrown
 * away. We overwrote our own prediction with the right answer and kept no record
 * that we had been wrong, so nothing could ever get better.
 *
 * A correction is worth far more than the wall it fixes. It is a MEASUREMENT.
 * When someone corrects a 2x4 to a 2x6 they have not just relabelled one line:
 * they have told us that the thing we measured as 121mm across is really 172mm,
 * and the pixels are on record. Three of those and we do not have three fixed
 * walls, we have a corrected scale — and a corrected scale fixes every wall on
 * the sheet, the takeoff, and the material list.
 *
 * WHAT THIS MODULE IS
 * -------------------
 *   1. A ledger. Append-only, capped, immutable — a record of predicted-vs-actual
 *      with the evidence that was in front of us at the time.
 *   2. A reader of that ledger. It looks for the SYSTEMATIC mistake behind the
 *      individual ones and reports it as a `Lesson` the app can act on now, on
 *      this print, in this session. Not someday, offline, after a training run.
 *
 * Pure and side-effect free, like `assistant` and `detectionReview` — no clock,
 * no storage, no store. Callers stamp the time and decide how loudly to say it.
 */

import {
  expectedFinishedMm,
  drywallAllowanceMm,
  type DrywallConfig,
  type WallType,
} from './wallTypeClassifier'

// ─── The record ──────────────────────────────────────────────────────────────

export type CorrectionKind =
  /** We named the wall's structure wrong: said 2x4, it is a 2x6. */
  | 'wall-type'
  /** We missed a wall entirely; the user traced it in. */
  | 'wall-added'
  /** We invented a wall — hatching, a dimension string — and the user deleted it. */
  | 'wall-removed'
  /** The user recalibrated the scale by hand. */
  | 'scale'
  /** A door/window we got wrong, or missed, or put where there is none. */
  | 'opening'
  /** We misread a room label off the print. */
  | 'room-name'
  /** We matched the wrong glossary symbol. */
  | 'symbol'

/**
 * What the app had in front of it when it made the call.
 *
 * `thicknessPx` matters more than `measuredMm` and is the one field worth
 * fighting to populate: millimetres are downstream of a scale that may itself be
 * the thing that is wrong, so a record carrying only millimetres cannot be
 * re-read once the scale changes. Pixels are what we actually saw.
 */
export interface CorrectionEvidence {
  /** Raw thickness on the raster, in pixels. Survives a scale correction. */
  thicknessPx?: number
  /** Finished thickness we concluded, in mm — derived, and therefore suspect. */
  measuredMm?: number
  /**
   * Finished thickness the user's answer MEANS, in mm, where the caller knows it
   * and `actual` is not a structural wall-type key we can look up.
   *
   * The app corrects walls in two vocabularies — the structural one the
   * classifier speaks ('stud-2x6') and the usage one the project picker speaks
   * ('Exterior', 'Partition') — and only the first can be turned into
   * millimetres by name. Rather than force every correction UI through one
   * vocabulary, a caller that already holds the thickness states it here and the
   * ledger takes its word over any lookup.
   */
  actualFinishedMm?: number
  /** The mm/px in force when the prediction was made. */
  scaleMmPerPx?: number | null
  /** How that scale was arrived at — a read scale and a guessed one differ. */
  scaleConfidence?: 'parsed' | 'inferred' | 'fallback' | null
  /** Drywall assumption in force, which is itself a common culprit. */
  drywall?: DrywallConfig
  /** Where on the sheet, so a pattern confined to one region can be seen. */
  x?: number
  y?: number
}

export interface CorrectionRecord {
  id: string
  /** ms since epoch, supplied by the caller — this module never reads a clock. */
  at: number
  kind: CorrectionKind
  drawingId: string
  /**
   * What the app concluded, as a short stable key — 'stud-2x4', 'door', 'BATH'.
   * Null where the app concluded nothing at all, which is what a missed wall is.
   */
  predicted: string | null
  /** What the user says it actually is. */
  actual: string
  /** How sure we were while being wrong, 0..1. High values are the expensive ones. */
  confidence?: number
  evidence?: CorrectionEvidence
}

/**
 * How many records to keep. Corrections are small and a real session produces
 * tens, not thousands; the cap only exists so a pathological loop cannot grow
 * the persisted project without bound. Oldest go first — the recent read of a
 * print is the one that describes the print we are looking at.
 */
export const LEDGER_CAP = 500

/** Append a correction, immutably, oldest dropped past the cap. */
export function appendCorrection(
  ledger: readonly CorrectionRecord[],
  record: CorrectionRecord,
  cap: number = LEDGER_CAP,
): CorrectionRecord[] {
  const next = [...ledger, record]
  return next.length > cap ? next.slice(next.length - cap) : next
}

// ─── Reading the ledger ──────────────────────────────────────────────────────

export interface CorrectionSummary {
  total: number
  byKind: Record<CorrectionKind, number>
  /**
   * Corrections where we were sure AND wrong. These are the ones that cost
   * trust: a hedged guess that misses is forgivable, a confident one is not.
   */
  confidentlyWrong: number
  /** Distinct drawings the user has had to correct. */
  drawingsTouched: number
}

/** Past this, the app was not guessing — it was asserting. */
const CONFIDENT = 0.7

const EMPTY_BY_KIND: Record<CorrectionKind, number> = {
  'wall-type': 0,
  'wall-added': 0,
  'wall-removed': 0,
  scale: 0,
  opening: 0,
  'room-name': 0,
  symbol: 0,
}

export function summarizeCorrections(
  records: readonly CorrectionRecord[],
): CorrectionSummary {
  const byKind = { ...EMPTY_BY_KIND }
  const drawings = new Set<string>()
  let confidentlyWrong = 0
  for (const r of records) {
    byKind[r.kind] = (byKind[r.kind] ?? 0) + 1
    drawings.add(r.drawingId)
    if ((r.confidence ?? 0) >= CONFIDENT) confidentlyWrong += 1
  }
  return {
    total: records.length,
    byKind,
    confidentlyWrong,
    drawingsTouched: drawings.size,
  }
}

// ─── The systematic mistake behind the individual ones ───────────────────────

/**
 * Below this many agreeing corrections, a pattern is a coincidence. Three is the
 * smallest number that can show agreement rather than just a pair of points, and
 * asking for more than three would mean the user fixing half the sheet by hand
 * before we notice we are the problem.
 */
export const MIN_SAMPLES = 3

/**
 * How tightly the corrections must agree before we act on them, as the spread of
 * the fit residuals relative to the size of the thing measured. Loose enough to
 * survive a detector that measures thickness to the nearest pixel; tight enough
 * that a user correcting genuinely different walls for genuinely different
 * reasons does not read as one systematic error.
 */
export const MAX_DISAGREEMENT = 0.12

/** Ignore a discrepancy smaller than this — it is inside our own measurement noise. */
const MIN_SCALE_ERROR = 0.08
/** In mm, the equivalent floor for the drywall reading. */
const MIN_OFFSET_ERROR_MM = 12

function median(values: number[]): number {
  if (values.length === 0) return 0
  const s = [...values].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m]
}

/** Median absolute deviation — a spread that one wild correction cannot dominate. */
function mad(values: number[], centre: number): number {
  if (values.length === 0) return 0
  return median(values.map((v) => Math.abs(v - centre)))
}

/** A wall-type correction with both halves of the measurement present. */
interface Paired {
  /** Pixels we measured across the wall. */
  px: number
  /** Millimetres the user's answer says it must be, finished. */
  mm: number
  /** Millimetres we thought it was. */
  saidMm: number | null
}

function pairs(
  records: readonly CorrectionRecord[],
  drywall: DrywallConfig,
): Paired[] {
  const out: Paired[] = []
  for (const r of records) {
    if (r.kind !== 'wall-type') continue
    const px = r.evidence?.thicknessPx
    if (!px || !Number.isFinite(px) || px <= 0) continue
    // The caller's own figure wins: it knows what the user actually picked.
    const mm =
      r.evidence?.actualFinishedMm ??
      expectedFinishedMm(r.actual as WallType, r.evidence?.drywall ?? drywall)
    if (mm == null || mm <= 0) continue
    const said =
      r.predicted != null
        ? expectedFinishedMm(r.predicted as WallType, r.evidence?.drywall ?? drywall)
        : null
    out.push({ px, mm, saidMm: r.evidence?.measuredMm ?? said })
  }
  return out
}

export interface ScaleLesson {
  kind: 'scale'
  /** The mm/px the corrections agree the print is actually at. */
  scaleMmPerPx: number
  /** Multiplier against the scale in force. >1 means we were reading everything small. */
  factor: number
  samples: number
  /** 0..1 — how tightly the corrections agree. */
  agreement: number
}

export interface DrywallLesson {
  kind: 'drywall'
  /** The constant, in mm, by which our finished thicknesses are off. */
  offsetMm: number
  /** What the offset says the drawing is actually showing. */
  suggested: DrywallConfig
  samples: number
  agreement: number
}

export interface DetectorBiasLesson {
  kind: 'detector-bias'
  /** 'loose' — we invent walls the user deletes. 'strict' — we miss walls they trace. */
  bias: 'loose' | 'strict'
  added: number
  removed: number
}

export type LessonBody = ScaleLesson | DrywallLesson | DetectorBiasLesson

/**
 * A lesson, said the way the assistant would say it.
 *
 * SAID IN ONE BREATH. These messages were written while nothing displayed them,
 * and they read like it — the scale one ran to seven lines in the coach's bubble
 * on a phone, a paragraph of explanation standing over the model. The rule now
 * is a sentence and a bit: what is wrong, and what one tap will do about it. The
 * reasoning belongs in this file, where it already is.
 *
 * `leverage` orders them the way `detectionReview` orders doubts, and for the
 * same reason: two suggestions at once is how you lose someone. Show the top one.
 */
export interface Lesson {
  id: string
  message: string
  actionLabel?: string
  /** 0..100 — how much of the model this fixes. */
  leverage: number
  body: LessonBody
}

export interface LessonContext {
  /** The scale currently in force on the drawing being read. */
  scaleMmPerPx: number | null
  /** The drywall assumption currently in force. */
  drywall: DrywallConfig
}

/**
 * IS IT THE SCALE, OR IS IT THE DRYWALL?
 *
 * Both show up as "every wall measures wrong", and they are told apart by HOW
 * they are wrong. A bad scale is multiplicative: every thickness is out by the
 * same ratio, so a 2x4 reads 30% thin and so does a 2x12. A bad drywall
 * assumption is additive: every thickness is out by the same number of
 * millimetres — 32 of them, for the layer we assumed and the drawing did not
 * have — which is most of a 2x4's error and barely any of a 2x12's.
 *
 * So fit both models and keep whichever explains the corrections better. Fitting
 * only the ratio, as the obvious version of this would, quietly re-scales the
 * whole building to compensate for a drywall checkbox — and the building is not
 * the thing that was wrong.
 */
export function deriveLessons(
  records: readonly CorrectionRecord[],
  ctx: LessonContext,
): Lesson[] {
  const lessons: Lesson[] = []
  const p = pairs(records, ctx.drywall)

  if (p.length >= MIN_SAMPLES) {
    // Ratio model: mm ≈ k · px. k IS the corrected scale, in mm per pixel.
    const ratios = p.map((x) => x.mm / x.px)
    const k = median(ratios)
    const ratioResidual = k > 0 ? mad(ratios, k) / k : Infinity

    // Offset model: mm ≈ measured + c, at the scale we already have.
    const offsets = p
      .filter((x) => x.saidMm != null && Number.isFinite(x.saidMm))
      .map((x) => x.mm - (x.saidMm as number))
    const c = median(offsets)
    const spread = offsets.length ? mad(offsets, c) : Infinity
    // Normalised against the typical wall so it compares like-for-like with the ratio.
    const typicalMm = median(p.map((x) => x.mm))
    const offsetResidual =
      offsets.length >= MIN_SAMPLES && typicalMm > 0 ? spread / typicalMm : Infinity

    const offsetWins =
      offsetResidual < ratioResidual && Math.abs(c) >= MIN_OFFSET_ERROR_MM

    if (offsetWins && offsetResidual <= MAX_DISAGREEMENT) {
      /**
       * A positive offset means the real walls are THICKER than we called them,
       * so the drawing carries finishes we did not allow for; a negative one
       * means we added drywall the drawing had already left off. Snap to the
       * configuration nearest the measured offset rather than inventing a new
       * one — these are the three the classifier knows how to work in.
       */
      const target = drywallAllowanceMm(ctx.drywall) + c
      const suggested = nearestDrywall(target)
      if (suggested !== ctx.drywall) {
        lessons.push({
          id: 'lesson-drywall',
          message: `Every wall you've fixed is out by the same ${Math.round(
            Math.abs(c),
          )}mm — that's a drywall allowance, not the scale. This sheet is drawn ${drywallPhrase(
            suggested,
          )}.`,
          actionLabel: 'Re-read the walls',
          leverage: 85,
          body: {
            kind: 'drywall',
            offsetMm: c,
            suggested,
            samples: offsets.length,
            agreement: clamp01(1 - offsetResidual / MAX_DISAGREEMENT),
          },
        })
      }
    } else if (ratioResidual <= MAX_DISAGREEMENT && k > 0) {
      const factor = ctx.scaleMmPerPx && ctx.scaleMmPerPx > 0 ? k / ctx.scaleMmPerPx : 1
      if (Math.abs(factor - 1) >= MIN_SCALE_ERROR) {
        lessons.push({
          id: 'lesson-scale',
          message: `Those ${p.length} fixes all point one way — the sheet reads ${
            factor > 1 ? 'small' : 'big'
          } by about ${Math.round(Math.abs(factor - 1) * 100)}%. Fix it once and every wall lands right.`,
          actionLabel: 'Fix the scale',
          leverage: 100,
          body: {
            kind: 'scale',
            scaleMmPerPx: k,
            factor,
            samples: p.length,
            agreement: clamp01(1 - ratioResidual / MAX_DISAGREEMENT),
          },
        })
      }
    }
  }

  // ── The detector's own bias, from what got added and deleted. ──
  const added = records.filter((r) => r.kind === 'wall-added').length
  const removed = records.filter((r) => r.kind === 'wall-removed').length
  if (added + removed >= MIN_SAMPLES && added !== removed) {
    const loose = removed > added
    lessons.push({
      id: 'lesson-detector-bias',
      message: loose
        ? `You've deleted ${removed} walls I found — I'm reading hatching as framing here. I'll be stricter next sheet.`
        : `You've traced in ${added} walls I missed — this print is lighter than I expect. I'll look harder next sheet.`,
      leverage: 50,
      body: { kind: 'detector-bias', bias: loose ? 'loose' : 'strict', added, removed },
    })
  }

  return lessons.sort((a, b) => b.leverage - a.leverage)
}

/** The single lesson worth acting on right now, or null while the read looks sound. */
export function topLesson(
  records: readonly CorrectionRecord[],
  ctx: LessonContext,
): Lesson | null {
  return deriveLessons(records, ctx)[0] ?? null
}

// ─── small helpers ───────────────────────────────────────────────────────────

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v))
}

const DRYWALL_OPTIONS: DrywallConfig[] = ['no-drywall', 'single-layer', 'double-layer']

function nearestDrywall(mm: number): DrywallConfig {
  let best = DRYWALL_OPTIONS[0]
  for (const o of DRYWALL_OPTIONS) {
    if (Math.abs(drywallAllowanceMm(o) - mm) < Math.abs(drywallAllowanceMm(best) - mm)) {
      best = o
    }
  }
  return best
}

function drywallPhrase(config: DrywallConfig): string {
  switch (config) {
    case 'no-drywall':
      return 'to bare framing, with no drywall on it'
    case 'double-layer':
      return 'with two layers of board each side'
    default:
      return 'with a single layer of board each side'
  }
}
