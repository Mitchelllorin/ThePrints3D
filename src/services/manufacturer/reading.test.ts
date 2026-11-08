import { describe, expect, it } from 'vitest'
import { MANUFACTURER_PARTS } from '../../data/manufacturerParts'
import { DEMO_ASSEMBLY, partMaterialSpec, scorePart } from './reading'
import { HORIZON_YEARS, SITES, buildingProfileFor } from '../fuse'

const part = MANUFACTURER_PARTS[0]

describe('manufacturer part reading', () => {
  it('scores the part at every site by default', () => {
    const r = scorePart(part)
    expect(r.missing).toBe(false)
    expect(r.sites.map((s) => s.siteId)).toEqual(SITES.map((s) => s.id))
    for (const s of r.sites) {
      expect(s.part, `${s.siteName} lost the part`).not.toBeNull()
      expect(s.part!.id).toBe(part.layer.id)
    }
  })

  it('reports the part in the assembly the demo actually builds', () => {
    const layers = buildingProfileFor(DEMO_ASSEMBLY).layers.map((l) => l.id)
    expect(layers).toContain(part.layer.id)
  })

  it('scores the part as the material it declares', () => {
    const spec = partMaterialSpec(part)
    expect(spec).not.toBeNull()
    // The sheet prints this label, so it must be the model's row and not a
    // leftover from another assembly.
    expect(spec!.label.length).toBeGreaterThan(3)

    const r = scorePart(part)
    for (const s of r.sites) expect(s.part!.material).toBe(part.layer.material)
  })

  it('is deterministic — the sheet and the panel cannot disagree', () => {
    const a = scorePart(part, { year: 20 })
    const b = scorePart(part, { year: 20 })
    expect(a.sites.map((s) => s.part?.reserve)).toEqual(b.sites.map((s) => s.part?.reserve))
    expect(a.sites.map((s) => s.first?.year)).toEqual(b.sites.map((s) => s.first?.year))
  })

  it('moves with the year on the scrubber', () => {
    const young = scorePart(part, { year: 0 })
    const old = scorePart(part, { year: HORIZON_YEARS })
    const coastYoung = young.sites.find((s) => s.siteId === 'coast')!
    const coastOld = old.sites.find((s) => s.siteId === 'coast')!
    expect(coastOld.failedCount).toBeGreaterThanOrEqual(coastYoung.failedCount)
    expect(coastOld.states.find((s) => s.id === part.layer.id)!.reserve)
      .toBeLessThanOrEqual(coastYoung.states.find((s) => s.id === part.layer.id)!.reserve)
  })

  it('refuses to score a part into an assembly with no layer for it', () => {
    // A dried-in wall has no cladding layer at all, so a cladding part has
    // nowhere to sit. The sheet must not print a reading scored against
    // something else — it gets `missing` and no part state instead.
    const claddingPart = { ...part, layer: { id: 'cladding' as const, material: 'fiber-cement-lap' } }
    const driedIn = { ...DEMO_ASSEMBLY, cladding: 'none' as const }
    const r = scorePart(claddingPart, { assembly: driedIn })
    expect(r.missing).toBe(true)
    for (const s of r.sites) expect(s.part).toBeNull()

    // The same part in a wall that has a cladding layer is scored normally.
    expect(scorePart(claddingPart).missing).toBe(false)
  })
})
