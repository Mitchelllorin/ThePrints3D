import { describe, expect, it } from 'vitest'
import type { ParsedWall } from '../types'
import { inferScaleFromStructure } from './scaleInference'

function wall(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  thickness: number,
  detectionConfidence = 0.85,
): ParsedWall {
  return { x1, y1, x2, y2, thickness, source: 'auto', detectionConfidence }
}

describe('inferScaleFromStructure', () => {
  it('returns null when there is not enough structural evidence', () => {
    expect(inferScaleFromStructure([])).toBeNull()
    expect(inferScaleFromStructure([wall(0, 0, 40, 0, 1)])).toBeNull()
  })

  it('infers scale from consistent wall thickness and opening width priors', () => {
    const inferred = inferScaleFromStructure([
      wall(0, 0, 220, 0, 30),
      wall(448, 0, 760, 0, 30),
      wall(0, 240, 280, 240, 43),
      wall(520, 240, 840, 240, 43),
      wall(100, 60, 100, 360, 30),
      wall(620, 60, 620, 360, 30),
    ])

    expect(inferred).not.toBeNull()
    expect(inferred!.scaleMmPerPx).toBeCloseTo(4, 1)
    expect(inferred!.support.walls).toBeGreaterThanOrEqual(2)
    expect(inferred!.support.openings).toBeGreaterThanOrEqual(1)
  })
})
