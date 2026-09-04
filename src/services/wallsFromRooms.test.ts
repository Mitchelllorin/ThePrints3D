import { describe, it, expect } from 'vitest'
import { wallsFromRooms } from './wallsFromRooms'
import type { ParsedRoom } from '../types'

const room = (name: string, x1: number, y1: number, x2: number, y2: number): ParsedRoom =>
  ({ id: name, name, cx: (x1+x2)/2, cy: (y1+y2)/2, x1, y1, x2, y2,
     areaPx: (x2-x1)*(y2-y1), areaSqM: null } as ParsedRoom)

describe('wallsFromRooms', () => {
  it('gives a single room four walls', () => {
    const r = wallsFromRooms([room('KITCHEN', 0, 0, 200, 160)])
    expect(r.walls).toHaveLength(4)
  })

  it('collapses the wall two rooms share instead of stacking two', () => {
    // Kitchen and dining sharing the x=200 line: 8 edges, 7 walls, 1 shared.
    const r = wallsFromRooms([
      room('KITCHEN', 0, 0, 200, 160),
      room('DINING', 200, 0, 400, 160),
    ])
    expect(r.shared).toBe(1)
    expect(r.walls).toHaveLength(7)
  })

  it('marks its output as inferred, not measured', () => {
    // The user has to be able to tell an estimate from a reading.
    const r = wallsFromRooms([room('BATH', 0, 0, 100, 90)])
    expect(r.walls.every((w) => w.roomDerived === true)).toBe(true)
  })

  it('closes: every endpoint meets another wall', () => {
    // The whole point — detected walls on the ADU screenshot enclosed nothing.
    const r = wallsFromRooms([room('LIVING', 0, 0, 300, 240)])
    const pts = r.walls.flatMap((w) => [[w.x1, w.y1], [w.x2, w.y2]] as const)
    for (const [x, y] of pts) {
      const touching = pts.filter((q) => q[0] === x && q[1] === y).length
      expect(touching).toBeGreaterThanOrEqual(2)
    }
  })

  it('snaps rooms that nearly line up onto one shared wall', () => {
    // Flood-filled rooms rarely agree to the pixel; a few px apart is one wall.
    const r = wallsFromRooms([
      room('A', 0, 0, 200, 160),
      room('B', 203, 0, 400, 160),
    ])
    expect(r.shared).toBe(1)
  })

  it('carries the drawing’s own wall thickness', () => {
    const r = wallsFromRooms([room('A', 0, 0, 200, 160)], 11)
    expect(r.walls.every((w) => w.thickness === 11)).toBe(true)
  })

  it('returns nothing when there are no usable rooms', () => {
    expect(wallsFromRooms([]).walls).toHaveLength(0)
  })
})
