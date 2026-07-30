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
  'steel-1-5-8': 0.0413, // 1-5/8" furring channel (towers: furr out for space)
  'steel-3-5-8': 0.0921, // 3-5/8"
  'steel-6': 0.1524,    // 6"
  'steel-8': 0.2032,    // 8" heavy-gauge (structural / truss-like exterior, roofs, ceilings)
  'cmu': 0.1905,        // 8" standard block
}

/** Fallback thickness when a wall has no (or an unknown) framing type. */
export const DEFAULT_WALL_THICKNESS_M = 0.0889  // 2×4

/** Look up a framing thickness, falling back to the 2×4 default. */
export function wallThicknessM(framingType?: string): number {
  return (framingType && WALL_THICKNESS_M[framingType]) || DEFAULT_WALL_THICKNESS_M
}

// ── Building envelope ─────────────────────────────────────────────────────────
//
// The exterior wall assembly, outward from the stud face. Order is not a style
// choice — it is how water and vapour are managed, so it is fixed:
//
//   studs → SHEATHING → WRB (housewrap) → [rainscreen] → cladding
//
// Only the first two are modelled here. Cladding is a bigger job (brick and
// stone need a ledge and an air gap, which changes the wall's footprint, not just
// its skin) and is deliberately left for its own pass.

/** One layer of the exterior assembly. */
export interface EnvelopeLayer {
  /** Nameplate text — what a tradesperson would call it. */
  label: string
  /** Real thickness in metres. */
  thicknessM: number
  /** Render colour, chosen to look like the actual product. */
  color: string
  /** Brand this layer is typically specified as, for product placement. */
  brand?: string
}

/** 7/16" OSB — the default wood-frame sheathing. */
export const OSB_T = 0.0111
/** 15/32" CDX plywood — the other wood-frame option, a hair thicker than OSB. */
export const PLYWOOD_T = 0.0119
/** 1/2" glass-mat gypsum sheathing (DensGlass). */
export const GLASSMAT_T = 0.0127
/** Housewrap is film-thin; drawn thicker than life so it is visible at all. */
export const WRB_T = 0.0015

/** Wood-frame sheathing panel choice. Steel ignores this and gets glass-mat. */
export type WoodSheathing = 'osb' | 'plywood'

/**
 * Sheathing for a wall, by framing material.
 *
 * Steel-framed exteriors get GLASS-MAT gypsum (DensGlass), not plywood — the
 * combination of steel studs and wood sheathing is not how these walls are built,
 * and getting it wrong is the kind of detail a tradesperson spots immediately.
 * Georgia-Pacific's DensGlass is the specified product often enough to name.
 *
 * Wood frame picks between OSB and CDX plywood. They are not interchangeable in
 * the field even though they look alike on a drawing: plywood holds up far better
 * to getting rained on before the walls are dry-in, which is why plenty of crews
 * still pay for it. Different real thicknesses, so the wall's outside face moves.
 */
export function sheathingLayer(
  framingMaterial: 'wood' | 'steel',
  wood: WoodSheathing = 'osb',
): EnvelopeLayer {
  if (framingMaterial === 'steel') {
    return { label: 'Glass-mat sheathing · 1/2"', thicknessM: GLASSMAT_T, color: '#c8b560', brand: 'DensGlass (Georgia-Pacific)' }
  }
  return wood === 'plywood'
    ? { label: 'CDX plywood sheathing · 15/32"', thicknessM: PLYWOOD_T, color: '#d8b483' }
    : { label: 'OSB sheathing · 7/16"', thicknessM: OSB_T, color: '#c9a273' }
}

// ── Interior board ───────────────────────────────────────────────────────────
//
// Gypsum board is interior-only, but "drywall" is not one product. What goes on
// the studs depends on what the room does to it: fire separation, splashing,
// or standing water behind tile.

export type BoardKind =
  | 'gypsum-half' | 'gypsum-type-x' | 'mold-resistant'
  | 'cement-board' | 'glassmat-tile' | 'foam-waterproof'

export interface BoardSpec {
  label: string
  thicknessM: number
  color: string
  brand?: string
  /** Suitable behind tile in a wet area (tub/shower surround). */
  wetRated: boolean
  /** Fire-resistance rated — required to the garage and commonly on ceilings. */
  fireRated: boolean
}

export const BOARD_HALF_T = 0.0127     // 1/2"
export const BOARD_58_T = 0.0159       // 5/8"
export const CEMENT_BOARD_T = 0.0127   // 1/2"
export const KERDI_BOARD_T = 0.0127    // 1/2" (also 5/8", 3/4", 1", 2")

export function boardSpec(kind: BoardKind): BoardSpec {
  switch (kind) {
    case 'gypsum-type-x':
      // 5/8" Type X — the fire-rated board. Required on the garage side of a
      // garage/house separation, and standard on ceilings under habitable space.
      return { label: 'Gypsum · 5/8" Type X', thicknessM: BOARD_58_T, color: '#efe6e0', wetRated: false, fireRated: true }
    case 'mold-resistant':
      // The paperless/coated interior board. No paper facing = no food for mould.
      return { label: 'Mould-resistant gypsum', thicknessM: BOARD_HALF_T, color: '#dfe7dc', brand: 'DensArmor Plus (Georgia-Pacific)', wetRated: false, fireRated: false }
    case 'cement-board':
      // Tile backer. Not waterproof on its own — it does not fall apart when wet,
      // which is a different claim, and it still needs a membrane behind the tile.
      return { label: 'Cement board (tile backer)', thicknessM: CEMENT_BOARD_T, color: '#b7b6b1', brand: 'Durock / HardieBacker', wetRated: true, fireRated: false }
    case 'glassmat-tile':
      // Glass-mat tile backer with the moisture barrier built into the face.
      return { label: 'Glass-mat tile backer', thicknessM: BOARD_HALF_T, color: '#c3d3c8', brand: 'DensShield (Georgia-Pacific)', wetRated: true, fireRated: false }
    case 'foam-waterproof':
      // Schluter KERDI-BOARD: an extruded polystyrene panel, fleece-coated both
      // faces, that is WATERPROOF in itself rather than merely water-tolerant.
      // Doubles as the substrate and the waterproofing in a shower, which is why
      // it replaces backer-plus-membrane rather than sitting alongside it. Sold as
      // a system with the banded seams and the metal profiles people know Schluter
      // for; the profiles are trim, this is the panel.
      return { label: 'Waterproof foam board', thicknessM: KERDI_BOARD_T, color: '#e6a83c', brand: 'KERDI-BOARD (Schluter-Systems)', wetRated: true, fireRated: false }
    case 'gypsum-half':
    default:
      return { label: 'Gypsum · 1/2"', thicknessM: BOARD_HALF_T, color: '#e8e6e1', wetRated: false, fireRated: false }
  }
}

// ── Cladding ─────────────────────────────────────────────────────────────────
//
// The finish layer, and the one that changes the wall's FOOTPRINT rather than
// just its skin. Lap siding and panels hang more or less on the wall. Masonry
// veneer does not: brick stands off on its own ledge with a drained air gap
// behind it, so an outside wall face can move ~4" outward. That is why cladding
// carries a `gapM` and is not modelled as one more thin sheet.

export type CladdingKind =
  | 'none'
  | 'vinyl-lap' | 'fiber-cement-lap' | 'wood-lap'
  | 'panel' | 'stucco'
  | 'brick-veneer' | 'stone-veneer'

export interface CladdingSpec {
  label: string
  /** Material thickness at its thickest point. */
  thicknessM: number
  /** Clear space held BEHIND the cladding: rainscreen furring, or the drained
   *  cavity behind masonry. Zero for finishes applied straight to the WRB. */
  gapM: number
  color: string
  brand?: string
  /** Lap siding is laid in courses; this is the exposed face height (the
   *  "reveal"). Null for anything applied as a continuous surface. */
  exposureM: number | null
  /** True for veneers that need a foundation LEDGE to bear on — they carry their
   *  own weight down to the footing rather than hanging off the wall. */
  needsLedge: boolean
}

export function claddingSpec(kind: CladdingKind): CladdingSpec | null {
  switch (kind) {
    case 'vinyl-lap':
      return { label: 'Vinyl lap siding', thicknessM: 0.011, gapM: 0, color: '#d9dcd6', exposureM: 0.102, needsLedge: false }
    case 'fiber-cement-lap':
      return { label: 'Fiber-cement lap siding', thicknessM: 0.008, gapM: 0, color: '#b9bfc2', brand: 'HardiePlank (James Hardie)', exposureM: 0.178, needsLedge: false }
    case 'wood-lap':
      return { label: 'Wood lap siding (bevel)', thicknessM: 0.019, gapM: 0, color: '#b98b5e', exposureM: 0.152, needsLedge: false }
    case 'panel':
      // Rainscreen panel: furred off the WRB so the cavity can drain and dry.
      return { label: 'Rainscreen panel', thicknessM: 0.016, gapM: 0.019, color: '#6b7280', brand: 'Nichiha / Equitone', exposureM: null, needsLedge: false }
    case 'stucco':
      // 3-coat over lath. Wants FELT, not housewrap — see recommendedWrb.
      return { label: 'Stucco · 3-coat over lath', thicknessM: 0.022, gapM: 0, color: '#cfc7b8', exposureM: null, needsLedge: false }
    case 'brick-veneer':
      // Nominal 3-5/8" brick with a 1" drained cavity. Bears on a brick ledge.
      return { label: 'Brick veneer · 3-5/8" + 1" cavity', thicknessM: 0.092, gapM: 0.025, color: '#9c4a34', exposureM: 0.194, needsLedge: true }
    case 'stone-veneer':
      return { label: 'Adhered stone veneer', thicknessM: 0.038, gapM: 0, color: '#8d8577', brand: 'Cultured Stone (Boral)', exposureM: null, needsLedge: true }
    case 'none':
    default:
      return null
  }
}

/**
 * The barrier an assembly wants, from the cladding AND the framing behind it.
 *
 * Not a preference, in either direction:
 *
 *  • Wet-applied finishes — stucco, adhered stone — bond to synthetic housewrap
 *    and destroy its ability to drain. That is a failure, not a style
 *    disagreement, so they get felt (traditionally two layers of Grade D paper).
 *  • STEEL stud walls are sheathed in glass-mat gypsum and detailed with an
 *    AIR/VAPOUR BARRIER over it, not housewrap. Housewrap on a DensGlass wall is
 *    a residential answer to a commercial assembly.
 *
 * Cladding wins where the two disagree, because a wet finish will wreck a
 * membrane it bonds to regardless of what is behind it.
 */
export function recommendedWrb(kind: CladdingKind, framingMaterial: 'wood' | 'steel' = 'wood'): WrbKind {
  if (kind === 'stucco' || kind === 'stone-veneer') return 'felt'
  return framingMaterial === 'steel' ? 'avb' : 'housewrap'
}

// ── Temporary fall protection ────────────────────────────────────────────────
//
// Not part of the finished building, but part of what the frame LOOKS like for
// most of its life on site. On a multi-storey job the rail sections are nailed to
// the wall panels while they are still flat on the deck, then linked with more
// 2x4 once the walls are stood, making one continuous run around the perimeter.
// They come off when the next floor goes in — and are forgotten in place often
// enough that a frame without them looks less real than a frame with them.
//
// OSHA 1926.502: top rail 42" (±3"), midrail about halfway. The non-mandatory
// wood-railing guidance pairs a 2x4 top rail with posts at 6 ft; a 2x6 top rail
// buys you 8 ft. We build the 2x4 version, so 6 ft.

/** Top-rail height above the walking surface — 42". */
export const GUARDRAIL_TOP_M = 1.067
/** Post spacing for a 2x4 top rail — 6 ft. */
export const GUARDRAIL_POST_SPACING_M = 1.829
/** Nominal 2x4, actual. */
export const GUARDRAIL_MEMBER = { thick: 0.038, wide: 0.089 }

/**
 * Water-resistive barrier options.
 *
 * Not one layer, because the right WRB depends on what goes OVER it:
 *
 *  housewrap  Synthetic sheet — the default, and what most people mean by
 *             "Tyvek". Tough, wide rolls (so few seams), high vapour permeance.
 *             The standard behind lap siding on new wood frame.
 *  felt       Asphalt felt / Grade D paper — "tar paper". NOT obsolete: the IRC
 *             still names No. 15 felt as the baseline WRB and treats the rest as
 *             approved equivalents. Still the norm under STUCCO (usually two
 *             layers) and under adhered stone, where wet-applied finishes bond to
 *             synthetics and wreck their drainage.
*  fluid      Fluid-applied membrane — rolled or sprayed on, seamless.
 *  avb        Air/vapour barrier over the sheathing — self-adhered sheet or
 *             fluid-applied. The standard companion to glass-mat sheathing on
 *             STEEL stud walls, where the assembly is sheathing + AVB rather than
 *             sheathing + housewrap.
 *  integrated Nothing separate: the sheathing already has the barrier on its face
 *             (ZIP System and similar), so a second layer would be wrong.
 */
export type WrbKind = 'housewrap' | 'felt' | 'fluid' | 'avb' | 'integrated'

/** #15 felt is thicker than housewrap; both are drawn thicker than life to show. */
export const FELT_T = 0.0008

export function wrbLayer(kind: WrbKind = 'housewrap'): EnvelopeLayer | null {
  switch (kind) {
    case 'integrated':
      // The sheathing IS the barrier — see WrbKind. Nothing to add.
      return null
    case 'felt':
      return { label: 'Asphalt felt · No. 15', thicknessM: WRB_T + FELT_T, color: '#3f3f46' }
    case 'fluid':
      return { label: 'Fluid-applied WRB', thicknessM: WRB_T, color: '#5b7fa6' }
    case 'avb':
      return { label: 'Air/vapour barrier', thicknessM: WRB_T * 1.5, color: '#2f4f6f' }
    case 'housewrap':
    default:
      return { label: 'Housewrap (WRB)', thicknessM: WRB_T, color: '#eef2f6', brand: 'Tyvek (DuPont)' }
  }
}

/**
 * Does this wall get an exterior envelope?
 *
 * Only walls that face the weather. An interior partition has no sheathing and no
 * housewrap, and masonry is its own assembly rather than a sheathed stud wall.
 */
export function wallTakesEnvelope(wallRole?: string, framingType?: string): boolean {
  if (framingType === 'cmu') return false
  return wallRole === 'exterior-bearing'
}

// ── Per-wall framing spec ─────────────────────────────────────────────────────
// THE source of truth that lets a build honour EACH wall's own framing (material,
// stud size, steel gauge) instead of one global setting — so a wood exterior and
// a steel-stud interior coexist in the same model. Resolved from the picker's
// framingType + wallRole, both stamped onto every traced wall.

export interface WallFramingSpec {
  material: 'wood' | 'steel'
  /** Stud-size key ('2x4' | '2x6' | '2x8'). */
  studSize: string
  /** Nominal steel web width (e.g. '3-5/8' | '6'); undefined for wood. */
  steelWidth?: string
  /** Steel gauge, derived from the load role; undefined for wood. */
  gauge?: string
  /** CMU/concrete — solid, not stud-framed. */
  isMasonry: boolean
}

const FRAMING_TYPE_SPEC: Record<string, { material: 'wood' | 'steel'; studSize: string; steelWidth?: string; isMasonry?: boolean }> = {
  'wood-2x4':    { material: 'wood',  studSize: '2x4' },
  'wood-2x6':    { material: 'wood',  studSize: '2x6' },
  'wood-2x8':    { material: 'wood',  studSize: '2x8' },
  'steel-1-5-8': { material: 'steel', studSize: '2x4', steelWidth: '1-5/8' }, // furring
  'steel-3-5-8': { material: 'steel', studSize: '2x4', steelWidth: '3-5/8' },
  'steel-6':     { material: 'steel', studSize: '2x6', steelWidth: '6' },
  'steel-8':     { material: 'steel', studSize: '2x8', steelWidth: '8' }, // heavy structural
  'cmu':         { material: 'wood',  studSize: '2x6', isMasonry: true },
}

// Steel gauge by load role. Lower number = heavier steel. Structural/exterior
// studs are heavy (16–18 ga); only interior NON-load partitions use the
// paper-thin 25 ga. A 6" exterior-bearing stud is 16 ga, never 25.
const ROLE_GAUGE: Record<string, string> = {
  'exterior-bearing':     '16',
  'interior-bearing':     '18',
  'interior-non-bearing': '20',
  'partition':            '25',
}
export const DEFAULT_STEEL_GAUGE = '20'

/** Resolve a wall's framing spec from its picked framingType + load role.
 *  Unknown/auto walls fall back to wood 2×4. */
export function wallFramingSpec(framingType?: string, wallRole?: string): WallFramingSpec {
  const base = (framingType && FRAMING_TYPE_SPEC[framingType]) || FRAMING_TYPE_SPEC['wood-2x4']
  const gauge = base.material === 'steel'
    ? ((wallRole && ROLE_GAUGE[wallRole]) || DEFAULT_STEEL_GAUGE)
    : undefined
  return {
    material: base.material,
    studSize: base.studSize,
    steelWidth: base.steelWidth,
    gauge,
    isMasonry: base.isMasonry ?? false,
  }
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
