/**
 * MAKE EVERY PRINT LOOK LIKE THE PRINT THE DETECTOR WAS BUILT FOR.
 *
 * Every raster stage downstream of here compares brightness against a number
 * somebody typed in: `INK_THRESHOLD = 64` in inkRaster, `WALL_GRAY_THRESHOLD =
 * 110` in roomExtractor, and — worst of all — the trained wall model, which
 * normalises with the ImageNet mean/std it was TRAINED on, over our own clean
 * synthetic plans.
 *
 * Those constants are not wrong. They are right for the image they were chosen
 * against: a PDF renders near-white paper and near-black ink, so "darker than
 * 110" really does mean "ink". Hand the same code a screenshot and none of it
 * survives — a screenshot carries the viewer's grey background, the display
 * gamma, JPEG mush and a rescale, so the paper might sit at 210 and the ink at
 * 90, and a threshold of 110 now selects almost the whole sheet. Photos and
 * scans fail the same way, from the other direction.
 *
 * So: measure what THIS image actually uses for paper and for ink, and stretch
 * it onto the full range before anything looks at it. Then a fixed threshold
 * means the same thing on every print, and the model is handed something from
 * the distribution it was trained on rather than whatever the user's screen
 * happened to be showing.
 *
 * Pure: plain arrays in, plain arrays out, no DOM. `ImageData` satisfies
 * `RasterLike` structurally, so callers pass one straight in.
 */

export interface RasterLike {
  data: Uint8ClampedArray
  width: number
  height: number
}

export interface InkStats {
  /** Grey level the paper sits at (high percentile). */
  paper: number
  /** Grey level the ink sits at (low percentile). */
  ink: number
  /** paper - ink. Under ~60 the image is washed out or fogged. */
  contrast: number
  /** Otsu's split between the two, 0..255. */
  threshold: number
  /** Share of pixels darker than the threshold — how much ink is on the page. */
  inkRatio: number
}

/** Rec.601 luminance, the same weights every other stage here uses. */
export function grayHistogram(img: RasterLike): Uint32Array {
  const hist = new Uint32Array(256)
  const { data } = img
  const px = img.width * img.height
  for (let i = 0; i < px; i++) {
    const o = i * 4
    hist[(0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2]) | 0]++
  }
  return hist
}

/**
 * Otsu's threshold — the grey level that best splits the histogram in two.
 *
 * There was already an implementation of this, private to roomExtractor, where
 * nothing else could reach it. That is why room extraction adapted to a dark
 * scan and every other stage did not.
 */
export function otsuThreshold(hist: Uint32Array, fallback = 128): number {
  let total = 0, sumAll = 0
  for (let t = 0; t < 256; t++) { total += hist[t]; sumAll += t * hist[t] }
  if (total === 0) return fallback

  let sumB = 0, wB = 0, maxVar = -1, best = fallback
  for (let t = 0; t < 256; t++) {
    wB += hist[t]
    if (wB === 0) continue
    const wF = total - wB
    if (wF === 0) break
    sumB += t * hist[t]
    const between = wB * wF * (sumB / wB - (sumAll - sumB) / wF) ** 2
    if (between > maxVar) { maxVar = between; best = t }
  }
  return best
}

/** The grey level at a given share of the pixels, counting up from black. */
function percentile(hist: Uint32Array, total: number, p: number): number {
  const target = total * p
  let seen = 0
  for (let t = 0; t < 256; t++) {
    seen += hist[t]
    if (seen >= target) return t
  }
  return 255
}

/**
 * What this image uses for paper and for ink.
 *
 * Percentiles rather than min/max: one black pixel of JPEG noise and one blown
 * highlight would otherwise claim the image already spans the full range, and
 * nothing would be corrected. A drawing is mostly paper, so the ink level is
 * taken low and the paper level high.
 */
export function inkStats(img: RasterLike): InkStats {
  const hist = grayHistogram(img)
  const total = img.width * img.height
  const ink = percentile(hist, total, 0.02)
  const paper = percentile(hist, total, 0.98)
  const threshold = otsuThreshold(hist)
  let dark = 0
  for (let t = 0; t <= threshold; t++) dark += hist[t]
  return {
    ink, paper,
    contrast: paper - ink,
    threshold,
    inkRatio: total ? dark / total : 0,
  }
}

export interface NormalizeOptions {
  /**
   * Leave images alone whose paper and ink are already this far apart. A PDF
   * render is already clean, and stretching it further only amplifies the
   * dither around thin lines — the exact pixels wall detection depends on.
   */
  minContrastToSkip?: number
  /** Percentile pair used for the stretch. */
  lowPercentile?: number
  highPercentile?: number
}

export interface NormalizeResult {
  image: RasterLike
  /** Stats BEFORE any correction — what the incoming print actually looked like. */
  stats: InkStats
  /** False when the image was already clean and was passed through untouched. */
  adjusted: boolean
}

/**
 * Stretch an image so its ink lands near black and its paper near white.
 *
 * Deliberately only a levels correction. Not a binarisation: the detector wants
 * grey edges to measure wall THICKNESS from, and a hard black/white image
 * throws that away. Not a sharpen or a denoise either — both invent detail, and
 * an invented line is a wall that is not there.
 */
export function normalizeForDetection(
  img: RasterLike,
  options: NormalizeOptions = {},
): NormalizeResult {
  const {
    minContrastToSkip = 170,
    lowPercentile = 0.02,
    highPercentile = 0.98,
  } = options

  const hist = grayHistogram(img)
  const total = img.width * img.height
  const ink = percentile(hist, total, lowPercentile)
  const paper = percentile(hist, total, highPercentile)
  const threshold = otsuThreshold(hist)
  let dark = 0
  for (let t = 0; t <= threshold; t++) dark += hist[t]
  const stats: InkStats = {
    ink, paper, contrast: paper - ink, threshold,
    inkRatio: total ? dark / total : 0,
  }

  // Already clean, or too flat to be a drawing at all (a blank sheet has no
  // two levels to stretch between, and scaling that noise up produces
  // structure out of nothing).
  if (stats.contrast >= minContrastToSkip || stats.contrast < 8) {
    return { image: img, stats, adjusted: false }
  }

  const span = paper - ink
  const lut = new Uint8Array(256)
  for (let v = 0; v < 256; v++) {
    lut[v] = Math.max(0, Math.min(255, Math.round(((v - ink) / span) * 255)))
  }

  const out = new Uint8ClampedArray(img.data.length)
  for (let i = 0; i < total; i++) {
    const o = i * 4
    out[o] = lut[img.data[o]]
    out[o + 1] = lut[img.data[o + 1]]
    out[o + 2] = lut[img.data[o + 2]]
    out[o + 3] = img.data[o + 3]
  }

  return { image: { data: out, width: img.width, height: img.height }, stats, adjusted: true }
}
