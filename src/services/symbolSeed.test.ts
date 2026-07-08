import { describe, it, expect } from 'vitest'
import { seedBoxAround, dedupeMatches, newPlacements } from './symbolSeed'
import type { SymbolMatch } from './symbolMatcher'

const m = (x: number, y: number, isSeed = false): SymbolMatch =>
  ({ x, y, score: 0.9, rotation: 0, flipped: false, isSeed })

describe('seedBoxAround', () => {
  it('centres a box on the point', () => {
    expect(seedBoxAround(100, 100, 20, 500, 500)).toEqual({ x: 90, y: 90, w: 20, h: 20 })
  })
  it('clamps to the image bounds', () => {
    expect(seedBoxAround(2, 2, 20, 500, 500)).toEqual({ x: 0, y: 0, w: 20, h: 20 })
    const br = seedBoxAround(499, 499, 20, 500, 500)
    expect(br.x).toBe(480)
    expect(br.y).toBe(480)
  })
})

describe('dedupeMatches / newPlacements', () => {
  it('removes matches near an existing placement', () => {
    const matches = [m(10, 10), m(100, 100), m(200, 200)]
    const existing = [{ x: 102, y: 98 }] // ~near (100,100)
    expect(dedupeMatches(matches, existing, 10).map((r) => r.x)).toEqual([10, 200])
  })
  it('newPlacements drops the seed and anything already placed', () => {
    const matches = [m(10, 10, true), m(100, 100), m(200, 200)]
    const existing = [{ x: 10, y: 10 }, { x: 200, y: 201 }]
    const out = newPlacements(matches, existing, 10)
    expect(out.map((r) => r.x)).toEqual([100]) // seed removed, (200,200) deduped
  })
  it('keeps everything when nothing is near', () => {
    const matches = [m(10, 10), m(100, 100)]
    expect(dedupeMatches(matches, [{ x: 400, y: 400 }], 10).length).toBe(2)
  })
})
