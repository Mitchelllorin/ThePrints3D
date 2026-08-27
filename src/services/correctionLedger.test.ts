import { describe, it, expect } from 'vitest'
import {
  appendCorrection,
  summarizeCorrections,
  deriveLessons,
  topLesson,
  LEDGER_CAP,
  type CorrectionRecord,
  type LessonContext,
} from './correctionLedger'
import { expectedFinishedMm } from './wallTypeClassifier'

const ctx: LessonContext = { scaleMmPerPx: 10, drywall: 'single-layer' }

let seq = 0
function rec(over: Partial<CorrectionRecord> = {}): CorrectionRecord {
  seq += 1
  return {
    id: `c${seq}`,
    at: 1_000 + seq,
    kind: 'wall-type',
    drawingId: 'd1',
    predicted: 'stud-2x4',
    actual: 'stud-2x6',
    ...over,
  }
}

/**
 * A wall-type correction as it would be recorded if the SCALE were off by
 * `factor`: the user's answer is the truth, and the pixels we measured are that
 * truth divided by the (wrong) scale we were reading at.
 */
function scaledCorrection(actual: string, factor: number, jitterPx = 0): CorrectionRecord {
  const trueMm = expectedFinishedMm(actual as never, 'single-layer') as number
  const px = trueMm / (ctx.scaleMmPerPx as number) / factor + jitterPx
  return rec({
    actual,
    predicted: 'stud-2x4',
    evidence: {
      thicknessPx: px,
      // What we concluded at the wrong scale — pixels × the scale in force.
      measuredMm: px * (ctx.scaleMmPerPx as number),
      scaleMmPerPx: ctx.scaleMmPerPx,
      drywall: 'single-layer',
    },
  })
}

/**
 * A correction as it would be recorded if the DRYWALL assumption were wrong by
 * `offsetMm`: the pixels are right at the current scale, we are just short a
 * constant number of millimetres on every wall regardless of its size.
 */
function offsetCorrection(actual: string, offsetMm: number): CorrectionRecord {
  const trueMm = expectedFinishedMm(actual as never, 'single-layer') as number
  const measuredMm = trueMm - offsetMm
  return rec({
    actual,
    predicted: 'stud-2x4',
    evidence: {
      thicknessPx: measuredMm / (ctx.scaleMmPerPx as number),
      measuredMm,
      scaleMmPerPx: ctx.scaleMmPerPx,
      drywall: 'single-layer',
    },
  })
}

describe('appendCorrection', () => {
  it('appends without mutating the ledger it was given', () => {
    const before: CorrectionRecord[] = [rec()]
    const after = appendCorrection(before, rec())
    expect(before).toHaveLength(1)
    expect(after).toHaveLength(2)
  })

  it('drops the oldest past the cap', () => {
    let ledger: CorrectionRecord[] = []
    for (let i = 0; i < LEDGER_CAP + 5; i++) ledger = appendCorrection(ledger, rec())
    expect(ledger).toHaveLength(LEDGER_CAP)
    // The first five are gone, the newest survives.
    expect(ledger[ledger.length - 1].id).toBe(`c${seq}`)
  })
})

describe('summarizeCorrections', () => {
  it('counts by kind, by drawing, and flags confident misses', () => {
    const s = summarizeCorrections([
      rec({ confidence: 0.95 }),
      rec({ kind: 'wall-removed', confidence: 0.4 }),
      rec({ kind: 'wall-removed', drawingId: 'd2', confidence: 0.8 }),
    ])
    expect(s.total).toBe(3)
    expect(s.byKind['wall-type']).toBe(1)
    expect(s.byKind['wall-removed']).toBe(2)
    expect(s.confidentlyWrong).toBe(2)
    expect(s.drawingsTouched).toBe(2)
  })

  it('is empty-safe', () => {
    const s = summarizeCorrections([])
    expect(s.total).toBe(0)
    expect(s.byKind.scale).toBe(0)
    expect(s.drawingsTouched).toBe(0)
  })
})

describe('deriveLessons — the systematic mistake', () => {
  it('says nothing until enough corrections agree', () => {
    const two = [scaledCorrection('stud-2x6', 1.4), scaledCorrection('stud-2x8', 1.4)]
    expect(deriveLessons(two, ctx)).toEqual([])
  })

  it('recovers the true scale from corrections of DIFFERENT wall sizes', () => {
    const records = [
      scaledCorrection('stud-2x4', 1.4),
      scaledCorrection('stud-2x6', 1.4),
      scaledCorrection('stud-2x8', 1.4),
      scaledCorrection('stud-2x12', 1.4),
    ]
    const lesson = topLesson(records, ctx)
    expect(lesson?.body.kind).toBe('scale')
    if (lesson?.body.kind !== 'scale') throw new Error('expected a scale lesson')
    // We were reading small by 1.4x, so the real scale is 1.4x the one in force.
    expect(lesson.body.factor).toBeCloseTo(1.4, 2)
    expect(lesson.body.scaleMmPerPx).toBeCloseTo(14, 1)
    expect(lesson.body.samples).toBe(4)
    expect(lesson.body.agreement).toBeGreaterThan(0.9)
  })

  it('calls a CONSTANT millimetre error the drywall assumption, not the scale', () => {
    // Off by 32mm on every wall, whatever its size — one layer of board a side.
    const records = [
      offsetCorrection('stud-2x4', 32),
      offsetCorrection('stud-2x6', 32),
      offsetCorrection('stud-2x8', 32),
      offsetCorrection('stud-2x12', 32),
    ]
    const lesson = topLesson(records, ctx)
    expect(lesson?.body.kind).toBe('drywall')
    if (lesson?.body.kind !== 'drywall') throw new Error('expected a drywall lesson')
    expect(lesson.body.offsetMm).toBeCloseTo(32, 0)
    // We assumed one layer and are 32mm short: the sheet carries two.
    expect(lesson.body.suggested).toBe('double-layer')
  })

  it('stays quiet when the corrections disagree with each other', () => {
    // Each correction implies a wildly different scale — a user fixing walls for
    // unrelated reasons, not one systematic error.
    const records = [
      scaledCorrection('stud-2x4', 1.1),
      scaledCorrection('stud-2x6', 1.9),
      scaledCorrection('stud-2x8', 0.7),
      scaledCorrection('stud-2x12', 1.5),
    ]
    expect(deriveLessons(records, ctx).filter((l) => l.body.kind === 'scale')).toEqual([])
  })

  it('ignores an error small enough to be our own measurement noise', () => {
    const records = [
      scaledCorrection('stud-2x4', 1.02),
      scaledCorrection('stud-2x6', 1.02),
      scaledCorrection('stud-2x8', 1.02),
    ]
    expect(deriveLessons(records, ctx).filter((l) => l.body.kind === 'scale')).toEqual([])
  })

  it('survives pixel jitter in the thickness measurement', () => {
    const records = [
      scaledCorrection('stud-2x4', 1.4, 0.4),
      scaledCorrection('stud-2x6', 1.4, -0.4),
      scaledCorrection('stud-2x8', 1.4, 0.3),
      scaledCorrection('stud-2x12', 1.4, -0.2),
    ]
    const lesson = topLesson(records, ctx)
    expect(lesson?.body.kind).toBe('scale')
  })

  it('skips records with no pixel evidence to measure against', () => {
    const records = [rec(), rec(), rec(), rec()]
    expect(deriveLessons(records, ctx)).toEqual([])
  })

  it('reads repeated deletions as a detector that is too loose', () => {
    const records = [
      rec({ kind: 'wall-removed', predicted: 'stud-2x4', actual: 'not-a-wall' }),
      rec({ kind: 'wall-removed', predicted: 'stud-2x4', actual: 'not-a-wall' }),
      rec({ kind: 'wall-removed', predicted: 'stud-2x4', actual: 'not-a-wall' }),
      rec({ kind: 'wall-added', predicted: null, actual: 'stud-2x4' }),
    ]
    const lesson = topLesson(records, ctx)
    expect(lesson?.body.kind).toBe('detector-bias')
    if (lesson?.body.kind !== 'detector-bias') throw new Error('expected a bias lesson')
    expect(lesson.body.bias).toBe('loose')
    expect(lesson.body.removed).toBe(3)
  })

  it('reads repeated traces as a detector that is too strict', () => {
    const records = [
      rec({ kind: 'wall-added', predicted: null, actual: 'stud-2x4' }),
      rec({ kind: 'wall-added', predicted: null, actual: 'stud-2x4' }),
      rec({ kind: 'wall-added', predicted: null, actual: 'stud-2x6' }),
    ]
    const lesson = topLesson(records, ctx)
    if (lesson?.body.kind !== 'detector-bias') throw new Error('expected a bias lesson')
    expect(lesson.body.bias).toBe('strict')
  })

  it('puts the scale ahead of the detector bias when both are true', () => {
    const records = [
      scaledCorrection('stud-2x4', 1.4),
      scaledCorrection('stud-2x6', 1.4),
      scaledCorrection('stud-2x8', 1.4),
      rec({ kind: 'wall-removed', predicted: 'stud-2x4', actual: 'not-a-wall' }),
      rec({ kind: 'wall-removed', predicted: 'stud-2x4', actual: 'not-a-wall' }),
      rec({ kind: 'wall-removed', predicted: 'stud-2x4', actual: 'not-a-wall' }),
    ]
    const lessons = deriveLessons(records, ctx)
    expect(lessons.map((l) => l.body.kind)).toEqual(['scale', 'detector-bias'])
  })

  it('is empty-safe', () => {
    expect(deriveLessons([], ctx)).toEqual([])
    expect(topLesson([], ctx)).toBeNull()
  })
})
