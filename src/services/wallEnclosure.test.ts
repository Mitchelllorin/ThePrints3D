import { describe, it, expect } from 'vitest'
import { enclosedRegions } from './wallEnclosure'
import { wallsFromRooms } from './wallsFromRooms'
import type { ParsedWall, ParsedRoom } from '../types'

const w = (x1: number, y1: number, x2: number, y2: number, t = 6): ParsedWall =>
  ({ x1, y1, x2, y2, thickness: t, source: 'auto' } as ParsedWall)
const room = (n: string, x1: number, y1: number, x2: number, y2: number): ParsedRoom =>
  ({ id: n, name: n, cx: 0, cy: 0, x1, y1, x2, y2, areaPx: 0, areaSqM: null } as ParsedRoom)

describe('enclosedRegions', () => {
  it('counts a closed box as one room', () => {
    const box = [w(100,100,500,100), w(500,100,500,400), w(100,400,500,400), w(100,100,100,400)]
    expect(enclosedRegions(box, 600, 500)).toBe(1)
  })

  it('counts a box with a wall missing as none', () => {
    // The exact failure the ADU screenshot hit: plenty of walls, nothing closed.
    const open = [w(100,100,500,100), w(500,100,500,400), w(100,100,100,400)]
    expect(enclosedRegions(open, 600, 500)).toBe(0)
  })

  it('counts a divided box as two rooms', () => {
    const two = [w(100,100,500,100), w(500,100,500,400), w(100,400,500,400),
                 w(100,100,100,400), w(300,100,300,400)]
    expect(enclosedRegions(two, 600, 500)).toBe(2)
  })

  it('ignores the paper around the plan', () => {
    expect(enclosedRegions([w(100,100,500,100)], 600, 500)).toBe(0)
  })

  it('scores the same plan the same at any resolution', () => {
    // Every absolute-pixel measure in this pipeline has failed this test.
    const small = [w(50,50,250,50), w(250,50,250,200), w(50,200,250,200), w(50,50,50,200)]
    const large = small.map((s) => w(s.x1*3, s.y1*3, s.x2*3, s.y2*3, 18))
    expect(enclosedRegions(large, 900, 750)).toBe(enclosedRegions(small, 300, 250))
  })

  it('agrees that room-derived walls enclose their rooms', () => {
    // The cascade's whole premise: when detection encloses nothing, the rooms
    // the app already found still describe a closed plan.
    const rooms = [room('KITCHEN', 40, 40, 240, 200), room('DINING', 240, 40, 440, 200)]
    const derived = wallsFromRooms(rooms, 6)
    expect(enclosedRegions(derived.walls, 500, 260)).toBe(2)
  })

  it('returns zero for no walls', () => {
    expect(enclosedRegions([], 600, 500)).toBe(0)
  })
})
