import { describe, it, expect } from 'vitest'
import {
  normalizeForDetection, inkStats, otsuThreshold, grayHistogram, type RasterLike,
} from './rasterNormalize'

/** Build an RGBA raster from a grey-level function. */
function raster(width: number, height: number, at: (x: number, y: number) => number): RasterLike {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const g = at(x, y), o = (y * width + x) * 4
      data[o] = data[o + 1] = data[o + 2] = g
      data[o + 3] = 255
    }
  }
  return { data, width, height }
}

/** A clean plan: white paper, black walls on a grid. */
const cleanPlan = (w = 80, h = 80) =>
  raster(w, h, (x, y) => (x % 20 === 0 || y % 20 === 0 ? 12 : 245))

/**
 * The same plan as a SCREENSHOT: contrast crushed toward mid-grey and the whole
 * thing lifted onto a viewer's grey background. Paper ~200, ink ~120 — which is
 * why a fixed "darker than 110 is ink" finds nothing at all.
 */
const screenshotOf = (src: RasterLike, gain = 0.35, lift = 110): RasterLike => {
  const data = new Uint8ClampedArray(src.data.length)
  for (let i = 0; i < src.data.length; i += 4) {
    const g = Math.round(src.data[i] * gain + lift)
    data[i] = data[i + 1] = data[i + 2] = g
    data[i + 3] = 255
  }
  return { data, width: src.width, height: src.height }
}

describe('inkStats', () => {
  it('reads paper and ink off a clean plan', () => {
    const s = inkStats(cleanPlan())
    expect(s.paper).toBeGreaterThan(220)
    expect(s.ink).toBeLessThan(40)
    expect(s.contrast).toBeGreaterThan(180)
    expect(s.inkRatio).toBeGreaterThan(0)
    expect(s.inkRatio).toBeLessThan(0.5)   // a drawing is mostly paper
  })

  it('reports the crushed contrast of a screenshot', () => {
    const s = inkStats(screenshotOf(cleanPlan()))
    expect(s.contrast).toBeLessThan(110)
    expect(s.ink).toBeGreaterThan(100)     // "ink" is no longer dark at all
  })
})

describe('otsuThreshold', () => {
  it('separates the two peaks — pixels <= t are the ink', () => {
    // Otsu's convention: t is the LAST level of the dark class, so on a
    // two-level image the answer is the ink level itself. That is the contract
    // callers rely on ("gray <= threshold means ink"), so it is pinned here.
    const t = otsuThreshold(grayHistogram(cleanPlan()))
    expect(t).toBeGreaterThanOrEqual(12)
    expect(t).toBeLessThan(245)
  })

  it('falls back on a blank sheet rather than inventing a split', () => {
    expect(otsuThreshold(new Uint32Array(256), 99)).toBe(99)
  })
})

describe('normalizeForDetection', () => {
  it('leaves a clean PDF-style plan untouched', () => {
    // The current pipeline works on these; correcting them would only amplify
    // the dither around thin lines.
    const src = cleanPlan()
    const r = normalizeForDetection(src)
    expect(r.adjusted).toBe(false)
    expect(r.image).toBe(src)
  })

  it('restores a screenshot to something the fixed thresholds can read', () => {
    const shot = screenshotOf(cleanPlan())
    const before = inkStats(shot)
    const r = normalizeForDetection(shot)

    expect(r.adjusted).toBe(true)
    const after = inkStats(r.image)
    expect(after.contrast).toBeGreaterThan(before.contrast + 100)
    // The two numbers the rest of the pipeline hardcodes: INK_THRESHOLD = 64
    // and WALL_GRAY_THRESHOLD = 110. Before, no wall pixel was below either.
    expect(before.ink).toBeGreaterThan(110)
    expect(after.ink).toBeLessThan(64)
    expect(after.paper).toBeGreaterThan(200)
  })

  it('keeps the drawing intact — ink stays ink, paper stays paper', () => {
    const r = normalizeForDetection(screenshotOf(cleanPlan()))
    const px = (img: RasterLike, x: number, y: number) => img.data[(y * img.width + x) * 4]
    expect(px(r.image, 0, 5)).toBeLessThan(64)      // on a wall line
    expect(px(r.image, 10, 5)).toBeGreaterThan(200) // in a room
  })

  it('refuses to stretch a blank sheet into structure', () => {
    const blank = raster(40, 40, () => 200)
    const r = normalizeForDetection(blank)
    expect(r.adjusted).toBe(false)
  })

  it('handles a dark scan as well as a washed-out one', () => {
    // Underexposed: everything crushed toward black.
    const dark = raster(60, 60, (x, y) => (x % 15 === 0 ? 4 : 70))
    const r = normalizeForDetection(dark)
    expect(r.adjusted).toBe(true)
    expect(inkStats(r.image).contrast).toBeGreaterThan(180)
  })
})
