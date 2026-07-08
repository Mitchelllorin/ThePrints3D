import { describe, it, expect } from 'vitest'
import { computeTakeoff } from './takeoff'
import type { TracedLine } from '../types'

const roofLine = (over: Partial<TracedLine>): TracedLine => ({
  id: 'r1', x1: 0, y1: 0, x2: 100, y2: 60,
  elementType: 'gable', size: '6:12', material: '', ...over,
})

// 1px = 100mm at this scale, so the rect is 10m × 6m.
const MM_PER_PX = 100

const baseInput = {
  scaleMmPerPx: MM_PER_PX, wallHeightM: 2.7,
  walls: [], plumbing: [], electrical: [], hvac: [], floors: [],
  placedObjects: [],
}

describe('computeTakeoff — roof section (roofPlanes-backed)', () => {
  it('reports SLOPED covering area, not the flat footprint', () => {
    const sections = computeTakeoff({ ...baseInput, roof: [roofLine({})], roofOverhangM: 0 })
    const roof = sections.find((s) => s.title === 'Roof')
    expect(roof).toBeDefined()
    // 10×6 = 60 m² footprint = 645.8 sq ft flat. 6:12 (pitch .5) → ×1.118 ≈ 722 sq ft.
    const area = roof!.items.find((i) => i.key === 'gable')!
    expect(area.quantity).toBeGreaterThan(700)
    expect(area.quantity).toBeLessThan(740)
    // Sheets from the sloped area (23), strictly more than the flat-footprint count (21).
    const sheets = roof!.items.find((i) => i.key === '__sheets')!
    expect(sheets.quantity).toBe(23)
  })

  it('lists fascia and ridge/hip cap footage', () => {
    const sections = computeTakeoff({ ...baseInput, roof: [roofLine({})], roofOverhangM: 0 })
    const roof = sections.find((s) => s.title === 'Roof')!
    const fascia = roof.items.find((i) => i.key === '__fascia')!
    const cap = roof.items.find((i) => i.key === '__ridgecap')!
    expect(fascia.quantity).toBeGreaterThan(60) // 20 m of eave ≈ 65.6 ft
    expect(cap.quantity).toBeGreaterThan(30)    // 10 m ridge ≈ 32.8 ft
  })

  it('a hip roof reports hip cap footage (ridge + hips)', () => {
    const gable = computeTakeoff({ ...baseInput, roof: [roofLine({})], roofOverhangM: 0 })
      .find((s) => s.title === 'Roof')!.items.find((i) => i.key === '__ridgecap')!.quantity
    const hip = computeTakeoff({ ...baseInput, roof: [roofLine({ elementType: 'hip' })], roofOverhangM: 0 })
      .find((s) => s.title === 'Roof')!.items.find((i) => i.key === '__ridgecap')!.quantity
    expect(hip).toBeGreaterThan(gable) // hips add substantial cap length
  })

  it('a live ridge pitch override drives the area (steeper → more sheathing)', () => {
    const steep = computeTakeoff({
      ...baseInput, roofOverhangM: 0,
      roof: [roofLine({ ridge: { pitch: 1.0 } })], // 12:12
    }).find((s) => s.title === 'Roof')!.items.find((i) => i.key === 'gable')!.quantity
    const shallow = computeTakeoff({ ...baseInput, roof: [roofLine({})], roofOverhangM: 0 })
      .find((s) => s.title === 'Roof')!.items.find((i) => i.key === 'gable')!.quantity
    expect(steep).toBeGreaterThan(shallow)
  })

  it('no roof areas → no Roof section', () => {
    const sections = computeTakeoff({ ...baseInput, roof: [] })
    expect(sections.find((s) => s.title === 'Roof')).toBeUndefined()
  })
})
