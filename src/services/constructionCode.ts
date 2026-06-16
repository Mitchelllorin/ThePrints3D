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
