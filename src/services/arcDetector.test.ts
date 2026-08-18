import { describe, it, expect } from 'vitest'
import { detectArcs, scaleFromDoorArc, type DetectedArc } from './arcDetector'
import type { RasterLike } from './rasterNormalize'

/** A white sheet you can draw dark strokes on. */
function sheet(width: number, height: number): RasterLike & { set: (x: number, y: number) => void } {
  const data = new Uint8ClampedArray(width * height * 4).fill(255)
  for (let i = 3; i < data.length; i += 4) data[i] = 255
  const img = {
    data, width, height,
    set(x: number, y: number) {
      const xi = Math.round(x), yi = Math.round(y)
      if (xi < 0 || yi < 0 || xi >= width || yi >= height) return
      const o = (yi * width + xi) * 4
      data[o] = data[o + 1] = data[o + 2] = 10
    },
  }
  return img
}

/** Draw an arc of `sweepDeg` starting at `startDeg`, with a 2px stroke. */
function drawArc(
  img: ReturnType<typeof sheet>, cx: number, cy: number, r: number,
  startDeg: number, sweepDeg: number,
) {
  const steps = Math.round((sweepDeg / 360) * 2 * Math.PI * r * 3) + 8
  for (let s = 0; s <= steps; s++) {
    const a = ((startDeg + (s / steps) * sweepDeg) * Math.PI) / 180
    for (const rr of [r - 0.5, r, r + 0.5]) {
      img.set(cx + rr * Math.cos(a), cy + rr * Math.sin(a))
    }
  }
}

function drawLine(img: ReturnType<typeof sheet>, x1: number, y1: number, x2: number, y2: number) {
  const n = Math.round(Math.hypot(x2 - x1, y2 - y1)) * 2 + 1
  for (let i = 0; i <= n; i++) {
    const t = i / n
    for (const d of [-0.5, 0, 0.5]) {
      img.set(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t + d)
    }
  }
}

const near = (arcs: DetectedArc[], cx: number, cy: number, tol = 6) =>
  arcs.find((a) => Math.hypot(a.cx - cx, a.cy - cy) <= tol)

describe('detectArcs', () => {
  it('finds a quarter-circle door swing', () => {
    const img = sheet(160, 160)
    drawArc(img, 40, 40, 30, 0, 90)          // the swing
    drawLine(img, 40, 40, 70, 40)            // the leaf, along +x
    const arcs = detectArcs(img, { minRadiusPx: 12, maxRadiusPx: 50 })

    const hit = near(arcs, 40, 40)
    expect(hit).toBeTruthy()
    expect(hit!.r).toBeGreaterThan(26)
    expect(hit!.r).toBeLessThan(34)
    // A quarter swing, give or take the stroke ends.
    expect(hit!.sweepDeg).toBeGreaterThan(60)
    expect(hit!.sweepDeg).toBeLessThan(140)
  })

  it('ignores a plain rectangle - a plan of nothing but walls has no arcs', () => {
    const img = sheet(160, 160)
    drawLine(img, 20, 20, 140, 20)
    drawLine(img, 20, 140, 140, 140)
    drawLine(img, 20, 20, 20, 140)
    drawLine(img, 140, 20, 140, 140)
    expect(detectArcs(img, { minRadiusPx: 12, maxRadiusPx: 50 })).toHaveLength(0)
  })

  it('separates two swings rather than merging them', () => {
    const img = sheet(240, 160)
    drawArc(img, 40, 40, 26, 0, 90)
    drawArc(img, 180, 40, 26, 90, 90)
    const arcs = detectArcs(img, { minRadiusPx: 12, maxRadiusPx: 40 })
    expect(near(arcs, 40, 40)).toBeTruthy()
    expect(near(arcs, 180, 40)).toBeTruthy()
  })

  it('reads the radius, which is what makes it a ruler', () => {
    const img = sheet(200, 200)
    drawArc(img, 60, 60, 44, 0, 90)
    const hit = near(detectArcs(img, { minRadiusPx: 20, maxRadiusPx: 70 }), 60, 60)
    expect(hit).toBeTruthy()
    expect(Math.abs(hit!.r - 44)).toBeLessThanOrEqual(4)
  })

  it('works on a washed-out screenshot, where the ink is not black', () => {
    // Same reasoning as rasterNormalize: the ink level is measured, not assumed,
    // so a low-contrast capture still resolves.
    const img = sheet(160, 160)
    drawArc(img, 40, 40, 30, 0, 90)
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.round(img.data[i] * 0.35 + 110)
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v
    }
    expect(near(detectArcs(img, { minRadiusPx: 12, maxRadiusPx: 50 }), 40, 40)).toBeTruthy()
  })

  it('rejects a full circle - a swing is a quarter, a table is not', () => {
    const img = sheet(160, 160)
    drawArc(img, 80, 80, 30, 0, 360)
    const arcs = detectArcs(img, { minRadiusPx: 12, maxRadiusPx: 50, maxSweepDeg: 200 })
    expect(near(arcs, 80, 80)).toBeFalsy()
  })
})

describe('scaleFromDoorArc', () => {
  it('turns a radius in pixels into mm per pixel', () => {
    // A 3'0" door drawn with a 60px swing on a print at 15.2 mm/px.
    expect(scaleFromDoorArc(60, 914)!).toBeCloseTo(15.23, 1)
  })

  it('lands near the ADU screenshot truth for a plausible swing', () => {
    // True scale on that capture is ~13.6 mm/px, so a 2'8" door reads ~60px.
    const mmPerPx = scaleFromDoorArc(60, 813)!
    expect(mmPerPx).toBeGreaterThan(11)
    expect(mmPerPx).toBeLessThan(16)
  })

  it('refuses nonsense', () => {
    expect(scaleFromDoorArc(0)).toBeNull()
    expect(scaleFromDoorArc(-3)).toBeNull()
  })
})
