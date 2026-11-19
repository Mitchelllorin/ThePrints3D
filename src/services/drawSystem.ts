/**
 * THE DRAWING SYSTEM — one set of rules for drawing walls, used by the Draw it
 * sheet and by tracing in the main workspace (and by any family app that draws
 * on a plan). No React, no units: every point and every reach is in the same
 * space as the caller's points (print pixels, page millimetres — anything), so
 * the caller converts a screen reach into its own space once and passes it in.
 *
 * The behaviour is written down for people in docs/drawing-system.md. In short:
 *
 *   - RIGHT ANGLES BY DEFAULT, HELD LOOSELY. A wall within a few degrees of the
 *     plan's axes, or of square / straight on / 45° off the wall before it,
 *     lands exactly there. A deliberate move past that gives the angle you drew,
 *     to the whole degree.
 *   - ENDS AND WALLS ARE TARGETS. A point near another wall's end lands on it;
 *     a held wall runs on to meet a wall it nearly reaches, along its own line,
 *     rather than kinking to get there; a held wall stops level with a corner
 *     it lines up with, so the last wall of a room comes out square to the first.
 *   - THE START CLOSES THE SHAPE. Near the first point of a run, the point is
 *     the first point, and the caller finishes the run there.
 *
 * Every snap says what it did (`kind`, the held angle, a guide line) so the
 * caller can draw it: you see why the point went where it went.
 */

export interface Pt { x: number; y: number }
export interface Seg { a: Pt; b: Pt }

/** The numbers the system runs on. One place, so every app feels the same. */
export const DRAW = {
  /** Square, straight on and the plan axes hold a wall within this many degrees. */
  SQUARE_TOL_DEG: 9,
  /** A 45 holds within this many — tighter, so a real 40° wall is not stolen. */
  DIAG_TOL_DEG: 5,
  /** With squaring off, square and 45 still pull in from this close. */
  FREE_MAGNET_DEG: 3,
  /** The start point's reach, as a multiple of the ordinary reach: closing a
   *  room should be easy to hit. */
  CLOSE_REACH: 1.6,
  /** Screen pixels a finger has to land within to catch an end or a wall. */
  REACH_PX: 18,
  /** A press held still this long ends the run (long-press to finish). */
  LONG_PRESS_MS: 550,
  /** A second tap this soon, this close, is a double tap: it ends the run. */
  DOUBLE_TAP_MS: 450,
  DOUBLE_TAP_PX: 40,
  /** The loupe sits this far above the finger, so the finger never hides the point. */
  LOUPE_LIFT_PX: 96,
} as const

export type SnapKind =
  /** On the run's first point: the shape closes here. */
  | 'close'
  /** On another wall's end. */
  | 'end'
  /** On (or run on to) another wall. */
  | 'line'
  /** Held to an angle. */
  | 'angle'
  /** Held to an angle and stopped level with another corner. */
  | 'align'
  /** Free angle, whole degrees. */
  | 'free'
  /** No anchor yet and nothing near: on the grid. */
  | 'grid'
  | 'none'

export interface DrawSnapOpts {
  /** Where this wall starts. Without it the point is a first point. */
  from?: Pt | null
  /** Unit direction of the wall before this one (its start toward `from`). */
  prevDir?: Pt | null
  /** First point of the run, for closing the shape. */
  runStart?: Pt | null
  /** Ends of walls already drawn. */
  ends?: readonly Pt[]
  /** Walls already drawn (and print lines), to land on or run on to. */
  lines?: readonly Seg[]
  /** The reach, in the caller's units. */
  tol: number
  /** Square by default; false keeps only a light magnet at square and 45. */
  square?: boolean
  /** A length step along the wall (and a grid for a first point). */
  grid?: number
}

export interface DrawSnap {
  point: Pt
  kind: SnapKind
  /** The direction the wall was held to, in degrees (atan2 of y over x). */
  heldDeg?: number
  /** Held by the plan's axes, or by the turn off the wall before. */
  heldBy?: 'axis' | 'turn'
  /** A guide along the held direction, through the start and past the point. */
  guide?: Seg
  /** The corner this point lined up with, and the point: draw it dotted. */
  alignGuide?: Seg
  /** The corner made with the wall before, 0–180°. */
  cornerDeg?: number
  /** The point is the run's first point: finish the run as a closed shape. */
  closes: boolean
}

const DEG = Math.PI / 180
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y)
const norm = (d: number) => { let x = ((d + 180) % 360 + 360) % 360 - 180; if (x === -180) x = 180; return x }
const angDiff = (a: number, b: number) => Math.abs(norm(a - b))
const dirOf = (deg: number): Pt => ({ x: Math.cos(deg * DEG), y: Math.sin(deg * DEG) })

/** Closest point on a segment. */
export function nearestOnSeg(p: Pt, s: Seg): Pt {
  const dx = s.b.x - s.a.x, dy = s.b.y - s.a.y
  const l2 = dx * dx + dy * dy
  const t = l2 < 1e-12 ? 0 : Math.max(0, Math.min(1, ((p.x - s.a.x) * dx + (p.y - s.a.y) * dy) / l2))
  return { x: s.a.x + t * dx, y: s.a.y + t * dy }
}

/** The corner between the wall before (arriving along `prevDir`) and a wall
 *  leaving `from` toward `to`: 90 for square, 180 for straight on. */
export function cornerAngleDeg(prevDir: Pt, from: Pt, to: Pt): number {
  const vx = to.x - from.x, vy = to.y - from.y
  const L = Math.hypot(vx, vy), P = Math.hypot(prevDir.x, prevDir.y)
  if (L < 1e-9 || P < 1e-9) return 0
  const c = (-prevDir.x * vx - prevDir.y * vy) / (L * P)
  return Math.acos(Math.max(-1, Math.min(1, c))) / DEG
}

/**
 * A TYPED CORNER ANGLE. The new wall leaves `from` at `cornerDeg` to the wall
 * before, on the side the pointer is on (`toward`), at length `len`.
 */
export function pointAtCornerAngle(prevDir: Pt, from: Pt, cornerDeg: number, len: number, toward: Pt): Pt {
  const back = Math.atan2(-prevDir.y, -prevDir.x) / DEG
  const want = Math.atan2(toward.y - from.y, toward.x - from.x) / DEG
  const a1 = back + cornerDeg, a2 = back - cornerDeg
  const deg = angDiff(a1, want) <= angDiff(a2, want) ? a1 : a2
  const d = dirOf(deg)
  return { x: from.x + d.x * len, y: from.y + d.y * len }
}

/** Where a ray from `o` along unit `d` crosses a segment, as the distance along the ray. */
function rayHit(o: Pt, d: Pt, s: Seg): number | null {
  const ex = s.b.x - s.a.x, ey = s.b.y - s.a.y
  const den = d.x * ey - d.y * ex
  if (Math.abs(den) < 1e-12) return null
  const qx = s.a.x - o.x, qy = s.a.y - o.y
  const t = (qx * ey - qy * ex) / den
  const u = (qx * d.y - qy * d.x) / den
  if (t <= 1e-9 || u < -1e-6 || u > 1 + 1e-6) return null
  return t
}

/** The angles a wall can be held to, and how loosely. */
function heldAngles(prevDir: Pt | null | undefined, square: boolean) {
  const out: Array<{ deg: number; tol: number; by: 'axis' | 'turn' }> = []
  const sq = square ? DRAW.SQUARE_TOL_DEG : DRAW.FREE_MAGNET_DEG
  const dg = square ? DRAW.DIAG_TOL_DEG : DRAW.FREE_MAGNET_DEG
  if (prevDir && Math.hypot(prevDir.x, prevDir.y) > 1e-9) {
    const p = Math.atan2(prevDir.y, prevDir.x) / DEG
    // Straight on, square either way, 45 either way. Never straight back.
    for (const k of [0, 90, -90]) out.push({ deg: norm(p + k), tol: sq, by: 'turn' })
    for (const k of [45, -45, 135, -135]) out.push({ deg: norm(p + k), tol: dg, by: 'turn' })
  }
  for (const k of [0, 90, 180, -90]) out.push({ deg: k, tol: sq, by: 'axis' })
  for (const k of [45, 135, -45, -135]) out.push({ deg: k, tol: dg, by: 'axis' })
  return out
}

/**
 * WHERE THE POINT LANDS. In order: the run's start (closes the shape); another
 * wall's end; then, with a start, the held angle (running on to a wall it
 * nearly meets, or stopping level with a corner it lines up with) or the free
 * angle; without a start, along a wall, then the grid.
 */
export function snapDrawPoint(p: Pt, o: DrawSnapOpts): DrawSnap {
  const tol = Math.max(1e-9, o.tol)
  const from = o.from ?? null
  const square = o.square ?? true
  const corner = (q: Pt) => (from && o.prevDir ? Math.round(cornerAngleDeg(o.prevDir, from, q)) : undefined)

  // 1. Close the shape: the first point, from further out than anything else.
  if (from && o.runStart && dist(from, o.runStart) > tol && dist(p, o.runStart) <= tol * DRAW.CLOSE_REACH) {
    const q = { ...o.runStart }
    return { point: q, kind: 'close', closes: true, cornerDeg: corner(q) }
  }

  // 2. Another wall's end — not the one being drawn from.
  let bestEnd: Pt | null = null
  let bestD = tol
  for (const e of o.ends ?? []) {
    if (from && dist(e, from) < 1e-6) continue
    const d = dist(e, p)
    if (d < bestD) { bestD = d; bestEnd = e }
  }
  if (bestEnd) {
    const q = { ...bestEnd }
    return { point: q, kind: 'end', closes: false, cornerDeg: corner(q) }
  }

  // 3. A first point: along a wall, or the grid.
  if (!from) {
    let best: Pt | null = null
    let bd = tol
    for (const s of o.lines ?? []) {
      const c = nearestOnSeg(p, s)
      const d = dist(c, p)
      if (d < bd) { bd = d; best = c }
    }
    if (best) return { point: best, kind: 'line', closes: false }
    if (o.grid && o.grid > 0) {
      return { point: { x: Math.round(p.x / o.grid) * o.grid, y: Math.round(p.y / o.grid) * o.grid }, kind: 'grid', closes: false }
    }
    return { point: { ...p }, kind: 'none', closes: false }
  }

  const len = dist(p, from)
  if (len < 1e-9) return { point: { ...p }, kind: 'none', closes: false }
  const raw = Math.atan2(p.y - from.y, p.x - from.x) / DEG

  // 4. Held: the nearest angle within its own tolerance. On a tie the turn off
  // the last wall wins — that is the corner you are making.
  let held: { deg: number; by: 'axis' | 'turn' } | null = null
  let hd = Infinity
  for (const c of heldAngles(o.prevDir, square)) {
    const d = angDiff(raw, c.deg)
    if (d <= c.tol && d < hd - 1e-9) { hd = d; held = c }
  }
  const deg = held ? held.deg : Math.round(raw)
  const u = dirOf(deg)
  let t = (p.x - from.x) * u.x + (p.y - from.y) * u.y
  if (t <= 0) t = len

  // Run on to a wall it nearly meets, along its own line.
  let hitT: number | null = null
  let hitD = tol
  for (const s of o.lines ?? []) {
    const h = rayHit(from, u, s)
    if (h == null) continue
    const d = Math.abs(h - t)
    if (d < hitD) { hitD = d; hitT = h }
  }
  const at = (k: number): Pt => ({ x: from.x + u.x * k, y: from.y + u.y * k })
  const guideFor = (k: number): Seg => ({ a: { ...from }, b: at(k + tol * 3) })
  if (hitT != null) {
    const q = at(hitT)
    return {
      point: q, kind: 'line', closes: false, cornerDeg: corner(q),
      ...(held ? { heldDeg: held.deg, heldBy: held.by, guide: guideFor(hitT) } : {}),
    }
  }

  if (held) {
    // Stop level with a corner it lines up with (the run's start first among equals).
    let alignT: number | null = null
    let alignE: Pt | null = null
    let ad = tol
    const cands = [...(o.runStart ? [o.runStart] : []), ...(o.ends ?? [])]
    for (const e of cands) {
      const s = (e.x - from.x) * u.x + (e.y - from.y) * u.y
      if (s <= tol) continue
      // A corner ON the line is an end snap or a wall to meet, not an alignment.
      const off = Math.abs((e.x - from.x) * u.y - (e.y - from.y) * u.x)
      if (off < tol) continue
      const d = Math.abs(s - t)
      if (d < ad) { ad = d; alignT = s; alignE = e }
    }
    if (alignT != null && alignE) {
      const q = at(alignT)
      return {
        point: q, kind: 'align', closes: false, cornerDeg: corner(q),
        heldDeg: held.deg, heldBy: held.by, guide: guideFor(alignT), alignGuide: { a: { ...alignE }, b: q },
      }
    }
  }

  if (o.grid && o.grid > 0) t = Math.max(o.grid, Math.round(t / o.grid) * o.grid)
  const q = at(t)
  return held
    ? { point: q, kind: 'angle', closes: false, cornerDeg: corner(q), heldDeg: held.deg, heldBy: held.by, guide: guideFor(t) }
    : { point: q, kind: 'free', closes: false, cornerDeg: corner(q) }
}

/** The ends of every wall in a list, for `ends`. */
export function endsOf(walls: ReadonlyArray<{ x1: number; y1: number; x2: number; y2: number }>): Pt[] {
  return walls.flatMap((w) => [{ x: w.x1, y: w.y1 }, { x: w.x2, y: w.y2 }])
}

/** Every wall in a list as a segment, for `lines`. */
export function segsOf(walls: ReadonlyArray<{ x1: number; y1: number; x2: number; y2: number }>): Seg[] {
  return walls.map((w) => ({ a: { x: w.x1, y: w.y1 }, b: { x: w.x2, y: w.y2 } }))
}

/** Is a tap a double tap of the last one? Timed from the last lift. */
export function isDoubleTap(last: { t: number; x: number; y: number } | null, t: number, x: number, y: number): boolean {
  return !!last && t - last.t < DRAW.DOUBLE_TAP_MS && Math.hypot(x - last.x, y - last.y) < DRAW.DOUBLE_TAP_PX
}

// ── Curves ──────────────────────────────────────────────────────────────────

/**
 * THE BAY ON A CURVE IS A QUARTER OF THE RADIUS, held between 8" and 16"
 * (millimetres in, millimetres out). The framing rule for a bent plate: 3" of
 * spacing per foot of radius, never past a stud space, never slivers.
 */
export function curveBayMm(radiusMm: number): number {
  return Math.min(406.4, Math.max(203.2, Math.abs(radiusMm) * 0.25))
}

/**
 * The bulge of a wall bent through `p`: its signed distance off the chord, to
 * the left of a→b positive. Held to at most a half circle either way.
 */
export function bulgeThrough(a: Pt, b: Pt, p: Pt): number {
  const c = dist(a, b)
  if (c < 1e-9) return 0
  const nx = -(b.y - a.y) / c, ny = (b.x - a.x) / c
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2
  const s = (p.x - mx) * nx + (p.y - my) * ny
  return Math.max(-c / 2, Math.min(c / 2, s))
}

/** The arc over chord a→b with bulge `s`: its centre and radius. Null when flat. */
export function arcOf(a: Pt, b: Pt, s: number): { cx: number; cy: number; r: number } | null {
  const c = dist(a, b)
  if (c < 1e-9 || Math.abs(s) < 1e-6 * c) return null
  const nx = -(b.y - a.y) / c, ny = (b.x - a.x) / c
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2
  const r = (c * c / 4 + s * s) / (2 * Math.abs(s))
  const k = s - Math.sign(s) * r
  return { cx: mx + nx * k, cy: my + ny * k, r }
}

/** The bulge that gives an arc of radius `r` over a chord of `chord` (the
 *  shorter arc), on side `sign`. A radius smaller than half the chord is a
 *  half circle. */
export function bulgeForRadius(chord: number, r: number, sign: number): number {
  const half = chord / 2
  const rr = Math.max(half, Math.abs(r))
  return (sign < 0 ? -1 : 1) * (rr - Math.sqrt(Math.max(0, rr * rr - half * half)))
}

/**
 * The points of an arc from a to b, bulge `s`, cut into chords no longer than
 * `maxChord` — what actually gets framed: short straight walls, a stud at
 * every break. The ends are exactly a and b, so the walls either side stay on.
 */
export function arcPoints(a: Pt, b: Pt, s: number, maxChord: number): Pt[] {
  const arc = arcOf(a, b, s)
  if (!arc) return [{ ...a }, { ...b }]
  const a0 = Math.atan2(a.y - arc.cy, a.x - arc.cx)
  const a1 = Math.atan2(b.y - arc.cy, b.x - arc.cx)
  // Sweep the way the bulge says: left bulge on a→b runs clockwise in y-down
  // terms when s > 0 — worked out from the apex rather than remembered.
  const c = dist(a, b)
  const apex = { x: (a.x + b.x) / 2 + (-(b.y - a.y) / c) * s, y: (a.y + b.y) / 2 + ((b.x - a.x) / c) * s }
  const am = Math.atan2(apex.y - arc.cy, apex.x - arc.cx)
  const within = (lo: number, hi: number, x: number) => {
    const span = ((hi - lo) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI)
    const off = ((x - lo) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI)
    return off <= span
  }
  // Counter-clockwise from a0 to a1 if the apex lies on that way round.
  let sweep = ((a1 - a0) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI)
  if (!within(a0, a1, am)) sweep -= 2 * Math.PI
  const arcLen = Math.abs(sweep) * arc.r
  const n = Math.max(2, Math.min(240, Math.ceil(arcLen / Math.max(1e-9, maxChord))))
  const pts: Pt[] = [{ ...a }]
  for (let i = 1; i < n; i++) {
    const t = a0 + (sweep * i) / n
    pts.push({ x: arc.cx + arc.r * Math.cos(t), y: arc.cy + arc.r * Math.sin(t) })
  }
  pts.push({ ...b })
  return pts
}

/**
 * An arc as walls: one chord per bay, each a facet of a curved wall (`bend`),
 * and every break after the first carries one stud, not two.
 */
export function arcWalls(a: Pt, b: Pt, s: number, maxChord: number): Array<{ x1: number; y1: number; x2: number; y2: number; bend?: boolean; sharedStartStud?: boolean }> {
  const pts = arcPoints(a, b, s, maxChord)
  if (pts.length === 2) return [{ x1: a.x, y1: a.y, x2: b.x, y2: b.y }]
  return pts.slice(1).map((q, i) => ({
    x1: pts[i].x, y1: pts[i].y, x2: q.x, y2: q.y, bend: true,
    ...(i > 0 ? { sharedStartStud: true } : {}),
  }))
}

/** Where a readout sits so it never covers the point or the pointer: `gap`
 *  off `at`, on the side away from `avoid`. Screen pixels in, screen pixels out. */
export function clearOf(at: Pt, avoid: Pt, gap: number, prefer?: Pt): Pt {
  let dx = at.x - avoid.x, dy = at.y - avoid.y
  let L = Math.hypot(dx, dy)
  if (L < 1e-6 && prefer) { dx = prefer.x; dy = prefer.y; L = Math.hypot(dx, dy) }
  if (L < 1e-6) { dx = 0; dy = -1; L = 1 }
  return { x: at.x + (dx / L) * gap, y: at.y + (dy / L) * gap }
}

// ── Editing after drawing ──────────────────────────────────────────────────

type WallLike = { x1: number; y1: number; x2: number; y2: number }
const isLevel = (w: WallLike, tol: number) => Math.abs(w.y2 - w.y1) <= tol && Math.abs(w.x2 - w.x1) > tol
const isPlumb = (w: WallLike, tol: number) => Math.abs(w.x2 - w.x1) <= tol && Math.abs(w.y2 - w.y1) > tol

/**
 * MOVE A CORNER. Every wall with an end on the corner goes with it, so the
 * walls stay joined. A wall that was level stays level and one that was plumb
 * stays plumb: its far end slides with the corner on the one axis that keeps
 * it square — and the walls at THAT end go with it — which is how dragging
 * one corner of a rectangle resizes the rectangle instead of skewing it.
 * Diagonals simply stretch. Returns the indices that changed with their new
 * coordinates, so the caller can update just those.
 */
export function movedCorner<W extends WallLike>(walls: readonly W[], at: Pt, to: Pt, tol: number): Map<number, W> {
  const out = new Map<number, W>()
  const get = (i: number) => out.get(i) ?? walls[i]
  const near = (x: number, y: number, p: Pt) => Math.hypot(x - p.x, y - p.y) <= tol
  const moveJoint = (p: Pt, q: Pt, skip: Set<number>) => {
    walls.forEach((_, i) => {
      if (skip.has(i)) return
      const w = get(i)
      if (near(w.x1, w.y1, p)) out.set(i, { ...w, x1: q.x, y1: q.y })
      else if (near(w.x2, w.y2, p)) out.set(i, { ...w, x2: q.x, y2: q.y })
    })
  }
  // First the far ends of the square walls on the corner (before anything moves).
  const far: Array<{ from: Pt; to: Pt; wall: number }> = []
  walls.forEach((w, i) => {
    const s = near(w.x1, w.y1, at), e = near(w.x2, w.y2, at)
    if (!s && !e) return
    const f = s ? { x: w.x2, y: w.y2 } : { x: w.x1, y: w.y1 }
    if (isLevel(w, tol)) far.push({ from: f, to: { x: f.x, y: to.y }, wall: i })
    else if (isPlumb(w, tol)) far.push({ from: f, to: { x: to.x, y: f.y }, wall: i })
  })
  moveJoint(at, to, new Set())
  for (const f of far) {
    if (Math.hypot(f.to.x - f.from.x, f.to.y - f.from.y) < 1e-9) continue
    const w = get(f.wall)
    // The square wall's own far end…
    if (near(w.x1, w.y1, f.from)) out.set(f.wall, { ...w, x1: f.to.x, y1: f.to.y })
    else out.set(f.wall, { ...w, x2: f.to.x, y2: f.to.y })
    // …and every other wall joined there.
    moveJoint(f.from, f.to, new Set([f.wall]))
  }
  return out
}

/**
 * SLIDE A WALL square to itself. It moves across, not along — a wall is slid
 * to make a room bigger, not shifted up its own line — and the walls joined to
 * its ends stretch to stay on it.
 */
export function slidWall<W extends WallLike>(walls: readonly W[], i: number, by: Pt, tol: number): Map<number, W> {
  const out = new Map<number, W>()
  const w = walls[i]
  if (!w) return out
  const L = Math.hypot(w.x2 - w.x1, w.y2 - w.y1)
  if (L < 1e-9) return out
  const nx = -(w.y2 - w.y1) / L, ny = (w.x2 - w.x1) / L
  const k = by.x * nx + by.y * ny
  const d = { x: nx * k, y: ny * k }
  const a = { x: w.x1, y: w.y1 }, b = { x: w.x2, y: w.y2 }
  out.set(i, { ...w, x1: w.x1 + d.x, y1: w.y1 + d.y, x2: w.x2 + d.x, y2: w.y2 + d.y })
  walls.forEach((o, j) => {
    if (j === i) return
    let n = o
    for (const p of [a, b]) {
      if (Math.hypot(n.x1 - p.x, n.y1 - p.y) <= tol) n = { ...n, x1: p.x + d.x, y1: p.y + d.y }
      else if (Math.hypot(n.x2 - p.x, n.y2 - p.y) <= tol) n = { ...n, x2: p.x + d.x, y2: p.y + d.y }
    }
    if (n !== o) out.set(j, n)
  })
  return out
}
