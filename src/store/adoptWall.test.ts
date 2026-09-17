/**
 * THE WALLS THE APP GUESSED AT WERE THE ONLY ONES YOU COULD NOT FIX.
 *
 * Every editing path in the app — the pick meshes, the edit rail, update,
 * delete, trim, X-ray — addresses walls by their index among `source: 'user'`
 * walls. A wall read off the print is `source: 'auto'`, so it appeared in none
 * of those lists: no hit box, no rail, no way to correct it. Exactly backwards,
 * since a detected wall is the one most likely to be wrong.
 *
 * `adoptDetectedWall` is the fix from the other end: touching a detected wall
 * makes it yours, and every existing path then works on it unchanged. These
 * tests drive the real store action, because the value is entirely in the
 * indices lining up afterwards.
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

const auto = (x: number): ParsedWall => ({
  x1: x, y1: 0, x2: x, y2: 400, thickness: 6, source: 'auto', detectionConfidence: 0.8,
})
const traced = (x: number): ParsedWall => ({
  x1: x, y1: 0, x2: x, y2: 400, thickness: 6, source: 'user',
})

function drawing(walls: ParsedWall[]): Drawing {
  return {
    id: 'd1',
    name: 'plan.png',
    type: 'floor_plan',
    status: 'ready',
    file: new File([], 'plan.png'),
    parsedWalls: walls,
    parsedRooms: [],
    parsedOpenings: [],
    parsedText: [],
    parsedSymbols: [],
    parsedAnnotationCandidates: [],
    parseProgress: 100,
    scaleMmPerPx: 5,
    scaleConfidence: 'inferred',
  } as unknown as Drawing
}

const userWalls = () =>
  (s().drawings[0].parsedWalls ?? []).filter((w) => w.source === 'user')

beforeEach(() => {
  useAppStore.setState({ drawings: [drawing([auto(10), auto(20), auto(30)])], selectedDrawingId: 'd1' })
})

describe('adoptDetectedWall', () => {
  it('turns a detected wall into one you own', () => {
    expect(userWalls()).toHaveLength(0)
    const i = s().adoptDetectedWall('d1', 1)
    expect(i).toBe(0)
    expect(userWalls()).toHaveLength(1)
    expect(userWalls()[0].x1).toBe(20)
  })

  /**
   * THE POINT OF THE RETURN VALUE. The caller selects with it, and every edit
   * path then reads `parsedWalls.filter(user)[index]`. If the index it hands
   * back does not find the same wall, tapping a wall selects a different one.
   */
  it('returns an index that finds that same wall', () => {
    const i = s().adoptDetectedWall('d1', 2)
    expect(userWalls()[i].x1).toBe(30)
  })

  it('keeps the wall count the same — it moves a wall, it does not add one', () => {
    s().adoptDetectedWall('d1', 0)
    expect(s().drawings[0].parsedWalls).toHaveLength(3)
  })

  it('leaves the other detected walls alone', () => {
    s().adoptDetectedWall('d1', 0)
    const autos = s().drawings[0].parsedWalls.filter((w) => w.source !== 'user')
    expect(autos.map((w) => w.x1).sort((a, b) => a - b)).toEqual([20, 30])
  })

  it('adopts several, each landing on its own index', () => {
    const a = s().adoptDetectedWall('d1', 0)
    const b = s().adoptDetectedWall('d1', s().drawings[0].parsedWalls.findIndex((w) => w.x1 === 30))
    expect(userWalls()[a].x1).toBe(10)
    expect(userWalls()[b].x1).toBe(30)
    expect(a).not.toBe(b)
  })

  /** A second tap on an adopted wall must be free — no history, same index. */
  it('is a no-op on a wall already adopted', () => {
    const first = s().adoptDetectedWall('d1', 1)
    const idx = s().drawings[0].parsedWalls.findIndex((w) => w.x1 === 20)
    const again = s().adoptDetectedWall('d1', idx)
    expect(again).toBe(first)
    expect(userWalls()).toHaveLength(1)
  })

  it('finds the right index when traced walls are already there', () => {
    useAppStore.setState({ drawings: [drawing([auto(10), traced(50), auto(30)])] })
    const i = s().adoptDetectedWall('d1', 0)
    expect(userWalls()[i].x1).toBe(10)
    expect(userWalls()).toHaveLength(2)
  })

  it('says so rather than guessing when there is no such wall', () => {
    expect(s().adoptDetectedWall('d1', 99)).toBe(-1)
    expect(s().adoptDetectedWall('nope', 0)).toBe(-1)
  })

  /**
   * An adopted wall is a correction, so it has to survive the undo stack the
   * same way a traced one does — one tap, one step back.
   */
  it('is undoable', () => {
    s().adoptDetectedWall('d1', 1)
    expect(userWalls()).toHaveLength(1)
    s().undo()
    expect(userWalls()).toHaveLength(0)
    expect(s().drawings[0].parsedWalls).toHaveLength(3)
  })
})
