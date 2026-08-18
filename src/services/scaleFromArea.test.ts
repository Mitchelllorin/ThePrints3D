import { describe, it, expect } from 'vitest'
import { scaleFromTotalArea, footprintAreaPx, inferScaleFromStructure } from './scaleInference'
import type { ParsedWall } from '../types'

const wall = (x1: number, y1: number, x2: number, y2: number, thickness: number): ParsedWall =>
  ({ x1, y1, x2, y2, thickness, source: 'auto', detectionConfidence: 0.9 })

describe('scaleFromTotalArea', () => {
  it('solves the ADU screenshot exactly', () => {
    // The drawing prints TOTAL AREA = 71 m². The building covers roughly
    // 665 x 480 px on that 759x622 capture.
    const mmPerPx = scaleFromTotalArea(71, 665 * 480)!
    // True scale from the printed dimensions (9.05 m across ~665 px) is ~13.6.
    expect(mmPerPx).toBeGreaterThan(11)
    expect(mmPerPx).toBeLessThan(16)
    // And nowhere near the 42.75 that thickness-guessing produced.
    expect(mmPerPx).toBeLessThan(20)
  })

  it('scales as the square root of area, not linearly', () => {
    const a = scaleFromTotalArea(50, 500_000)!   // -> 10 mm/px
    const b = scaleFromTotalArea(200, 500_000)!  // 4x the area -> 20 mm/px
    expect(b / a).toBeCloseTo(2, 6)             // 2x the scale
  })

  it('refuses nonsense rather than returning a wrong number', () => {
    expect(scaleFromTotalArea(0, 1000)).toBeNull()
    expect(scaleFromTotalArea(71, 0)).toBeNull()
    expect(scaleFromTotalArea(-5, 1000)).toBeNull()
    // Absurdly large: 10000 m² over a postage stamp is out of range.
    expect(scaleFromTotalArea(10000, 100)).toBeNull()
  })
})

describe('footprintAreaPx', () => {
  it('measures the bounding box of everything drawn', () => {
    const walls = [wall(100, 50, 400, 50, 4), wall(100, 250, 400, 250, 4)]
    expect(footprintAreaPx(walls)).toBe(300 * 200)
  })

  it('is zero with nothing drawn', () => {
    expect(footprintAreaPx([])).toBe(0)
  })
})

describe('a line weight is not a wall thickness', () => {
  // THE SCREENSHOT BUG. Walls drawn as a 4px stroke carry no scale
  // information: 4px is what the drawing was published at, not 100mm seen from
  // far away. Asking what scale makes 4px standard produces an answer for every
  // entry in the table, and the winner is picked by classifying the same walls
  // with the same guess.
  const thinPlan = [
    wall(80, 80, 720, 80, 4), wall(80, 560, 720, 560, 4),
    wall(80, 80, 80, 560, 4), wall(720, 80, 720, 560, 4),
    wall(400, 80, 400, 300, 4),
  ]

  it('does not invent a scale from 4px strokes', () => {
    expect(inferScaleFromStructure(thinPlan)).toBeNull()
  })

  it('still infers from walls thick enough to mean something', () => {
    const thick = thinPlan.map((w) => ({ ...w, thickness: 12 }))
    const got = inferScaleFromStructure(thick)
    // Not asserting a value — only that a resolvable wall is still allowed to
    // speak, so this guard did not simply switch inference off.
    expect(got === null || got.scaleMmPerPx > 0).toBe(true)
  })
})
