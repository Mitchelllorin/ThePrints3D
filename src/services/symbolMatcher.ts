// Seed-guided SYMBOL detection — the "trace one, find the rest" mechanic
// (already live for walls via seedDetector) generalized to symbols: the user
// boxes ONE door / window / outlet / fixture on the raster, and this finds the
// other instances by template matching. Pure (no DOM/THREE) so it's unit-
// testable and reusable by the detection pipeline and any worker.
//
// Matching is normalized cross-correlation (NCC) on a small resampled grid, so
// it's invariant to brightness/contrast. Symbols repeat at different
// orientations (a door swings four ways and mirrors), so we test the seed at
// 0/90/180/270° and an optional horizontal flip and keep the best per location.
// Non-max suppression collapses overlapping hits to one per symbol.

/** A grayscale image, row-major, one byte (0..255) per pixel. */
export interface GrayImage {
  data: Uint8ClampedArray | Uint8Array | number[]
  width: number
  height: number
}

/** The pixel rectangle the user traced around one example symbol. */
export interface SeedBox {
  x: number
  y: number
  w: number
  h: number
}

export interface SymbolMatch {
  /** Centre of the match, in image pixels. */
  x: number
  y: number
  /** Normalized cross-correlation of the winning variant, 0..1. */
  score: number
  /** Orientation of the seed that matched here. */
  rotation: 0 | 90 | 180 | 270
  /** Whether the winning variant was horizontally mirrored. */
  flipped: boolean
  /** True for the match that coincides with the user's own seed box. */
  isSeed: boolean
}

export interface MatchOptions {
  /** Minimum NCC to accept a match (0..1). Default 0.62. */
  threshold?: number
  /** Scan stride in image pixels. Default derived from the seed size. */
  step?: number
  /** Rotations (deg) to test the seed at. Default [0, 90, 180, 270]. */
  rotations?: Array<0 | 90 | 180 | 270>
  /** Also test a horizontally-mirrored seed (doors/handing). Default true. */
  allowFlip?: boolean
  /** Cap on returned matches (highest score first). Default 200. */
  maxMatches?: number
  /** Longest side of the internal resample grid. Default 24. */
  gridMax?: number
}

const DEFAULTS = {
  // NCC is scale/brightness-invariant; repeated drawing stamps score ~0.95+, so
  // a firm 0.72 rejects partial/edge correlations without missing real repeats.
  threshold: 0.72,
  rotations: [0, 90, 180, 270] as Array<0 | 90 | 180 | 270>,
  allowFlip: true,
  maxMatches: 200,
  gridMax: 24,
}

/** Convert RGBA ImageData-like pixels to a grayscale GrayImage (luma). */
export function toGrayImage(img: { data: Uint8ClampedArray | number[]; width: number; height: number }): GrayImage {
  const { data, width, height } = img
  const gray = new Uint8ClampedArray(width * height)
  for (let i = 0, p = 0; p < gray.length; p++, i += 4) {
    // Rec. 601 luma; alpha ignored (floorplans are opaque).
    gray[p] = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) | 0
  }
  return { data: gray, width, height }
}

interface Grid {
  cells: Float64Array
  gw: number
  gh: number
}

/**
 * Nearest-neighbour resample of an image region into a gw×gh grid, sampling at
 * cell centres with `floor` (not round-half-up) so a 1:1 grid maps exactly and
 * 90° rotation commutes with sampling — otherwise rotated templates misalign by
 * a pixel and their NCC drops below threshold.
 */
function sampleGrid(img: GrayImage, x0: number, y0: number, rw: number, rh: number, gw: number, gh: number): Grid {
  const cells = new Float64Array(gw * gh)
  const { data, width, height } = img
  for (let gy = 0; gy < gh; gy++) {
    const sy = Math.min(height - 1, Math.max(0, Math.floor(y0 + ((gy + 0.5) / gh) * rh)))
    for (let gx = 0; gx < gw; gx++) {
      const sx = Math.min(width - 1, Math.max(0, Math.floor(x0 + ((gx + 0.5) / gw) * rw)))
      cells[gy * gw + gx] = data[sy * width + sx]
    }
  }
  return { cells, gw, gh }
}

/** Rotate a grid by a multiple of 90° and/or mirror it horizontally. */
function transformGrid(g: Grid, rotation: 0 | 90 | 180 | 270, flip: boolean): Grid {
  let cur = g
  const rot90 = (src: Grid): Grid => {
    const { cells, gw, gh } = src
    const out = new Float64Array(cells.length)
    // (x,y) -> (gh-1-y, x); result is gh×gw
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        const nx = gh - 1 - y
        const ny = x
        out[ny * gh + nx] = cells[y * gw + x]
      }
    }
    return { cells: out, gw: gh, gh: gw }
  }
  const times = rotation / 90
  for (let i = 0; i < times; i++) cur = rot90(cur)
  if (flip) {
    const { cells, gw, gh } = cur
    const out = new Float64Array(cells.length)
    for (let y = 0; y < gh; y++)
      for (let x = 0; x < gw; x++) out[y * gw + (gw - 1 - x)] = cells[y * gw + x]
    cur = { cells: out, gw, gh }
  }
  return cur
}

interface NormTemplate {
  cells: Float64Array // mean-subtracted
  norm: number        // sqrt(sum of squares); 0 → featureless
  gw: number
  gh: number
  rotation: 0 | 90 | 180 | 270
  flipped: boolean
}

function normalize(g: Grid, rotation: 0 | 90 | 180 | 270, flipped: boolean): NormTemplate {
  const { cells, gw, gh } = g
  const n = cells.length
  let mean = 0
  for (let i = 0; i < n; i++) mean += cells[i]
  mean /= n
  const out = new Float64Array(n)
  let ss = 0
  for (let i = 0; i < n; i++) {
    const v = cells[i] - mean
    out[i] = v
    ss += v * v
  }
  return { cells: out, norm: Math.sqrt(ss), gw, gh, rotation, flipped }
}

/**
 * Find symbol instances similar to the seed box. Returns matches (highest score
 * first) with the seed's own location flagged `isSeed`, so a caller can place
 * "the rest" (the non-seed matches) directly.
 */
export function findSimilarSymbols(image: GrayImage, seed: SeedBox, options: MatchOptions = {}): SymbolMatch[] {
  const opts = { ...DEFAULTS, ...options }
  const seedW = Math.max(1, Math.round(seed.w))
  const seedH = Math.max(1, Math.round(seed.h))
  if (seedW < 3 || seedH < 3) return []

  // Resample grid: preserve aspect, longest side ≤ gridMax. Never UPSAMPLE
  // (cap at 1:1) — upsampling adds no information and its half-pixel rounding
  // breaks rotation invariance.
  const scale = Math.min(1, opts.gridMax / Math.max(seedW, seedH))
  const gw = Math.max(3, Math.round(seedW * scale))
  const gh = Math.max(3, Math.round(seedH * scale))

  const seedGrid = sampleGrid(image, seed.x, seed.y, seedW, seedH, gw, gh)

  // Build the template variant set. Square seeds get all rotations; rectangular
  // seeds only get 0/180 (+ their flips) since 90/270 change the aspect ratio
  // and won't align with the fixed seedW×seedH scan window anyway.
  const square = Math.abs(gw - gh) <= 1
  const rotations = square ? opts.rotations : opts.rotations.filter((r) => r === 0 || r === 180)
  const variants: NormTemplate[] = []
  const seen = new Set<string>()
  for (const rot of rotations) {
    for (const flip of opts.allowFlip ? [false, true] : [false]) {
      const tg = transformGrid(seedGrid, rot, flip)
      if (tg.gw !== gw || tg.gh !== gh) continue // aspect changed → skip (rectangular 90/270)
      const key = `${rot}:${flip}`
      if (seen.has(key)) continue
      seen.add(key)
      variants.push(normalize(tg, rot, flip))
    }
  }
  const featured = variants.filter((v) => v.norm > 1e-6)
  if (featured.length === 0) return [] // seed is a blank patch — nothing to match

  const step = Math.max(1, opts.step ?? Math.max(2, Math.round(Math.min(seedW, seedH) / 6)))
  const maxX = image.width - seedW
  const maxY = image.height - seedH
  const raw: SymbolMatch[] = []

  for (let y = 0; y <= maxY; y += step) {
    for (let x = 0; x <= maxX; x += step) {
      const win = sampleGrid(image, x, y, seedW, seedH, gw, gh)
      // Window stats (variant-independent).
      const cells = win.cells
      const n = cells.length
      let mean = 0
      for (let i = 0; i < n; i++) mean += cells[i]
      mean /= n
      let winNorm = 0
      for (let i = 0; i < n; i++) { const d = cells[i] - mean; winNorm += d * d }
      winNorm = Math.sqrt(winNorm)
      if (winNorm < 1e-6) continue // flat window (blank paper) — skip

      let best = -1
      let bestRot: 0 | 90 | 180 | 270 = 0
      let bestFlip = false
      for (const v of featured) {
        let dot = 0
        for (let i = 0; i < n; i++) dot += (cells[i] - mean) * v.cells[i]
        const ncc = dot / (winNorm * v.norm)
        if (ncc > best) { best = ncc; bestRot = v.rotation; bestFlip = v.flipped }
      }
      if (best >= opts.threshold) {
        raw.push({
          x: x + seedW / 2,
          y: y + seedH / 2,
          score: best,
          rotation: bestRot,
          flipped: bestFlip,
          isSeed: false,
        })
      }
    }
  }

  // Non-max suppression: one hit per symbol. Radius ≈ half the seed's smaller side.
  const suppress = Math.max(step, Math.min(seedW, seedH) * 0.6)
  raw.sort((a, b) => b.score - a.score)
  const kept: SymbolMatch[] = []
  for (const m of raw) {
    if (kept.some((k) => Math.hypot(k.x - m.x, k.y - m.y) < suppress)) continue
    kept.push(m)
    if (kept.length >= opts.maxMatches) break
  }

  // Flag the match nearest the seed centre as the seed itself.
  const seedCx = seed.x + seedW / 2
  const seedCy = seed.y + seedH / 2
  let seedIdx = -1
  let seedD = Infinity
  kept.forEach((m, i) => {
    const d = Math.hypot(m.x - seedCx, m.y - seedCy)
    if (d < seedD && d < suppress * 1.5) { seedD = d; seedIdx = i }
  })
  if (seedIdx >= 0) kept[seedIdx].isSeed = true

  return kept
}

/** Just "the rest" — matches excluding the user's own seed instance. */
export function findAdditionalSymbols(image: GrayImage, seed: SeedBox, options?: MatchOptions): SymbolMatch[] {
  return findSimilarSymbols(image, seed, options).filter((m) => !m.isSeed)
}
