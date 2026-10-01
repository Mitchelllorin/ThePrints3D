import { describe, expect, it } from 'vitest'
import { boxHitsHull, convexHull, layoutNameplates, rankPlates, MAX_FULL, type Box, type PlateRequest } from './nameplateLayout'

const BOUNDS: Box = { x: 0, y: 0, w: 800, h: 600 }
const CENTRE = { x: 400, y: 300 }

/** A small square part at (x, y), with a plate asked for at `tier`. */
function req(id: string, x: number, y: number, over: Partial<PlateRequest> = {}): PlateRequest {
  return {
    id,
    anchor: { x, y },
    hull: [{ x: x - 20, y }, { x: x + 20, y }, { x: x + 20, y: y + 40 }, { x: x - 20, y: y + 40 }],
    depth: 10,
    order: 0,
    selected: false,
    warning: false,
    tier: 3,
    sizes: { 1: { w: 90, h: 24 }, 2: { w: 150, h: 24 }, 3: { w: 150, h: 104 } },
    tooSmall: false,
    ...over,
  }
}

const overlap = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

describe('nameplate layout', () => {
  it('never puts a plate on its own part', () => {
    const r = req('a', 600, 300)
    const { plates } = layoutNameplates([r], BOUNDS, CENTRE)
    expect(plates).toHaveLength(1)
    expect(boxHitsHull(plates[0].box, r.hull, 0)).toBe(false)
  })

  it('goes outward, away from the model centre', () => {
    const { plates } = layoutNameplates([req('right', 600, 300)], BOUNDS, CENTRE)
    expect(plates[0].box.x).toBeGreaterThan(600)
    const { plates: left } = layoutNameplates([req('left', 200, 300)], BOUNDS, CENTRE)
    expect(left[0].box.x + left[0].box.w).toBeLessThan(200)
  })

  it('flips to another side when the outward side is off the screen', () => {
    const r = req('edge', 760, 300)
    const { plates } = layoutNameplates([r], BOUNDS, CENTRE)
    expect(plates).toHaveLength(1)
    const b = plates[0].box
    expect(b.x + b.w).toBeLessThanOrEqual(800)
    expect(boxHitsHull(b, r.hull, 0)).toBe(false)
  })

  it('no two plates ever overlap, however many parts are bunched together', () => {
    const reqs = Array.from({ length: 12 }, (_, i) => req(`p${i}`, 380 + (i % 4) * 12, 260 + Math.floor(i / 4) * 12, { order: i, tier: 2 }))
    const { plates } = layoutNameplates(reqs, BOUNDS, CENTRE)
    for (let i = 0; i < plates.length; i++)
      for (let j = i + 1; j < plates.length; j++)
        expect(overlap(plates[i].box, plates[j].box), `${plates[i].id} / ${plates[j].id}`).toBe(false)
  })

  it('the selected part wins and keeps full; the other drops a tier', () => {
    const a = req('a', 600, 300, { order: 0 })
    const b = req('b', 604, 300, { order: 1, selected: true })
    const { plates } = layoutNameplates([a, b], BOUNDS, CENTRE)
    expect(plates.find((p) => p.id === 'b')?.tier).toBe(3)
    const other = plates.find((p) => p.id === 'a')
    expect(other && other.tier < 3).toBe(true)
  })

  it('a pushed plate gets a leader back to its part', () => {
    const reqs = Array.from({ length: 6 }, (_, i) => req(`p${i}`, 600, 300, { order: i, tier: 1 }))
    const { plates } = layoutNameplates(reqs, BOUNDS, CENTRE)
    expect(plates.some((p) => p.leader)).toBe(true)
  })

  it(`caps full plates at ${MAX_FULL}`, () => {
    const reqs = Array.from({ length: 6 }, (_, i) => req(`p${i}`, 100 + i * 120, i % 2 ? 100 : 500, { order: i }))
    const { plates } = layoutNameplates(reqs, BOUNDS, CENTRE)
    expect(plates.filter((p) => p.tier === 3).length).toBeLessThanOrEqual(MAX_FULL)
  })

  it('never hides a plate outright — no room means a dot, and touching dots merge', () => {
    const tiny: Box = { x: 0, y: 0, w: 60, h: 60 }
    const reqs = [req('a', 30, 30, { order: 0 }), req('b', 34, 34, { order: 1 }), req('c', 50, 20, { order: 2 })]
    const { plates, dots, clusters } = layoutNameplates(reqs, tiny, { x: 30, y: 30 })
    const shown = plates.length + dots.length + clusters.reduce((n, c) => n + c.ids.length, 0)
    expect(shown).toBe(3)
    expect(clusters.length).toBe(1)
  })

  it('a part too small on screen is a dot', () => {
    const { plates, dots } = layoutNameplates([req('a', 600, 300, { tooSmall: true })], BOUNDS, CENTRE)
    expect(plates).toHaveLength(0)
    expect(dots).toEqual([{ id: 'a', x: 600, y: 300 }])
  })

  it('tier 0 asks for nothing', () => {
    const out = layoutNameplates([req('a', 600, 300, { tier: 0 })], BOUNDS, CENTRE)
    expect(out.plates.length + out.dots.length + out.clusters.length).toBe(0)
  })

  it('stays on the side it was on last frame while that side still works', () => {
    const r = req('a', 600, 300)
    const first = layoutNameplates([r], BOUNDS, CENTRE).plates[0]
    const forced = layoutNameplates([r], BOUNDS, CENTRE, new Map([['a', 2]])).plates[0]
    expect(first.dir).toBe(0)
    expect(forced.dir).toBe(2)
  })

  it('ranks by selected, then warning, then nearer, then first in', () => {
    const order = rankPlates([
      req('far', 0, 0, { depth: 30, order: 0 }),
      req('near', 0, 0, { depth: 5, order: 1 }),
      req('warn', 0, 0, { warning: true, order: 2 }),
      req('sel', 0, 0, { selected: true, order: 3 }),
      req('near2', 0, 0, { depth: 5.1, order: 4 }),
    ]).map((r) => r.id)
    expect(order).toEqual(['sel', 'warn', 'near', 'near2', 'far'])
  })

  it('convex hull of a box drops the inside points', () => {
    const h = convexHull([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 5, y: 5 }])
    expect(h).toHaveLength(4)
  })
})
