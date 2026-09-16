/**
 * MAKE THE MODEL'S ANSWER FACE THE DRAWING.
 *
 * The AI wall detector reads a 256x256 mask and hands back segments. Those
 * segments were then stamped `detectionConfidence: max(x, 0.75)` and passed
 * straight down the pipeline, so every one of them arrived downstream claiming
 * to be a wall on the model's say-so alone. Nothing ever checked them against
 * the pixels the user can see.
 *
 * Measured on a phone screenshot of a one-bed studio, that produced 30 walls,
 * of which ten were not walls: a segment through the word "BEDROOM", another
 * through "LIVING ROOM AREA", the fridge outline, a kitchen counter, a dashed
 * furniture stub and the edge of the bath. They stand up in the 3D model as
 * real framed walls, and the only way a user can tell is by recognising that
 * there is a stud wall where the label used to be.
 *
 * TWO QUESTIONS, ASKED OF THE ORIGINAL IMAGE, SETTLE IT.
 *
 *   IS THERE INK UNDER IT? Sample the drawing along the segment — the job
 *   `classifyLine` already does — and a few pixels either side of it, because
 *   a 256px mask stretched onto a 732px raster puts a correct wall up to eight
 *   pixels off the line it stands for. The darkest continuous reading in that
 *   band is the ink the segment is standing for; if nothing in the band reads
 *   as a continuous dark run, the model drew a wall over white paper.
 *
 *   IS IT JOINED TO ANYTHING? A wall is part of a structure: it lands on
 *   another wall or on the exterior. A line through a word lands on nothing.
 *   This is the question that does the work darkness cannot, because at this
 *   size the lettering IS a continuous grey smear and reads as 0.87 dark —
 *   indistinguishable from a thin grey partition by brightness alone.
 *
 * Both together drop all ten and keep all twenty.
 *
 * IT ALSO MOVES THE WALLS IT KEEPS. The offset that found the ink is where
 * the wall actually is, so a kept wall is snapped onto it. That is not a
 * bonus tacked on: a wall eight pixels out is a wall that will not close a
 * room, and half the work downstream — enclosure, corners, openings — is
 * trying to recover from exactly that.
 *
 * AND WHEN NOTHING SURVIVES, THE CALLER GETS AN EMPTY LIST AND FALLS BACK.
 * The detector cascade takes the first non-empty answer, so a model that
 * confidently returns rubbish has always cancelled the classical ladder that
 * would have coped. A corroborated empty answer lets the ladder have its turn.
 */
import type { ParsedWall } from '../types'
import { classifyLines } from './lineClassifier'

export interface CorroborateOptions {
  /**
   * How far either side of the segment to look for the ink it stands for.
   *
   * MUST BE SIZED TO THE RASTER, NOT PICKED. This started as a flat 8px,
   * tuned on a 732px screenshot where the mask upscale is 2.9x and a wall
   * lands a few pixels out. On a 3888px permit sheet the upscale is 15x, the
   * same registration error is forty raster pixels, an 8px search finds blank
   * paper beside every wall, and the stage throws the whole sheet away —
   * measured, 100 walls to 55 and 87 to 37 across the corpus. It is the same
   * absolute-pixel-threshold trap `vectorizeSize` exists to avoid, made again
   * one file over. Callers pass `rasterSearchPx()`.
   */
  searchPx?: number
  /** Fraction of the samples along the line that must read as ink. */
  minDark?: number
  /** Dark/light flips allowed along it. A wall is continuous; a word is not. */
  maxTransitions?: number
  /** How close an end has to come to another wall to count as landing on it. */
  touchPx?: number
}

/**
 * The search radius for a raster of this size, in its own pixels.
 *
 * The mask is 256 across whatever the sheet is, so one mask pixel is
 * `longEdge / 256` raster pixels and the model's registration error is a small
 * number of mask pixels. Three of them covers what was measured on the
 * screenshot (8px at 2.9x) and scales correctly to a full sheet. Capped
 * because a search wider than the gap between two parallel walls will happily
 * snap a wall onto its neighbour.
 */
export function rasterSearchPx(width: number, height: number): number {
  const perMaskPx = Math.max(width, height) / 256
  return Math.max(6, Math.min(28, Math.round(3 * perMaskPx)))
}

export interface CorroborationResult {
  walls: ParsedWall[]
  /** How many the drawing did not support. */
  dropped: number
  /** How many were moved onto the ink they stand for. */
  snapped: number
  /** Largest correction applied, in pixels — the mask's registration error. */
  maxSnapPx: number
}

interface Seg { x1: number; y1: number; x2: number; y2: number }

/** The same segment, shifted perpendicular by `d` pixels. */
function shift<T extends Seg>(s: T, d: number): T {
  if (d === 0) return s
  const dx = s.x2 - s.x1
  const dy = s.y2 - s.y1
  const len = Math.hypot(dx, dy) || 1
  const nx = -dy / len
  const ny = dx / len
  return { ...s, x1: s.x1 + nx * d, y1: s.y1 + ny * d, x2: s.x2 + nx * d, y2: s.y2 + ny * d }
}

/** Distance from a point to a segment — an end landing MID-run still counts. */
function distToSeg(px: number, py: number, s: Seg): number {
  const vx = s.x2 - s.x1
  const vy = s.y2 - s.y1
  const lenSq = vx * vx + vy * vy
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - s.x1) * vx + (py - s.y1) * vy) / lenSq))
  return Math.hypot(px - (s.x1 + t * vx), py - (s.y1 + t * vy))
}

/**
 * How many of a wall's two ends land on another wall.
 *
 * Measured against the ORIGINAL set, before anything is dropped. Judging it
 * against the survivors would cascade: one dropped wall orphans its neighbour,
 * which is then dropped in turn, and a single bad segment can unzip a plan.
 */
function joinedEnds(walls: readonly Seg[], i: number, touchPx: number): number {
  const w = walls[i]
  let ends = 0
  for (const [ex, ey] of [[w.x1, w.y1], [w.x2, w.y2]] as Array<[number, number]>) {
    for (let j = 0; j < walls.length; j++) {
      if (j === i) continue
      if (distToSeg(ex, ey, walls[j]) <= touchPx) { ends++; break }
    }
  }
  return ends
}

/**
 * Keep the walls the drawing supports, snapped onto the ink they stand for.
 *
 * `imageData` must be the ORIGINAL raster the user handed over, and `walls`
 * must already be in its coordinates — corroborating a mask against itself is
 * how this went wrong in the first place.
 */
export function corroborateWalls(
  imageData: ImageData,
  walls: readonly ParsedWall[],
  options: CorroborateOptions = {},
): CorroborationResult {
  const {
    searchPx = 8,
    minDark = 0.6,
    maxTransitions = 6,
    touchPx = 10,
  } = options

  if (walls.length === 0) return { walls: [], dropped: 0, snapped: 0, maxSnapPx: 0 }

  const offsets: number[] = []
  for (let d = -searchPx; d <= searchPx; d++) offsets.push(d)

  /**
   * ONE classifyLines CALL FOR EVERY VARIANT, not one per wall.
   *
   * It derives the dark threshold from the lines it is given, and this print
   * is the reason that matters: its interior walls are thin grey double lines
   * sitting well above the hard-coded 128, so line-by-line calls fall back to
   * that constant and read every partition in the building as blank paper —
   * 7 of 30 corroborated instead of 25. The threshold has to be taken across
   * the whole candidate set or it is not adaptive at all.
   */
  const variants = walls.flatMap((w) => offsets.map((d) => shift(w, d)))
  const readings = classifyLines(imageData, variants.map((v) => ({
    x1: v.x1, y1: v.y1, x2: v.x2, y2: v.y2, thickness: v.thickness ?? 4,
  }))).classified

  /**
   * Connectivity is measured on the geometry as it arrived. Snapping moves
   * walls by a few pixels and would otherwise change who touches whom mid-pass.
   */
  const ends = walls.map((_, i) => joinedEnds(walls, i, touchPx))
  /**
   * A plan with one or two walls has nothing to be joined to. Requiring a
   * junction there would reject a perfectly good answer for being lonely.
   */
  const requireJoin = walls.length > 2

  const kept: ParsedWall[] = []
  let dropped = 0
  let snapped = 0
  let maxSnapPx = 0

  walls.forEach((wall, i) => {
    /**
     * THE BEST READING, THEN THE MIDDLE OF IT.
     *
     * A wall is several pixels thick, so a whole band of offsets reads equally
     * dark. Taking the first or the nearest of those parks the wall on the
     * near FACE of the run rather than on its centre, which then reports a
     * wall a couple of pixels off and half a thickness thin. The middle of the
     * band is the centreline, which is what every stage downstream — corners,
     * openings, the framing itself — expects a wall to be.
     */
    let bestDark = 0
    let bestTransitions = 99
    offsets.forEach((_d, k) => {
      const r = readings[i * offsets.length + k]
      if (r.dark_ratio > bestDark + 1e-6) { bestDark = r.dark_ratio; bestTransitions = r.transitions }
      else if (Math.abs(r.dark_ratio - bestDark) <= 1e-6 && r.transitions < bestTransitions) {
        bestTransitions = r.transitions
      }
    })
    const band = offsets.filter((_d, k) => {
      const r = readings[i * offsets.length + k]
      return Math.abs(r.dark_ratio - bestDark) <= 1e-6 && r.transitions <= bestTransitions
    })
    const centreOfBand = band.length ? band[Math.floor((band.length - 1) / 2)] : 0
    const best = {
      d: centreOfBand,
      dark: bestDark,
      transitions: bestTransitions,
    }

    const hasInk = best.dark >= minDark && best.transitions <= maxTransitions
    const joined = !requireJoin || ends[i] >= 1
    if (!hasInk || !joined) { dropped++; return }

    const moved = shift(wall, best.d)
    if (best.d !== 0) { snapped++; maxSnapPx = Math.max(maxSnapPx, Math.abs(best.d)) }
    kept.push({
      ...moved,
      /**
       * The confidence now says something. It used to be `max(x, 0.75)` — a
       * floor stamped on every segment the model emitted, which made a wall
       * over a word indistinguishable from the exterior of the building.
       */
      detectionConfidence: Math.max(0.35, Math.min(0.97, best.dark * 0.9 + (ends[i] === 2 ? 0.07 : 0))),
    })
  })

  return { walls: kept, dropped, snapped, maxSnapPx }
}
