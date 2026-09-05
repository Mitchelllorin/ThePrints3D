/**
 * WHAT WE LEARNED, WITHOUT THE DRAWING WE LEARNED IT FROM.
 *
 * The app promises, in the store listing and the privacy policy and on the
 * marketing site, that your drawings never leave your device. That promise is
 * the reason a tradesperson can put a client's permit set through it at all, so
 * it is not up for quiet renegotiation — and it rules out shipping rasters
 * anywhere, which is what training a pixel model would want.
 *
 * But the raster is not the only thing worth having. When someone corrects a
 * 2x4 to a 2x6 they have told us something about OUR READING — that the thing
 * we measured as 121mm across is really 172mm — and that fact is a number, not
 * a picture. Pooled across many prints, numbers like these are exactly what
 * tonight's threshold sweep showed is missing: the detector's constants are
 * fragile precisely because nobody has ever seen how they perform in the field.
 *
 * So this exports the UNDERSTANDING and leaves the drawing at home.
 *
 * WHAT GOES IN: only measurements of the print as a signal — its size, its ink,
 * its stroke width, how confident we were, and how wrong we turned out to be.
 *
 * WHAT NEVER GOES IN, deliberately:
 *   - the raster or the source file, in any form, at any resolution
 *   - the file name, which is routinely a client's name or a site address
 *   - any recognised text, including room labels — 'KITCHEN' is harmless and
 *     'SMITH RESIDENCE' is not, and telling them apart reliably is not a bet
 *     worth taking
 *   - wall coordinates, which are the floor plan itself
 *
 * The sheet id is a hash of the pixels, so it is stable enough to deduplicate
 * and useless for reconstructing anything.
 *
 * Even this leaves the device only if the user asks. Nothing here uploads.
 */

import type { CorpusSheet, CorpusCorrection } from './corpus'

/** One print's worth of "how did we do", with no way back to the print. */
export interface LessonRecord {
  /** Hash of the pixels. Deduplicates; reconstructs nothing. */
  sheetId: string
  /** Reading-space size — a shape, not a drawing. */
  width: number
  height: number
  /** How many times this print has been through the app. */
  seenCount: number
  scaleMmPerPx: number | null
  scaleConfidence: string | null
  /** What we read off it. Counts only. */
  detectedWalls: number
  detectedRooms: number
  detectedOpenings: number
  /** What the user then had to fix, by kind. */
  correctionsByKind: Record<string, number>
  /** How sure we were, averaged, while being wrong. High values are expensive. */
  meanConfidenceWhenWrong: number | null
  /** Did the user leave their own reading behind, and how much of it. */
  userWallCount: number | null
}

export interface LessonExport {
  version: 1
  exportedAt: number
  /** Stated in the payload so a reader never has to infer it. */
  contains: string
  excludes: string[]
  records: LessonRecord[]
}

/**
 * Build the privacy-preserving export.
 *
 * Pure: sheets and corrections in, plain object out. No storage, no clock of
 * its own, no upload — the caller decides all three.
 */
export function buildLessonExport(
  sheets: CorpusSheet[],
  corrections: CorpusCorrection[],
  now: number,
): LessonExport {
  const bySheet = new Map<string, CorpusCorrection[]>()
  for (const c of corrections) {
    const list = bySheet.get(c.sheetId) ?? []
    list.push(c)
    bySheet.set(c.sheetId, list)
  }

  const records = sheets.map((s): LessonRecord => {
    const mine = bySheet.get(s.id) ?? []
    const correctionsByKind: Record<string, number> = {}
    let confSum = 0
    let confCount = 0
    for (const c of mine) {
      const kind = String((c as { kind?: string }).kind ?? 'unknown')
      correctionsByKind[kind] = (correctionsByKind[kind] ?? 0) + 1
      const conf = (c as { confidence?: number }).confidence
      if (typeof conf === 'number' && Number.isFinite(conf)) { confSum += conf; confCount++ }
    }
    return {
      sheetId: s.id,
      width: s.width,
      height: s.height,
      seenCount: s.seenCount,
      scaleMmPerPx: s.read.scaleMmPerPx,
      scaleConfidence: s.read.scaleConfidence,
      detectedWalls: s.read.wallCount,
      detectedRooms: s.read.roomCount,
      detectedOpenings: s.read.openingCount,
      correctionsByKind,
      meanConfidenceWhenWrong: confCount > 0 ? confSum / confCount : null,
      userWallCount: s.truth?.userWallCount ?? null,
    }
  })

  return {
    version: 1,
    exportedAt: now,
    contains: 'measurements of how the reading performed — sizes, counts, confidences',
    excludes: [
      'the raster or source file, in any form',
      'the file name',
      'any recognised text, including room labels',
      'wall coordinates',
    ],
    records,
  }
}
