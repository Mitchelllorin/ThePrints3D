import { describe, it, expect } from 'vitest'
import { wallFootprintPx, deriveBuildAreas } from './autoBuildAreas'
import type { ParsedWall } from '../types'

const wall = (x1: number, y1: number, x2: number, y2: number): ParsedWall => ({
  x1, y1, x2, y2, thickness: 6, source: 'auto',
})

// A closed 1000 x 800 rectangle of walls.
const box: ParsedWall[] = [
  wall(100, 100, 1100, 100),
  wall(1100, 100, 1100, 900),
  wall(1100, 900, 100, 900),
  wall(100, 900, 100, 100),
]

const ids = (role: string, level: number) => `${role}-${level}`

describe('wallFootprintPx', () => {
  it('returns the bounding box of every wall endpoint', () => {
    expect(wallFootprintPx(box)).toEqual({ x1: 100, y1: 100, x2: 1100, y2: 900 })
  })

  it('is null with no walls — nothing to stand a slab on', () => {
    expect(wallFootprintPx([])).toBeNull()
  })

  it('is null for a degenerate footprint (a single wall has no area)', () => {
    expect(wallFootprintPx([wall(0, 0, 500, 0)])).toBeNull()
  })
})

describe('deriveBuildAreas', () => {
  it('single storey: slab at level 0, ceiling on top, one roof', () => {
    const { floors, roofs } = deriveBuildAreas(box, { makeId: ids })

    expect(floors.map((f) => f.elementType)).toEqual(['Concrete Slab', 'Ceiling joists'])
    expect(floors.map((f) => f.level)).toEqual([0, 0])
    expect(roofs).toHaveLength(1)
    expect(roofs[0].elementType).toBe('Gable')
    expect(roofs[0].size).toBe('6:12')
    expect(roofs[0].level).toBe(0)
  })

  it('every derived area spans the wall footprint', () => {
    const { floors, roofs } = deriveBuildAreas(box, { makeId: ids })
    for (const a of [...floors, ...roofs]) {
      expect([a.x1, a.y1, a.x2, a.y2]).toEqual([100, 100, 1100, 900])
    }
  })

  it('multi-storey: slab once, a deck per storey above, ceiling + roof on the top', () => {
    const { floors, roofs } = deriveBuildAreas(box, { levels: 3, makeId: ids })

    expect(floors.map((f) => [f.elementType, f.level])).toEqual([
      ['Concrete Slab', 0],
      ['I-Joist', 1],
      ['I-Joist', 2],
      ['Ceiling joists', 2],
    ])
    expect(roofs[0].level).toBe(2)
  })

  it('honours roof form and pitch overrides', () => {
    const { roofs } = deriveBuildAreas(box, { roofElement: 'Hip', roofPitch: '8:12', makeId: ids })
    expect(roofs[0].elementType).toBe('Hip')
    expect(roofs[0].size).toBe('8:12')
  })

  it('derives nothing when there are no walls', () => {
    expect(deriveBuildAreas([], { makeId: ids })).toEqual({ floors: [], roofs: [] })
  })

  it('ids are unique across the derived set', () => {
    const { floors, roofs } = deriveBuildAreas(box, { levels: 2, makeId: ids })
    const all = [...floors, ...roofs].map((a) => a.id)
    expect(new Set(all).size).toBe(all.length)
  })
})
