import { describe, it, expect } from 'vitest'
import { isWetRoom, isSplashOnly, boardForRoom, suggestWetWalls } from './wetWalls'
import type { ParsedRoom, ParsedWall } from '../types'

const room = (name: string, x1: number, y1: number, x2: number, y2: number): ParsedRoom => ({
  id: name, name, cx: (x1 + x2) / 2, cy: (y1 + y2) / 2, x1, y1, x2, y2,
  areaPx: (x2 - x1) * (y2 - y1), areaSqM: null,
})
const wall = (x1: number, y1: number, x2: number, y2: number, extra: Partial<ParsedWall> = {}): ParsedWall =>
  ({ x1, y1, x2, y2, thickness: 8, source: 'user', ...extra })

// A bath at 100,100 → 300,400, with a bedroom beside it.
const BATH = room('BATH', 100, 100, 300, 400)
const BED = room('BED 1', 300, 100, 700, 400)

describe('reading water off the plan', () => {
  it('knows a wet room by its name, however the plan abbreviates it', () => {
    for (const n of ['BATH', 'Bathroom', 'ENSUITE', 'en-suite', 'Shower', 'WC', 'PWDR', 'Laundry']) {
      expect(isWetRoom(n)).toBe(true)
    }
    for (const n of ['BED 1', 'KITCHEN', 'LIVING', 'HALL', 'GARAGE', undefined]) {
      expect(isWetRoom(n)).toBe(false)
    }
  })

  it('separates bathed-in from merely splashed', () => {
    expect(isSplashOnly('PWDR')).toBe(true)
    expect(isSplashOnly('Laundry')).toBe(true)
    expect(isSplashOnly('BATH')).toBe(false)
    expect(isSplashOnly('ENSUITE')).toBe(false)
  })

  it('asks for tile backer where tile goes, mould-resistant where it does not', () => {
    // A powder room gets splashed. It does not get a shower, so calling for a
    // full tile backer there would be overspecifying it.
    expect(boardForRoom('BATH')).toBe('glassmat-tile')
    expect(boardForRoom('ENSUITE')).toBe('glassmat-tile')
    expect(boardForRoom('PWDR')).toBe('mold-resistant')
    expect(boardForRoom('BED 1')).toBeNull()
  })
})

describe('which walls bound the wet room', () => {
  it('finds the walls around a bath and leaves the rest alone', () => {
    const walls = [
      wall(100, 100, 300, 100),   // 0 bath top
      wall(300, 100, 300, 400),   // 1 bath/bed party wall
      wall(100, 400, 300, 400),   // 2 bath bottom
      wall(100, 100, 100, 400),   // 3 bath left
      wall(300, 100, 700, 100),   // 4 bedroom top — dry
    ]
    const got = suggestWetWalls(walls, [BATH, BED])
    expect(got.map((s) => s.index)).toEqual([0, 1, 2, 3])
    expect(got.every((s) => s.boardKind === 'glassmat-tile')).toBe(true)
    expect(got.every((s) => s.roomName === 'BATH')).toBe(true)
  })

  it('ignores a wall that merely passes through the room box', () => {
    // Cutting across the middle is not bounding it.
    const through = [wall(100, 250, 300, 250)]
    expect(suggestWetWalls(through, [BATH])).toEqual([])
  })

  it('says nothing when the wall is already boarded for it', () => {
    const done = [wall(100, 100, 300, 100, { boardKind: 'glassmat-tile' })]
    expect(suggestWetWalls(done, [BATH])).toEqual([])
  })

  it('leaves auto-detected walls alone', () => {
    // An auto line is a guess; changing its board would be a guess on a guess.
    const auto = [wall(100, 100, 300, 100, { source: 'auto' })]
    expect(suggestWetWalls(auto, [BATH])).toEqual([])
  })

  it('lets tile backer outrank mould-resistant on a shared wall', () => {
    // One wall between a powder room and a full bath: backer satisfies both.
    const PWDR = room('PWDR', 300, 100, 500, 400)
    const shared = [wall(300, 100, 300, 400)]
    const got = suggestWetWalls(shared, [PWDR, BATH])
    expect(got).toHaveLength(1)
    expect(got[0].boardKind).toBe('glassmat-tile')
  })

  it('does nothing at all on a plan with no named rooms', () => {
    const unnamed = [{ ...BATH, name: undefined }]
    expect(suggestWetWalls([wall(100, 100, 300, 100)], unnamed)).toEqual([])
  })
})
