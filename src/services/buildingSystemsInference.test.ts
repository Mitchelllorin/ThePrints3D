import { describe, it, expect } from 'vitest'
import {
  inferBuildingSystems,
  inferExteriorEnvelope,
  inferInsulation,
  type SystemsInferenceInput,
} from './buildingSystemsInference'

const base: SystemsInferenceInput = {
  buildingType: 'residential-single',
}

// ─── Exterior cladding ────────────────────────────────────────────────────────

describe('inferBuildingSystems — exterior cladding', () => {
  it('residential temperate → vinyl siding (most common, cost-effective)', () => {
    const spec = inferBuildingSystems(base)
    expect(spec.cladding.value).toBe('vinylSiding')
    expect(spec.cladding.confidence).toBeGreaterThanOrEqual(0.75)
  })

  it('residential cold climate → fiber cement (freeze-thaw resistant)', () => {
    const spec = inferBuildingSystems({ ...base, climateZone: 'cold' })
    expect(spec.cladding.value).toBe('fiberCement')
    expect(spec.cladding.confidence).toBeGreaterThan(0.75)
  })

  it('residential hot climate → stucco (thermal mass, moisture management)', () => {
    const spec = inferBuildingSystems({ ...base, climateZone: 'hot-humid' })
    expect(spec.cladding.value).toBe('stucco')
  })

  it('masonry wall → brick veneer', () => {
    const spec = inferBuildingSystems({ ...base, wallRole: 'masonry' })
    expect(spec.cladding.value).toBe('brick')
    expect(spec.cladding.confidence).toBeGreaterThan(0.8)
  })

  it('industrial → metal panel', () => {
    const spec = inferBuildingSystems({ ...base, buildingType: 'industrial' })
    expect(spec.cladding.value).toBe('metalPanel')
    expect(spec.cladding.confidence).toBeGreaterThan(0.85)
  })

  it('commercial → fiber cement', () => {
    const spec = inferBuildingSystems({ ...base, buildingType: 'commercial' })
    expect(spec.cladding.value).toBe('fiberCement')
  })
})

// ─── Sheathing ────────────────────────────────────────────────────────────────

describe('inferBuildingSystems — sheathing', () => {
  it('wood-frame residential → OSB 7/16"', () => {
    const spec = inferBuildingSystems(base)
    expect(spec.sheathing.value).toBe('osb')
    expect(spec.sheathing.confidence).toBeGreaterThan(0.85)
  })

  it('3+ storey building → plywood for racking strength', () => {
    const spec = inferBuildingSystems({ ...base, buildingHeightStoreys: 3 })
    expect(spec.sheathing.value).toBe('plywood')
  })

  it('masonry wall → no sheathing', () => {
    const spec = inferBuildingSystems({ ...base, wallRole: 'cmu' })
    expect(spec.sheathing.value).toBe('none')
    expect(spec.sheathing.confidence).toBeGreaterThan(0.9)
  })

  it('industrial building → no sheathing', () => {
    const spec = inferBuildingSystems({ ...base, buildingType: 'warehouse' })
    expect(spec.sheathing.value).toBe('none')
  })
})

// ─── Insulation ───────────────────────────────────────────────────────────────

describe('inferBuildingSystems — insulation', () => {
  it('residential default → fiberglass batt', () => {
    const spec = inferBuildingSystems(base)
    expect(spec.wallInsulationType.value).toBe('batt')
    expect(spec.wallInsulationType.confidence).toBeGreaterThan(0.8)
  })

  it('cold climate → spray foam for maximum R-value + air sealing', () => {
    const spec = inferBuildingSystems({ ...base, climateZone: 'very-cold' })
    expect(spec.wallInsulationType.value).toBe('spray-foam')
  })

  it('masonry wall → rigid foam continuous insulation', () => {
    const spec = inferBuildingSystems({ ...base, wallRole: 'masonry' })
    expect(spec.wallInsulationType.value).toBe('rigid')
  })

  it('R-value ≥ 13 for hot/mixed climates', () => {
    const spec = inferBuildingSystems({ ...base, climateZone: 'hot-humid' })
    expect(spec.wallInsulationRValue.value).toBeGreaterThanOrEqual(13)
  })

  it('R-value ≥ 20 for cold climates', () => {
    const spec = inferBuildingSystems({ ...base, climateZone: 'cold' })
    expect(spec.wallInsulationRValue.value).toBeGreaterThanOrEqual(20)
  })

  it('unknown climate → lower confidence on R-value', () => {
    const spec = inferBuildingSystems(base)
    expect(spec.wallInsulationRValue.confidence).toBeLessThan(0.80)
  })
})

// ─── MEP ─────────────────────────────────────────────────────────────────────

describe('inferBuildingSystems — MEP', () => {
  it('hot climate residential → heat pump (covers heating and cooling)', () => {
    const spec = inferBuildingSystems({ ...base, climateZone: 'hot-dry' })
    expect(spec.heatingSystem.value).toBe('heat-pump')
    expect(spec.coolingSystem.value).toBe('heat-pump')
  })

  it('cold climate residential → forced-air gas furnace', () => {
    const spec = inferBuildingSystems({ ...base, climateZone: 'cold' })
    expect(spec.heatingSystem.value).toBe('forced-air')
    expect(spec.coolingSystem.value).toBe('central-ac')
  })

  it('heat-pump heating → cooling inferred as heat-pump (no separate system)', () => {
    const spec = inferBuildingSystems({ ...base, climateZone: 'marine' })
    if (spec.heatingSystem.value === 'heat-pump') {
      expect(spec.coolingSystem.value).toBe('heat-pump')
    }
  })

  it('residential → PEX plumbing', () => {
    const spec = inferBuildingSystems(base)
    expect(spec.plumbingMaterial.value).toBe('pex')
    expect(spec.plumbingMaterial.confidence).toBeGreaterThan(0.8)
  })

  it('commercial → copper plumbing', () => {
    const spec = inferBuildingSystems({ ...base, buildingType: 'commercial' })
    expect(spec.plumbingMaterial.value).toBe('copper')
  })

  it('residential → 200A electrical panel', () => {
    const spec = inferBuildingSystems(base)
    expect(spec.electricalPanelAmps.value).toBe(200)
    expect(spec.electricalPanelAmps.confidence).toBeGreaterThan(0.8)
  })

  it('industrial → 400A panel', () => {
    const spec = inferBuildingSystems({ ...base, buildingType: 'industrial' })
    expect(spec.electricalPanelAmps.value).toBe(400)
  })
})

// ─── Drywall & finishes ───────────────────────────────────────────────────────

describe('inferBuildingSystems — drywall & finishes', () => {
  it('residential → 1/2" drywall', () => {
    const spec = inferBuildingSystems(base)
    expect(spec.drywallThicknessIn.value).toBeCloseTo(0.5)
    expect(spec.drywallThicknessIn.confidence).toBeGreaterThan(0.8)
  })

  it('commercial → 5/8" Type X', () => {
    const spec = inferBuildingSystems({ ...base, buildingType: 'commercial' })
    expect(spec.drywallThicknessIn.value).toBeCloseTo(5 / 8)
  })

  it('residential → drywall finish', () => {
    const spec = inferBuildingSystems(base)
    expect(spec.interiorFinish.value).toBe('drywall')
  })

  it('industrial → concrete finish', () => {
    const spec = inferBuildingSystems({ ...base, buildingType: 'industrial' })
    expect(spec.interiorFinish.value).toBe('concrete')
  })
})

// ─── Convenience helpers ──────────────────────────────────────────────────────

describe('inferExteriorEnvelope', () => {
  it('returns only cladding and sheathing', () => {
    const env = inferExteriorEnvelope(base)
    expect(env.cladding).toBeDefined()
    expect(env.sheathing).toBeDefined()
    // Should not contain MEP keys
    expect((env as Record<string, unknown>).heatingSystem).toBeUndefined()
  })
})

describe('inferInsulation', () => {
  it('returns type and rValue', () => {
    const ins = inferInsulation(base)
    expect(ins.type).toBeDefined()
    expect(ins.rValue).toBeDefined()
    expect(ins.rValue.value).toBeGreaterThan(0)
  })
})

// ─── Self-consistency ─────────────────────────────────────────────────────────

describe('inferBuildingSystems — self-consistency', () => {
  it('all confidence scores are in [0, 1]', () => {
    const inputs: SystemsInferenceInput[] = [
      base,
      { buildingType: 'commercial', climateZone: 'cold' },
      { buildingType: 'industrial' },
      { buildingType: 'residential-multi', wallRole: 'masonry', climateZone: 'hot-humid' },
    ]
    for (const inp of inputs) {
      const spec = inferBuildingSystems(inp)
      const recs = Object.values(spec) as Array<{ confidence: number }>
      for (const r of recs) {
        expect(r.confidence).toBeGreaterThanOrEqual(0)
        expect(r.confidence).toBeLessThanOrEqual(1)
      }
    }
  })

  it('all value fields are non-null/undefined', () => {
    const spec = inferBuildingSystems(base)
    const recs = Object.values(spec) as Array<{ value: unknown }>
    for (const r of recs) {
      expect(r.value).toBeDefined()
      expect(r.value).not.toBeNull()
    }
  })
})
