import { describe, it, expect } from 'vitest'
import type { CorpusSheet, CorpusTruth } from './corpus'

/**
 * The corpus was designed as training data from the start — its own header says
 * "the pixels plus the segments ... is a labelled example". It was missing the
 * label: `detected` held the app's guess and nothing held the user's answer.
 */
describe('CorpusTruth', () => {
  it('carries geometry, not counts — a count cannot train anything', () => {
    const truth: CorpusTruth = {
      walls: [{ x1: 0, y1: 0, x2: 100, y2: 0, thickness: 6 }],
      userWallCount: 1,
      at: Date.now(),
    }
    expect(Array.isArray(truth.walls)).toBe(true)
    expect(truth.walls).toHaveLength(1)
  })

  it('sits alongside the guess rather than replacing it', () => {
    // Both halves are needed: the guess is what a model would have said, the
    // truth is what it should have said. Scoring needs the pair.
    const sheet = {
      id: 'abc', name: 'plan.png', capturedAt: 0, lastSeenAt: 0, seenCount: 1,
      raster: null, source: null, sourceName: '', sourceType: '',
      width: 800, height: 600,
      read: { scaleMmPerPx: null, scaleConfidence: null, wallCount: 3,
              roomCount: 0, openingCount: 0, symbolCount: 0, textCount: 0 },
      detected: { walls: [1, 2, 3], rooms: [], openings: [], symbols: [], text: [] },
      truth: { walls: [1, 2, 3, 4], userWallCount: 4, at: 1 },
    } satisfies CorpusSheet
    expect(sheet.detected?.walls).toHaveLength(3)
    expect(sheet.truth?.walls).toHaveLength(4)
  })

  it('is optional, so every sheet captured before this existed still loads', () => {
    // Annotated, not `satisfies`: `satisfies` narrows to the literal, and the
    // literal has no `truth` key, so reading `old.truth` — the entire point of
    // the test — is a type error. It passed under vitest, which does not
    // typecheck, and broke `npm run build`, which does.
    const old: CorpusSheet = {
      id: 'x', name: 'n', capturedAt: 0, lastSeenAt: 0, seenCount: 1,
      raster: null, source: null, sourceName: '', sourceType: '',
      width: 10, height: 10,
      read: { scaleMmPerPx: null, scaleConfidence: null, wallCount: 0,
              roomCount: 0, openingCount: 0, symbolCount: 0, textCount: 0 },
    } satisfies CorpusSheet
    expect(old.truth).toBeUndefined()
  })
})
