import { describe, it, expect } from 'vitest'
import { modelWalls, tracedWallCount, autoWallIsReal, isAttachedReturn, scaleIsKnown, MIN_AUTO_WALL_PX } from './modelWalls'
import type { ParsedWall, Drawing } from '../types'

const wall = (x1: number, y1: number, x2: number, y2: number, source: 'user' | 'auto'): ParsedWall =>
  ({ x1, y1, x2, y2, thickness: 8, confidence: 1, source } as ParsedWall)

/** A drawing whose scale was READ — the state in which detection may be built. */
const drawing = (walls: ParsedWall[], scaleMmPerPx: number | null = 10): Drawing =>
  ({ id: 'd1', parsedWalls: walls, scaleMmPerPx, scaleConfidence: 'parsed' } as unknown as Drawing)

/** A drawing whose scale was GUESSED — an upload nobody has calibrated yet. */
const guessed = (walls: ParsedWall[], scaleMmPerPx: number | null = 44.8): Drawing =>
  ({ id: 'd2', parsedWalls: walls, scaleMmPerPx, scaleConfidence: 'inferred' } as unknown as Drawing)

describe('nothing is built from a guessed scale', () => {
  it('holds detected walls back until the scale is known', () => {
    // The failure this exists for: upload a 32 ft bungalow, have the scale
    // inferred at 44.8 mm/px against a true 10, and forty nine detected walls
    // stand up at four and a half times life size before the app admits it
    // could not read the scale.
    const walls = [wall(0, 0, 400, 0, 'auto'), wall(0, 0, 0, 400, 'auto')]
    expect(modelWalls([guessed(walls)])).toEqual([])
    expect(modelWalls([drawing(walls)]).length).toBe(2)
  })

  it('still builds what the user traced, guess or no guess', () => {
    // A traced wall is the user's own line at a size they chose; the scale being
    // unread is not a reason to refuse to show it.
    const out = modelWalls([guessed([wall(9, 9, 409, 9, 'user'), wall(0, 0, 400, 0, 'auto')])])
    expect(out.length).toBe(1)
    expect(out[0].wall.source).toBe('user')
  })

  it('counts only a READ scale as known — a guess is not one', () => {
    expect(scaleIsKnown({ scaleConfidence: 'parsed' })).toBe(true)
    expect(scaleIsKnown({ scaleConfidence: 'inferred' })).toBe(false)
    expect(scaleIsKnown({ scaleConfidence: 'fallback' })).toBe(false)
    expect(scaleIsKnown({ scaleConfidence: null })).toBe(false)
  })
})

describe('the walls the model is built from', () => {
  it('builds detected walls, not just traced ones', () => {
    // The regression: "Find the rest" reported walls and the model never changed.
    const d = drawing([wall(0, 0, 400, 0, 'auto'), wall(0, 0, 0, 400, 'auto')])
    expect(modelWalls([d]).length).toBe(2)
  })

  it('puts traced walls FIRST so existing selection indices still point at them', () => {
    const d = drawing([
      wall(0, 0, 400, 0, 'auto'),      // detected, listed first in the drawing
      wall(9, 9, 409, 9, 'user'),      // traced
      wall(0, 0, 0, 400, 'auto'),
    ])
    const out = modelWalls([d])
    expect(out[0].wall.source).toBe('user')
    expect(out.slice(1).every((m) => m.wall.source === 'auto')).toBe(true)
  })

  it('keeps a traced wall at the same index no matter how much detection adds', () => {
    const traced = wall(9, 9, 409, 9, 'user')
    const few = modelWalls([drawing([traced, wall(0, 0, 400, 0, 'auto')])])
    const many = modelWalls([drawing([
      traced,
      ...Array.from({ length: 30 }, (_, i) => wall(0, i * 10, 400, i * 10, 'auto')),
    ])])
    expect(few[0].wall).toBe(traced)
    expect(many[0].wall).toBe(traced)
  })

  it('drops detection noise too short to be a wall', () => {
    // A title block's rule lines come back as dozens of tiny "walls".
    const d = drawing([wall(0, 0, 10, 0, 'auto'), wall(0, 0, 400, 0, 'auto')])
    const out = modelWalls([d])
    expect(out.length).toBe(1)
    expect(Math.hypot(out[0].wall.x2 - out[0].wall.x1, 0)).toBe(400)
  })

  it('never drops a TRACED wall for being short — you meant that one', () => {
    const d = drawing([wall(0, 0, 6, 0, 'user')])
    expect(modelWalls([d]).length).toBe(1)
  })

  it('measures the length bar on the diagonal, not just one axis', () => {
    expect(autoWallIsReal(wall(0, 0, MIN_AUTO_WALL_PX - 1, 0, 'auto'))).toBe(false)
    expect(autoWallIsReal(wall(0, 0, 20, 20, 'auto'))).toBe(true)   // ~28px diagonal
  })

  it('carries each drawing’s own scale through', () => {
    const out = modelWalls([
      drawing([wall(0, 0, 400, 0, 'user')], 10),
      drawing([wall(0, 0, 400, 0, 'user')], 25),
    ])
    expect(out.map((m) => m.scaleMmPerPx)).toEqual([10, 25])
  })

  it('counts only the traced walls as editable', () => {
    const d = drawing([wall(9, 9, 409, 9, 'user'), wall(0, 0, 400, 0, 'auto')])
    expect(tracedWallCount([d])).toBe(1)
  })

  it('returns nothing for a drawing with no walls', () => {
    expect(modelWalls([drawing([])])).toEqual([])
  })
})

/**
 * A tradesperson named the thing the length gate was deleting: a RETURN — the
 * short leg where a wall turns back on itself, beside a window or an entry
 * recess. Those run 4 to 24 inches, which is well under MIN_AUTO_WALL_PX at
 * screenshot scale, and they live on the perimeter — which is why it was the
 * outside walls that kept coming up missing.
 */
describe('returns — a short wall that is attached is not annotation', () => {
  const anchor = wall(0, 0, 400, 0, 'auto')   // a long, unambiguous wall

  it('keeps a short segment that corners off a real wall', () => {
    const ret = wall(400, 0, 400, 14, 'auto')  // 14px return off the anchor's end
    expect(autoWallIsReal(ret)).toBe(false)    // the old gate threw this away
    expect(isAttachedReturn(ret, [anchor])).toBe(true)
  })

  it('keeps one that TEES into the middle of a wall, not just at a corner', () => {
    expect(isAttachedReturn(wall(200, 0, 200, 15, 'auto'), [anchor])).toBe(true)
  })

  it('still throws away a short line floating in the middle of a room', () => {
    // Lettering and dimension ticks touch nothing. That is the whole difference.
    expect(isAttachedReturn(wall(200, 300, 214, 300, 'auto'), [anchor])).toBe(false)
  })

  it('will not let a return vouch for another return', () => {
    // Otherwise a row of lettering walks itself in one serif at a time: each
    // tick is "attached" to the one before it. Anchors are long walls only, so
    // a stub hanging off a stub is measured against the wall and comes up short.
    expect(isAttachedReturn(wall(400, 14, 400, 28, 'auto'), [anchor])).toBe(false)
  })

  /**
   * A return TURNS. A short piece lying along the wall it touches is a fragment
   * — detection splitting one run, or the far edge of a thick wall — and
   * keeping those re-inflates the wall count with bits of walls already built.
   */
  it('rejects a collinear stub lying along the wall', () => {
    expect(isAttachedReturn(wall(0, 0, 14, 0, 'auto'), [anchor])).toBe(false)
  })

  it('rejects a segment shorter than the wall is thick', () => {
    // You cannot have a leg of wall shorter than the wall's own depth.
    const stub = { ...wall(400, 0, 400, 7, 'auto'), thickness: 12 }
    expect(isAttachedReturn(stub, [anchor])).toBe(false)
  })

  it('rescues returns through modelWalls, appended so indices stay put', () => {
    const d = drawing([anchor, wall(400, 0, 400, 14, 'auto'), wall(9, 300, 20, 300, 'auto')])
    const out = modelWalls([d])
    expect(out.length).toBe(2)               // anchor + the return; the floater is gone
    expect(out[0].wall).toBe(anchor)         // the long wall keeps index 0
    expect(out[1].wall.y2).toBe(14)          // the return lands after it
  })
})
