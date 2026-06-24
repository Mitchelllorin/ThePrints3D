import { describe, it, expect } from 'vitest'
import { buildFloorDeck, buildFloorJoists } from './framingGeometry'

describe('floor openings (stairwell/shaft holes)', () => {
  const area = { lenX: 8, lenZ: 6 }

  it('drops deck sheets over an opening, leaving fewer sheets', () => {
    const solid = buildFloorDeck({ ...area }).userData.sheetCount as number
    const holed = buildFloorDeck({ ...area, holes: [{ x: 0, z: 0, w: 2, d: 3 }] }).userData.sheetCount as number
    expect(solid).toBeGreaterThan(0)
    expect(holed).toBeLessThan(solid)
  })

  it('no holes → deck unchanged', () => {
    const a = buildFloorDeck({ ...area }).userData.sheetCount as number
    const b = buildFloorDeck({ ...area, holes: [] }).userData.sheetCount as number
    expect(a).toBe(b)
  })

  it('builds a joist field with framed openings without throwing', () => {
    const g = buildFloorJoists({ ...area, element: '2x10', ocM: 0.4064, holes: [{ x: 0, z: 0, w: 2, d: 2 }] })
    // Header/trimmer members + segmented joists still leave a populated group.
    expect(g.children.length).toBeGreaterThan(0)
  })
})
