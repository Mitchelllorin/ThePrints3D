// Material takeoff — counts EVERYTHING that's been drawn so a tradesperson can
// quote from the model: wall linear feet + studs + board sheets, plumbing /
// electrical / HVAC feet grouped by type·size·material, floor & roof areas with
// subfloor/sheathing sheet counts, and fixture counts. Pure (no store/THREE) so
// it's unit-testable and reusable by the takeoff panel and any export.
//
// Geometry is in image pixels; `scaleMmPerPx` converts to real units
// (1 ft = 304.8 mm). Line systems measure length; floors/roofs measure area.

import type { ParsedWall, TracedLine } from '../types'
import { generateRoofPlanes, summarizeRoof } from './roofPlanes'
import { pitchToRatio } from '../data/traceLayers'

const MM_PER_FT = 304.8
const MM_PER_M = 1000
const SQM_PER_SQFT = 0.09290304
const M_PER_FT = 0.3048
const STUD_OC_IN = 16
const SHEET_SQFT = 32 // 4'×8'
const DEFAULT_ROOF_OVERHANG_M = 0.4 // ~16" boxed eave (matches roofPlanes default)

export interface TakeoffItem {
  key: string
  label: string
  quantity: number
  unit: string
}

export interface TakeoffSection {
  title: string
  items: TakeoffItem[]
}

export interface TakeoffInput {
  scaleMmPerPx: number
  /** Wall height (m) — drives board/sheathing area. */
  wallHeightM: number
  walls: ParsedWall[]
  plumbing: TracedLine[]
  electrical: TracedLine[]
  hvac: TracedLine[]
  /** Floor areas — corner-pair rectangles. */
  floors: TracedLine[]
  /** Roof areas — corner-pair rectangles. */
  roof: TracedLine[]
  placedObjects: Array<{ type: string }>
  /** Eave overhang depth (m) used for the roof takeoff. Defaults to ~16". */
  roofOverhangM?: number
}

const lineFt = (l: { x1: number; y1: number; x2: number; y2: number }, mmPerPx: number): number =>
  (Math.hypot(l.x2 - l.x1, l.y2 - l.y1) * mmPerPx) / MM_PER_FT

const rectSqFt = (a: { x1: number; y1: number; x2: number; y2: number }, mmPerPx: number): number =>
  (Math.abs(a.x2 - a.x1) * Math.abs(a.y2 - a.y1) * mmPerPx * mmPerPx) / (MM_PER_FT * MM_PER_FT)

const round1 = (n: number): number => Math.round(n * 10) / 10

/** Sum a quantity into a keyed bucket, accumulating same-key entries. */
function bucket() {
  const map = new Map<string, { label: string; qty: number }>()
  return {
    add(label: string, qty: number) {
      const e = map.get(label) ?? { label, qty: 0 }
      e.qty += qty
      map.set(label, e)
    },
    items(unit: string): TakeoffItem[] {
      return Array.from(map.entries())
        .map(([key, e]) => ({ key, label: e.label, quantity: round1(e.qty), unit }))
        .sort((a, b) => b.quantity - a.quantity)
    },
    get size() { return map.size },
  }
}

/** Linear-run takeoff for a trade (plumbing/electrical/hvac): feet by type·size·material. */
function runSection(title: string, lines: TracedLine[], mmPerPx: number): TakeoffSection | null {
  if (lines.length === 0) return null
  const b = bucket()
  for (const l of lines) {
    const temp = l.tempType ? ` (${l.tempType})` : ''
    const label = [l.elementType, l.size, l.material].filter(Boolean).join(' · ') + temp
    b.add(label || title, lineFt(l, mmPerPx))
  }
  return { title, items: b.items('ft') }
}

/** Area takeoff (floors/roof): sq ft + sheet count by element type. */
function areaSection(title: string, areas: TracedLine[], mmPerPx: number, sheeted: boolean): TakeoffSection | null {
  if (areas.length === 0) return null
  const area = bucket()
  let totalSqFt = 0
  for (const a of areas) {
    const sqft = rectSqFt(a, mmPerPx)
    totalSqFt += sqft
    area.add(a.elementType || title, sqft)
  }
  const items = area.items('sq ft')
  if (sheeted && totalSqFt > 0) {
    items.push({ key: '__sheets', label: 'Subfloor/sheathing sheets (4×8)', quantity: Math.ceil(totalSqFt / SHEET_SQFT), unit: 'sheets' })
  }
  return { title, items }
}

/**
 * Roof takeoff — consumes the roofPlanes keystone so a steep or hipped roof
 * reports its true SLOPED covering area (not the flat footprint), plus fascia
 * and ridge/hip cap footage. Each roof area is a plan rectangle carrying its
 * type (elementType), pitch (ridge override or `size`), so we regenerate the
 * same plane model the renderer uses and sum the real quantities.
 */
function roofSection(roofs: TracedLine[], mmPerPx: number, overhangM: number): TakeoffSection | null {
  if (roofs.length === 0) return null
  const byType = bucket()
  let surfaceSqFt = 0
  let eaveFt = 0, ridgeFt = 0, hipFt = 0, valleyFt = 0
  for (const r of roofs) {
    const lenX = (Math.abs(r.x2 - r.x1) * mmPerPx) / MM_PER_M
    const lenZ = (Math.abs(r.y2 - r.y1) * mmPerPx) / MM_PER_M
    if (lenX <= 0 || lenZ <= 0) continue
    const pitch = r.ridge?.pitch ?? pitchToRatio(r.size)
    const structure = generateRoofPlanes({ lenX, lenZ }, r.elementType || 'gable', pitch, overhangM)
    const q = summarizeRoof(structure)
    const sqft = q.surfaceAreaM2 / SQM_PER_SQFT
    surfaceSqFt += sqft
    byType.add(r.elementType || 'Roof', sqft)
    eaveFt += q.eaveM / M_PER_FT
    ridgeFt += q.ridgeM / M_PER_FT
    hipFt += q.hipM / M_PER_FT
    valleyFt += q.valleyM / M_PER_FT
  }
  if (surfaceSqFt <= 0) return null
  const items = byType.items('sq ft') // sloped covering area by roof type
  items.push({ key: '__sheets', label: 'Roof sheathing (4×8)', quantity: Math.ceil(surfaceSqFt / SHEET_SQFT), unit: 'sheets' })
  if (eaveFt > 0) items.push({ key: '__fascia', label: 'Fascia / eave', quantity: round1(eaveFt), unit: 'ft' })
  const capFt = ridgeFt + hipFt
  if (capFt > 0) items.push({ key: '__ridgecap', label: 'Ridge & hip cap', quantity: round1(capFt), unit: 'ft' })
  if (valleyFt > 0) items.push({ key: '__valley', label: 'Valley flashing', quantity: round1(valleyFt), unit: 'ft' })
  return { title: 'Roof', items }
}

export function computeTakeoff(input: TakeoffInput): TakeoffSection[] {
  const { scaleMmPerPx: mm, wallHeightM } = input
  const sections: TakeoffSection[] = []

  // ── Walls: linear ft + stud count + board sheets, grouped by framing type ──
  if (input.walls.length > 0) {
    const lin = bucket()
    let totalFt = 0
    let studs = 0
    for (const w of input.walls) {
      const ft = lineFt(w, mm)
      totalFt += ft
      studs += Math.floor((ft * 12) / STUD_OC_IN) + 1
      const label = w.framingType || w.wallRole || 'Wall framing'
      lin.add(label, ft)
    }
    const items = lin.items('ft')
    items.push({ key: '__studs', label: `Studs (~${STUD_OC_IN}" OC)`, quantity: studs, unit: 'ea' })
    items.push({ key: '__plates', label: 'Plate stock (top+bottom)', quantity: round1(totalFt * 2), unit: 'ft' })
    // Board: each wall face is height × length; both faces boarded.
    const faceSqFt = (totalFt * (wallHeightM * 3.28084)) * 2
    items.push({ key: '__board', label: 'Wall board/sheathing (4×8)', quantity: Math.ceil(faceSqFt / SHEET_SQFT), unit: 'sheets' })
    sections.push({ title: 'Walls', items })
  }

  const floor = areaSection('Floors', input.floors, mm, true)
  if (floor) sections.push(floor)
  const roof = roofSection(input.roof, mm, input.roofOverhangM ?? DEFAULT_ROOF_OVERHANG_M)
  if (roof) sections.push(roof)

  const plumb = runSection('Plumbing', input.plumbing, mm)
  if (plumb) sections.push(plumb)
  const elec = runSection('Electrical', input.electrical, mm)
  if (elec) sections.push(elec)
  const hvac = runSection('HVAC', input.hvac, mm)
  if (hvac) sections.push(hvac)

  // ── Fixtures / placed objects: count by type ──
  if (input.placedObjects.length > 0) {
    const b = bucket()
    for (const o of input.placedObjects) b.add(o.type, 1)
    sections.push({ title: 'Fixtures & objects', items: b.items('ea') })
  }

  return sections
}
