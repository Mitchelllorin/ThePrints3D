/**
 * WHICH ROOM IS THIS? — the room the walls close around a point.
 *
 * Drawn plans have no rooms, only walls. A room is found the way a person
 * finds it on paper: start where you tapped and spread until you hit walls.
 * The walls are drawn into a grid at their real thickness and the open space
 * is flood-filled from the point. Spreading out to the edge of the grid means
 * the point is outside the building, or the room is not closed yet: no room.
 *
 * What comes back is the room's floor as rectangles (rows of the fill, merged
 * where they line up), inside the wall faces, in print px: enough to lay a
 * ceiling board in an L-shaped room or a room with an angled wall.
 *
 * Pure: runs in node and in a test.
 */

import type { ParsedWall, RoomBulkhead } from '../types'

export interface RoomRegion {
  /** The floor of the room, [x1, y1, x2, y2] in print px. */
  rects: Array<[number, number, number, number]>
  /** Floor area in square print px. */
  areaPx: number
  /** Bounding box, print px. */
  x1: number; y1: number; x2: number; y2: number
}

/** The finest the grid goes; the coarsest is set by MAX_CELLS. */
const CELL_MM = 25
/** Grid cells along the longer side, at most. */
const MAX_CELLS = 700

/** The walls a room is found from: the drawn ones on that floor, or — on a
 *  plan with none drawn — the ones read off the print. */
export function roomWalls(walls: ParsedWall[], level: number): ParsedWall[] {
  const here = walls.filter((w) => (w.level ?? 0) === level)
  const mine = here.filter((w) => w.source === 'user')
  return mine.length > 0 ? mine : here
}

type Seg = Pick<ParsedWall, 'x1' | 'y1' | 'x2' | 'y2' | 'thickness'>

interface Grid {
  mask: Uint8Array
  gw: number; gh: number
  ox: number; oy: number
  cell: number
  minX: number; minY: number; maxX: number; maxY: number
}

/** The walls drawn into a grid, at their real thickness. */
function wallGrid(walls: Seg[], mmPerPx: number | null): Grid | null {
  if (walls.length === 0) return null
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const w of walls) {
    if (![w.x1, w.y1, w.x2, w.y2].every(Number.isFinite)) continue
    minX = Math.min(minX, w.x1, w.x2); maxX = Math.max(maxX, w.x1, w.x2)
    minY = Math.min(minY, w.y1, w.y2); maxY = Math.max(maxY, w.y1, w.y2)
  }
  if (!Number.isFinite(minX) || maxX - minX < 1 || maxY - minY < 1) return null
  const span = Math.max(maxX - minX, maxY - minY)
  const cell = Math.max(span / MAX_CELLS, mmPerPx && mmPerPx > 0 ? CELL_MM / mmPerPx : span / MAX_CELLS)
  // A margin of open cells all round, so outside is one connected space.
  const ox = minX - cell * 2, oy = minY - cell * 2
  const gw = Math.ceil((maxX - minX) / cell) + 5
  const gh = Math.ceil((maxY - minY) / cell) + 5
  const mask = new Uint8Array(gw * gh)
  for (const w of walls) {
    const ax = (w.x1 - ox) / cell, ay = (w.y1 - oy) / cell
    const bx = (w.x2 - ox) / cell, by = (w.y2 - oy) / cell
    if (![ax, ay, bx, by].every(Number.isFinite)) continue
    // Half the wall's thickness, never under a cell, so a thin line still shuts.
    const r = Math.max(0.75, (w.thickness || 0) / cell / 2)
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) * 2))
    for (let s = 0; s <= steps; s++) {
      const t = s / steps
      const x = ax + (bx - ax) * t, y = ay + (by - ay) * t
      const x0 = Math.max(0, Math.floor(x - r)), x1 = Math.min(gw - 1, Math.ceil(x + r))
      const y0 = Math.max(0, Math.floor(y - r)), y1 = Math.min(gh - 1, Math.ceil(y + r))
      for (let yy = y0; yy <= y1; yy++) {
        for (let xx = x0; xx <= x1; xx++) {
          if ((xx + 0.5 - x) ** 2 + (yy + 0.5 - y) ** 2 <= r * r) mask[yy * gw + xx] = 1
        }
      }
    }
  }
  return { mask, gw, gh, ox, oy, cell, minX, minY, maxX, maxY }
}

/** Flood from one cell. Null if it reaches the edge (outside, or not closed). */
function fill(g: Grid, start: number, seen: Uint8Array): number[] | null {
  const { mask, gw, gh } = g
  const cells = [start]
  const stack = [start]
  seen[start] = 1
  let out = false
  while (stack.length) {
    const i = stack.pop()!
    const x = i % gw, y = (i - x) / gw
    if (x === 0 || y === 0 || x === gw - 1 || y === gh - 1) { out = true; continue }
    for (const j of [i - 1, i + 1, i - gw, i + gw]) {
      if (!mask[j] && !seen[j]) { seen[j] = 1; stack.push(j); cells.push(j) }
    }
  }
  return out ? null : cells
}

/** Rows of the fill, merged downward where a run lines up with the one above. */
function toRegion(g: Grid, cells: number[]): RoomRegion {
  const { gw, ox, oy, cell } = g
  const inRoom = new Set(cells)
  const rows = new Map<number, number[]>()
  for (const i of cells) {
    const x = i % gw, y = (i - x) / gw
    const r = rows.get(y)
    if (r) r.push(x); else rows.set(y, [x])
  }
  const ys = [...rows.keys()].sort((a, b) => a - b)
  const rects: Array<[number, number, number, number]> = []
  let open = new Map<string, number>()
  let prevY = -2
  let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity
  for (const y of ys) {
    if (y !== prevY + 1) open = new Map()
    prevY = y
    const xs = rows.get(y)!.sort((a, b) => a - b)
    const next = new Map<string, number>()
    let k = 0
    while (k < xs.length) {
      const x0 = xs[k]
      let x = x0
      while (k < xs.length && xs[k] === x && inRoom.has(y * gw + x)) { k++; x++ }
      const key = `${x0},${x}`
      const px0 = ox + x0 * cell, px1 = ox + x * cell
      const py0 = oy + y * cell, py1 = oy + (y + 1) * cell
      bx0 = Math.min(bx0, px0); bx1 = Math.max(bx1, px1)
      by0 = Math.min(by0, py0); by1 = Math.max(by1, py1)
      const o = open.get(key)
      if (o !== undefined) { rects[o][3] = py1; next.set(key, o) } else { rects.push([px0, py0, px1, py1]); next.set(key, rects.length - 1) }
    }
    open = next
  }
  return { rects, areaPx: cells.length * cell * cell, x1: bx0, y1: by0, x2: bx1, y2: by1 }
}

/**
 * The room around `p`, or null when `p` is on a wall, outside the walls, or in
 * a room that is not closed.
 */
export function roomAt(walls: Seg[], p: { x: number; y: number }, mmPerPx: number | null): RoomRegion | null {
  const g = wallGrid(walls, mmPerPx)
  if (!g || p.x <= g.minX || p.x >= g.maxX || p.y <= g.minY || p.y >= g.maxY) return null
  const sx = Math.floor((p.x - g.ox) / g.cell), sy = Math.floor((p.y - g.oy) / g.cell)
  const start = sy * g.gw + sx
  if (g.mask[start]) return null
  const cells = fill(g, start, new Uint8Array(g.gw * g.gh))
  return cells ? toRegion(g, cells) : null
}

/**
 * EVERY ROOM ON THE FLOOR — each closed space the walls make, with a point in
 * it. Slivers under `minAreaM2` (a gap between two walls drawn side by side)
 * are left out. A steel job hangs a ceiling in every one.
 */
export function allRooms(walls: Seg[], mmPerPx: number | null, minAreaM2 = 1): Array<RoomRegion & { seed: { x: number; y: number } }> {
  const g = wallGrid(walls, mmPerPx)
  if (!g) return []
  const seen = new Uint8Array(g.gw * g.gh)
  const out: Array<RoomRegion & { seed: { x: number; y: number } }> = []
  const minPx = mmPerPx && mmPerPx > 0 ? (minAreaM2 * 1e6) / (mmPerPx * mmPerPx) : 0
  for (let i = 0; i < g.mask.length; i++) {
    if (g.mask[i] || seen[i]) continue
    const cells = fill(g, i, seen)
    if (!cells || cells.length * g.cell * g.cell < minPx) continue
    const region = toRegion(g, cells)
    // The seed: the middle of the biggest rectangle, so it is well inside.
    const big = region.rects.reduce((b, r) => ((r[2] - r[0]) * (r[3] - r[1]) > (b[2] - b[0]) * (b[3] - b[1]) ? r : b))
    out.push({ ...region, seed: { x: (big[0] + big[2]) / 2, y: (big[1] + big[3]) / 2 } })
  }
  return out
}

/**
 * A straight line laid across a room, cut to the pieces that are on its floor
 * (print px). Used to run ceiling channel wall to wall in any shape of room.
 */
export function clipToRegion(r: RoomRegion, a: { x: number; y: number }, b: { x: number; y: number }, step = 2): Array<[{ x: number; y: number }, { x: number; y: number }]> {
  const L = Math.hypot(b.x - a.x, b.y - a.y)
  if (L < 1e-6) return []
  const n = Math.max(2, Math.ceil(L / step))
  const out: Array<[{ x: number; y: number }, { x: number; y: number }]> = []
  let s0: number | null = null
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
    const on = regionHas(r, p)
    if (on && s0 == null) s0 = t
    if ((!on || i === n) && s0 != null) {
      const t1 = on ? t : (i - 1) / n
      if (t1 > s0) out.push([{ x: a.x + (b.x - a.x) * s0, y: a.y + (b.y - a.y) * s0 }, { x: a.x + (b.x - a.x) * t1, y: a.y + (b.y - a.y) * t1 }])
      s0 = null
    }
  }
  return out
}

/** Is `p` on the floor of this room? */
export function regionHas(r: RoomRegion, p: { x: number; y: number }): boolean {
  if (p.x < r.x1 || p.x > r.x2 || p.y < r.y1 || p.y > r.y2) return false
  return r.rects.some(([x1, y1, x2, y2]) => p.x >= x1 && p.x <= x2 && p.y >= y1 && p.y <= y2)
}

/**
 * A bulkhead laid out against its wall, on the room's side: where its run
 * starts and ends (print px, at the wall's face, pulled in off the walls at
 * each end) and which way is out into the room (unit vector). Null when the
 * wall does not face the room.
 */
export function bulkheadLayout(
  b: RoomBulkhead,
  region: RoomRegion,
  thicknessPx: number,
): { a: [number, number]; z: [number, number]; out: [number, number] } | null {
  const dx = b.x2 - b.x1, dy = b.y2 - b.y1
  const L = Math.hypot(dx, dy)
  if (L < 1) return null
  const ux = dx / L, uy = dy / L
  // Out into the room: the side of the wall a step off its middle lands in it.
  const half = thicknessPx / 2
  const step = half + Math.max(2, thicknessPx)
  // Anywhere along it, not just its middle: an outside wall runs past several
  // rooms, and only its stretch beside this one counts.
  let out: [number, number] | null = null
  const samples = Math.max(8, Math.ceil(L / 4))
  for (let i = 1; i < samples && !out; i++) {
    const mx = b.x1 + (dx * i) / samples, my = b.y1 + (dy * i) / samples
    for (const [nx, ny] of [[-uy, ux], [uy, -ux]] as Array<[number, number]>) {
      if (regionHas(region, { x: mx + nx * step, y: my + ny * step })) { out = [nx, ny]; break }
    }
  }
  if (!out) return null
  // Along the face, kept to the stretch that is actually in the room.
  const fx = b.x1 + out[0] * (half + 0.5), fy = b.y1 + out[1] * (half + 0.5)
  const probe = (t: number) => regionHas(region, { x: fx + ux * t + out![0] * 1.5, y: fy + uy * t + out![1] * 1.5 })
  const n = Math.max(8, Math.ceil(L / 2))
  let t0 = -1, t1 = -1
  for (let i = 0; i <= n; i++) {
    const t = (L * i) / n
    if (probe(t)) { if (t0 < 0) t0 = t; t1 = t }
  }
  if (t0 < 0 || t1 - t0 < 1) return null
  return {
    a: [fx + ux * t0, fy + uy * t0],
    z: [fx + ux * t1, fy + uy * t1],
    out,
  }
}
