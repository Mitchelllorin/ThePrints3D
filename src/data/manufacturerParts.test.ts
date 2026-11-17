import { describe, expect, it } from 'vitest'
import { MANUFACTURER_PARTS, getManufacturerPart } from './manufacturerParts'
import { getMember, membersFor } from './members'
import { MATERIALS } from '../services/fuse'

describe('manufacturer parts', () => {
  it('has unique ids', () => {
    const ids = MANUFACTURER_PARTS.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it.each(MANUFACTURER_PARTS.map((p) => [p.id, p] as const))('%s resolves to a catalogue member', (_id, part) => {
    const member = getMember(part.memberId)
    expect(member, `member ${part.memberId} is not in the catalogue`).toBeDefined()
    // A member with no depth is a spec sheet the app cannot draw.
    expect(member!.depthIn).toBeGreaterThan(0)
    expect(member!.widthIn).toBeGreaterThan(0)
    // The part's size must be the member's size — a sheet showing a different
    // beam than the model draws is the one error that would end the pitch.
    expect(member!.name).toContain(part.manufacturer === 'Nordic Structures' ? 'Nordic Lam' : part.product)
  })

  it.each(MANUFACTURER_PARTS.map((p) => [p.id, p] as const))('%s occupies a layer F.U.S.E. scores', (_id, part) => {
    expect(MATERIALS[`${part.layer.id}:${part.layer.material}`]).toBeDefined()
  })

  it.each(MANUFACTURER_PARTS.map((p) => [p.id, p] as const))('%s cites a source for its rated values', (_id, part) => {
    expect(part.source.url).toMatch(/^https:\/\//)
    expect(part.source.label.length).toBeGreaterThan(3)
    expect(part.basis.length).toBeGreaterThan(20)
    expect(part.rated.length).toBeGreaterThan(0)
  })

  it.each(MANUFACTURER_PARTS.map((p) => [p.id, p] as const))('%s puts a unit on every number', (_id, part) => {
    // A dimension, a span, a ratio: digits and nothing else but punctuation.
    // '24F-E/ES1M1' is a designation, not a number, and needs no unit.
    const NUMERIC = /^[\d.,\s/×–-]+$/
    for (const f of part.rated) {
      if (NUMERIC.test(f.value)) {
        expect(f.unit, `${f.label} is a number with no unit`).toBeTruthy()
      }
    }
  })

  it.each(MANUFACTURER_PARTS.map((p) => [p.id, p] as const))('%s is offered by the pickers, not just in the array', (_id, part) => {
    const member = getMember(part.memberId)!
    const offered = member.uses.some((use) => membersFor(use).some((m) => m.id === member.id))
    expect(offered, `${member.name} is in the catalogue but no picker offers it`).toBe(true)
  })

  it('reads back by id', () => {
    expect(getManufacturerPart(MANUFACTURER_PARTS[0].id)?.manufacturer).toBe('Nordic Structures')
    expect(getManufacturerPart('nope')).toBeUndefined()
  })
})
