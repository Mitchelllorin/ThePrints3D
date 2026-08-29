import { describe, it, expect } from 'vitest'
import { nextSuggestion, type GCContext } from './generalContractor'
import type { Lesson } from './correctionLedger'

const base: GCContext = {
  hasPlan: true,
  status: 'ready',
  calibrationCleared: true,
  calibrationMode: false,
  hasFloor: true,
  hasWalls: false,
  userWallCount: 0,
  detectedScaleAvailable: false,
  detectedWallCount: 0,
  built: false,
  traceMode: false,
  tracePaused: false,
  activePanel: null,
}
const ctx = (over: Partial<GCContext>): GCContext => ({ ...base, ...over })

describe('nextSuggestion — busy gate (non-pushy)', () => {
  it('stays quiet with no plan', () => {
    expect(nextSuggestion(ctx({ hasPlan: false }))).toBeNull()
  })
  it('stays quiet while actively tracing', () => {
    expect(nextSuggestion(ctx({ traceMode: true, tracePaused: false }))).toBeNull()
  })
  it('speaks again when tracing is paused', () => {
    expect(nextSuggestion(ctx({ traceMode: true, tracePaused: true }))).not.toBeNull()
  })
  it('stays quiet during calibration', () => {
    expect(nextSuggestion(ctx({ calibrationMode: true }))).toBeNull()
  })
  it.each(['picker', 'object', 'wall', 'line', 'panelBoard'])('stays quiet while %s panel is open', (p) => {
    expect(nextSuggestion(ctx({ activePanel: p }))).toBeNull()
  })
  it('still speaks while browsing (catalog/layers/settings)', () => {
    expect(nextSuggestion(ctx({ activePanel: 'settings' }))).not.toBeNull()
  })
})

describe('nextSuggestion — decision tree (first match wins)', () => {
  it('processing → progress, no action', () => {
    const s = nextSuggestion(ctx({ status: 'processing' }))
    expect(s?.id).toBe('processing')
    expect(s?.actionKind).toBeUndefined()
  })
  it('uncalibrated WITH detected scale → useDetected', () => {
    const s = nextSuggestion(ctx({ calibrationCleared: false, detectedScaleAvailable: true }))
    expect(s?.id).toBe('useDetected')
    expect(s?.actionKind).toBe('useDetectedScale')
  })
  it('uncalibrated WITHOUT detected scale → calibrate', () => {
    const s = nextSuggestion(ctx({ calibrationCleared: false }))
    expect(s?.id).toBe('calibrate')
    expect(s?.actionKind).toBe('calibrate')
  })
  it('calibrated, no floor → does NOT nag about laying one', () => {
    // The old three-step wizard is gone, and this suggestion was its last piece:
    // load a preset and a card came across the workspace assigning you a floor
    // before you had looked at the plan. The rail names that gesture in the
    // section that performs it, so the G.C. stays out of it.
    const s = nextSuggestion(ctx({ hasFloor: false }))
    expect(s?.id).not.toBe('floor')
    expect(s?.actionKind).not.toBe('layFloor')
  })
  it('floor + detected walls, none traced → autoBuild', () => {
    const s = nextSuggestion(ctx({ hasWalls: true, detectedWallCount: 7 }))
    expect(s?.id).toBe('autoBuild')
    expect(s?.message).toContain('7')
  })
  it('floor + user-traced walls → offer to find the rest', () => {
    // Not "build" any more: walls stand as they are traced, so there is nothing
    // to build and no button to build it with. The useful offer at this exact
    // moment is the seed-guided one.
    const s = nextSuggestion(ctx({ hasWalls: true, userWallCount: 3 }))
    expect(s?.id).toBe('findRest')
    expect(s?.message).toContain('3 walls')
  })
  it('floor, no walls at all → trace', () => {
    expect(nextSuggestion(ctx({ hasWalls: false }))?.id).toBe('trace')
  })
  it('built beats trace/build (success, no action)', () => {
    const s = nextSuggestion(ctx({ built: true, userWallCount: 3, hasWalls: true }))
    expect(s?.id).toBe('built')
    expect(s?.tone).toBe('success')
    expect(s?.actionKind).toBeUndefined()
  })
  it('singular wall copy', () => {
    expect(nextSuggestion(ctx({ hasWalls: true, userWallCount: 1 }))?.message).toContain('1 wall traced')
  })
})

/**
 * A clean run of walls, all roughly the same order of length — a believable
 * reading of a real plan.
 */
function cleanWalls(n = 12) {
  return Array.from({ length: n }, (_, i) => ({
    x1: 0, y1: i * 10, x2: 400, y2: i * 10,
    detectionConfidence: 0.9, source: 'auto' as const,
  }))
}

/** Scraps: far shorter than the median, the way lettering and tick marks read. */
function stubs(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    x1: 0, y1: i * 3, x2: 6, y2: i * 3,
    detectionConfidence: 0.9, source: 'auto' as const,
  }))
}

const soundRead = {
  scaleConfidence: 'parsed' as const,
  scaleMmPerPx: 12.7,
  walls: cleanWalls(),
  roomCount: 6,
  openingCount: 9,
}

/**
 * A lesson is the only thing in the G.C.'s context the app could not have
 * worked out for itself — it is there because the user taught it, three
 * corrections ago. It is worth more than any step in the sequence below it.
 */
describe('the G.C. says what it has been taught', () => {
  const scaleLesson: Lesson = {
    id: 'lesson-scale',
    message: 'The whole sheet is reading small by about 50%.',
    actionLabel: 'Fix the scale',
    leverage: 100,
    body: { kind: 'scale', scaleMmPerPx: 10, factor: 2, samples: 3, agreement: 0.9 },
  }

  it('relays the lesson in the words the ledger wrote, with a button', () => {
    const s = nextSuggestion(ctx({ hasWalls: true, detectedWallCount: 40, lesson: scaleLesson }))
    expect(s?.id).toBe('lesson-scale')
    expect(s?.message).toBe(scaleLesson.message)
    expect(s?.actionKind).toBe('applyLesson')
  })

  it('outranks "your model is standing" — it is standing at the wrong size', () => {
    const s = nextSuggestion(ctx({ built: true, hasWalls: true, lesson: scaleLesson }))
    expect(s?.id).toBe('lesson-scale')
  })

  it('outranks the offer to build from walls we now know we misread', () => {
    const s = nextSuggestion(ctx({ hasWalls: true, detectedWallCount: 40, lesson: scaleLesson }))
    expect(s?.id).not.toBe('autoBuild')
  })

  it('a lesson with nothing to act on is still said, but gets no button', () => {
    const bias: Lesson = {
      id: 'lesson-detector-bias',
      message: "You've deleted 5 walls I found — I'll be stricter on the next sheet.",
      leverage: 50,
      body: { kind: 'detector-bias', bias: 'loose', added: 1, removed: 5 },
    }
    const s = nextSuggestion(ctx({ hasWalls: true, lesson: bias }))
    expect(s?.id).toBe('lesson-detector-bias')
    expect(s?.actionKind).toBeUndefined()
  })

  it('still says nothing at all while the user is working', () => {
    expect(nextSuggestion(ctx({ traceMode: true, lesson: scaleLesson }))).toBeNull()
  })

  it('leaves the scale question to the calibrate step, which comes first', () => {
    const s = nextSuggestion(ctx({ calibrationCleared: false, lesson: scaleLesson }))
    expect(s?.id).toBe('calibrate')
  })
})

describe('the G.C. raises its doubts before offering to build', () => {
  it('offers the build when the reading looks sound', () => {
    const s = nextSuggestion(ctx({ hasWalls: true, detectedWallCount: 12, detection: soundRead }))
    expect(s?.id).toBe('autoBuild')
  })

  it('behaves exactly as before when no reading is supplied', () => {
    const s = nextSuggestion(ctx({ hasWalls: true, detectedWallCount: 12 }))
    expect(s?.id).toBe('autoBuild')
  })

  it('raises the doubt instead of the offer when the read is a pile of scraps', () => {
    const walls = [...cleanWalls(10), ...stubs(10)]
    const s = nextSuggestion(
      ctx({
        hasWalls: true,
        detectedWallCount: walls.length,
        detection: { ...soundRead, walls, roomCount: 4 },
      }),
    )
    expect(s?.id).toBe('doubt-fragmented')
    // And it offers the corrective, not a build button.
    expect(s?.actionKind).toBe('trace')
  })

  it('raises the doubt when the detector itself is unsure', () => {
    const walls = cleanWalls(12).map((w, i) => ({
      ...w,
      detectionConfidence: i < 6 ? 0.2 : 0.9,
    }))
    const s = nextSuggestion(
      ctx({ hasWalls: true, detectedWallCount: walls.length, detection: { ...soundRead, walls } }),
    )
    expect(s?.id).toBe('doubt-confidence')
  })

  it('does not re-ask about scale — the calibrate step above owns that', () => {
    const s = nextSuggestion(
      ctx({
        hasWalls: true,
        detectedWallCount: 12,
        // Calibration already waved off, but the scale is still only a guess.
        calibrationCleared: true,
        detection: { ...soundRead, scaleConfidence: 'fallback', scaleMmPerPx: null },
      }),
    )
    expect(s?.id).not.toBe('doubt-scale')
    expect(s?.id).toBe('autoBuild')
  })

  it('still lets a traced wall take priority — the user is already working', () => {
    const walls = [...cleanWalls(10), ...stubs(10)]
    const s = nextSuggestion(
      ctx({
        hasWalls: true,
        userWallCount: 1,
        detectedWallCount: walls.length,
        detection: { ...soundRead, walls },
      }),
    )
    expect(s?.id).toBe('findRest')
  })
})
