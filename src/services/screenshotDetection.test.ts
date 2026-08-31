import { describe, it, expect } from 'vitest'
import { detectWalls } from './wallDetector'

/**
 * A phone SCREENSHOT of a plan, not a rasterised sheet.
 *
 * The whole ladder is tuned in absolute pixels against a ~10 MP raster of a
 * 36" sheet. A screenshot is an order of magnitude smaller, so this pins down
 * that the photo-path thresholds still find walls at that size — the case the
 * user hit where the app returned nothing at all.
 */
function screenshotOfAPlan(w = 900, h = 1100): ImageData {
  const data = new Uint8ClampedArray(w * h * 4).fill(255)
  const ink = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return
    const i = (y * w + x) * 4
    data[i] = data[i + 1] = data[i + 2] = 20
  }
  // Walls drawn as the paired parallel lines a real plan uses, ~6px thick.
  const rect = (x0: number, y0: number, x1: number, y1: number, t = 6) => {
    for (let k = 0; k < t; k++) {
      for (let x = x0; x <= x1; x++) { ink(x, y0 + k); ink(x, y1 - k) }
      for (let y = y0; y <= y1; y++) { ink(x0 + k, y); ink(x1 - k, y) }
    }
  }
  rect(90, 120, 810, 900)          // exterior
  rect(90, 120, 450, 520)          // an interior room
  return { data, width: w, height: h, colorSpace: 'srgb' } as ImageData
}

describe('detection at screenshot scale', () => {
  it('finds walls with the photo-path thresholds', () => {
    const img = screenshotOfAPlan()
    // The strict photo pass from drawingProcessor's ladder.
    const strict = detectWalls(img, {
      edgeThreshold: 30,
      minWallLengthPx: 55,
      minWallThicknessPx: 3,
      maxWallThicknessPx: 60,
      requirePairedEdges: true,
      mergeGapPx: 4,
    })
    expect(strict.walls.length).toBeGreaterThan(0)
  })

  it('still finds walls on the most lenient pass', () => {
    const lenient = detectWalls(screenshotOfAPlan(), {
      edgeThreshold: 16,
      minWallLengthPx: 28,
      minWallThicknessPx: 2,
      maxWallThicknessPx: 120,
      requirePairedEdges: false,
      mergeGapPx: 8,
    })
    expect(lenient.walls.length).toBeGreaterThan(0)
  })
})
