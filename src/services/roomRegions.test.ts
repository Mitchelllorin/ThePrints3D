import { describe, it, expect } from 'vitest'
import { roomAt, regionHas, bulkheadLayout, allRooms, clipToRegion } from './roomRegions'

// 1 px = 10 mm. A 4 m × 3 m box split by a partition at x = 250.
const w = (x1: number, y1: number, x2: number, y2: number, thickness = 14) => ({ x1, y1, x2, y2, thickness })
const box = [w(0, 0, 400, 0), w(400, 0, 400, 300), w(400, 300, 0, 300), w(0, 300, 0, 0)]
const split = [...box, w(250, 0, 250, 300, 10)]

describe('finding a room from the walls', () => {
  it('fills the room around the point, inside the wall faces', () => {
    const r = roomAt(split, { x: 100, y: 150 }, 10)!
    expect(r).not.toBeNull()
    expect(r.x1).toBeGreaterThan(3)
    expect(r.x2).toBeLessThan(248)
    expect(r.x2).toBeGreaterThan(240)
    expect(regionHas(r, { x: 100, y: 150 })).toBe(true)
    expect(regionHas(r, { x: 300, y: 150 })).toBe(false)
    // roughly 2.43 m × 2.86 m
    expect(r.areaPx).toBeGreaterThan(230 * 280)
    expect(r.areaPx).toBeLessThan(250 * 300)
  })
  it('the room next door is its own room', () => {
    const r = roomAt(split, { x: 320, y: 150 }, 10)!
    expect(regionHas(r, { x: 100, y: 150 })).toBe(false)
    expect(regionHas(r, { x: 320, y: 50 })).toBe(true)
  })
  it('no room outside the walls, on a wall, or where the walls are open', () => {
    expect(roomAt(split, { x: 500, y: 150 }, 10)).toBeNull()
    expect(roomAt(split, { x: 250, y: 150 }, 10)).toBeNull()
    const open = [w(0, 0, 400, 0), w(400, 0, 400, 300), w(400, 300, 0, 300)]
    expect(roomAt(open, { x: 100, y: 150 }, 10)).toBeNull()
  })
  it('an L-shaped room comes back as more than one rectangle', () => {
    const L = [w(0, 0, 400, 0), w(400, 0, 400, 150), w(400, 150, 200, 150), w(200, 150, 200, 300), w(200, 300, 0, 300), w(0, 300, 0, 0)]
    const r = roomAt(L, { x: 100, y: 100 }, 10)!
    expect(r.rects.length).toBeGreaterThan(1)
    expect(regionHas(r, { x: 300, y: 250 })).toBe(false)
    expect(regionHas(r, { x: 300, y: 75 })).toBe(true)
  })
})

describe('a bulkhead along a wall of the room', () => {
  it('hangs on the room side and stops at the walls', () => {
    const r = roomAt(split, { x: 100, y: 150 }, 10)!
    const lay = bulkheadLayout({ x1: 0, y1: 0, x2: 400, y2: 0 }, r, 14)!
    expect(lay).not.toBeNull()
    expect(lay.out[1]).toBeCloseTo(1) // down into the room
    const xs = [lay.a[0], lay.z[0]].sort((a, b) => a - b)
    expect(xs[0]).toBeLessThan(12)
    expect(xs[1]).toBeLessThan(248) // not through the partition into the next room
    expect(xs[1]).toBeGreaterThan(235)
  })
  it('an outside wall that runs past several rooms: only the stretch in this one', () => {
    const r = roomAt(split, { x: 320, y: 150 }, 10)!
    const lay = bulkheadLayout({ x1: 0, y1: 300, x2: 400, y2: 300 }, r, 14)!
    expect(lay).not.toBeNull()
    expect(lay.out[1]).toBeCloseTo(-1)
    const xs = [lay.a[0], lay.z[0]].sort((a, b) => a - b)
    expect(xs[0]).toBeGreaterThan(252)
    expect(xs[1]).toBeGreaterThan(385)
  })
  it('a wall that is not round the room gives nothing', () => {
    const r = roomAt(split, { x: 100, y: 150 }, 10)!
    expect(bulkheadLayout({ x1: 400, y1: 0, x2: 400, y2: 300 }, r, 14)).toBeNull()
  })
})

describe('every room on the floor', () => {
  it('finds both rooms of the split box, each with a point inside it', () => {
    const rooms = allRooms(split, 10)
    expect(rooms.length).toBe(2)
    for (const r of rooms) expect(regionHas(r, r.seed)).toBe(true)
  })
  it('a channel across the room stops at its walls', () => {
    const r = roomAt(split, { x: 100, y: 150 }, 10)!
    const pieces = clipToRegion(r, { x: -50, y: 150 }, { x: 500, y: 150 })
    expect(pieces.length).toBe(1)
    expect(pieces[0][0].x).toBeGreaterThan(3)
    expect(pieces[0][1].x).toBeLessThan(248)
  })
})
