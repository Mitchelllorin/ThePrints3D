import { describe, it, expect } from 'vitest'
import { sessionSummary, buildPilotSnapshot, serializePilotRows } from './pilotMetrics'
import type { Drawing } from '../types'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeDrawing(overrides: Partial<Drawing> = {}): Drawing {
  return {
    id: 'test-id',
    name: 'A-101 Floor Plan.pdf',
    type: 'floor-plan',
    file: new File([], 'test.pdf', { type: 'application/pdf' }),
    pageCount: 1,
    currentPage: 1,
    previewUrl: null,
    rasterUrl: null,
    rasterWidth: null,
    rasterHeight: null,
    parsedWalls: [],
    parsedRooms: [],
    parsedOpenings: [],
    parseProgress: 100,
    floorNumber: null,
    status: 'ready',
    scaleMmPerPx: null,
    scaleNotation: null,
    uploadedAt: Date.now(),
    ...overrides,
  }
}

// ─── sessionSummary ───────────────────────────────────────────────────────────

describe('sessionSummary', () => {
  it('returns zeroed summary for an empty drawing set', () => {
    const result = sessionSummary([], 0)
    expect(result.sheetCount).toBe(0)
    expect(result.wallCount).toBe(0)
    expect(result.floorCount).toBe(0)
    expect(result.scaleConfidenceDistribution).toEqual({ auto: 0, manual: 0, none: 0 })
    expect(result.renderTimeMs).toBe(0)
  })

  it('counts sheets correctly', () => {
    const drawings = [makeDrawing(), makeDrawing({ id: 'id2', name: 'A-201 Floor Plan.pdf' })]
    const result = sessionSummary(drawings, 0)
    expect(result.sheetCount).toBe(2)
  })

  it('sums detected wall counts across all drawings', () => {
    const walls = [
      { x1: 0, y1: 0, x2: 100, y2: 0, thickness: 5 },
      { x1: 0, y1: 0, x2: 0, y2: 100, thickness: 5 },
    ]
    const drawings = [
      makeDrawing({ parsedWalls: walls }),
      makeDrawing({ id: 'id2', parsedWalls: [walls[0]] }),
    ]
    const result = sessionSummary(drawings, 0)
    expect(result.wallCount).toBe(3)
  })

  it('counts distinct floor levels from floorNumber field', () => {
    const drawings = [
      makeDrawing({ floorNumber: 0 }),
      makeDrawing({ id: 'id2', floorNumber: 1 }),
      makeDrawing({ id: 'id3', floorNumber: 1 }), // duplicate floor
      makeDrawing({ id: 'id4', floorNumber: 2 }),
    ]
    const result = sessionSummary(drawings, 0)
    expect(result.floorCount).toBe(3)
  })

  it('infers floor number from filename when floorNumber is null', () => {
    const drawings = [
      makeDrawing({ floorNumber: null, name: 'A-101.pdf' }),  // → floor 1
      makeDrawing({ id: 'id2', floorNumber: null, name: 'A-201.pdf' }), // → floor 2
    ]
    const result = sessionSummary(drawings, 0)
    expect(result.floorCount).toBe(2)
  })

  it('classifies scale confidence correctly', () => {
    const drawings = [
      makeDrawing({ scaleMmPerPx: 0.5, scaleNotation: '1:100' }),  // auto
      makeDrawing({ id: 'id2', scaleMmPerPx: 0.5, scaleNotation: null }),  // manual
      makeDrawing({ id: 'id3', scaleMmPerPx: null, scaleNotation: null }), // none
    ]
    const result = sessionSummary(drawings, 0)
    expect(result.scaleConfidenceDistribution).toEqual({ auto: 1, manual: 1, none: 1 })
  })

  it('records render time unchanged', () => {
    const result = sessionSummary([], 12345)
    expect(result.renderTimeMs).toBe(12345)
  })
})

// ─── buildPilotSnapshot ───────────────────────────────────────────────────────

describe('buildPilotSnapshot', () => {
  it('includes session summary fields in the CSV row', () => {
    const walls = [{ x1: 0, y1: 0, x2: 10, y2: 0, thickness: 3 }]
    const drawings = [
      makeDrawing({ floorNumber: 0, parsedWalls: walls, scaleMmPerPx: 0.5, scaleNotation: '1:100' }),
      makeDrawing({ id: 'id2', floorNumber: 1, parsedWalls: walls, scaleMmPerPx: 0.5, scaleNotation: null }),
      makeDrawing({ id: 'id3', floorNumber: 1, parsedWalls: [], scaleMmPerPx: null, scaleNotation: null }),
    ]
    const row = buildPilotSnapshot(drawings, 90000)
    expect(row.wall_count).toBe(2)
    expect(row.floor_count).toBe(2)
    expect(row.scale_confidence_auto).toBe(1)
    expect(row.scale_confidence_manual).toBe(1)
    expect(row.scale_confidence_none).toBe(1)
    expect(row.render_time_ms).toBe(90000)
    expect(row.time_to_usable_3d_min).toBe('1.50')
  })

  it('leaves time_to_usable_3d_min empty when renderTimeMs is 0', () => {
    const row = buildPilotSnapshot([], 0)
    expect(row.time_to_usable_3d_min).toBe('')
  })
})

// ─── serializePilotRows ───────────────────────────────────────────────────────

describe('serializePilotRows', () => {
  it('emits new columns in the header', () => {
    const csv = serializePilotRows([])
    expect(csv).toContain('wall_count')
    expect(csv).toContain('floor_count')
    expect(csv).toContain('scale_confidence_auto')
    expect(csv).toContain('scale_confidence_manual')
    expect(csv).toContain('scale_confidence_none')
    expect(csv).toContain('render_time_ms')
  })

  it('serializes a snapshot row with correct column order', () => {
    const drawings = [makeDrawing({ floorNumber: 0, scaleMmPerPx: 1.0, scaleNotation: '1:50' })]
    const row = buildPilotSnapshot(drawings, 5000)
    const csv = serializePilotRows([row])
    const lines = csv.split('\n')
    expect(lines).toHaveLength(2)
    const headers = lines[0].split(',')
    const values = lines[1].split(',')
    const wallCountIdx = headers.indexOf('wall_count')
    expect(wallCountIdx).toBeGreaterThan(-1)
    expect(values[wallCountIdx]).toBe('0') // no walls on this drawing
  })
})
