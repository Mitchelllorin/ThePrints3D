import { describe, expect, it } from 'vitest'
import type { ClassifiedLine, LineClassificationStats } from '../symbols/types'
import type { ParsedWall } from '../types'
import { filterWallsForNoisyPrint } from './noisyPrintFilter'

function lineStats(overrides: Partial<LineClassificationStats>): LineClassificationStats {
  return {
    total: 120,
    wall: 24,
    dimension: 24,
    dashed: 24,
    dotted: 12,
    leader: 24,
    unknown: 12,
    ...overrides,
  }
}

function classifiedLines(count: number): ClassifiedLine[] {
  return Array.from({ length: count }, (_, i) => ({
    x1: i,
    y1: i,
    x2: i + 10,
    y2: i + 10,
    thickness: 2,
    classification: 'unknown',
    confidence: 0.4,
    transitions: 7,
    dark_ratio: 0.4,
  }))
}

describe('filterWallsForNoisyPrint', () => {
  it('filters isolated border/title-block lines while preserving supported walls', () => {
    const walls: ParsedWall[] = [
      { x1: 80, y1: 80, x2: 420, y2: 80, thickness: 10, detectionConfidence: 0.72 },
      { x1: 80, y1: 80, x2: 80, y2: 300, thickness: 10, detectionConfidence: 0.72 },
      { x1: 420, y1: 80, x2: 420, y2: 300, thickness: 10, detectionConfidence: 0.72 },
      { x1: 80, y1: 300, x2: 420, y2: 300, thickness: 10, detectionConfidence: 0.72 },
      { x1: 240, y1: 80, x2: 240, y2: 300, thickness: 10, detectionConfidence: 0.7 },
      { x1: 10, y1: 8, x2: 390, y2: 8, thickness: 2, detectionConfidence: 0.58 },
    ]

    const result = filterWallsForNoisyPrint({
      walls,
      classified: classifiedLines(180),
      stats: lineStats({ total: 180, wall: 32 }),
      imageWidth: 480,
      imageHeight: 360,
      minWallLengthPx: 55,
    })

    expect(result.walls.some((w) => Math.abs(w.y1 - 8) < 1 && Math.abs(w.y2 - 8) < 1)).toBe(false)
    expect(result.walls).toHaveLength(5)
    expect(result.metrics.fallbackApplied).toBe(false)
  })

  it('removes unsupported weak candidates in heavy-noise sheets', () => {
    const walls: ParsedWall[] = [
      { x1: 90, y1: 90, x2: 430, y2: 90, thickness: 11, detectionConfidence: 0.76 },
      { x1: 90, y1: 90, x2: 90, y2: 320, thickness: 11, detectionConfidence: 0.76 },
      { x1: 430, y1: 90, x2: 430, y2: 320, thickness: 11, detectionConfidence: 0.76 },
      { x1: 90, y1: 320, x2: 430, y2: 320, thickness: 11, detectionConfidence: 0.76 },
      { x1: 250, y1: 90, x2: 250, y2: 320, thickness: 10, detectionConfidence: 0.73 },
      { x1: 150, y1: 210, x2: 230, y2: 255, thickness: 2, detectionConfidence: 0.46 },
    ]

    const result = filterWallsForNoisyPrint({
      walls,
      classified: classifiedLines(300),
      stats: lineStats({ total: 300, wall: 26, unknown: 70, dashed: 62, leader: 62 }),
      imageWidth: 520,
      imageHeight: 420,
      minWallLengthPx: 55,
    })

    expect(result.walls.some((w) => w.x1 === 150 && w.y1 === 210)).toBe(false)
    expect(result.walls).toHaveLength(5)
  })

  it('falls back to original walls when filtering would over-prune sparse prints', () => {
    const sparseWalls: ParsedWall[] = [
      { x1: 120, y1: 120, x2: 340, y2: 120, thickness: 9, detectionConfidence: 0.5 },
      { x1: 340, y1: 120, x2: 340, y2: 260, thickness: 9, detectionConfidence: 0.49 },
      { x1: 120, y1: 260, x2: 340, y2: 260, thickness: 9, detectionConfidence: 0.48 },
    ]

    const result = filterWallsForNoisyPrint({
      walls: sparseWalls,
      classified: classifiedLines(220),
      stats: lineStats({ total: 220, wall: 12 }),
      imageWidth: 420,
      imageHeight: 320,
      minWallLengthPx: 55,
    })

    expect(result.metrics.fallbackApplied).toBe(true)
    expect(result.walls).toHaveLength(sparseWalls.length)
  })
})
