/**
 * SETTING THE SCALE HAS TO RESIZE THE PRINT.
 *
 * A wall's place in the world is its pixel position times the print's size; its
 * thickness and studs come from mm/px. Calibration used to change mm/px and
 * leave the print at the size the OLD scale gave it, so typing a real distance
 * over a bad guess left the house the same size with walls a fraction as thick.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../services/pdfRasterizer', () => ({
  rasterizePDF: vi.fn(),
  rasterizeImage: vi.fn(),
  rasterizeFile: vi.fn(),
}))

import { useAppStore } from './useAppStore'
import type { Drawing } from '../types'

const s = () => useAppStore.getState()

beforeEach(() => {
  useAppStore.setState({
    drawings: [{
      id: 'd1', name: 'plan.png', type: 'floor_plan', status: 'ready', file: new File([], 'plan.png'),
      parsedWalls: [], parsedRooms: [], parsedOpenings: [], parsedText: [], parsedSymbols: [],
      parsedAnnotationCandidates: [], parseProgress: 100,
      rasterWidth: 732, rasterHeight: 727, scaleMmPerPx: 28.5, scaleConfidence: 'inferred',
    } as unknown as Drawing],
    selectedDrawingId: 'd1',
  })
  s().updateFloorplanOverlay({ drawingId: 'd1', scale: [20.862, 20.7195] }, false)
})

describe('setDrawingScale', () => {
  it('resizes the print to the new scale', () => {
    s().setDrawingScale('d1', 9.34, 'custom')
    const [w, d] = s().floorplanOverlay.scale
    expect(w).toBeCloseTo((732 * 9.34) / 1000, 3)
    expect(d).toBeCloseTo((727 * 9.34) / 1000, 3)
  })

  it('keeps the print where it is — only the size changes', () => {
    s().updateFloorplanOverlay({ position: [3, -2] }, false)
    s().setDrawingScale('d1', 9.34, 'custom')
    expect(s().floorplanOverlay.position).toEqual([3, -2])
  })

  it('leaves a print that belongs to another drawing alone', () => {
    s().updateFloorplanOverlay({ drawingId: 'other' }, false)
    s().setDrawingScale('d1', 9.34, 'custom')
    expect(s().floorplanOverlay.scale).toEqual([20.862, 20.7195])
  })
})
