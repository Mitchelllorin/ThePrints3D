import { describe, it, expect } from 'vitest'
import { modelWalls, tracedWallCount, autoWallIsReal, MIN_AUTO_WALL_PX } from './modelWalls'
import type { ParsedWall, Drawing } from '../types'

const wall = (x1: number, y1: number, x2: number, y2: number, source: 'user' | 'auto'): ParsedWall =>
  ({ x1, y1, x2, y2, thickness: 8, confidence: 1, source } as ParsedWall)

const drawing = (walls: ParsedWall[], scaleMmPerPx: number | null = 10): Drawing =>
  ({ id: 'd1', parsedWalls: walls, scaleMmPerPx } as unknown as Drawing)

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
