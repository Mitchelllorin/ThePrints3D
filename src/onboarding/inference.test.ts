import { describe, it, expect } from 'vitest'
import { inferProjectMeta } from './inference'
import type { Drawing } from '../types'

function mkDrawing(overrides: Partial<Drawing>): Drawing {
  return {
    id: overrides.id ?? Math.random().toString(36),
    name: overrides.name ?? 'untitled.pdf',
    type: 'floor-plan',
    file: new File([], overrides.name ?? 'untitled.pdf'),
    pageCount: 1,
    currentPage: 0,
    previewUrl: null,
    rasterUrl: null,
    rasterWidth: null,
    rasterHeight: null,
    parsedWalls: [],
    parseProgress: 100,
    floorNumber: null,
    status: 'ready',
    scaleMmPerPx: null,
    scaleNotation: null,
    uploadedAt: 0,
    ...overrides,
  }
}

describe('inferProjectMeta', () => {
  it('returns zero confidence with no drawings', () => {
    const r = inferProjectMeta([])
    expect(r.confidence).toBe(0)
    expect(r.sheetSummary.total).toBe(0)
  })

  it('recognises metric scale notation', () => {
    const r = inferProjectMeta([
      mkDrawing({ name: 'A-2.7 - 6th Level Plan.pdf', scaleNotation: '1:75', scaleMmPerPx: 1.5 }),
    ])
    expect(r.detected.unitSystem).toBe('metric')
    expect(r.confidence).toBeGreaterThan(0)
  })

  it('recognises imperial scale notation', () => {
    const r = inferProjectMeta([
      mkDrawing({ name: 'A-101 First Floor.pdf', scaleNotation: '1/4" = 1\'-0"', scaleMmPerPx: 0.5 }),
    ])
    expect(r.detected.unitSystem).toBe('imperial')
  })

  it('counts architectural sheets and skips MEP', () => {
    const r = inferProjectMeta([
      mkDrawing({ name: 'A-101.pdf' }),
      mkDrawing({ name: 'A-201.pdf' }),
      mkDrawing({ name: 'M-101 HVAC.pdf' }),
      mkDrawing({ name: 'P-101 Plumbing.pdf' }),
      mkDrawing({ name: 'E-101 Electrical.pdf' }),
    ])
    expect(r.sheetSummary.architectural).toBe(2)
    expect(r.sheetSummary.skipped).toBe(3)
  })

  it('infers multi-unit residential from ≥4 floors', () => {
    const drawings = [1, 2, 3, 4, 5, 6].map((n) =>
      mkDrawing({ name: `A-${n}01.pdf`, scaleNotation: '1:75', scaleMmPerPx: 1.5 })
    )
    const r = inferProjectMeta(drawings)
    expect(r.detected.buildingType).toBe('residential-multi')
    expect(r.detected.framing).toBe('mixed')
    expect(r.detected.drywall).toBe('double-layer')
    expect(r.detected.floorHeightM).toBe(2.7)
  })

  it('defaults a single-storey to wood + single-layer drywall', () => {
    const r = inferProjectMeta([
      mkDrawing({ name: 'A-101 First Floor.pdf', scaleNotation: '1:50', scaleMmPerPx: 1.0 }),
    ])
    expect(r.detected.buildingType).toBe('residential-single')
    expect(r.detected.framing).toBe('wood')
    expect(r.detected.drywall).toBe('single-layer')
  })

  it('reaches high confidence (≥0.9) with scale + discipline + floors', () => {
    const drawings = [1, 2, 3].map((n) =>
      mkDrawing({ name: `A-${n}01.pdf`, scaleNotation: '1:75', scaleMmPerPx: 1.5 })
    )
    const r = inferProjectMeta(drawings)
    expect(r.confidence).toBeGreaterThanOrEqual(0.9)
  })

  it('surfaces human-readable reasons', () => {
    const r = inferProjectMeta([
      mkDrawing({ name: 'A-2.7 - 6th Level Plan.pdf', scaleNotation: '1:75', scaleMmPerPx: 1.5 }),
      mkDrawing({ name: 'M-101 HVAC.pdf' }),
    ])
    expect(r.reasons.some((s) => /metric/i.test(s))).toBe(true)
    expect(r.reasons.some((s) => /skipped/i.test(s))).toBe(true)
  })
})
