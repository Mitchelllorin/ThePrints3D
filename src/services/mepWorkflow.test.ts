import { describe, it, expect } from 'vitest'
import { stepStatus, planSource, planRegisters, planRuns, DEVICES_PER_CIRCUIT } from './mepWorkflow'
import type { ParsedWall, PlacedObject } from '../types'

/** A 10 m × 8 m box, 1 px = 10 mm. */
const wall = (x1: number, y1: number, x2: number, y2: number): ParsedWall =>
  ({ x1, y1, x2, y2, thickness: 15, level: 0 } as unknown as ParsedWall)
const box = [wall(0, 0, 1000, 0), wall(1000, 0, 1000, 800), wall(1000, 800, 0, 800), wall(0, 800, 0, 0)]
let n = 0
const obj = (type: string, pxX: number, pxY: number, extra: Partial<PlacedObject> = {}): PlacedObject =>
  ({ id: `o${n++}`, type, pxX, pxY, x: 0, z: 0, rotationY: 0, scaleX: 1, scaleY: 1, scaleZ: 1, label: type, level: 0, ...extra })

describe('stepStatus', () => {
  it('counts what is served, names the missing source, counts the runs', () => {
    const objs = [obj('toilet', 100, 100), obj('water-heater', 0, 400)]
    const s = stepStatus('plumbing', objs, [], 0)
    expect(s.serves).toBe(1)
    expect(s.sourceMissing).toEqual(['drain-stack'])
    expect(s.runs).toBe(0)
  })
  it('only counts this storey', () => {
    expect(stepStatus('electrical', [obj('duplex-outlet', 1, 1, { level: 1 })], [], 0).serves).toBe(0)
  })
})

describe('planSource', () => {
  it('puts the panel on the longest wall, once', () => {
    const p = planSource('electrical', box, [], 0, 0.01)
    expect(p.map((o) => o.type)).toEqual(['panel-box'])
    // Longest wall is the top one (y = 0); the panel sits on its inside face.
    expect(p[0].pxY).toBeGreaterThan(0)
    expect(p[0].pxY).toBeLessThan(20)
    expect(planSource('electrical', box, [obj('panel-box', 500, 8)], 0, 0.01)).toEqual([])
  })
  it('puts the stack on the wet wall and the heater a step along it', () => {
    const fixtures = [obj('toilet', 950, 300), obj('bathroom-sink', 950, 450)]
    const p = planSource('plumbing', box, fixtures, 0, 0.01)
    expect(p.map((o) => o.type)).toEqual(['drain-stack', 'water-heater'])
    // The right-hand wall (x = 1000) is the wet one.
    for (const o of p) expect(o.pxX).toBeGreaterThan(980)
    expect(Math.abs(p[0].pxY - p[1].pxY)).toBeGreaterThan(100)
  })
})

describe('planRegisters', () => {
  it('puts a supply under each window and one return', () => {
    const p = planRegisters(box, [obj('window', 500, 0), obj('window', 1000, 400)], 0)
    expect(p.filter((o) => o.type === 'supply-register')).toHaveLength(2)
    expect(p.filter((o) => o.type === 'return-grille')).toHaveLength(1)
  })
})

describe('planRuns', () => {
  it('needs a source before it runs anything', () => {
    expect(planRuns('electrical', box, [obj('duplex-outlet', 100, 8)], 0)).toEqual([])
  })

  it('wires circuits from the panel: a home run each, then along the walls', () => {
    const outlets = Array.from({ length: DEVICES_PER_CIRCUIT + 2 }, (_, i) => obj('duplex-outlet', 50 + i * 90, 8))
    const runs = planRuns('electrical', box, [obj('panel-box', 0, 400), ...outlets], 0)
    expect(runs.filter((r) => r.elementType === 'Home Run')).toHaveLength(2)
    expect(runs.every((r) => r.band === 'in-wall')).toBe(true)
    expect(runs.filter((r) => r.elementType === 'Circuit Run').length).toBeGreaterThan(0)
  })

  it('drains every fixture to the stack and runs supply from the heater', () => {
    const objs = [obj('drain-stack', 990, 400), obj('water-heater', 990, 550), obj('toilet', 950, 200), obj('kitchen-sink', 500, 790)]
    const runs = planRuns('plumbing', box, objs, 0)
    const drains = runs.filter((r) => r.elementType === 'Drain Line')
    expect(drains).toHaveLength(2)
    expect(drains.find((d) => d.x1 === 950)?.size).toBe('3"')   // the toilet
    expect(drains.every((d) => d.band === 'under-floor')).toBe(true)
    expect(runs.some((r) => r.elementType === 'Supply Line')).toBe(true)
  })

  it('runs a branch to each supply and the return back to the furnace', () => {
    const objs = [obj('furnace', 500, 400), obj('supply-register', 100, 10), obj('supply-register', 900, 10), obj('return-grille', 500, 790)]
    const runs = planRuns('hvac', box, objs, 0)
    expect(runs.filter((r) => r.elementType === 'Branch / Flex')).toHaveLength(2)
    expect(runs.filter((r) => r.elementType === 'Return Duct')).toHaveLength(1)
  })
})
