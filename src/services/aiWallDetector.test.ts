import { describe, it, expect } from 'vitest'
import { aiResultIsUsable, vectorizeSize, scaleGeometryToRaster, junctionWallsToRaster } from './aiWallDetector'

/**
 * The rule that decides whether the model's answer is preferred over the
 * classical ladder. It exists because "the model ran" used to be the bar: an
 * empty-but-successful result cancelled the fallback and the user got no walls
 * at all from a phone screenshot.
 */
describe('aiResultIsUsable', () => {
  it('rejects an empty result so the classical ladder still runs', () => {
    expect(aiResultIsUsable({ walls: [] })).toBe(false)
  })

  it('accepts a result that actually found something', () => {
    expect(aiResultIsUsable({ walls: [{}] as never })).toBe(true)
  })
})

/**
 * The size the 256x256 mask gets vectorised at.
 *
 * `detectWalls` asks for a 36px minimum wall length in absolute pixels, so
 * stretching the mask to the full raster first made that threshold mean
 * whatever the rasteriser felt like: 12.6 mask pixels on a screenshot and 2.4
 * on a permit sheet. lacounty-adu-A came back with 612 walls for a 3-bed
 * bungalow and a studio screenshot with 22, and the only thing that differed
 * was page size.
 */
describe('vectorizeSize', () => {
  it('leaves a print that is already small enough completely alone', () => {
    // screenshot-studio-1bed, which detects cleanly today.
    expect(vectorizeSize(732, 727)).toEqual({ width: 732, height: 727, scale: 1 })
  })

  it('caps a big permit sheet at the long edge', () => {
    // lacounty-adu-A: 3888x2592 is a 15.2x upscale of the mask.
    const out = vectorizeSize(3888, 2592)
    expect(Math.max(out.width, out.height)).toBe(1024)
    // Same shape as the page, or walls land somewhere the plan is not.
    expect(out.width / out.height).toBeCloseTo(3888 / 2592, 2)
  })

  it('caps on the long edge of a portrait sheet too', () => {
    const out = vectorizeSize(918, 1188)
    expect(out.height).toBe(1024)
    expect(out.width).toBe(Math.round(918 * (1024 / 1188)))
  })

  it('never returns a zero dimension for a sliver of a page', () => {
    const out = vectorizeSize(20000, 3)
    expect(out.width).toBe(1024)
    expect(out.height).toBeGreaterThanOrEqual(1)
  })
})

describe('scaleGeometryToRaster', () => {
  const line = (x1: number, y1: number, x2: number, y2: number, thickness: number) =>
    ({ x1, y1, x2, y2, thickness, keep: 'me' })

  it('puts working-size geometry back on the raster', () => {
    const out = scaleGeometryToRaster(
      [line(0, 0, 512, 341, 4)],
      { width: 1024, height: 683 },
      { width: 3888, height: 2592 },
    )
    expect(out[0].x2).toBeCloseTo(512 * (3888 / 1024), 3)
    expect(out[0].y2).toBeCloseTo(341 * (2592 / 683), 3)
    // Thickness scales too, or every wall on a big sheet reads as hairline.
    expect(out[0].thickness).toBeGreaterThan(4)
  })

  it('keeps the fields it does not own', () => {
    const out = scaleGeometryToRaster(
      [line(1, 1, 2, 2, 1)],
      { width: 10, height: 10 },
      { width: 20, height: 20 },
    )
    expect(out[0].keep).toBe('me')
  })

  it('is a no-op when the print was never scaled down', () => {
    const items = [line(1, 2, 3, 4, 5)]
    expect(scaleGeometryToRaster(items, { width: 800, height: 600 }, { width: 800, height: 600 }))
      .toBe(items)
  })
})

/**
 * Walls the junction skeleton built at 256x256, put back on the page. The model
 * reads every page stretched to a square, so the axes come back separately.
 */
describe('junctionWallsToRaster', () => {
  const MASK = { width: 256, height: 256 }

  it('stretches each axis back to the page it came from, from pixel centres', () => {
    const [w] = junctionWallsToRaster([{ x1: 0, y1: 0, x2: 255, y2: 127 }], MASK, { width: 2560, height: 1280 }, 12)
    expect(w.x1).toBeCloseTo(0.5 * 10, 6)
    expect(w.y1).toBeCloseTo(0.5 * 5, 6)
    expect(w.x2).toBeCloseTo(255.5 * 10, 6)
    expect(w.y2).toBeCloseTo(127.5 * 5, 6)
  })

  it('lends every wall the raster thickness it is given', () => {
    const walls = junctionWallsToRaster(
      [{ x1: 10, y1: 10, x2: 50, y2: 10 }, { x1: 50, y1: 10, x2: 50, y2: 90 }],
      MASK,
      { width: 1024, height: 1024 },
      14,
    )
    expect(walls.map((w) => w.thickness)).toEqual([14, 14])
    expect(walls.every((w) => w.source === 'auto')).toBe(true)
  })

  it('makes no walls from an empty skeleton', () => {
    expect(junctionWallsToRaster([], MASK, { width: 800, height: 600 }, 6)).toEqual([])
  })
})
