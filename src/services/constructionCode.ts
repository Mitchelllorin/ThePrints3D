/**
 * Construction-code reference values — the single source of truth for things
 * like nominal wall thicknesses. Keyed by the framing-type keys the wall-type
 * picker stamps onto each wall (see FRAMING_TYPES in FloorplanPanel).
 */

/** Nominal finished wall thickness, in metres, by framing-type key. */
export const WALL_THICKNESS_M: Record<string, number> = {
  'wood-2x4': 0.0889,   // 3.5"
  'wood-2x6': 0.1397,   // 5.5"
  'wood-2x8': 0.1905,   // 7.5"
  'steel-3-5-8': 0.0921, // 3-5/8"
  'steel-6': 0.1524,    // 6"
  'cmu': 0.1905,        // 8" standard block
}

/** Fallback thickness when a wall has no (or an unknown) framing type. */
export const DEFAULT_WALL_THICKNESS_M = 0.0889  // 2×4

/** Look up a framing thickness, falling back to the 2×4 default. */
export function wallThicknessM(framingType?: string): number {
  return (framingType && WALL_THICKNESS_M[framingType]) || DEFAULT_WALL_THICKNESS_M
}

// ── Wall finish/cladding materials (PBR presets for the two wall faces) ───────

export interface WallMaterialPreset {
  color: string
  roughness: number
  metalness?: number
}

export const WALL_MATERIALS: Record<string, WallMaterialPreset> = {
  drywall:      { color: '#f5f0eb', roughness: 0.9,  metalness: 0 },
  plaster:      { color: '#ede8e0', roughness: 0.85, metalness: 0 },
  tile:         { color: '#e2e8f0', roughness: 0.3,  metalness: 0 },
  exposedBrick: { color: '#8b4513', roughness: 0.95, metalness: 0 },
  stucco:       { color: '#d4c5a9', roughness: 0.95, metalness: 0 },
  vinylSiding:  { color: '#e8e0d0', roughness: 0.7,  metalness: 0 },
  woodSiding:   { color: '#c4a265', roughness: 0.95, metalness: 0 },
  brick:        { color: '#8b4513', roughness: 0.95, metalness: 0 },
  stone:        { color: '#9ca3af', roughness: 1.0,  metalness: 0 },
  metalPanel:   { color: '#94a3b8', roughness: 0.3,  metalness: 0.8 },
  fiberCement:  { color: '#d1cfc9', roughness: 0.85, metalness: 0 },
  concrete:     { color: '#a8a8a8', roughness: 1.0,  metalness: 0 },
}

export const DEFAULT_INTERIOR_MATERIAL = 'drywall'
export const DEFAULT_EXTERIOR_MATERIAL = 'stucco'

export function wallMaterialPreset(key?: string): WallMaterialPreset {
  return (key && WALL_MATERIALS[key]) || WALL_MATERIALS.drywall
}

/** Interior-finish options for the wall property card (label → preset key). */
export const INTERIOR_FINISHES: Array<{ label: string; key: string }> = [
  { label: 'Drywall', key: 'drywall' },
  { label: 'Plaster', key: 'plaster' },
  { label: 'Tile', key: 'tile' },
  { label: 'Exposed Brick', key: 'exposedBrick' },
  { label: 'Concrete', key: 'concrete' },
]

/** Exterior-cladding options for the wall property card (label → preset key). */
export const EXTERIOR_CLADDINGS: Array<{ label: string; key: string }> = [
  { label: 'Stucco', key: 'stucco' },
  { label: 'Vinyl Siding', key: 'vinylSiding' },
  { label: 'Wood Siding', key: 'woodSiding' },
  { label: 'Brick', key: 'brick' },
  { label: 'Stone', key: 'stone' },
  { label: 'Metal Panel', key: 'metalPanel' },
  { label: 'Fiber Cement', key: 'fiberCement' },
]

// ── Electrical code reference ─────────────────────────────────────────────────

import type { Circuit, CircuitType, ParsedWall, TracedLine } from '../types'

export interface RequiredCircuitSpec {
  amps: 15 | 20 | 30 | 50
  type: CircuitType
  count?: number
  label: string
}

/** NEC-style required branch circuits by room type (for suggestions). */
export const REQUIRED_CIRCUITS: Record<string, RequiredCircuitSpec[]> = {
  kitchen: [
    { amps: 20, type: 'gfci', count: 2, label: 'Small appliance' },
    { amps: 20, type: 'dedicated', label: 'Dishwasher' },
    { amps: 50, type: 'dedicated', label: 'Range' },
  ],
  bathroom: [{ amps: 20, type: 'gfci', count: 1, label: 'Bath receptacle' }],
  bedroom: [{ amps: 15, type: 'afci', count: 1, label: 'General lighting' }],
  garage: [{ amps: 20, type: 'gfci', count: 1, label: 'Garage receptacle' }],
  laundry: [
    { amps: 20, type: 'dedicated', label: 'Washer' },
    { amps: 30, type: 'dedicated', label: 'Dryer' },
  ],
}

export const ROOM_TYPES = Object.keys(REQUIRED_CIRCUITS)

const MM_PER_FT = 304.8

/** Nominal wattage by electrical fixture/outlet type (for panel load calc). */
export const FIXTURE_WATTS: Record<string, number> = {
  'duplex-outlet': 180,
  'gfci-outlet': 180,
  'switch': 0,
  'ceiling-light': 100,
  'recessed-light': 65,
  'exhaust-fan': 120,
  'panel-box': 0,
}

/** Operating voltage for a circuit (240V for 50A+ feeders, else 120V). */
export function circuitVoltage(amperage: number): number {
  return amperage >= 50 ? 240 : 120
}

export interface ElectricalViolation {
  id: string
  /** Pixel coordinates on the print (overlay converts to world). */
  x: number
  y: number
  message: string
}

interface ValidateInput {
  userWalls: ParsedWall[]
  /** Placed outlets/fixtures in PIXEL space, with their catalog type. */
  outlets: Array<{ x: number; y: number; type: string; circuitId?: string }>
  circuits: Circuit[]
  electricalLines: TracedLine[]
  mmPerPx: number | null
}

function distToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number) {
  const dx = x2 - x1, dy = y2 - y1
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return Math.hypot(px - x1, py - y1)
  let t = ((px - x1) * dx + (py - y1) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy))
}

/**
 * Best-effort electrical code checks, returning violation markers in pixel
 * space. NOTE: GFCI/AFCI *room-zone* checks need room typing (not available
 * from geometry), so those are validated by circuit/outlet consistency instead.
 */
export function validateElectrical(input: ValidateInput): ElectricalViolation[] {
  const { userWalls, outlets, circuits, electricalLines, mmPerPx } = input
  const out: ElectricalViolation[] = []
  const pxPerFt = MM_PER_FT / (mmPerPx ?? 8)

  // 1) Outlet spacing — any wall run over 12 ft with no outlet within 6 ft.
  userWalls.forEach((w, i) => {
    const lenPx = Math.hypot(w.x2 - w.x1, w.y2 - w.y1)
    const lenFt = (lenPx * (mmPerPx ?? 8)) / MM_PER_FT
    if (lenFt <= 12) return
    const nearest = outlets.reduce((min, o) => Math.min(min, distToSegment(o.x, o.y, w.x1, w.y1, w.x2, w.y2)), Infinity)
    if (nearest > 6 * pxPerFt) {
      // Key by wall index too — two walls can share a start point (corners).
      out.push({ id: `spacing-${i}-${w.x1}-${w.y1}`, x: (w.x1 + w.x2) / 2, y: (w.y1 + w.y2) / 2, message: `${lenFt.toFixed(0)}ft wall run with no outlet within 6ft` })
    }
  })

  // 2) GFCI consistency — outlets on a GFCI circuit must be GFCI receptacles.
  const circuitById = new Map(circuits.map((c) => [c.id, c]))
  for (const o of outlets) {
    const c = o.circuitId ? circuitById.get(o.circuitId) : undefined
    if (c && (c.type === 'gfci' || c.type === 'gfci+afci') && o.type === 'duplex-outlet') {
      out.push({ id: `gfci-${o.x}-${o.y}`, x: o.x, y: o.y, message: 'Outlet on a GFCI circuit should be a GFCI receptacle' })
    }
  }

  // 3) AFCI — 15/20A general circuits in dwellings require AFCI protection.
  const lineById = new Map(electricalLines.map((l) => [l.id, l]))
  for (const c of circuits) {
    if (c.suggested) continue
    if ((c.amperage === 15 || c.amperage === 20) && c.type === 'general') {
      const l = c.lineIds.map((id) => lineById.get(id)).find(Boolean)
      if (l) out.push({ id: `afci-${c.id}`, x: (l.x1 + l.x2) / 2, y: (l.y1 + l.y2) / 2, message: `${c.label}: general circuit should be AFCI-protected (NEC 210.12)` })
    }
  }

  return out
}
