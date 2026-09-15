import { describe, it, expect } from 'vitest'
import { wallNameplate, joistNameplate, nameplateHasContent, NAMEPLATE_FIELDS } from './nameplate'

const U = { activeUnit: 'ft' as const, lengthFormat: 'ft-in' as const }
const keys = (f: ReturnType<typeof wallNameplate>) => f.map((x) => x.key)
const val = (f: ReturnType<typeof wallNameplate>, k: string) => f.find((x) => x.key === k)!.value

describe('nameplate field order', () => {
  it('is member, depth, spacing, span, grade — always', () => {
    // The build rules fix this order for ThePrints3D. A readout whose fields
    // move around is one you search instead of glance at.
    expect([...NAMEPLATE_FIELDS]).toEqual(['member', 'depth', 'spacing', 'span', 'grade'])
    expect(keys(wallNameplate({ framingType: 'wood-2x6', lengthM: 3, spacingMm: 406.4, ...U })))
      .toEqual([...NAMEPLATE_FIELDS])
  })

  it('holds the order even when fields are empty', () => {
    // A missing field keeps its slot. Dropping it lets the row below jump up
    // into the gap, which is the same bug as reordering.
    const f = wallNameplate({ framingType: 'cmu', lengthM: 4, ...U })
    expect(keys(f)).toEqual([...NAMEPLATE_FIELDS])
    expect(f).toHaveLength(5)
  })

  it('is the same order for a joist as for a wall', () => {
    expect(keys(joistNameplate({ member: '2×10', ...U }))).toEqual(keys(wallNameplate({ lengthM: 1, ...U })))
  })
})

describe('wall nameplate values', () => {
  it('never shows a bare number — every value carries its unit', () => {
    const f = wallNameplate({ framingType: 'wood-2x4', lengthM: 3.6576, spacingMm: 406.4, ...U })
    for (const field of f) {
      if (field.value == null) continue
      expect(field.value, `${field.key} has no unit`).toMatch(/[”"'′m]|mm|cm|ga|CMU|×/)
    }
  })

  it('reports milled depths, not nominal ones', () => {
    // A 2x8 is 7-1/4". Same rule as the framing geometry, and for a harder
    // reason: this readout gets taken to a lumber yard.
    const mm = { activeUnit: 'mm' as const, lengthFormat: 'decimal' as const }
    expect(val(wallNameplate({ framingType: 'wood-2x8', lengthM: 3, ...mm }), 'depth')).toContain('184')
    expect(val(wallNameplate({ framingType: 'wood-2x4', lengthM: 3, ...mm }), 'depth')).toContain('89')
  })

  it('marks spacing as on-centre', () => {
    expect(val(wallNameplate({ framingType: 'wood-2x4', lengthM: 3, spacingMm: 406.4, ...U }), 'spacing'))
      .toMatch(/o\.c\./)
  })

  it('gives masonry no stud and no spacing rather than inventing one', () => {
    // A CMU wall genuinely has no member on layout. Saying so beats filling
    // the slot with a 2x4 nobody is going to build.
    const f = wallNameplate({ framingType: 'cmu', lengthM: 4, spacingMm: 406.4, ...U })
    expect(val(f, 'member')).toBe('CMU')
    expect(val(f, 'depth')).toBeNull()
    expect(val(f, 'spacing')).toBeNull()
    expect(val(f, 'span')).not.toBeNull()
  })

  it('puts a steel gauge in the grade slot', () => {
    // Steel has a gauge, not a grade — but the slot means "what stock is this",
    // and the eye is already looking there.
    const f = wallNameplate({ framingType: 'steel-3-5-8', wallRole: 'exterior', lengthM: 3, ...U })
    expect(val(f, 'member')).toMatch(/steel/i)
    expect(val(f, 'grade')).toMatch(/ga$/)
  })

  it('prefers a stated lumber grade over anything derived', () => {
    const f = wallNameplate({ framingType: 'wood-2x6', lengthM: 3, grade: 'No.2 SPF', ...U })
    expect(val(f, 'grade')).toBe('No.2 SPF')
  })

  it('always has a span, because a wall always has a length', () => {
    expect(val(wallNameplate({ lengthM: 2.4384, ...U }), 'span')).not.toBeNull()
  })
})

describe('nameplateHasContent', () => {
  it('is false only when every slot is empty', () => {
    expect(nameplateHasContent(wallNameplate({ lengthM: 3, ...U }))).toBe(true)
    expect(nameplateHasContent(joistNameplate({ member: '', ...U }))).toBe(false)
  })
})
