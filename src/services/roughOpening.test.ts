import { describe, expect, it } from 'vitest'
import { roughOpening, roughOpeningRule, tubAlcoveM } from './roughOpening'

const IN = 0.0254
const inches = (m: number) => Math.round((m / IN) * 1000) / 1000

describe('the rough opening is bigger than the door', () => {
  it('frames a 3068 prehung at 38 by 82-1/2', () => {
    const ro = roughOpening('door', 'Hinged Single', 36 * IN, 80 * IN)
    expect(inches(ro.widthM)).toBe(38)
    expect(inches(ro.heightM)).toBe(82.5)
  })

  it('frames a door with no type chosen yet as a swing door, not as nothing', () => {
    const ro = roughOpening('door', undefined, 36 * IN, 80 * IN)
    expect(ro.rule).toBe('swing')
    expect(inches(ro.widthM)).toBe(38)
  })

  it('frames a pair of doors off their combined width', () => {
    const ro = roughOpening('door', 'Hinged Double', 60 * IN, 80 * IN)
    expect(inches(ro.widthM)).toBe(62)
  })
})

describe('a pocket door gets the pocket', () => {
  it('frames twice the door plus an inch, and room for the track above', () => {
    // The mistake this replaces: a pocket door framed like a swing door, one
    // door wide, so the leaf had nowhere to slide into.
    const ro = roughOpening('door', 'Pocket', 30 * IN, 80 * IN)
    expect(inches(ro.widthM)).toBe(61)
    expect(inches(ro.heightM)).toBe(84.5)
  })
})

describe('the other door types', () => {
  it('frames a garage door to the door size, because the opening IS the door size', () => {
    const ro = roughOpening('door', 'Garage', 16 * 12 * IN, 7 * 12 * IN)
    expect(inches(ro.widthM)).toBe(192)
    expect(inches(ro.heightM)).toBe(84)
  })

  it('frames bifold and sliding like a swing door: jambs plus clearance', () => {
    expect(roughOpeningRule('door', 'Bifold')).toBe('swing')
    expect(roughOpeningRule('door', 'Sliding')).toBe('swing')
  })
})

describe('windows', () => {
  it('frames the nominal unit plus half an inch each way', () => {
    const ro = roughOpening('window', 'Casement', 36 * IN, 48 * IN)
    expect(inches(ro.widthM)).toBe(36.5)
    expect(inches(ro.heightM)).toBe(48.5)
  })
})

describe('a tub alcove is the tub plus an inch, as the panel layout calls it out', () => {
  it('frames a 4-11-7/8 tub at 5-0-7/8', () => {
    expect(inches(tubAlcoveM((4 * 12 + 11 + 7 / 8) * IN))).toBe(60.875)
  })
})
