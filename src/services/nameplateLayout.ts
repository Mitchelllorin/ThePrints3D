/**
 * WHERE EVERY NAMEPLATE GOES — the collision rules, as one pure function.
 *
 * A nameplate floats with the part it names, and two things are never allowed:
 *
 *   IT NEVER COVERS ITS OWN PART. The plate is offset outward from the model's
 *   centre, beside the part, so the thing being named stays in view. If that
 *   side has no room it tries the other sides before it gives up.
 *
 *   TWO PLATES NEVER OVERLAP. When they meet:
 *     1. Rank them — selected, then warning, then nearer the camera, then the
 *        one that entered the scene first (so the order is stable as it turns).
 *     2. The winner keeps its tier; the loser drops one.
 *     3. Still no room: push it further out along whichever side has space and
 *        draw a thin leader back to its part.
 *     4. No more than three at full at once.
 *     5. Nothing is hidden outright. A plate with no room left collapses to a
 *        dot on its part, and dots that would sit on each other merge into one
 *        marker with a count.
 *
 * Pure: screen pixels in, screen pixels out. No THREE, no DOM, no store — the
 * scene projects the parts, this decides, the overlay draws.
 */

export type Tier = 0 | 1 | 2 | 3

export interface Pt { x: number; y: number }
export interface Box { x: number; y: number; w: number; h: number }
export interface Size { w: number; h: number }

export interface PlateRequest {
  id: string
  /** Where the leader lands on the part: the top-middle of it, on screen. */
  anchor: Pt
  /** The part's outline on screen (convex). The plate may not touch it. */
  hull: readonly Pt[]
  /** Distance from the camera — smaller is nearer. */
  depth: number
  /** Entry order, for a tie-break that does not flicker. */
  order: number
  selected: boolean
  warning: boolean
  /** The tier asked for, before any collision. 0 = no plate. */
  tier: Tier
  /** The plate's size at each tier it can show. */
  sizes: Record<1 | 2 | 3, Size>
  /** The part is too small on screen to carry text: show a dot. */
  tooSmall: boolean
}

export interface PlacedPlate {
  id: string
  tier: 1 | 2 | 3
  box: Box
  anchor: Pt
  /** Draw a line from the plate back to its anchor. */
  leader: boolean
  /** Which side it went to — fed back next frame so it does not hop. */
  dir: number
}

export interface Dot { id: string; x: number; y: number }
export interface Cluster { ids: string[]; x: number; y: number }

export interface NameplateLayout {
  plates: PlacedPlate[]
  dots: Dot[]
  clusters: Cluster[]
}

/** Clear space between a plate and its part, and between two plates. */
export const PLATE_GAP = 6
/** How far each push moves a plate out. */
const PUSH_STEP = 14
/** How many pushes before a tier is given up. */
const PUSH_STEPS = 10
/** At most this many at full. */
export const MAX_FULL = 3
/** Dots closer than a tap target plus its spacing are one marker. */
export const DOT_MERGE = 56
/** Depth is ranked in steps this big, so two walls at nearly the same distance
 *  do not swap places every frame as the model turns. */
const DEPTH_STEP = 0.75

/** The eight sides a plate can go to, clockwise from the right. */
const DIRS: Pt[] = Array.from({ length: 8 }, (_, i) => {
  const a = (i * Math.PI) / 4
  return { x: Math.round(Math.cos(a) * 1e6) / 1e6, y: Math.round(Math.sin(a) * 1e6) / 1e6 }
})

/** Rank order: the first in the list wins every collision it is in. */
export function rankPlates<T extends PlateRequest>(reqs: readonly T[]): T[] {
  return [...reqs].sort((a, b) =>
    Number(b.selected) - Number(a.selected)
    || Number(b.warning) - Number(a.warning)
    || Math.round(a.depth / DEPTH_STEP) - Math.round(b.depth / DEPTH_STEP)
    || a.order - b.order)
}

function boxesOverlap(a: Box, b: Box, gap: number): boolean {
  return a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap
}

/**
 * Does a box touch a convex outline? Separating-axis test: the box's own two
 * axes, then every edge normal of the outline. `gap` grows the box first.
 */
export function boxHitsHull(b: Box, hull: readonly Pt[], gap: number): boolean {
  if (hull.length === 0) return false
  const x1 = b.x - gap, y1 = b.y - gap, x2 = b.x + b.w + gap, y2 = b.y + b.h + gap
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const p of hull) {
    if (p.x < minX) minX = p.x
    if (p.x > maxX) maxX = p.x
    if (p.y < minY) minY = p.y
    if (p.y > maxY) maxY = p.y
  }
  if (maxX < x1 || minX > x2 || maxY < y1 || minY > y2) return false
  if (hull.length < 3) return true
  const corners = [{ x: x1, y: y1 }, { x: x2, y: y1 }, { x: x2, y: y2 }, { x: x1, y: y2 }]
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i], c = hull[(i + 1) % hull.length]
    const nx = c.y - a.y, ny = a.x - c.x
    let hMin = Infinity, hMax = -Infinity, bMin = Infinity, bMax = -Infinity
    for (const p of hull) { const d = p.x * nx + p.y * ny; if (d < hMin) hMin = d; if (d > hMax) hMax = d }
    for (const p of corners) { const d = p.x * nx + p.y * ny; if (d < bMin) bMin = d; if (d > bMax) bMax = d }
    if (bMax < hMin || bMin > hMax) return false
  }
  return true
}

/** Convex hull, for turning a projected box's eight corners into an outline. */
export function convexHull(points: readonly Pt[]): Pt[] {
  const p = [...points].sort((a, b) => a.x - b.x || a.y - b.y)
  if (p.length < 3) return p
  const cross = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
  const lower: Pt[] = []
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop()
    lower.push(q)
  }
  const upper: Pt[] = []
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop()
    upper.push(q)
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1))
}

/** The sides to try, best first: straight out from the centre, then round to the far side. */
function dirOrder(anchor: Pt, centre: Pt, prev: number | undefined): number[] {
  const dx = anchor.x - centre.x, dy = anchor.y - centre.y
  // At the centre there is no "outward"; up is the side that covers least.
  const out = Math.hypot(dx, dy) < 1 ? 6 : ((Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) % 8) + 8) % 8
  const order = [0, 1, -1, 2, -2, 3, -3, 4].map((k) => (out + k + 8) % 8)
  // Where it was last frame goes first, so a plate does not hop sides as the
  // model turns a degree. It only moves when that side stops working.
  if (prev != null && order.includes(prev)) return [prev, ...order.filter((d) => d !== prev)]
  return order
}

/** The box `dist` px out from the anchor along a side, nearest edge first. */
function boxAt(anchor: Pt, dir: Pt, dist: number, s: Size): Box {
  const reach = Math.abs(dir.x) * s.w / 2 + Math.abs(dir.y) * s.h / 2
  const cx = anchor.x + dir.x * (dist + reach), cy = anchor.y + dir.y * (dist + reach)
  return { x: cx - s.w / 2, y: cy - s.h / 2, w: s.w, h: s.h }
}

function inside(b: Box, bounds: Box): boolean {
  return b.x >= bounds.x && b.y >= bounds.y && b.x + b.w <= bounds.x + bounds.w && b.y + b.h <= bounds.y + bounds.h
}

/**
 * Lay every plate out.
 *
 * `bounds` is the canvas less the safe-area edges; a plate is never placed
 * outside it. `obstacles` are the HUD controls actually on screen — the rail,
 * the top buttons, the explode slider — measured, not guessed. `centre` is the model's centre on screen,
 * which decides what "outward" means. `prevDirs` is the last layout's sides.
 */
export function layoutNameplates(
  reqs: readonly PlateRequest[],
  bounds: Box,
  centre: Pt,
  prevDirs?: ReadonlyMap<string, number>,
  /** The HUD's controls, on screen. A plate never sits on a control. */
  obstacles: readonly Box[] = [],
): NameplateLayout {
  const plates: PlacedPlate[] = []
  const dotReqs: PlateRequest[] = []
  let full = 0

  for (const r of rankPlates(reqs)) {
    if (r.tier === 0) continue
    if (r.tooSmall) { dotReqs.push(r); continue }
    let want: 1 | 2 | 3 = r.tier
    if (want === 3) {
      if (full >= MAX_FULL) want = 2
      else full++
    }

    const sides = dirOrder(r.anchor, centre, prevDirs?.get(r.id))
    // How far the part itself reaches out from the anchor on each side. The
    // search starts there, so a plate hugs the edge of its part instead of
    // starting on top of it and having to be pushed off.
    const clear = DIRS.map((dir) => {
      let m = 0
      for (const p of r.hull) m = Math.max(m, (p.x - r.anchor.x) * dir.x + (p.y - r.anchor.y) * dir.y)
      return m
    })
    let blockedByPlate = false
    const tryTier = (tier: 1 | 2 | 3, from: number, to: number, sideList: readonly number[] = sides): PlacedPlate | null => {
      const size = r.sizes[tier]
      for (let step = from; step <= to; step++) {
        for (const d of sideList) {
          const box = boxAt(r.anchor, DIRS[d], clear[d] + PLATE_GAP + step * PUSH_STEP, size)
          if (!inside(box, bounds)) continue
          if (obstacles.some((o) => boxesOverlap(box, o, PLATE_GAP))) continue
          // Half the gap here: the search already starts a full gap clear of
          // the part, and testing the full gap again would reject a plate
          // sitting exactly where it was put.
          if (boxHitsHull(box, r.hull, PLATE_GAP / 2)) continue
          if (plates.some((p) => boxesOverlap(box, p.box, PLATE_GAP))) { blockedByPlate = true; continue }
          // Beside its part it needs no line. Pushed out, it does: the line is
          // what keeps it honest once the plate has moved off the part.
          return { id: r.id, tier, box, anchor: r.anchor, leader: step > 1, dir: d }
        }
      }
      return null
    }

    // The order the rules give. Its own tier beside the part, on the outward
    // sides. If those are only off the screen or over its own part, flip to the
    // far side at the same tier. If another plate is in the way, that is a
    // collision and this one lost it: one tier down beside the part, then one
    // tier down pushed out, then each lower tier the same way. Flipping a FULL
    // plate across the model to dodge a collision would cover more of the model
    // than dropping a tier, and the model wins that argument.
    const down = (want > 1 ? want - 1 : want) as 1 | 2 | 3
    let placed = tryTier(want, 0, 1, sides.slice(0, 3))
      ?? (!blockedByPlate ? tryTier(want, 0, 1, sides.slice(3)) : null)
      ?? (down !== want ? tryTier(down, 0, 1) : null)
      ?? tryTier(down, 2, PUSH_STEPS)
    for (let t = down - 1; !placed && t >= 1; t--) placed = tryTier(t as 1 | 2, 0, PUSH_STEPS)
    if (placed) {
      if (want === 3 && placed.tier !== 3) full--
      plates.push(placed)
    } else {
      if (want === 3) full--
      dotReqs.push(r)
    }
  }

  // DOTS. In rank order, each joins the first marker it would sit on; a marker
  // stays where its best-ranked part is, so it does not wander as dots join.
  const groups: { ids: string[]; x: number; y: number }[] = []
  for (const r of dotReqs) {
    const g = groups.find((k) => Math.hypot(k.x - r.anchor.x, k.y - r.anchor.y) < DOT_MERGE)
    if (g) g.ids.push(r.id)
    else groups.push({ ids: [r.id], x: r.anchor.x, y: r.anchor.y })
  }
  const dots: Dot[] = []
  const clusters: Cluster[] = []
  for (const g of groups) {
    if (g.ids.length === 1) dots.push({ id: g.ids[0], x: g.x, y: g.y })
    else clusters.push(g)
  }
  return { plates, dots, clusters }
}
