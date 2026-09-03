import { describe, it, expect } from 'vitest'
import { filterWallsForNoisyPrint } from './noisyPrintFilter'
import type { ParsedWall } from '../types'
import type { ClassifiedLine, LineClassificationStats } from '../symbols/types'

/**
 * The user imported a PNG screenshot and got back one "wall" roughly four times
 * the thickness of every real wall around it — a solid block. The pair-finder
 * had matched one wall's face to a different wall's face across a room.
 */
function wall(x1: number, y1: number, x2: number, y2: number, thickness: number): ParsedWall {
  return {
    x1, y1, x2, y2, thickness,
    source: 'auto',
    // High confidence on purpose: the old soft -0.12 outlier penalty was
    // absorbed by exactly this kind of score, which is why blocks survived.
    detectionConfidence: 0.85,
  } as ParsedWall
}

const stats: LineClassificationStats = { total: 10, wall: 8 } as LineClassificationStats
const classified: ClassifiedLine[] = []

function run(walls: ParsedWall[]) {
  return filterWallsForNoisyPrint({
    walls, classified, stats,
    imageWidth: 900, imageHeight: 1100, minWallLengthPx: 40,
  })
}

describe('thickness cap', () => {
  const normal = [
    wall(100, 100, 700, 100, 6),
    wall(100, 100, 100, 800, 6),
    wall(700, 100, 700, 800, 6),
    wall(100, 800, 700, 800, 6),
    wall(400, 100, 400, 500, 5),
  ]

  it('drops a wall four times the median thickness', () => {
    const block = wall(200, 300, 650, 300, 24) // 4x the 6px median
    const out = run([...normal, block])
    expect(out.walls.some((w) => w.thickness === 24)).toBe(false)
  })

  it('keeps the ordinary walls', () => {
    const out = run([...normal, wall(200, 300, 650, 300, 24)])
    expect(out.walls.length).toBeGreaterThanOrEqual(4)
  })

  it('never resurrects a block through the low-retention fallback', () => {
    // Scored so harshly that the filter bails out — the old code returned the
    // ORIGINAL list here, block included.
    const scraggly = Array.from({ length: 14 }, (_, i) =>
      wall(10 + i, 10 + i * 3, 44 + i, 52 + i * 3, 6),
    )
    const out = run([...scraggly, wall(200, 300, 650, 300, 30)])
    expect(out.walls.some((w) => w.thickness === 30)).toBe(false)
  })

  it('still returns walls rather than nothing when every wall is thick', () => {
    // A degenerate reading is not a reason to hand back an empty model.
    const out = run([wall(0, 0, 500, 0, 40), wall(0, 0, 0, 500, 42)])
    expect(out.walls.length).toBeGreaterThan(0)
  })
})
