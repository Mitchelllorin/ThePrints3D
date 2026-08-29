/**
 * The ledger is only worth anything if the app actually writes to it.
 *
 * `detectionReview` and the old `exportCorrectionDataset` were both written,
 * both sensible, and both wired to nothing — so this test drives the REAL store
 * actions a user's taps go through, not the pure module underneath them, and
 * checks that a correction comes out the other side with its evidence intact and
 * a lesson drawn from it.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

/**
 * The store reaches pdf.js through the processor, and pdf.js touches DOMMatrix
 * at import time — which does not exist in a node test. Nothing here rasterizes
 * anything, so stub the module out rather than drag a DOM in for it.
 */
vi.mock('../services/pdfRasterizer', () => ({
  rasterizePDF: vi.fn(),
  rasterizeImage: vi.fn(),
  rasterizeFile: vi.fn(),
}))

import { useAppStore } from './useAppStore'
import type { Drawing, ParsedWall, WallType, DetectedWallType } from '../types'

const s = () => useAppStore.getState()

/** The usage types the correction picker offers, with their finished thicknesses. */
const EXT: WallType = {
  id: 'EXT', name: 'Exterior', thicknessMm: 250, layers: [],
  loadBearing: true, usage: 'exterior', markupTag: 'EXT', color: '#94a3b8',
}
const INT: WallType = {
  id: 'INT', name: 'Interior', thicknessMm: 120, layers: [],
  loadBearing: false, usage: 'interior', markupTag: 'INT', color: '#e2e8f0',
}
const PT: WallType = {
  id: 'PT', name: 'Partition', thicknessMm: 75, layers: [],
  loadBearing: false, usage: 'partition', markupTag: 'PT', color: '#f1f5f9',
}

/**
 * A sheet read at HALF its true scale: every wall measured half the millimetres
 * it really is, which is exactly the failure the ledger exists to catch.
 */
const SCALE_IN_FORCE = 5
const TRUE_FACTOR = 2

function wallFor(type: WallType, x: number): ParsedWall {
  // Pixels are the truth: the wall really is thicknessMm across, and at the
  // scale in force we will read half that.
  const thickness = type.thicknessMm / (SCALE_IN_FORCE * TRUE_FACTOR)
  return {
    x1: x, y1: 0, x2: x, y2: 400,
    thickness,
    source: 'auto',
    detectionConfidence: 0.8,
    finishedMm: thickness * SCALE_IN_FORCE,
  }
}

const WALLS = [wallFor(EXT, 10), wallFor(INT, 20), wallFor(PT, 30)]

function drawing(): Drawing {
  return {
    id: 'd1',
    name: 'plan.pdf',
    type: 'floor_plan',
    status: 'ready',
    file: new File([], 'plan.pdf'),
    parsedWalls: [...WALLS],
    parsedRooms: [],
    parsedOpenings: [],
    parsedText: [],
    parsedSymbols: [],
    parsedAnnotationCandidates: [],
    parseProgress: 100,
    scaleMmPerPx: SCALE_IN_FORCE,
    scaleConfidence: 'inferred',
  } as unknown as Drawing
}

const detected: DetectedWallType[] = WALLS.map((w) => ({
  wallId: `${w.x1},${w.y1}`,
  // The app's wrong answer: everything read as the thinnest type, because every
  // measurement came out half size.
  wallType: PT,
  confidence: 0.8,
  fromSeed: false,
}))

beforeEach(() => {
  useAppStore.setState({
    drawings: [drawing()],
    selectedDrawingId: 'd1',
    detectedWallTypes: detected.map((d) => ({ ...d })),
    projectWallTypes: [EXT, INT, PT],
    corrections: [],
    correctionCount: 0,
  })
})

describe('correctElement writes the mistake down', () => {
  it('records what we said, what the user said, and the pixels behind it', () => {
    s().correctElement('10,0', 'EXT')

    const [rec] = s().corrections
    expect(s().corrections).toHaveLength(1)
    expect(rec.kind).toBe('wall-type')
    expect(rec.drawingId).toBe('d1')
    expect(rec.predicted).toBe('PT')
    expect(rec.actual).toBe('EXT')
    expect(rec.confidence).toBe(0.8)
    // The measurement, not just the verdict.
    expect(rec.evidence?.thicknessPx).toBeCloseTo(WALLS[0].thickness, 6)
    expect(rec.evidence?.actualFinishedMm).toBe(250)
    expect(rec.evidence?.scaleMmPerPx).toBe(SCALE_IN_FORCE)
    expect(rec.evidence?.scaleConfidence).toBe('inferred')
  })

  it('still applies the correction to the model', () => {
    s().correctElement('10,0', 'EXT')
    expect(s().detectedWallTypes[0].wallType.id).toBe('EXT')
    expect(s().correctionCount).toBe(1)
  })

  it('finds the scale error hiding under three individual fixes', () => {
    expect(s().correctionLessons()).toEqual([])

    s().correctElement('10,0', 'EXT')
    s().correctElement('20,0', 'INT')
    s().correctElement('30,0', 'PT')

    const lesson = s().correctionLessons()[0]
    expect(lesson?.body.kind).toBe('scale')
    if (lesson?.body.kind !== 'scale') throw new Error('expected a scale lesson')
    // Reading half size, so the sheet is really at twice the scale in force.
    expect(lesson.body.factor).toBeCloseTo(TRUE_FACTOR, 2)
    expect(lesson.body.scaleMmPerPx).toBeCloseTo(SCALE_IN_FORCE * TRUE_FACTOR, 2)
    expect(lesson.body.samples).toBe(3)
  })
})

describe('setDrawingScale writes the mistake down', () => {
  it('records the old scale against the one the user calibrated', () => {
    s().setDrawingScale('d1', 12.7, '1/4" = 1\'-0"')
    const [rec] = s().corrections
    expect(rec.kind).toBe('scale')
    expect(rec.predicted).toBe(String(SCALE_IN_FORCE))
    expect(rec.actual).toBe('12.7')
    expect(s().drawings[0].scaleMmPerPx).toBe(12.7)
  })

  it('says nothing when the scale did not actually change', () => {
    s().setDrawingScale('d1', SCALE_IN_FORCE, 'same')
    expect(s().corrections).toHaveLength(0)
  })
})

/**
 * The lesson was always only half the job: the app could say "the whole sheet is
 * reading small by 50%" and then leave the user to go and fix it themselves. So
 * these drive the other half — the tap that puts the lesson into force.
 */
/**
 * The ledger used to die with the tab, so every record in it was from the sheet
 * on screen. Now that corrections are kept across sessions (see `corpus`) the
 * store holds work from every print the user has ever corrected, and a scale
 * fitted across all of them is a scale belonging to none of them.
 */
describe('a lesson is about one sheet', () => {
  /** A second print, drawn at a scale that has nothing to do with the first. */
  function addSecondSheet() {
    useAppStore.setState((st) => ({
      drawings: [
        ...st.drawings,
        { ...st.drawings[0], id: 'd2', name: 'other.pdf', scaleMmPerPx: 40 },
      ],
    }))
  }

  it('ignores corrections made on a different print', () => {
    addSecondSheet()
    // Three corrections, all on the OTHER sheet.
    useAppStore.setState({ selectedDrawingId: 'd2' })
    s().correctElement('10,0', 'EXT')
    s().correctElement('20,0', 'INT')
    s().correctElement('30,0', 'PT')
    expect(s().corrections).toHaveLength(3)
    expect(s().corrections.every((c) => c.drawingId === 'd2')).toBe(true)

    // Back on the first sheet, which nobody has corrected: nothing to say.
    useAppStore.setState({ selectedDrawingId: 'd1' })
    expect(s().correctionLessons()).toEqual([])
  })

  it('still counts the detector bias across every sheet', () => {
    // Being loose with hatching is a habit of the detector, not a property of
    // one print, and the message promises to carry it to the next sheet.
    useAppStore.setState({
      corrections: [
        { id: 'r1', at: 1, kind: 'wall-removed', drawingId: 'd2', predicted: 'stud-2x4', actual: 'none', confidence: 0.5 },
        { id: 'r2', at: 2, kind: 'wall-removed', drawingId: 'd2', predicted: 'stud-2x4', actual: 'none', confidence: 0.5 },
        { id: 'r3', at: 3, kind: 'wall-removed', drawingId: 'd9', predicted: 'stud-2x4', actual: 'none', confidence: 0.5 },
      ],
    })
    const lesson = s().correctionLessons()[0]
    expect(lesson?.body.kind).toBe('detector-bias')
  })
})

describe('mergeCorrections takes back what the sheet already taught us', () => {
  /** What the corpus hands back: the right answers, under LAST session's ids. */
  const stored = [
    { id: 'old-1', at: 1, kind: 'wall-type' as const, drawingId: 'gone-2151', predicted: 'PT', actual: 'EXT', confidence: 0.8,
      evidence: { thicknessPx: 25, actualFinishedMm: 250 } },
    { id: 'old-2', at: 2, kind: 'wall-type' as const, drawingId: 'gone-2151', predicted: 'PT', actual: 'INT', confidence: 0.8,
      evidence: { thicknessPx: 12, actualFinishedMm: 120 } },
    { id: 'old-3', at: 3, kind: 'wall-type' as const, drawingId: 'gone-2151', predicted: 'PT', actual: 'PT', confidence: 0.8,
      evidence: { thicknessPx: 7.5, actualFinishedMm: 75 } },
  ]

  it('restamps them onto the drawing this session is calling it', () => {
    expect(s().mergeCorrections(stored, 'd1')).toBe(3)
    expect(s().corrections.every((c) => c.drawingId === 'd1')).toBe(true)
  })

  it('teaches the lesson again without the user tapping anything', () => {
    s().mergeCorrections(stored, 'd1')
    const lesson = s().correctionLessons()[0]
    // Same half-scale sheet, same conclusion — from a previous session's work.
    expect(lesson?.body.kind).toBe('scale')
    if (lesson?.body.kind !== 'scale') throw new Error('expected a scale lesson')
    expect(lesson.body.factor).toBeCloseTo(TRUE_FACTOR, 2)
  })

  it('can be handed the same set repeatedly without stacking it up', () => {
    s().mergeCorrections(stored, 'd1')
    s().mergeCorrections(stored, 'd1')
    s().mergeCorrections(stored, 'd1')
    expect(s().corrections).toHaveLength(3)
  })
})

describe('applyTopLesson acts on what the corrections taught it', () => {
  /** Three fixes on three different walls: a scale error, not three mistakes. */
  function teachIt() {
    s().correctElement('10,0', 'EXT')
    s().correctElement('20,0', 'INT')
    s().correctElement('30,0', 'PT')
  }

  it('puts the corrected scale on the drawing', () => {
    teachIt()
    const applied = s().applyTopLesson()

    expect(applied?.body.kind).toBe('scale')
    expect(s().drawings[0].scaleMmPerPx).toBeCloseTo(SCALE_IN_FORCE * TRUE_FACTOR, 2)
    // Arithmetic on the user's own answers outranks a scale note read off paper.
    expect(s().drawings[0].scaleConfidence).toBe('parsed')
  })

  it('re-reads every wall on the sheet, not just the ones they tapped', () => {
    teachIt()
    // Half size, so the 250mm exterior wall was being called a 2x4.
    expect(s().drawings[0].parsedWalls[0].finishedMm).toBeCloseTo(125, 1)

    s().applyTopLesson()

    const [ext, int, pt] = s().drawings[0].parsedWalls
    expect(ext.finishedMm).toBeCloseTo(250, 1)
    expect(ext.wallType).toBe('stud-2x10')
    expect(int.finishedMm).toBeCloseTo(120, 1)
    expect(int.wallType).toBe('stud-2x4')
    expect(pt.wallType).toBe('partition-thin')
  })

  it('does not write a correction of its own', () => {
    teachIt()
    expect(s().corrections).toHaveLength(3)

    s().applyTopLesson()

    // Going through `setDrawingScale` here would log a fourth correction — the
    // app marking its own homework, and the next lesson derived partly from its
    // own inference.
    expect(s().corrections).toHaveLength(3)
    expect(s().corrections.every((c) => c.kind === 'wall-type')).toBe(true)
  })

  it('leaves a wall the user traced exactly as they drew it', () => {
    useAppStore.setState((st) => {
      const d = st.drawings[0]
      return {
        drawings: [
          {
            ...d,
            parsedWalls: [
              ...d.parsedWalls,
              { ...wallFor(EXT, 40), source: 'user' as const, wallType: 'stud-2x6' as const },
            ],
          },
        ],
      }
    })
    teachIt()

    s().applyTopLesson()

    const traced = s().drawings[0].parsedWalls[3]
    expect(traced.source).toBe('user')
    expect(traced.wallType).toBe('stud-2x6')
    expect(traced.finishedMm).toBeCloseTo(125, 1)
  })

  it('goes quiet once the lesson is in force', () => {
    teachIt()
    expect(s().correctionLessons()).not.toEqual([])

    s().applyTopLesson()

    // Nothing marks it "done": the corrections now agree with the scale in
    // force, so there is no systematic error left to find.
    expect(s().correctionLessons()).toEqual([])
  })

  it('says nothing to apply when there is no lesson', () => {
    expect(s().applyTopLesson()).toBeNull()
    expect(s().drawings[0].scaleMmPerPx).toBe(SCALE_IN_FORCE)
  })
})

describe('exportCorrectionDataset exports the pairs, not our own answers', () => {
  it('carries predicted-vs-actual through to the file', () => {
    s().correctElement('10,0', 'EXT')
    const parsed = JSON.parse(s().exportCorrectionDataset())
    expect(parsed.version).toBe(2)
    expect(parsed.summary.total).toBe(1)
    expect(parsed.corrections[0].predicted).toBe('PT')
    expect(parsed.corrections[0].actual).toBe('EXT')
  })
})
