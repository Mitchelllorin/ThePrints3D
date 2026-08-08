import type { ParsedWall } from '../types'
import { detectOpenings } from './openingDetector'
import { classifyWallType, type DrywallConfig } from './wallTypeClassifier'

const COMMON_OPENING_WIDTHS_MM = [686, 762, 813, 864, 914, 965, 1200, 1500, 1800, 2100, 2400]
const COMMON_FINISHED_WALLS_MM = [70, 89, 121, 152, 171, 184, 203, 235, 286, 305]
const MIN_SCALE_MM_PER_PX = 0.2
const MAX_SCALE_MM_PER_PX = 50

export interface InferredScale {
  scaleMmPerPx: number
  confidence: number
  support: {
    walls: number
    openings: number
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function roundScaleBucket(scaleMmPerPx: number): number {
  return Math.round(scaleMmPerPx * 20) / 20
}

/** Longest side of everything drawn, in pixels. */
function drawnExtentPx(walls: ParsedWall[]): number {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const w of walls) {
    minX = Math.min(minX, w.x1, w.x2)
    maxX = Math.max(maxX, w.x1, w.x2)
    minY = Math.min(minY, w.y1, w.y2)
    maxY = Math.max(maxY, w.y1, w.y2)
  }
  if (!Number.isFinite(minX)) return 0
  return Math.max(maxX - minX, maxY - minY)
}

function collectCandidateScales(walls: ParsedWall[]): number[] {
  const openings = detectOpenings(walls, { minGapPx: 12, maxGapPx: 320 })
  const candidates: number[] = []

  for (const opening of openings) {
    if (opening.widthPx <= 0) continue
    for (const widthMm of COMMON_OPENING_WIDTHS_MM) {
      const scale = widthMm / opening.widthPx
      if (scale >= MIN_SCALE_MM_PER_PX && scale <= MAX_SCALE_MM_PER_PX) {
        candidates.push(scale)
      }
    }
  }

  for (const wall of walls) {
    if (wall.thickness < 2) continue
    for (const widthMm of COMMON_FINISHED_WALLS_MM) {
      const scale = widthMm / wall.thickness
      if (scale >= MIN_SCALE_MM_PER_PX && scale <= MAX_SCALE_MM_PER_PX) {
        candidates.push(scale)
      }
    }
  }

  return Array.from(new Set(candidates.map(roundScaleBucket)))
}

function scoreOpening(mm: number): number {
  let best = 0
  for (const widthMm of COMMON_OPENING_WIDTHS_MM) {
    const tolerance = Math.max(120, widthMm * 0.18)
    const closeness = 1 - Math.abs(mm - widthMm) / tolerance
    if (closeness > best) best = closeness
  }
  return clamp(best, 0, 1)
}

function scoreScaleCandidate(
  walls: ParsedWall[],
  scaleMmPerPx: number,
  drywall: DrywallConfig,
): { score: number; wallHits: number; openingHits: number } {
  let wallScore = 0
  let wallHits = 0

  for (const wall of walls) {
    if (wall.thickness < 2) continue
    const result = classifyWallType(wall.thickness * scaleMmPerPx, drywall)
    if (result.type === 'unknown') continue
    const length = Math.hypot(wall.x2 - wall.x1, wall.y2 - wall.y1)
    const lengthWeight = clamp(length / 120, 0.6, 1.6)
    const detectionWeight = clamp(wall.detectionConfidence ?? 0.7, 0.4, 1)
    wallHits++
    wallScore += result.confidence * lengthWeight * detectionWeight
  }

  const openings = detectOpenings(walls, { minGapPx: 12, maxGapPx: 320 })
  let openingScore = 0
  let openingHits = 0
  for (const opening of openings) {
    const score = scoreOpening(opening.widthPx * scaleMmPerPx)
    if (score <= 0) continue
    openingHits++
    openingScore += score * 1.35
  }

  return {
    score: wallScore + openingScore,
    wallHits,
    openingHits,
  }
}

/**
 * The drawing scales that actually get used, as real millimetres per paper
 * millimetre. Imperial first (this is a US/Canadian 1-&-2-family market), then
 * the metric ratios.
 *
 * 48 is 1/4"=1'-0", the residential floor-plan default; 96 is 1/8"=1'-0" for a
 * bigger building on the same sheet; the small numbers are details and sections.
 */
const ARCHITECTURAL_RATIOS = [
  192, 128, 96, 64, 48, 32, 24, 16, 12, 8, 4,   // 1/16" … 3"=1'-0"
  20, 25, 50, 100, 200,                          // 1:20 … 1:200
]

/** 1/4"=1'-0" and 1/8"=1'-0": the residential floor-plan defaults in the
 *  imperial market this app is built for. */
const DEFAULT_RATIOS = new Set([48, 96])
/** Also common, just not the first guess. */
const PLAUSIBLE_RATIOS = new Set([64, 50, 100])

/**
 * A "wall" thinner than this ON PAPER is a pen line, not a wall.
 *
 * The single most useful fact in here. A detector reports the thickness of the
 * ink it found, and on the real 1-&-2-family sheet 217 of 274 "walls" came back
 * 3–5px — which at 108 pixels to the paper inch is 0.7–1.2mm of pen. Those are
 * single drawn faces, not wall widths, and they outnumber the genuine
 * double-line walls 6:1, so any scale that flatters them wins on volume alone.
 * That is how the estimate landed 2.7× out, calling every pen stroke a tidy
 * 120mm partition.
 *
 * Line weight does not change with drawing scale — a heavy pen is ~1mm at any
 * scale — while a real wall is always wider than the pen that draws it. So this
 * threshold is measured in PAPER millimetres and needs no scale to apply, which
 * is precisely what makes it safe to use before the scale is known.
 */
const MIN_WALL_PAPER_MM = 1.5
/** Below this many surviving walls, trust the crowd again: a small or lightly
 *  drawn plan may legitimately have almost no heavy linework. */
const MIN_FILTERED_WALLS = 6

/**
 * How believable is a drawing that turns out to be this many metres across?
 *
 * The evidence the wall/opening scorer uses is weaker than it looks on a real
 * sheet. Most "wall thicknesses" a detector returns are LINE WEIGHTS — the
 * modal value on the real 1-&-2-family plan is 4px, and at 108 pixels to the
 * paper inch that is 0.037" of pen, not a 4½" partition. Feed those to the
 * classifier and a 2.7×-too-large scale looks great: every pen line becomes a
 * tidy 120mm stud wall.
 *
 * Overall extent cannot be faked that way. The sheet is dimensioned 24'-6" and
 * the whole drawing is tens of metres across; the scale that made those pen
 * lines into stud walls also made the building 117 METRES wide, which no
 * 1-&-2-family plan is. So size sanity gets a vote, and it is the vote that
 * settles it.
 *
 * A multiplier rather than a filter — an unusual building should be dragged
 * down, not ruled out.
 */
function extentPlausibility(metres: number): number {
  if (!Number.isFinite(metres) || metres <= 0) return 1
  if (metres < 3) return 0.2          // a doll's house — the scale is too small
  if (metres <= 60) return 1          // a house, or a sheet of them
  if (metres <= 120) return 0.5       // a big building, or a scale one step out
  return 0.15                         // a city block. Almost certainly wrong.
}

/**
 * Infer scale KNOWING HOW BIG THE PAPER IS.
 *
 * The structural inference below is a guess conditioned on nothing: it will
 * happily land on 42.85 mm/px, call every wall 600mm of masonry, and be
 * internally consistent while being about 4× wrong — which is exactly what it
 * did to the real 1-&-2-family set.
 *
 * A PDF page, though, states its own size. 3888px across a 36" sheet is 108
 * pixels per paper inch, and that is not a guess. The only unknown left is
 * WHICH standard scale the sheet was plotted at, and there are about sixteen of
 * those in the world. Choosing among sixteen physically real options beats
 * searching a continuum, so the same wall/opening evidence now decides a much
 * easier question.
 *
 * @param pxPerPaperInch raster pixels per inch of PAPER (not of the building).
 */
export function inferScaleFromPaper(
  walls: ParsedWall[],
  pxPerPaperInch: number,
  drywall: DrywallConfig = 'single-layer',
): InferredScale | null {
  if (walls.length === 0) return null
  if (!Number.isFinite(pxPerPaperInch) || pxPerPaperInch <= 0) return null

  const mmPerPxOnPaper = 25.4 / pxPerPaperInch

  // Judge the scale on real walls only — see MIN_WALL_PAPER_MM. Extent still
  // comes from EVERY wall: the pen lines are part of the drawing even if they
  // are not evidence of thickness, and throwing them away would shrink the
  // building.
  const heavy = walls.filter((w) => w.thickness * mmPerPxOnPaper >= MIN_WALL_PAPER_MM)
  const evidence = heavy.length >= MIN_FILTERED_WALLS ? heavy : walls
  const extentPx = drawnExtentPx(walls)

  let best: InferredScale | null = null
  let bestScore = 0

  for (const ratio of ARCHITECTURAL_RATIOS) {
    const scaleMmPerPx = mmPerPxOnPaper * ratio
    if (scaleMmPerPx < MIN_SCALE_MM_PER_PX || scaleMmPerPx > MAX_SCALE_MM_PER_PX) continue

    const { score, wallHits, openingHits } = scoreScaleCandidate(evidence, scaleMmPerPx, drywall)
    if (wallHits < 2 && openingHits < 1) continue
    // A thumb on the scale for the ratios a floor plan is actually drawn at.
    // It only decides near-ties — evidence still outranks it — but 1:50 and
    // 1/4"=1'-0" are 4% apart and both fit any drawing that fits either, so
    // something has to break that tie, and in this market it is the imperial one.
    const prior = DEFAULT_RATIOS.has(ratio) ? 1.2 : PLAUSIBLE_RATIOS.has(ratio) ? 1.1 : 1
    const weighted = score * prior * extentPlausibility((extentPx * scaleMmPerPx) / 1000)
    if (weighted <= bestScore) continue

    bestScore = weighted
    best = {
      scaleMmPerPx,
      confidence: clamp(0.5 + score / 12, 0, 0.95),
      support: { walls: wallHits, openings: openingHits },
    }
  }

  if (!best || bestScore < 2.2) return null
  return best
}

export function inferScaleFromStructure(
  walls: ParsedWall[],
  drywall: DrywallConfig = 'single-layer',
): InferredScale | null {
  if (walls.length === 0) return null

  const candidates = collectCandidateScales(walls)
  if (candidates.length === 0) return null

  let best: InferredScale | null = null
  let bestScore = 0

  for (const candidate of candidates) {
    const { score, wallHits, openingHits } = scoreScaleCandidate(walls, candidate, drywall)
    const hasSupport = wallHits >= 2 || openingHits >= 1
    if (!hasSupport || score <= bestScore) continue
    bestScore = score
    best = {
      scaleMmPerPx: candidate,
      confidence: clamp(0.35 + score / 12, 0, 0.9),
      support: {
        walls: wallHits,
        openings: openingHits,
      },
    }
  }

  if (!best) return null
  if (best.support.walls < 2 && best.support.openings < 1) return null
  if (bestScore < 2.2) return null
  return best
}
