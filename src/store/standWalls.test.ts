/**
 * FRAME IT IS ONE UNDO.
 *
 * Standing the walls is three inner steps — hang the openings, build, hang
 * again — and each used to record its own undo. Undo then stopped between
 * them, on a model marked unbuilt with its walls still standing, and the step
 * chip asked to "Stand them up" over walls that were up (25 Oct 2026, in the
 * screenshot sent to the boss).
 */
import { describe, it, expect, vi } from 'vitest'

/** pdf.js touches DOMMatrix at import time and nothing here rasterises. */
vi.mock('../services/pdfRasterizer', () => ({
  rasterizePDF: vi.fn(),
  rasterizeImage: vi.fn(),
  rasterizeFile: vi.fn(),
}))

import { useAppStore } from './useAppStore'

const s = () => useAppStore.getState()

describe('standWalls', () => {
  it('records one undo step, and one Undo puts it all back', () => {
    s().startDrawnProject({ widthMm: 12000, depthMm: 9000, wallTypeKey: 'wood-2x6', floor: 'slab' })
    const before = s().historyPast.length
    const placedBefore = s().placedObjects.length

    s().standWalls()
    expect(s().model.status).toBe('ready')
    expect(s().historyPast.length).toBe(before + 1)

    s().undo()
    expect(s().historyPast.length).toBe(before)
    expect(s().model.status).toBe('idle')
    expect(s().placedObjects.length).toBe(placedBefore)

    s().redo()
    expect(s().model.status).toBe('ready')
  })

  it('leaves other actions recording their own undo afterwards', () => {
    s().startDrawnProject({ widthMm: 12000, depthMm: 9000, wallTypeKey: 'wood-2x6', floor: 'slab' })
    s().standWalls()
    const after = s().historyPast.length
    s().putRoofOn()
    expect(s().historyPast.length).toBe(after + 1)
  })
})
