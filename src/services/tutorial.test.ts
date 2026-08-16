import { describe, it, expect } from 'vitest'
import { TUTORIAL_STEPS, tutorialAdvance, clampStep, type TutorialContext } from './tutorial'

const EMPTY: TutorialContext = {
  hasPlan: false,
  calibrationCleared: false,
  userWallCount: 0,
  totalWallCount: 0,
  hasFloor: false,
  hasRoof: false,
  built: false,
  openingCount: 0,
  plumbingCount: 0,
  electricalCount: 0,
}

describe('tutorial script', () => {
  it('covers the full house build in order', () => {
    const ids = TUTORIAL_STEPS.map((s) => s.id)
    expect(ids).toEqual([
      // ONE line of orientation, then work. Four talking steps up front was
      // three too many, and "lock the scale" told presets to do nothing.
      'welcome', 'calibrate',
      'floor', 'wall', 'findRest',
      'build', 'roof', 'openings', 'plumbing', 'electrical', 'takeoff',
    ])
  })

  it('every step has teaching copy, and any hint it carries says something', () => {
    for (const s of TUTORIAL_STEPS) {
      expect(s.title.length).toBeGreaterThan(0)
      expect(s.body.length).toBeGreaterThan(0)
      // The hint is optional — a spotlit step does not need prose repeating
      // what the ring is already pointing at. But an empty string is a mistake
      // rather than a choice, so it is not allowed to sit there blank.
      if (s.hint !== undefined) expect(s.hint.length).toBeGreaterThan(0)
    }
  })

  it('keeps the copy short enough to read standing over a phone', () => {
    // Long paragraphs get skipped whole. This is a ceiling, not a target.
    for (const s of TUTORIAL_STEPS) {
      expect(s.body.length).toBeLessThanOrEqual(180)
    }
  })

  it('clampStep keeps the index in range', () => {
    expect(clampStep(-5)).toBe(0)
    expect(clampStep(999)).toBe(TUTORIAL_STEPS.length - 1)
    expect(clampStep(3)).toBe(3)
  })

  it('auto-advances a step once its goal is met', () => {
    // The floor step: not done with no floor, done + advances once one is laid.
    // Found by id rather than index so re-ordering the script does not break a
    // test about auto-advance.
    const i = TUTORIAL_STEPS.findIndex((s) => s.id === 'floor')
    expect(tutorialAdvance(i, EMPTY)).toEqual({ done: false, nextIndex: null })
    expect(tutorialAdvance(i, { ...EMPTY, hasFloor: true })).toEqual({ done: true, nextIndex: i + 1 })
  })

  it('a step with nothing to detect carries its own timer out', () => {
    // Every other step advances when the user DOES the thing. The opening line
    // has no such signal, so without a timer it waits forever on a Next the
    // user may never spot — the tour looks hung on its own first sentence.
    for (const s of TUTORIAL_STEPS) {
      const isTerminal = s === TUTORIAL_STEPS[TUTORIAL_STEPS.length - 1]
      const detectable = s.done({
        ...EMPTY, hasPlan: true, calibrationCleared: true, hasFloor: true, hasRoof: true,
        built: true, openingCount: 1, plumbingCount: 1, electricalCount: 1,
        userWallCount: 1, totalWallCount: 9,
      })
      if (!detectable && !isTerminal) {
        expect(s.autoAdvanceMs, `${s.id} would sit forever`).toBeGreaterThan(0)
      }
    }
  })

  it('find-the-rest completes only when auto walls exceed the traced one', () => {
    const i = TUTORIAL_STEPS.findIndex((s) => s.id === 'findRest')
    expect(tutorialAdvance(i, { ...EMPTY, userWallCount: 1, totalWallCount: 1 }).done).toBe(false)
    expect(tutorialAdvance(i, { ...EMPTY, userWallCount: 1, totalWallCount: 6 }).done).toBe(true)
  })

  it('the terminal takeoff step never auto-advances', () => {
    const last = TUTORIAL_STEPS.length - 1
    const full: TutorialContext = {
      hasPlan: true, calibrationCleared: true, userWallCount: 4, totalWallCount: 8,
      hasFloor: true, hasRoof: true, built: true, openingCount: 2, plumbingCount: 3, electricalCount: 3,
    }
    expect(tutorialAdvance(last, full).nextIndex).toBeNull()
  })
})
