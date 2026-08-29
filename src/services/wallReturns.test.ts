import { describe, it, expect } from 'vitest'
import { combMembers, inkWidth, drawnLikeTheWall, cropToWalls } from './wallReturns'
import type { ParsedWall } from '../types'

const seg = (x1: number, y1: number, x2: number, y2: number, thickness = 1): ParsedWall =>
  ({ x1, y1, x2, y2, thickness, source: 'auto' }) as ParsedWall

/**
 * A white page you can draw black bars on, so the ink tests are about ink
 * rather than about a real print nobody can read in a diff.
 */
function page(width: number, height: number): ImageData {
  const data = new Uint8ClampedArray(width * height * 4).fill(255)
  return { width, height, data } as ImageData
}

function bar(img: ImageData, x0: number, y0: number, w: number, h: number): void {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      const i = (y * img.width + x) * 4
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 0
      img.data[i + 3] = 255
    }
  }
}

/**
 * Measured on the two real screenshots: attachment alone rescued 34 and 49
 * segments, and the overlay showed them landing on a hatched band, a run of
 * kitchen cabinets, the toilet, the bed and the sofa. These are the two tests
 * that took that to one apiece.
 */
describe('combs — hatching and cabinet fronts come in families', () => {
  it('condemns a row of evenly spaced parallel ticks', () => {
    // The studio print's hatched band: twelve vertical ticks, 4px apart.
    const hatch = Array.from({ length: 12 }, (_, i) => seg(506 + i * 4, 706, 506 + i * 4, 717))
    expect(combMembers(hatch).size).toBe(12)
  })

  it('leaves a lone stub alone', () => {
    expect(combMembers([seg(400, 0, 400, 14)]).size).toBe(0)
  })

  it('leaves a PAIR alone — a window has a return on each side', () => {
    expect(combMembers([seg(100, 0, 100, 14), seg(140, 0, 140, 14)]).size).toBe(0)
  })

  it('does not condemn returns that merely share a length', () => {
    // Three stubs of the same size scattered around the plan are three returns,
    // not a comb. What makes a comb is that they repeat in one place.
    const spread = [seg(100, 0, 100, 14), seg(300, 0, 300, 14), seg(500, 0, 500, 14)]
    expect(combMembers(spread).size).toBe(0)
  })
})

describe('ink — a return is drawn with the wall, furniture is drawn thin', () => {
  it('measures the width of the band it sits on', () => {
    const img = page(60, 60)
    bar(img, 20, 10, 12, 40)              // a 12px wide vertical poché band
    expect(inkWidth(img, seg(26, 14, 26, 44))).toBe(12)
  })

  it('finds the stroke even when the coordinate is a pixel off it', () => {
    const img = page(60, 60)
    bar(img, 20, 10, 6, 40)
    expect(inkWidth(img, seg(19, 14, 19, 44))).toBeGreaterThanOrEqual(6)
  })

  it('rejects a thin line hanging off a thick wall', () => {
    // The dining table against the kitchen wall, in miniature.
    const img = page(80, 80)
    bar(img, 0, 20, 80, 12)               // the wall: 12px of ink
    bar(img, 40, 32, 1, 20)               // the furniture: one pixel
    const wall = seg(0, 26, 80, 26, 12)
    expect(drawnLikeTheWall(img, seg(40, 34, 40, 50), wall)).toBe(false)
  })

  it('keeps a stub drawn to the wall’s own weight', () => {
    const img = page(80, 80)
    bar(img, 0, 20, 80, 12)
    bar(img, 40, 32, 12, 20)              // a real return: the wall, turning
    const wall = seg(0, 26, 80, 26, 12)
    expect(drawnLikeTheWall(img, seg(46, 34, 46, 50), wall)).toBe(true)
  })

  it('does not invent a reason to drop one when there is no wall to compare to', () => {
    const img = page(40, 40)
    expect(drawnLikeTheWall(img, seg(10, 10, 10, 24), seg(0, 0, 40, 0, 1))).toBe(true)
  })
})

describe('cropping — only look where a return could be', () => {
  it('crops to the walls and reports the offset to add back', () => {
    const img = page(400, 400)
    const c = cropToWalls(img, [seg(100, 100, 300, 100), seg(300, 100, 300, 200)])
    expect(c).not.toBeNull()
    expect([c!.dx, c!.dy]).toEqual([76, 76])
    expect([c!.image.width, c!.image.height]).toEqual([248, 148])
  })

  it('does not bother when the walls already fill the sheet', () => {
    const img = page(200, 200)
    expect(cropToWalls(img, [seg(2, 2, 198, 2), seg(2, 2, 2, 198)])).toBeNull()
  })

  it('carries the pixels across, not a blank crop', () => {
    const img = page(400, 400)
    bar(img, 150, 150, 20, 20)
    const c = cropToWalls(img, [seg(100, 100, 300, 100), seg(300, 100, 300, 300)])!
    const i = ((160 - c.dy) * c.image.width + (160 - c.dx)) * 4
    expect(c.image.data[i]).toBe(0)
  })
})
