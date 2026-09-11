import { describe, it, expect } from 'vitest'
import { DEFAULT_APP_CONFIG, useConfigStore } from './useConfigStore'

/**
 * Ceiling height is the number every layer frames to — walls, the deck above
 * them, drywall, the roof's eave, the takeoff. It arrives through
 * `useSceneConfig`, and before that it arrived nowhere at all: the old
 * `buildFloorHeightM` setting was read by its own slider and by nothing else.
 */
describe('ceiling height config', () => {
  it('defaults to "not stated" so the build type decides', () => {
    // null, not a number: a stored 2.7 here would quietly outrank the 8ft
    // residential default that deriveWorkspaceSceneConfig picks.
    expect(DEFAULT_APP_CONFIG.ceilingHeightM).toBeNull()
    expect(useConfigStore.getState().ceilingHeightM).toBeNull()
  })

  it('does not carry the old dead setting forward', () => {
    // The rename is the migration: a persisted buildFloorHeightM — one user's
    // sat at 5.6 m, 18'4" — must not start driving real wall heights.
    expect('buildFloorHeightM' in DEFAULT_APP_CONFIG).toBe(false)
  })

  it('takes a stated height', () => {
    useConfigStore.getState().set({ ceilingHeightM: 3.05 })
    expect(useConfigStore.getState().ceilingHeightM).toBeCloseTo(3.05, 6)
    useConfigStore.getState().set({ ceilingHeightM: null })
    expect(useConfigStore.getState().ceilingHeightM).toBeNull()
  })
})
