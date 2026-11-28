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
import { perimeterTest } from './wallFacing'

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

/**
 * THE OUTLINE OF A STOREY: its outside walls chained end to end into a closed
 * loop, as plan points. The largest loop wins (a courtyard's inner ring is not
 * the footprint). Null when the outside walls do not close.
 */
export function footprintLoopPx(walls: ParsedWall[], tol = 4): Array<[number, number]> | null {
  if (walls.length < 3) return null
  const outside = perimeterTest(walls)
  const segs = walls.filter((w) => outside(w)).map((w) => ({ a: [w.x1, w.y1] as [number, number], b: [w.x2, w.y2] as [number, number] }))
  const near = (p: [number, number], q: [number, number]) => Math.hypot(p[0] - q[0], p[1] - q[1]) <= tol
  const used = new Set<number>()
  let best: Array<[number, number]> | null = null
  let bestArea = 0
  for (let s0 = 0; s0 < segs.length; s0++) {
    if (used.has(s0)) continue
    used.add(s0)
    const loop: Array<[number, number]> = [segs[s0].a]
    let end = segs[s0].b
    let closed = false
    for (let guard = 0; guard < segs.length; guard++) {
      if (near(end, loop[0])) { closed = true; break }
      loop.push(end)
      const k = segs.findIndex((sg, i) => !used.has(i) && (near(sg.a, end) || near(sg.b, end)))
      if (k < 0) break
      used.add(k)
      end = near(segs[k].a, end) ? segs[k].b : segs[k].a
    }
    if (!closed || loop.length < 3) continue
    let area = 0
    for (let i = 0; i < loop.length; i++) {
      const [x1, y1] = loop[i], [x2, y2] = loop[(i + 1) % loop.length]
      area += x1 * y2 - x2 * y1
    }
    if (Math.abs(area) / 2 > bestArea) { bestArea = Math.abs(area) / 2; best = loop }
  }
  return best
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

  // THE SLAB AND DECKS FOLLOW THE WALLS. A box round the walls put slab in
  // the notch of an L and out past the walls. Where the outside walls close
  // into a loop, the floor takes that shape (as fractions of its box).
  const shaped = (a: TracedLine): TracedLine => {
    const loop = footprintLoopPx(walls.filter((w) => (w.level ?? 0) === (a.level ?? 0)))
    if (!loop) return a
    const w = a.x2 - a.x1, h = a.y2 - a.y1
    if (w < 1 || h < 1) return a
    const shape = loop.map(([x, y]) => [(x - a.x1) / w, (y - a.y1) / h] as [number, number])
    // A plain rectangle needs no shape.
    if (shape.length === 4 && shape.every(([u, v]) => (u < 0.01 || u > 0.99) && (v < 0.01 || v > 0.99))) return a
    return { ...a, shape }
  }
  const floors: TracedLine[] = [shaped(rect('slab', 0, 'Concrete Slab', spacing))]
  for (let lv = 1; lv < levels; lv++) floors.push(shaped(rect('deck', lv, deck, spacing)))
  // The ceiling caps the top storey; the roof then sits above it.
  floors.push(rect('ceiling', topLevel, 'Ceiling joists', spacing))

  const roofs: TracedLine[] = [
    rect('roof', topLevel, opts.roofElement ?? ROOF_DEFAULTS.element, opts.roofPitch ?? ROOF_DEFAULTS.size),
  ]

  return { floors, roofs }
}
