/**
 * autoBuildAreas — derive the whole shell from the wall footprint.
 *
 * The construction engine only frames WALLS (stud / plate / header / blocking).
 * Everything below and above the walls — slab, floor deck, ceiling, roof, and
 * the boxed eave that carries the fascia — is rendered from *traced areas*
 * (`floorsAreas` / `roofAreas`). Until now those existed only if the user drew
 * them by hand, so "Build 3D" on a print produced walls standing on nothing
 * with open sky above.
 *
 * This module closes that gap: given the walls, it derives the areas needed to
 * carry a build from slab through fascia. It is deliberately pure — no store,
 * no THREE — so the sequence can be unit-tested without a renderer.
 */
import type { ParsedWall, TracedLine } from '../types'
import { FLOORS_DEFAULTS, ROOF_DEFAULTS } from '../data/traceLayers'

/** Axis-aligned pixel-space rectangle, the same space `TracedLine` lives in. */
export interface FootprintPx {
  x1: number
  y1: number
  x2: number
  y2: number
}

/**
 * Smallest axis-aligned box containing every wall endpoint.
 *
 * A convex hull would be more faithful for an L-shaped plan, but areas are
 * stored as axis-aligned rectangles, so a hull could not be represented anyway.
 */
export function wallFootprintPx(walls: ParsedWall[]): FootprintPx | null {
  if (walls.length === 0) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const w of walls) {
    minX = Math.min(minX, w.x1, w.x2)
    minY = Math.min(minY, w.y1, w.y2)
    maxX = Math.max(maxX, w.x1, w.x2)
    maxY = Math.max(maxY, w.y1, w.y2)
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null
  // A degenerate footprint would build a zero-area slab and a roof the eave
  // builder rejects outright (it bails under 0.2 m a side).
  if (maxX - minX < 1 || maxY - minY < 1) return null
  return { x1: minX, y1: minY, x2: maxX, y2: maxY }
}

export interface DerivedAreas {
  floors: TracedLine[]
  roofs: TracedLine[]
}

export interface DeriveOptions {
  /** Number of storeys. Level 0 gets the slab; each level above gets a deck. */
  levels?: number
  /** Roof form — any of ROOF_PICKER.element. Defaults to Gable. */
  roofElement?: string
  /** Roof pitch string, e.g. '6:12'. */
  roofPitch?: string
  /** Deck joist type for levels above the slab. */
  deckElement?: string
  /** Joist spacing, e.g. '16"'. */
  joistSpacing?: string
  /** Injected so callers (and tests) control id generation. */
  makeId: (role: string, level: number) => string
}

/**
 * Build the slab → deck → ceiling → roof sequence over a footprint.
 *
 * Ordering follows how a house actually goes up, and each piece is the same
 * shape a user would have traced by hand:
 *   level 0        → concrete slab (the thing the walls stand on)
 *   levels 1..n-1  → framed floor deck (joists + subfloor)
 *   top level      → ceiling joists
 *   top level      → roof; its overhang is what emits soffit + fascia
 */
export function deriveBuildAreas(walls: ParsedWall[], opts: DeriveOptions): DerivedAreas {
  const fp = wallFootprintPx(walls)
  if (!fp) return { floors: [], roofs: [] }

  const levels = Math.max(1, Math.floor(opts.levels ?? 1))
  const spacing = opts.joistSpacing ?? FLOORS_DEFAULTS.size
  const deck = opts.deckElement ?? FLOORS_DEFAULTS.element
  const topLevel = levels - 1

  const rect = (role: string, level: number, elementType: string, size: string): TracedLine => ({
    id: opts.makeId(role, level),
    x1: fp.x1,
    y1: fp.y1,
    x2: fp.x2,
    y2: fp.y2,
    elementType,
    size,
    material: '',
    level,
  })

  const floors: TracedLine[] = [rect('slab', 0, 'Concrete Slab', spacing)]
  for (let lv = 1; lv < levels; lv++) floors.push(rect('deck', lv, deck, spacing))
  // The ceiling caps the top storey; the roof then sits above it.
  floors.push(rect('ceiling', topLevel, 'Ceiling joists', spacing))

  const roofs: TracedLine[] = [
    rect('roof', topLevel, opts.roofElement ?? ROOF_DEFAULTS.element, opts.roofPitch ?? ROOF_DEFAULTS.size),
  ]

  return { floors, roofs }
}
