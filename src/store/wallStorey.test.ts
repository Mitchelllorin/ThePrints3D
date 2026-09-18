/**
 * A WALL STANDS ON THE STOREY ITS SHEET IS ON.
 *
 * Every renderer asks a wall which storey it is on and nothing ever told it.
 * The sheet knows — `floorNumber`, read off the sheet number or set by hand —
 * but that never reached the walls drawn on it, so a second-floor plan framed
 * its walls on the ground, inside the ground floor's own. From outside it read
 * as one storey of framing with a roof floating above it, which is what "the
 * second floor is only partly framed" looks like.
 *
 * Driven through the real store action, because the value is entirely in what
 * the walls report afterwards.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

/** pdf.js touches DOMMatrix at import time and nothing here rasterises. */
vi.mock('../services/pdfRasterizer', () => ({
  rasterizePDF: vi.fn(),
  rasterizeImage: vi.fn(),
  rasterizeFile: vi.fn(),
}))

import { useAppStore } from './useAppStore'
import type { Drawing, ParsedWall } from '../types'

const s = () => useAppStore.getState()

const wall = (x: number, level?: number): ParsedWall =>
  ({ x1: x, y1: 0, x2: x, y2: 400, thickness: 6, source: 'user', ...(level === undefined ? {} : { level }) }) as ParsedWall

function drawing(walls: ParsedWall[], floorNumber: number | null = 0): Drawing {
  return {
    id: 'd1', name: 'plan.png', type: 'floor_plan', status: 'ready',
    file: new File([], 'plan.png'),
    parsedWalls: walls, parsedRooms: [], parsedOpenings: [], parsedText: [],
    parsedSymbols: [], parsedAnnotationCandidates: [], parseProgress: 100,
    scaleMmPerPx: 5, scaleConfidence: 'parsed', floorNumber,
  } as unknown as Drawing
}

const levels = () => (s().drawings[0].parsedWalls ?? []).map((w) => w.level ?? 0)

beforeEach(() => {
  useAppStore.setState({ drawings: [drawing([wall(10), wall(20)])], selectedDrawingId: 'd1' })
})

describe('assigning a sheet to a floor takes its walls with it', () => {
  it('puts the walls of a second-floor sheet on the second floor', () => {
    expect(levels()).toEqual([0, 0])
    s().assignDrawingToLevel('d1', 1)
    expect(levels()).toEqual([1, 1])
    expect(s().drawings[0].floorNumber).toBe(1)
  })

  it('moves them back down again', () => {
    s().assignDrawingToLevel('d1', 2)
    s().assignDrawingToLevel('d1', 0)
    expect(levels()).toEqual([0, 0])
  })

  it('keeps a stack stacked — levels move by the difference, not by assignment', () => {
    // carryWallsUp puts a second storey INSIDE one sheet, stamping levels itself.
    // Re-assigning the sheet must not flatten that stack into one storey.
    useAppStore.setState({ drawings: [drawing([wall(10, 0), wall(10, 1), wall(20, 0)])], selectedDrawingId: 'd1' })
    s().assignDrawingToLevel('d1', 1)
    expect(levels()).toEqual([1, 2, 1])
  })

  it('takes a wall with no storey of its own to be on the sheet it is drawn on', () => {
    useAppStore.setState({ drawings: [drawing([wall(10), wall(20, 1)], 0)], selectedDrawingId: 'd1' })
    s().assignDrawingToLevel('d1', 0)          // no move, but the blanks fill in
    expect(levels()).toEqual([0, 1])
  })
})
