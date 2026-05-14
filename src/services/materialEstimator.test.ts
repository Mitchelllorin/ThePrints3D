import { describe, expect, it } from 'vitest'
import { estimateMaterials, materialReportToCsv } from './materialEstimator'
import type { ParsedWall } from '../types'

const walls: ParsedWall[] = [
  { x1: 0, y1: 0, x2: 1000, y2: 0, thickness: 6, wallType: 'stud-2x4', framingMm: 89 },
  { x1: 1000, y1: 0, x2: 1000, y2: 800, thickness: 6, wallType: 'stud-2x6', framingMm: 140 },
  { x1: 0, y1: 300, x2: 700, y2: 300, thickness: 12, wallType: 'masonry-thick', framingMm: 220 },
]

describe('estimateMaterials', () => {
  it('estimates framed and masonry quantities from parsed walls', () => {
    const report = estimateMaterials(walls, 1, {
      ceilingHeightFt: 9,
      studSpacingIn: 16,
      wasteFactorPct: 10,
      drywallSheetSize: '4x8',
    })

    expect(report.totals.totalWallLengthFt).toBeGreaterThan(8)
    expect(report.totals.framedWallLengthFt).toBeGreaterThan(5)
    expect(report.totals.masonryWallLengthFt).toBeGreaterThan(2)

    const studs = report.items.find((i) => i.id === 'stud-count')
    const drywall = report.items.find((i) => i.id === 'drywall-sheets')
    expect(studs?.quantity).toBeGreaterThan(0)
    expect(drywall?.quantity).toBeGreaterThan(0)
  })

  it('applies unit costs and calculates total estimated cost', () => {
    const report = estimateMaterials(walls, 1, {
      itemUnitCosts: {
        'stud-count': 5,
        'drywall-sheets': 18,
      },
    })

    expect(report.totals.estimatedCost).not.toBeNull()
    expect((report.totals.estimatedCost ?? 0) > 0).toBe(true)
  })

  it('exports report to CSV', () => {
    const report = estimateMaterials(walls, 1)
    const csv = materialReportToCsv(report)
    expect(csv).toContain('Item,Quantity,Unit')
    expect(csv).toContain('Wall Linear Footage')
  })
})
