/**
 * A SHED, FRAMED IN ONE TAP: skid floor, walls up, the chosen roof on and
 * double doors hung in the front wall — and one Undo takes all of it back.
 */
import { describe, it, expect, vi } from 'vitest'

/** pdf.js touches DOMMatrix at import time and nothing here rasterises. */
vi.mock('../services/pdfRasterizer', () => ({
  rasterizePDF: vi.fn(),
  rasterizeImage: vi.fn(),
  rasterizeFile: vi.fn(),
}))

import { useAppStore } from './useAppStore'
import { SKID_FLOOR } from '../services/framingGeometry'
import { doorStyle, doorWidthM } from '../services/doorStyle'

const s = () => useAppStore.getState()
const FT = 304.8

describe('frameShed', () => {
  it('builds the shed with its door and roof, as one undo step', () => {
    const before = s().historyPast.length
    const roofsBefore = s().roofAreas.length
    s().frameShed(
      { widthMm: 10 * FT, depthMm: 12 * FT, wallTypeKey: 'wood-2x4', floor: 'skids', name: 'Shed' },
      { roof: 'Shed', pitch: '3:12', doorWidthM: 1.524 },
    )
    expect(s().historyPast.length).toBe(before + 1)
    expect(s().model.status).toBe('ready')

    // The floor sits on skids, and the roof is the lean-to that was chosen.
    expect(s().floorsAreas.some((a) => a.elementType === SKID_FLOOR)).toBe(true)
    const roofs = s().roofAreas.slice(roofsBefore)
    expect(roofs.length).toBeGreaterThan(0)
    expect(roofs[0].elementType).toBe('Shed')
    expect(roofs[0].size).toBe('3:12')

    // Double doors, 5 ft, swinging out, in the front wall.
    const door = s().placedObjects.find((o) => o.label === 'Shed door')
    expect(door).toBeTruthy()
    expect(doorStyle(door!)).toBe('double')
    expect(doorWidthM(door!)).toBeCloseTo(1.524, 4)
    expect(door!.swingSide).toBe('out')

    s().undo()
    expect(s().historyPast.length).toBe(before)
    expect(s().placedObjects.some((o) => o.label === 'Shed door')).toBe(false)
  })
})
