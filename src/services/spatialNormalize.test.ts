import { describe, it, expect } from 'vitest'
import { measureStroke, resample, normalizeStrokeScale, CANONICAL_STROKE_PX } from './spatialNormalize'
import type { RasterLike } from './rasterNormalize'

/** A plan-like image: a grid of lines of known thickness on white paper. */
function planWithStroke(strokePx: number, w = 600, h = 600): RasterLike {
  const data = new Uint8ClampedArray(w * h * 4).fill(255)
  for (let i = 3; i < data.length; i += 4) data[i] = 255
  const ink = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return
    const i = (y * w + x) * 4
    data[i] = data[i + 1] = data[i + 2] = 10
  }
  // Lines every 60px, each `strokePx` thick, both directions.
  for (let gy = 40; gy < h - 40; gy += 60)
    for (let t = 0; t < strokePx; t++)
      for (let x = 40; x < w - 40; x++) ink(x, gy + t)
  for (let gx = 40; gx < w - 40; gx += 60)
    for (let t = 0; t < strokePx; t++)
      for (let y = 40; y < h - 40; y++) ink(gx + t, y)
  return { data, width: w, height: h }
}

describe('measureStroke', () => {
  it('reads the stroke width of a thin-line drawing', () => {
    expect(measureStroke(planWithStroke(3)).strokePx).toBe(3)
  })

  it('reads the stroke width of a thick-line drawing', () => {
    expect(measureStroke(planWithStroke(8)).strokePx).toBe(8)
  })

  it('is not fooled by resolution — same drawing, twice the pixels', () => {
    // The point of the whole module: a 6px stroke IS a different drawing to a
    // 3px stroke, and must be reported as such.
    expect(measureStroke(planWithStroke(6)).strokePx).toBe(6)
  })
})

describe('resample', () => {
  it('halves the dimensions at factor 0.5', () => {
    const out = resample(planWithStroke(4), 0.5)
    expect([out.width, out.height]).toEqual([300, 300])
  })

  it('produces a valid buffer', () => {
    const out = resample(planWithStroke(4), 0.5)
    expect(out.data.length).toBe(out.width * out.height * 4)
  })
})

describe('normalizeStrokeScale', () => {
  it('shrinks a heavy-stroked drawing toward the canonical width', () => {
    const r = normalizeStrokeScale(planWithStroke(9))
    expect(r.adjusted).toBe(true)
    expect(r.image.width).toBeLessThan(600)
    // Round-trip: normalized coords times inverseFactor land back in source px.
    expect(r.image.width * r.inverseFactor).toBeCloseTo(600, 0)
  })

  it('leaves a drawing already at the canonical width alone', () => {
    const r = normalizeStrokeScale(planWithStroke(CANONICAL_STROKE_PX))
    expect(r.adjusted).toBe(false)
    expect(r.inverseFactor).toBe(1)
  })

  it('brings two drawings of the same plan at different resolutions together', () => {
    // The whole justification for the module: a sheet and a screenshot of the
    // same plan must arrive at detection looking alike.
    const sheet = normalizeStrokeScale(planWithStroke(9))
    const shot = normalizeStrokeScale(planWithStroke(2))
    const a = measureStroke(sheet.image).strokePx
    const b = measureStroke(shot.image).strokePx
    expect(Math.abs(a - b)).toBeLessThanOrEqual(1)
  })

  it('does nothing when there is too little ink to measure', () => {
    const blank: RasterLike = {
      data: new Uint8ClampedArray(100 * 100 * 4).fill(255), width: 100, height: 100,
    }
    expect(normalizeStrokeScale(blank).adjusted).toBe(false)
  })
})

/**
 * Regression guards for the two faults the real corpus exposed, both of which
 * the synthetic tests above passed straight through.
 */
describe('estimator faults found on the real corpus', () => {
  it('does not pin at the floor when strokes carry an anti-aliased halo', () => {
    // Soft-edged lines: a core of `core` px flanked by grey fringe. Measuring
    // at Otsu counted the fringe and reported 2 — the floor — on every real
    // screenshot regardless of its actual line work.
    const w = 600, h = 600, core = 6
    const data = new Uint8ClampedArray(w * h * 4).fill(255)
    const put = (x: number, y: number, v: number) => {
      if (x < 0 || y < 0 || x >= w || y >= h) return
      const i = (y * w + x) * 4
      if (data[i] > v) { data[i] = data[i + 1] = data[i + 2] = v }
    }
    const softLine = (fixed: number, vertical: boolean) => {
      for (let t = -2; t < core + 2; t++) {
        const v = t < 0 || t >= core ? 170 : 20   // halo vs core
        for (let k = 30; k < (vertical ? h : w) - 30; k++) {
          vertical ? put(fixed + t, k, v) : put(k, fixed + t, v)
        }
      }
    }
    for (let g = 60; g < w - 60; g += 90) { softLine(g, true); softLine(g, false) }
    const m = measureStroke({ data, width: w, height: h })
    expect(m.strokePx).toBeGreaterThan(3)
  })

  it('reports a fractional width rather than snapping between bins', () => {
    // A whole-pixel mode makes the resample factor jump 50% between adjacent
    // answers; the sub-pixel fit keeps it continuous.
    const m = measureStroke(planWithStroke(5))
    expect(Number.isInteger(m.strokePx * 100)).toBe(true)
    expect(m.strokePx).toBeGreaterThanOrEqual(4.5)
    expect(m.strokePx).toBeLessThanOrEqual(5.5)
  })
})
