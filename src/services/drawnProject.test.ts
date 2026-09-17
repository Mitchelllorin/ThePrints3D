import { describe, it, expect } from 'vitest'
import { createDrawnProject, parseSizeMm, shellThicknessMm, DRAWN_MM_PER_PX } from './drawnProject'
import { modelWalls, scaleIsKnown } from './modelWalls'
import type { Drawing } from '../types'

const FT = 304.8
const spec = { widthMm: 40 * FT, depthMm: 30 * FT, wallTypeKey: 'wood-2x6', floor: 'slab' as const }

/** Outside face to outside face of the built shell, in millimetres. */
const outside = (p: ReturnType<typeof createDrawnProject>) => {
  const w = p.drawing.parsedWalls
  const xs = w.flatMap((x) => [x.x1, x.x2])
  const ys = w.flatMap((x) => [x.y1, x.y2])
  const t = w[0].thickness
  return {
    width: (Math.max(...xs) - Math.min(...xs) + t) * DRAWN_MM_PER_PX,
    depth: (Math.max(...ys) - Math.min(...ys) + t) * DRAWN_MM_PER_PX,
  }
}

describe('a typed size is the size you get', () => {
  it('measures the footprint outside face to outside face', () => {
    // 40 ft means 40 ft across the outside, not 40 ft between centrelines with
    // half a wall hanging off each end.
    const got = outside(createDrawnProject(spec))
    expect(got.width).toBeCloseTo(40 * FT, 6)
    expect(got.depth).toBeCloseTo(30 * FT, 6)
  })

  it('holds the outside size whatever the shell is framed from', () => {
    for (const key of ['wood-2x4', 'wood-2x6', 'wood-2x8', 'steel-6']) {
      const got = outside(createDrawnProject({ ...spec, wallTypeKey: key }))
      expect(got.width).toBeCloseTo(40 * FT, 6)
      expect(got.depth).toBeCloseTo(30 * FT, 6)
    }
  })

  it('frames the shell at the chosen wall type thickness', () => {
    const p = createDrawnProject({ ...spec, wallTypeKey: 'wood-2x4' })
    expect(p.drawing.parsedWalls[0].thickness * DRAWN_MM_PER_PX).toBeCloseTo(shellThicknessMm('wood-2x4'), 6)
    expect(p.drawing.parsedWalls.every((w) => w.framingType === 'wood-2x4')).toBe(true)
  })

  it('closes the rectangle — four walls, every corner met', () => {
    const w = createDrawnProject(spec).drawing.parsedWalls
    expect(w).toHaveLength(4)
    for (let i = 0; i < 4; i++) {
      const next = w[(i + 1) % 4]
      expect(w[i].x2).toBeCloseTo(next.x1, 6)
      expect(w[i].y2).toBeCloseTo(next.y1, 6)
    }
  })
})

describe('nothing here is guessed', () => {
  it('marks the scale KNOWN, because the sheet was drawn at it', () => {
    const p = createDrawnProject(spec)
    expect(p.drawing.scaleMmPerPx).toBe(DRAWN_MM_PER_PX)
    expect(scaleIsKnown(p.drawing)).toBe(true)
  })

  it('makes the walls the user OWN, so they build and can be edited', () => {
    const p = createDrawnProject(spec)
    expect(p.drawing.parsedWalls.every((w) => w.source === 'user')).toBe(true)
    // The gate in modelWalls lets them through: they were not detected.
    expect(modelWalls([p.drawing as unknown as Drawing])).toHaveLength(4)
  })

  it('sets the sheet on the ground at its true size', () => {
    const p = createDrawnProject(spec)
    // 40 ft plus 4 ft of paper each side, in metres.
    expect(p.overlayScale[0]).toBeCloseTo((40 + 8) * FT / 1000, 1)
    expect(p.overlayScale[1]).toBeCloseTo((30 + 8) * FT / 1000, 1)
  })
})

describe('the floor goes down before the walls', () => {
  it('lays a slab over the whole footprint', () => {
    const f = createDrawnProject(spec).floorAreas[0]
    expect(f).toBeTruthy()
    expect(f.elementType).toBe('Concrete Slab')
    expect((f.x2 - f.x1) * DRAWN_MM_PER_PX).toBeCloseTo(40 * FT, 6)
    expect((f.y2 - f.y1) * DRAWN_MM_PER_PX).toBeCloseTo(30 * FT, 6)
  })

  it('lays joists instead when asked', () => {
    expect(createDrawnProject({ ...spec, floor: 'joists' }).floorAreas[0].elementType).toBe('2x10')
  })

  it('leaves it out when the floor is for later — every step is optional', () => {
    expect(createDrawnProject({ ...spec, floor: 'none' }).floorAreas).toEqual([])
  })
})

describe('a house is a series of boxes', () => {
  // 32 x 26 with a 12 x 14 kitchen wing off the back, flush at the left.
  const L = {
    ...spec, widthMm: 32 * FT, depthMm: 26 * FT,
    wings: [{ widthMm: 12 * FT, depthMm: 14 * FT, attach: { side: 'bottom' as const, offsetMm: 0 } }],
  }

  it('frames the L as six walls — no wall through the join', () => {
    const p = createDrawnProject(L)
    expect(p.drawing.parsedWalls).toHaveLength(6)
    expect(p.drawing.parsedWalls.every((w) => w.source === 'user')).toBe(true)
  })

  it('measures the whole building outside face to outside face', () => {
    const got = outside(createDrawnProject(L))
    expect(got.width).toBeCloseTo(32 * FT, 6)
    expect(got.depth).toBeCloseTo((26 + 14) * FT, 6)
  })

  it('closes the loop, every wall end meeting the next', () => {
    const w = createDrawnProject(L).drawing.parsedWalls
    for (let i = 0; i < w.length; i++) {
      const next = w[(i + 1) % w.length]
      expect(w[i].x2).toBeCloseTo(next.x1, 6)
      expect(w[i].y2).toBeCloseTo(next.y1, 6)
    }
  })

  it('puts a floor under both legs', () => {
    expect(createDrawnProject(L).floorAreas).toHaveLength(2)
  })

  it('builds every wall of it — nothing detected, nothing dropped', () => {
    const p = createDrawnProject(L)
    expect(modelWalls([p.drawing as unknown as Drawing])).toHaveLength(6)
  })
})

describe('sizes typed the way the trade writes them', () => {
  it('reads a bare number as FEET, never millimetres', () => {
    // The 300x mistake: 40 meaning 40mm would be a building the size of a brick.
    expect(parseSizeMm('40')).toBeCloseTo(40 * FT, 6)
  })

  it('reads feet, feet-and-inches, and the dash the trade uses', () => {
    expect(parseSizeMm("40'")).toBeCloseTo(40 * FT, 6)
    expect(parseSizeMm(`40' 6"`)).toBeCloseTo(40.5 * FT, 6)
    expect(parseSizeMm('40-6')).toBeCloseTo(40.5 * FT, 6)
  })

  it('reads metric when it is written', () => {
    expect(parseSizeMm('12.2m')).toBeCloseTo(12200, 6)
    expect(parseSizeMm('4500mm')).toBeCloseTo(4500, 6)
    expect(parseSizeMm('120cm')).toBeCloseTo(1200, 6)
    expect(parseSizeMm('480in')).toBeCloseTo(480 * 25.4, 6)
  })

  it('refuses what it cannot read rather than guessing', () => {
    expect(parseSizeMm('')).toBeNull()
    expect(parseSizeMm('big')).toBeNull()
    expect(parseSizeMm('40 x 30')).toBeNull()
  })
})
