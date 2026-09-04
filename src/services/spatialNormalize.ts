/**
 * MAKE EVERY PRINT THE SAME SIZE, NOT JUST THE SAME BRIGHTNESS.
 *
 * `rasterNormalize` fixed one half of this problem: it measures what an image
 * actually uses for paper and ink and stretches it onto the full range, so a
 * fixed brightness threshold means the same thing on a PDF, a screenshot and a
 * photo. This is the other half, and until now nothing did it.
 *
 * Every stage downstream measures in ABSOLUTE PIXELS — `minWallLengthPx`,
 * `minWallThicknessPx`, `maxWallThicknessPx`, `mergeGapPx` — and what the
 * detector is handed varies by an order of magnitude:
 *
 *     a rendered PDF sheet      ~3900 px across
 *     an imported image         up to 3000 px
 *     a phone screenshot          ~732 px
 *
 * A wall is ~30 px thick on the sheet and ~6 px thick on the screenshot, so one
 * set of constants cannot be right for both. The codebase compensated by
 * hand-tuning a three-pass ladder per source (60/55/28 px) and by capping
 * thickness at 120 px — which is most of a ROOM on a 732 px screenshot. Those
 * are symptoms; this is the cause.
 *
 * The fix is the same trick `rasterNormalize` uses for tone: let the image tell
 * you its own scale. The ink has a characteristic STROKE WIDTH — the thickness
 * of an ordinary drawn line — and it is the one feature every drawing has,
 * whatever its subject, format or resolution. Measure it, resample so it is
 * always the same number of pixels, and one set of constants is correct for
 * every input. No dimension text, no title block, no user input.
 *
 * Pure: plain arrays in, plain arrays out, no DOM. `ImageData` satisfies
 * `RasterLike` structurally, so callers pass one straight in.
 */

import { grayHistogram, inkStats, otsuThreshold, type RasterLike } from './rasterNormalize'

/**
 * The stroke width every image is resampled to.
 *
 * Chosen to match what the existing constants were tuned against — a rendered
 * PDF sheet, whose ordinary line work lands around 3 px. Keeping the target
 * there means the detector's numbers keep meaning what they already meant on
 * the source they were chosen for; it is the other inputs that move.
 */
export const CANONICAL_STROKE_PX = 3

/** Runs longer than this are filled regions (hatching, solid poché), not strokes. */
const MAX_STROKE_RUN = 40

export interface StrokeMeasurement {
  /** Typical line thickness in pixels. Fractional — see the estimator below. */
  strokePx: number
  /** How many runs the mode was drawn from. Low counts mean a weak reading. */
  samples: number
  /** Ink/paper split used, for debugging a bad measurement. */
  threshold: number
}

function toGray(img: RasterLike, x: number, y: number): number {
  const i = (y * img.width + x) * 4
  const d = img.data
  return (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000
}

/**
 * Measure the drawing's characteristic stroke width.
 *
 * Walks every Nth row and column, records the length of each unbroken run of
 * ink, and takes the MODE of those lengths. The mode rather than the mean
 * because a plan is mostly ordinary line work with a few outliers — thick
 * walls, filled poché, a title block border — and the mean is dragged around by
 * them while the mode is not.
 */
export function measureStroke(img: RasterLike): StrokeMeasurement {
  /**
   * BIAS THE INK SPLIT AWAY FROM THE FRINGE.
   *
   * Otsu sits between paper and ink, which is the right split for deciding
   * "is there ink here". It is the WRONG split for measuring how THICK the ink
   * is: on an anti-aliased screenshot every stroke carries a grey halo that
   * falls on the ink side of Otsu, and those halos produce a flood of 2px runs
   * that win the mode outright. Measured on the corpus, both real screenshots
   * reported a stroke of 2 — the floor of the search — regardless of their
   * actual line work.
   *
   * So the threshold moves halfway from Otsu down toward the ink level, which
   * selects stroke CORES and leaves the halo on the paper side.
   *
   * Otsu's split is also inclusive of the ink side: on a clean bi-level drawing
   * it lands exactly on the ink value, so a strict `<` would find no ink at all
   * on the best-formed input imaginable.
   */
  const stats = inkStats(img)
  const otsu = otsuThreshold(grayHistogram(img))
  const threshold = Math.max(stats.ink, Math.round(stats.ink + (otsu - stats.ink) * 0.5))
  const hist = new Uint32Array(MAX_STROKE_RUN + 1)
  let samples = 0

  // Sampling every 3rd line is plenty for a mode and keeps this cheap on a
  // 10-megapixel sheet, where reading every pixel would cost more than the
  // detection it is meant to be preparing.
  const STEP = 3

  for (let y = 0; y < img.height; y += STEP) {
    let run = 0
    for (let x = 0; x < img.width; x++) {
      if (toGray(img, x, y) <= threshold) run++
      else {
        if (run > 0 && run <= MAX_STROKE_RUN) { hist[run]++; samples++ }
        run = 0
      }
    }
    if (run > 0 && run <= MAX_STROKE_RUN) { hist[run]++; samples++ }
  }

  for (let x = 0; x < img.width; x += STEP) {
    let run = 0
    for (let y = 0; y < img.height; y++) {
      if (toGray(img, x, y) <= threshold) run++
      else {
        if (run > 0 && run <= MAX_STROKE_RUN) { hist[run]++; samples++ }
        run = 0
      }
    }
    if (run > 0 && run <= MAX_STROKE_RUN) { hist[run]++; samples++ }
  }

  // Single-pixel runs are dominated by anti-aliasing fringe and JPEG speckle on
  // a screenshot, so they would win the mode on exactly the inputs this exists
  // to rescue. Start at 2.
  let best = 2
  let bestCount = 0
  for (let w = 2; w <= MAX_STROKE_RUN; w++) {
    if (hist[w] > bestCount) { bestCount = hist[w]; best = w }
  }

  /**
   * SUB-PIXEL PEAK, NOT A WINNING BIN.
   *
   * A whole-pixel mode quantises hard: a drawing whose true stroke sits between
   * 2 and 3 gets reported as one or the other depending on which bin wins by a
   * hair, and the resample factor then jumps by 50%. Fitting a parabola through
   * the winning bin and its two neighbours recovers the fraction, so the factor
   * moves smoothly with the drawing instead of snapping between two answers.
   *
   * On a clean synthetic image the neighbours are empty, the fit returns
   * exactly zero offset, and the integer answer is preserved.
   */
  const yL = best > 2 ? hist[best - 1] : 0
  const yC = hist[best]
  const yR = best < MAX_STROKE_RUN ? hist[best + 1] : 0
  const denom = yL - 2 * yC + yR
  const delta = denom !== 0 ? (0.5 * (yL - yR)) / denom : 0
  const strokePx = best + Math.max(-0.5, Math.min(0.5, delta))

  return { strokePx, samples, threshold }
}

/** Bilinear resample. Handles both up- and down-scaling. */
export function resample(img: RasterLike, factor: number): RasterLike {
  const w = Math.max(1, Math.round(img.width * factor))
  const h = Math.max(1, Math.round(img.height * factor))
  const out = new Uint8ClampedArray(w * h * 4)
  const sx = img.width / w
  const sy = img.height / h

  for (let y = 0; y < h; y++) {
    const fy = Math.min(img.height - 1, (y + 0.5) * sy - 0.5)
    const y0 = Math.max(0, Math.floor(fy))
    const y1 = Math.min(img.height - 1, y0 + 1)
    const wy = fy - y0
    for (let x = 0; x < w; x++) {
      const fx = Math.min(img.width - 1, (x + 0.5) * sx - 0.5)
      const x0 = Math.max(0, Math.floor(fx))
      const x1 = Math.min(img.width - 1, x0 + 1)
      const wx = fx - x0
      const o = (y * w + x) * 4
      for (let c = 0; c < 4; c++) {
        const p00 = img.data[(y0 * img.width + x0) * 4 + c]
        const p10 = img.data[(y0 * img.width + x1) * 4 + c]
        const p01 = img.data[(y1 * img.width + x0) * 4 + c]
        const p11 = img.data[(y1 * img.width + x1) * 4 + c]
        const top = p00 + (p10 - p00) * wx
        const bot = p01 + (p11 - p01) * wx
        out[o + c] = top + (bot - top) * wy
      }
    }
  }
  return { data: out, width: w, height: h }
}

export interface SpatialNormalizeResult {
  image: RasterLike
  /** Multiply a normalized-space coordinate by this to get back to source px. */
  inverseFactor: number
  /** What the source measured at, before resampling. */
  measured: StrokeMeasurement
  /** False when the image was passed through untouched. */
  adjusted: boolean
}

/**
 * Resample an image so its stroke width is `target` pixels.
 *
 * Deliberately conservative about when it acts:
 *  - a weak measurement (too few runs) is not trusted, and nothing is done;
 *  - factors near 1 are skipped, since resampling always costs a little
 *    sharpness and there is nothing to gain;
 *  - the factor is clamped, so a pathological reading cannot blow a 3000px
 *    image up to something that will not fit in memory.
 *
 * Returning `adjusted: false` with `inverseFactor: 1` means "use the original",
 * which keeps the caller's happy path identical to what it was before.
 */
export function normalizeStrokeScale(
  img: RasterLike,
  target: number = CANONICAL_STROKE_PX,
): SpatialNormalizeResult {
  const measured = measureStroke(img)
  const untouched: SpatialNormalizeResult = {
    image: img, inverseFactor: 1, measured, adjusted: false,
  }

  // Under a few thousand runs the mode is noise, not a measurement.
  if (measured.samples < 2000) return untouched

  const raw = target / measured.strokePx
  const factor = Math.min(4, Math.max(0.25, raw))
  // Within ±15% the resample would cost more sharpness than it buys.
  if (factor > 0.85 && factor < 1.15) return untouched

  return {
    image: resample(img, factor),
    inverseFactor: 1 / factor,
    measured,
    adjusted: true,
  }
}
