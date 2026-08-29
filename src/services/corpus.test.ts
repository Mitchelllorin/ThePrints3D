/**
 * The corpus has one job it cannot be allowed to fail at, and one it cannot be
 * allowed to do: it must recognise a print it has seen before, and it must never
 * throw into the app that is trying to get a job done.
 *
 * There is no IndexedDB in the node runner, which makes this the exact
 * environment the defensive path exists for — every write here goes down the
 * "storage is unavailable" branch, and the test asserts it comes back quietly
 * rather than taking the workspace with it.
 */
import { describe, it, expect } from 'vitest'
import {
  sheetIdFor,
  corpusAvailable,
  captureSheet,
  rememberCorrections,
  correctionsForSheet,
  listSheets,
  corpusStats,
  exportCorpus,
  forgetEverything,
} from './corpus'
import type { CorrectionRecord } from './correctionLedger'

const bytes = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer

describe('a sheet is identified by its own pixels', () => {
  it('gives the same print the same id every time', async () => {
    const a = await sheetIdFor(bytes('the same raster'))
    const b = await sheetIdFor(bytes('the same raster'))
    expect(a).toBe(b)
  })

  it('tells two different prints apart', async () => {
    const a = await sheetIdFor(bytes('sheet A1 — ground floor plan'))
    const b = await sheetIdFor(bytes('sheet A2 — second floor plan'))
    expect(a).not.toBe(b)
  })

  it('is a short hex string, whatever the print is', async () => {
    const small = await sheetIdFor(bytes('x'))
    const large = await sheetIdFor(bytes('y'.repeat(200_000)))
    for (const id of [small, large]) {
      expect(id).toMatch(/^[0-9a-f]+$/)
      expect(id.length).toBeLessThanOrEqual(32)
    }
  })
})

describe('storage that is not there takes nothing down with it', () => {
  const record: CorrectionRecord = {
    id: 'corr-1',
    at: Date.now(),
    kind: 'wall-type',
    drawingId: 'd1',
    predicted: 'stud-2x4',
    actual: 'stud-2x6',
    confidence: 0.8,
    evidence: { thicknessPx: 12 },
  }

  it('knows it has nowhere to write', () => {
    expect(corpusAvailable()).toBe(false)
  })

  it('captures nothing and says so, rather than throwing', async () => {
    await expect(
      captureSheet({
        name: 'plan.pdf',
        raster: new Blob(['raster bytes']),
        source: new Blob(['pdf bytes']),
        sourceName: 'plan.pdf',
        width: 1200,
        height: 900,
        read: {
          scaleMmPerPx: 5,
          scaleConfidence: 'inferred',
          wallCount: 3,
          roomCount: 0,
          openingCount: 0,
          symbolCount: 0,
          textCount: 0,
        },
      }),
    ).resolves.toBeNull()
  })

  it('reads and writes corrections without complaint', async () => {
    await expect(rememberCorrections('sheet1', [record])).resolves.toBe(0)
    await expect(correctionsForSheet('sheet1')).resolves.toEqual([])
  })

  it('reports an empty corpus rather than an error', async () => {
    await expect(listSheets()).resolves.toEqual([])
    await expect(corpusStats()).resolves.toEqual({ sheets: 0, corrections: 0, bytes: 0 })
  })

  it('still exports a well-formed, empty file', async () => {
    const parsed = JSON.parse(await exportCorpus())
    expect(parsed.version).toBe(1)
    expect(parsed.sheets).toEqual([])
    expect(parsed.corrections).toEqual([])
  })

  it('can always be told to forget everything', async () => {
    await expect(forgetEverything()).resolves.toBeUndefined()
  })
})
