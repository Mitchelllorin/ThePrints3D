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
      'plan', 'scale', 'wall', 'findRest', 'floor',
      'build', 'roof', 'openings', 'plumbing', 'electrical', 'takeoff',
    ])
  })

  it('every step has teaching copy and a hint', () => {
    for (const s of TUTORIAL_STEPS) {
      expect(s.title.length).toBeGreaterThan(0)
      expect(s.body.length).toBeGreaterThan(0)
      expect(s.hint.length).toBeGreaterThan(0)
    }
  })

  it('clampStep keeps the index in range', () => {
    expect(clampStep(-5)).toBe(0)
    expect(clampStep(999)).toBe(TUTORIAL_STEPS.length - 1)
    expect(clampStep(3)).toBe(3)
  })

  it('auto-advances a step once its goal is met', () => {
    // Step 0 (plan): not done with no plan, done + advances with a plan.
    expect(tutorialAdvance(0, EMPTY)).toEqual({ done: false, nextIndex: null })
    expect(tutorialAdvance(0, { ...EMPTY, hasPlan: true })).toEqual({ done: true, nextIndex: 1 })
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
