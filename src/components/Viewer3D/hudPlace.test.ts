import { describe, it, expect } from 'vitest'
import { placeClear } from './hudPlace'

const area = { x1: 50, y1: 100, x2: 350, y2: 580 }
describe('placing a readout clear of everything', () => {
  it('takes the first place that fits', () => {
    expect(placeClear({ x: 200, y: 300 }, [{ x: 0, y: -40 }, { x: 0, y: 40 }], { w: 60, h: 30 }, area, [], 20)).toEqual({ x: 0, y: -40 })
  })
  it('skips a place over the rail', () => {
    expect(placeClear({ x: 70, y: 300 }, [{ x: -50, y: 0 }, { x: 50, y: 0 }], { w: 60, h: 30 }, area, [], 20)).toEqual({ x: 50, y: 0 })
  })
  it('skips a place on the pointer', () => {
    expect(placeClear({ x: 200, y: 300 }, [{ x: 0, y: -40 }, { x: 0, y: 40 }], { w: 60, h: 30 }, area, [{ x: 200, y: 262 }], 24)).toEqual({ x: 0, y: 40 })
  })
  it('with nowhere that fits, pulls the best one inside the free area', () => {
    const o = placeClear({ x: 52, y: 300 }, [{ x: -60, y: 0 }], { w: 60, h: 30 }, area, [], 20)
    expect(52 + o.x - 30).toBeGreaterThanOrEqual(50)
  })
})
