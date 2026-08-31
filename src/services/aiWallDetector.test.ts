import { describe, it, expect } from 'vitest'
import { aiResultIsUsable } from './aiWallDetector'

/**
 * The rule that decides whether the model's answer is preferred over the
 * classical ladder. It exists because "the model ran" used to be the bar: an
 * empty-but-successful result cancelled the fallback and the user got no walls
 * at all from a phone screenshot.
 */
describe('aiResultIsUsable', () => {
  it('rejects an empty result so the classical ladder still runs', () => {
    expect(aiResultIsUsable({ walls: [] })).toBe(false)
  })

  it('accepts a result that actually found something', () => {
    expect(aiResultIsUsable({ walls: [{}] as never })).toBe(true)
  })
})
