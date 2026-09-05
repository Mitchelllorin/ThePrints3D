import { describe, it, expect } from 'vitest'
import { buildLessonExport } from './lessonExport'
import type { CorpusSheet, CorpusCorrection } from './corpus'

const sheet = (over: Partial<CorpusSheet> = {}): CorpusSheet => ({
  id: 'hash-abc', name: 'SMITH RESIDENCE - 42 Elm St.pdf',
  capturedAt: 0, lastSeenAt: 0, seenCount: 2,
  raster: new Blob(['pixels']), source: new Blob(['pdf']),
  sourceName: 'SMITH RESIDENCE - 42 Elm St.pdf', sourceType: 'application/pdf',
  width: 800, height: 600,
  read: { scaleMmPerPx: 12.5, scaleConfidence: 'inferred', wallCount: 20,
          roomCount: 5, openingCount: 3, symbolCount: 1, textCount: 40 },
  detected: { walls: [{ x1: 1, y1: 2, x2: 3, y2: 4 }], rooms: [], openings: [], symbols: [], text: ['KITCHEN'] },
  truth: { walls: [{ x1: 9, y1: 9, x2: 9, y2: 9 }], userWallCount: 7, at: 0 },
  ...over,
} as CorpusSheet)

const correction = (kind: string, confidence?: number): CorpusCorrection =>
  ({ id: Math.random().toString(), sheetId: 'hash-abc', at: 0, kind,
     drawingId: 'd', predicted: 'stud-2x4', actual: 'stud-2x6', confidence } as unknown as CorpusCorrection)

describe('buildLessonExport — keeps the promise', () => {
  const out = buildLessonExport([sheet()], [correction('wall-type', 0.9), correction('wall-type', 0.7), correction('scale')], 1234)
  const json = JSON.stringify(out)

  it('never carries the drawing, at any resolution', () => {
    expect(json).not.toContain('pixels')
    expect(json.toLowerCase()).not.toContain('dataurl')
    expect(json.toLowerCase()).not.toContain('base64')
  })

  it('never carries the file name — routinely a client or a site address', () => {
    expect(json).not.toContain('SMITH')
    expect(json).not.toContain('Elm')
  })

  it('never carries recognised text, room labels included', () => {
    // 'KITCHEN' is harmless; telling it apart from a client's name reliably is
    // not a bet worth taking, so no text goes at all.
    expect(json).not.toContain('KITCHEN')
  })

  it('never carries wall coordinates — those are the floor plan itself', () => {
    expect(json).not.toContain('x1')
  })

  it('does carry how wrong we were, which is the point', () => {
    const r = out.records[0]
    expect(r.correctionsByKind['wall-type']).toBe(2)
    expect(r.correctionsByKind['scale']).toBe(1)
    expect(r.detectedWalls).toBe(20)
    expect(r.scaleConfidence).toBe('inferred')
  })

  it('records how sure we were while being wrong — the expensive mistakes', () => {
    expect(out.records[0].meanConfidenceWhenWrong).toBeCloseTo(0.8, 5)
  })

  it('records that the user left an answer, without the answer itself', () => {
    expect(out.records[0].userWallCount).toBe(7)
    expect(json).not.toContain('"walls"')
  })

  it('states in the payload what it excludes, so a reader need not infer it', () => {
    expect(out.excludes.join(' ')).toContain('raster')
    expect(out.excludes.join(' ')).toContain('file name')
  })

  it('handles a sheet nobody has corrected', () => {
    const clean = buildLessonExport([sheet()], [], 0)
    expect(clean.records[0].correctionsByKind).toEqual({})
    expect(clean.records[0].meanConfidenceWhenWrong).toBeNull()
  })
})
