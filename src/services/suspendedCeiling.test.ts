import { describe, it, expect } from 'vitest'
import { roomAt } from './roomRegions'
import { suspendedCeilingLayout } from './suspendedCeiling'

// 1 px = 10 mm: a 6 m x 4 m room.
const w = (x1: number, y1: number, x2: number, y2: number) => ({ x1, y1, x2, y2, thickness: 14 })
const box = [w(0, 0, 600, 0), w(600, 0, 600, 400), w(600, 400, 0, 400), w(0, 400, 0, 0)]

describe('a hung steel ceiling', () => {
  const r = roomAt(box, { x: 300, y: 200 }, 10)!
  const lay = suspendedCeilingLayout(r, box, 10)
  it('carrying channel at 4 ft runs the long way, wall to wall', () => {
    // 4 m across at 1219 oc from 150 in: 4 lines.
    expect(lay.carrying.length).toBe(4)
    for (const s of lay.carrying) expect(Math.abs(s[1].y - s[0].y)).toBeLessThan(1)
  })
  it('hat track at 16 in runs across it', () => {
    expect(lay.hats.length).toBeGreaterThanOrEqual(14)
    expect(lay.hats.length).toBeLessThanOrEqual(16)
    for (const s of lay.hats) expect(Math.abs(s[1].x - s[0].x)).toBeLessThan(1)
  })
  it('hanger wire about every 4 ft each way', () => {
    // 4 channels x 5 wires along 6 m.
    expect(lay.wires.length).toBeGreaterThanOrEqual(16)
    expect(lay.wires.length).toBeLessThanOrEqual(24)
    expect(lay.counts.clips).toBe(lay.carrying.length * lay.hats.length)
  })
  it('wall angle on all four walls, board about the floor area', () => {
    expect(lay.angle.length).toBe(4)
    expect(lay.counts.boardM2).toBeGreaterThan(22)
    expect(lay.counts.boardM2).toBeLessThan(24)
  })
})
