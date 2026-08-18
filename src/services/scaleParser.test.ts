import { describe, it, expect } from 'vitest'
import { findScaleRatios, pickScaleNotation, deriveScaleFromNotation } from './scaleParser'

describe('findScaleRatios — imperial', () => {
  it('reads 1/4" = 1\'-0" as 48, not as the ratio 1:4', () => {
    // THE bug. A ratio regex allowing `/` as a separator found "1/4" inside
    // this and called the sheet 1:4 — twelve times too small. Three of five
    // real municipal drawing sets came back at 0.94 mm/px because of it.
    expect(findScaleRatios('SCALE: 1/4" = 1\'-0"')).toContain(48)
    expect(findScaleRatios('SCALE: 1/4" = 1\'-0"')).not.toContain(4)
  })

  it('handles the other scales a residential set actually uses', () => {
    expect(findScaleRatios('1/8" = 1\'-0"')).toContain(96)
    expect(findScaleRatios('3/16"=1\'-0"')).toContain(64)
    expect(findScaleRatios('1/2" = 1\'-0"')).toContain(24)
    expect(findScaleRatios('3/4"=1\'-0"')).toContain(16)
    expect(findScaleRatios('1" = 1\'-0"')).toContain(12)
    expect(findScaleRatios('1 1/2" = 1\'-0"')).toContain(8)
  })

  it('handles an engineering scale and a stated inch remainder', () => {
    expect(findScaleRatios('1" = 20\'')).toContain(240)
    expect(findScaleRatios('1/4" = 1\'-6"')).toContain(72)
  })
})

describe('findScaleRatios — metric', () => {
  it('reads a colon ratio', () => {
    expect(findScaleRatios('SCALE 1:50')).toContain(50)
    expect(findScaleRatios('1:100')).toContain(100)
  })

  it('accepts a continental slash ratio', () => {
    // Continental drawings write 1/50 for 1:50, so a blanket ban on the slash
    // would break them.
    expect(findScaleRatios('ECHELLE 1/50')).toContain(50)
    expect(findScaleRatios('1/100')).toContain(100)
  })

  it('does NOT read an imperial fraction as a ratio', () => {
    // Small denominator: halves, quarters, eighths — never a scale ratio.
    expect(findScaleRatios('1/4')).toEqual([])
    expect(findScaleRatios('sheet 1/4')).toEqual([])
    // Large denominator but plainly an equation about lengths.
    expect(findScaleRatios('1/16" = 1\'-0"')).toContain(192)
    expect(findScaleRatios('1/16" = 1\'-0"')).not.toContain(16)
  })

  it('ignores ratios no building drawing uses', () => {
    expect(findScaleRatios('1:1')).toEqual([])
    expect(findScaleRatios('1:9999')).toEqual([])
  })
})

describe('pickScaleNotation', () => {
  it('finds nothing in text that states no scale', () => {
    // Null is a GOOD answer — it hands the question to the paper-anchored
    // inference, which is the more reliable of the two on real sheets.
    expect(pickScaleNotation('FIRST FLOOR PLAN\nBEDROOM 10-2 x 12-4')).toBeNull()
  })

  it('prefers the scale the sheet repeats over a one-off detail scale', () => {
    const titleBlock = 'DETAIL 3" = 1\'-0"\nFLOOR PLAN 1/4" = 1\'-0"\nSCALE 1/4" = 1\'-0"'
    expect(pickScaleNotation(titleBlock)).toBe('1:48')
  })

  it('normalises whatever it finds to 1:N', () => {
    expect(pickScaleNotation('SCALE: 1/8" = 1\'-0"')).toBe('1:96')
    expect(pickScaleNotation('SCALE 1:50')).toBe('1:50')
  })
})

describe('deriveScaleFromNotation', () => {
  it('turns a notation into millimetres per pixel', () => {
    // 1:48 at RASTER_SCALE 1.5 → 48 * (25.4/72) / 1.5 = 11.29 mm/px, which is
    // exactly what the real 36x24 sheets measure.
    expect(deriveScaleFromNotation('1:48')!).toBeCloseTo(11.29, 1)
  })

  it('accepts the imperial form written out', () => {
    expect(deriveScaleFromNotation('1/4" = 1\'-0"')!).toBeCloseTo(11.29, 1)
  })

  it('returns null rather than a wrong number', () => {
    expect(deriveScaleFromNotation('no scale here')).toBeNull()
  })
})
