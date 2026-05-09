import { describe, expect, it } from 'vitest'
import { deriveScaleFromNotation } from './scaleParser'

describe('deriveScaleFromNotation', () => {
  it('parses normal architectural scales', () => {
    const mmPerPx = deriveScaleFromNotation('1:100')
    expect(mmPerPx).not.toBeNull()
    expect(mmPerPx!).toBeGreaterThan(20)
    expect(mmPerPx!).toBeLessThan(30)
  })

  it('supports slash separators', () => {
    const mmPerPx = deriveScaleFromNotation('1/50')
    expect(mmPerPx).not.toBeNull()
    expect(mmPerPx!).toBeGreaterThan(10)
  })

  it('returns null for invalid or implausible values', () => {
    expect(deriveScaleFromNotation('')).toBeNull()
    expect(deriveScaleFromNotation('abc')).toBeNull()
    expect(deriveScaleFromNotation('1:999999')).toBeNull()
  })
})
