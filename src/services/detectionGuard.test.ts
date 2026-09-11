import { describe, it, expect } from 'vitest'
import { keepUnlessWorse, replaceIfCloser } from './detectionGuard'
import type { ParsedWall } from '../types'

const W = 400
const H = 400

function wall(x1: number, y1: number, x2: number, y2: number): ParsedWall {
  return { id: `${x1},${y1}-${x2},${y2}`, x1, y1, x2, y2, thickness: 6 } as ParsedWall
}

/** A closed rectangle: one room. */
function closedRoom(): ParsedWall[] {
  return [
    wall(50, 50, 350, 50),
    wall(350, 50, 350, 350),
    wall(350, 350, 50, 350),
    wall(50, 350, 50, 50),
  ]
}

/** The same rectangle with one side pulled well short — nothing is enclosed. */
function brokenRoom(): ParsedWall[] {
  const r = closedRoom()
  r[2] = wall(350, 350, 220, 350)
  return r
}

describe('keepUnlessWorse', () => {
  it('keeps a step that closes a room', () => {
    const v = keepUnlessWorse(brokenRoom(), closedRoom(), W, H)
    expect(v.kept).toBe(true)
    expect(v.enclosedBefore).toBe(0)
    expect(v.enclosedAfter).toBe(1)
    expect(v.walls).toHaveLength(4)
  })

  it('rolls back a step that opens a room that was closed', () => {
    const before = closedRoom()
    const v = keepUnlessWorse(before, brokenRoom(), W, H)
    expect(v.kept).toBe(false)
    // The ORIGINAL walls are what carries forward, not the damaged ones.
    expect(v.walls).toBe(before)
    expect(v.reason).toContain('rolled back')
  })

  /**
   * The regression that shipped silently: a result that got much worse but was
   * not empty, so every "did we get nothing?" guard waved it through.
   */
  it('catches a large loss that is not a total failure', () => {
    const before = closedRoom()
    const after = [...brokenRoom(), wall(80, 80, 120, 80), wall(80, 100, 120, 100)]
    const v = keepUnlessWorse(before, after, W, H)
    expect(v.kept).toBe(false)
    expect(after.length).toBeGreaterThan(0) // not empty — the old test passes
  })

  it('keeps a step that leaves enclosure unchanged', () => {
    // Endpoints tightened onto their corners; the shape, and the score, is the same.
    const after = closedRoom().map((w) => ({ ...w, thickness: 7 }))
    const v = keepUnlessWorse(closedRoom(), after, W, H)
    expect(v.kept).toBe(true)
    expect(v.reason).toContain('unchanged')
  })

  describe('when the room extractor has its own count', () => {
    /** Two rooms: the rectangle with a divider down the middle. */
    const twoRooms = () => [...closedRoom(), wall(200, 50, 200, 350)]

    it('prefers the result nearer the extractor’s count', () => {
      const v = keepUnlessWorse(closedRoom(), twoRooms(), W, H, 2)
      expect(v.kept).toBe(true)
      expect(v.enclosedAfter).toBe(2)
    })

    /**
     * More enclosure is NOT automatically better. With the drawing itself
     * saying one room, a step that splits it in two has over-segmented, and
     * without the target this guard would have rewarded it.
     */
    it('rejects over-segmentation past the extractor’s count', () => {
      const v = keepUnlessWorse(closedRoom(), twoRooms(), W, H, 1)
      expect(v.kept).toBe(false)
      expect(v.enclosedAfter).toBe(2)
    })
  })

  it('is safe on empty input', () => {
    const v = keepUnlessWorse([], [], W, H)
    expect(v.kept).toBe(true)
    expect(v.enclosedBefore).toBe(0)
  })
})

/**
 * The guard for swapping in the junction skeleton's walls wholesale. Unlike a
 * step that only moves endpoints, a replacement discards everything the current
 * reading found, so a tie is not enough.
 */
describe('replaceIfCloser', () => {
  it('swaps in a set that closes a room the current one does not', () => {
    const v = replaceIfCloser(brokenRoom(), closedRoom(), W, H)
    expect(v.kept).toBe(true)
    expect(v.enclosedAfter).toBe(1)
    expect(v.reason).toContain('replaced')
  })

  it('keeps the current walls on a tie — a replacement has to earn it', () => {
    const current = closedRoom()
    const v = replaceIfCloser(current, closedRoom().map((w) => ({ ...w, thickness: 7 })), W, H)
    expect(v.kept).toBe(false)
    expect(v.walls).toBe(current)
  })

  it('keeps the current walls when the candidate is worse', () => {
    const current = closedRoom()
    const v = replaceIfCloser(current, brokenRoom(), W, H)
    expect(v.kept).toBe(false)
    expect(v.walls).toBe(current)
    expect(v.reason).toContain('kept current')
  })

  it('judges against the extractor’s count when there is one', () => {
    const twoRooms = [...closedRoom(), wall(200, 50, 200, 350)]
    expect(replaceIfCloser(closedRoom(), twoRooms, W, H, 2).kept).toBe(true)
    // The drawing says one room; splitting it is over-segmentation, not progress.
    expect(replaceIfCloser(closedRoom(), twoRooms, W, H, 1).kept).toBe(false)
  })

  it('never swaps in an empty set', () => {
    const current = brokenRoom()
    const v = replaceIfCloser(current, [], W, H, 1)
    expect(v.kept).toBe(false)
    expect(v.walls).toBe(current)
  })
})
