/**
 * THE DRAW IT SHEET — the house, where it sits on the page, and the walls
 * inside it. No React here; FootprintEditor draws it and DrawItSheet holds it.
 *
 * One sheet, one workflow, in the order a house goes up: pull the outline to
 * size, put it where you want it on the page, then draw the inside walls on
 * the same sheet, and frame the lot at once.
 *
 * TWO SPACES, BOTH IN MILLIMETRES:
 *   - FOOTPRINT space is what `placeBoxes` returns: the main box's top-left
 *     corner at 0,0, sections off its sides.
 *   - PAGE space is the sheet: the main box's top-left corner is at `origin`.
 *     Inside walls live in page space, so pulling the left wall out (which
 *     moves the origin) leaves every inside wall where it was drawn.
 *
 * THE PAGE DOES NOT RECENTRE. Moving the house has to mean something, and on a
 * sheet that refits itself around the house the moment you let go, it would
 * mean nothing. So the page is a fixed piece of paper, bigger than the house;
 * it grows when the house outgrows it and never shrinks under you.
 */
import { placeBoxes, footprintOutline, type FootprintBox, type Point, type Rect } from './footprint'
import { cornerShift, normalizeBoxes, snapTo, type Grip } from './footprintEdit'
import { freeAnglePoint } from './wallTraceReducer'

export interface InsideWall {
  x1: number; y1: number; x2: number; y2: number
  /**
   * A FACET OF A CURVED WALL, not a corner. The next chord carries on round the
   * arc rather than arriving at right angles, so there is nothing for this wall
   * to butt into: it is framed at its own length, break to break, with no corner
   * post, no plate lap and no corner extension.
   */
  bend?: boolean
  /**
   * The stud at this wall's START break is the one the chord before it stood up.
   * Set on every chord but the first of a ring, so a break carries ONE stud
   * instead of one from each side of it.
   */
  sharedStartStud?: boolean
}

/**
 * A CIRCLE ON THE SHEET — a round post, a footing, a fire pit, a turning
 * circle. Page millimetres, same as the walls, so it holds its size against the
 * print and a diameter typed on it is the diameter you build.
 */
export interface DrawItCircle { cx: number; cy: number; r: number }

export interface DrawItPlan {
  boxes: FootprintBox[]
  /** The main box's top-left corner, on the page. */
  origin: Point
  /** The paper. */
  page: { w: number; d: number }
  /** Centrelines, in page millimetres. */
  walls: InsideWall[]
  /**
   * THE HOUSE AT ANY ANGLE. Left out, the outline is the boxes. Set, it is this
   * shape instead — the outside face, corner by corner, in page millimetres —
   * and the boxes wait underneath for "Square" to put them back. It starts as
   * the boxes' own outline, so switching over changes nothing until a corner
   * is dragged.
   */
  shape?: Point[]
  /**
   * Circles drawn on the sheet. They are marks on the paper, not part of the
   * shell: the page grows and shifts them with the walls, but picking the house
   * up and moving it leaves them where they were drawn — a post does not slide
   * along with the building you drew it inside.
   */
  circles?: DrawItCircle[]
}

/** Paper round the house on a new sheet: room to move it, room for dimensions.
 *  Not more — the page is what fits the screen, so every foot of margin is a
 *  foot of house you do not get to see on a phone. */
export const PAGE_MARGIN_MM = 12 * 304.8
/** The least paper kept round the house when the page grows to fit it. */
const MIN_CLEAR_MM = 10 * 304.8
/** Shorter than this is a slip of the finger, not a wall. */
export const MIN_WALL_MM = 300
/** A drag within this many degrees of square is square. */
const SQUARE_DEG = 10

/**
 * WALLS ON PAPER, WITH NO BUILDING ROUND THEM.
 *
 * A carport is three walls. A fence line is one. An addition is whatever the
 * print says, not what a box says. So the sheet can be paper and nothing else —
 * the print when there is one, squared paper when there is not — and the walls
 * dragged on it are the building. No boxes, so nothing closes a loop round them
 * and no wall is invented to finish a rectangle.
 */
export function wallsPlan(page: { w: number; d: number }): DrawItPlan {
  return { boxes: [], origin: { x: 0, y: 0 }, page, walls: [] }
}

/** What walls occupy on the page — the building, when there is no box. */
export function wallsBounds(walls: readonly InsideWall[]): { x1: number; y1: number; w: number; d: number } | null {
  if (walls.length === 0) return null
  const xs = walls.flatMap((w) => [w.x1, w.x2])
  const ys = walls.flatMap((w) => [w.y1, w.y2])
  const x1 = Math.min(...xs), y1 = Math.min(...ys)
  return { x1, y1, w: Math.max(...xs) - x1, d: Math.max(...ys) - y1 }
}

// ── Circles ────────────────────────────────────────────────────────────────

/** The circles on the sheet, when there are none yet. */
export function planCircles(plan: DrawItPlan): DrawItCircle[] {
  return plan.circles ?? []
}

export function addCircle(plan: DrawItPlan, c: DrawItCircle): DrawItPlan {
  return { ...plan, circles: [...planCircles(plan), c] }
}

export function removeCircle(plan: DrawItPlan, i: number): DrawItPlan {
  return { ...plan, circles: planCircles(plan).filter((_, k) => k !== i) }
}

/** A diameter typed on the circle: the figure a post or a footing is ordered by. */
export function withCircleDiameter(plan: DrawItPlan, i: number, mm: number): DrawItPlan {
  if (!(mm > 0)) return plan
  return { ...plan, circles: planCircles(plan).map((c, k) => (k === i ? { ...c, r: mm / 2 } : c)) }
}

// ── The string a circle is built from ──────────────────────────────────────

/**
 * A CIRCLE IS NOT A WALL, AND A CURVED WALL IS NOT A CURVE.
 *
 * What goes up is a string of short straight walls round the ring — one stud bay
 * each, chord after chord — and the sheathing bends over them. That is how a
 * curved wall or a gazebo wall is really framed: a plate bent round the circle
 * in bays, and a stud at every break. So the circle on the sheet is the line the
 * string is set out to, and the walls are the chords.
 */
/** 16" on centre — the framing's own spacing, and the longest a curved bay goes. */
export const STUD_BAY_MM = 406.4
/** 8" on centre — the tightest a bay is laid out, so a small ring is not slivers. */
const MIN_CHORD_MM = 203.2
/**
 * THE BAY ON A CURVE IS A QUARTER OF THE RADIUS.
 *
 * That is the framing rule for a curved plate read as a number: 3" of spacing
 * per foot of radius, so a 4 ft radius frames at 12", an 8 ft at 24". It is
 * also why a ring always comes out around 25 straight walls however big it is —
 * a quarter of the radius as the chord is a little over 14° at every break.
 */
const CHORD_PER_RADIUS = 0.25
/** Fewer than this and it is a stubby polygon, not a ring. */
const MIN_CHORDS = 8
/** Past this nobody is framing it, and the plan stops reading. */
const MAX_CHORDS = 240

export interface CircleString {
  walls: InsideWall[]
  /** How many short walls the ring went up as. */
  chords: number
  /** The length of each chord — one bay of wall. */
  chordMm: number
}

/**
 * The ring as walls: `n` chords, `n` as close to a bay each as a whole number
 * can get. Consecutive chords share an end to the last bit — the same point is
 * worked out once and walked twice — so each break is one joint, not two ends a
 * hair apart, and the ring closes on itself exactly.
 *
 * The bay is a quarter of the radius, held between 8" and 16": a tighter curve
 * gets closer studs because the plate has to bend round it, and a bay is held
 * to a stud space because the skin still has to land on something. The chord
 * comes out a millimetre or two either side of the target — the count is a
 * whole number of walls, so the ring is shared out between them.
 */
export function circleString(c: DrawItCircle): CircleString {
  const r = Math.abs(c.r)
  if (r < 1) return { walls: [], chords: 0, chordMm: 0 }
  const bay = Math.min(STUD_BAY_MM, Math.max(MIN_CHORD_MM, r * CHORD_PER_RADIUS))
  const n = Math.max(MIN_CHORDS, Math.min(MAX_CHORDS,
    Math.round((2 * Math.PI * r) / bay)))
  // One point per break, worked out once and walked twice, so a chord's start is
  // the same number as its neighbour's end — and the ring closes on itself
  // exactly instead of leaving the last break a rounding-error apart.
  const pts = Array.from({ length: n }, (_, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n
    return { x: c.cx + r * Math.cos(a), y: c.cy + r * Math.sin(a) }
  })
  const walls: InsideWall[] = pts.map((p, i) => {
    const q = pts[(i + 1) % n]
    return {
      x1: p.x, y1: p.y, x2: q.x, y2: q.y,
      bend: true,
      // This chord's start is where the one before it ended, and that chord's
      // own end stud is already at the joint — so this end brings none.
      sharedStartStud: i > 0,
    }
  })
  return { walls, chords: n, chordMm: 2 * r * Math.sin(Math.PI / n) }
}

/**
 * EVERYTHING ON THE SHEET THAT GETS BUILT: the drawn walls, then the string
 * under each circle.
 *
 * The string is worked out from the circle every time rather than stored beside
 * it, so a diameter typed on the ring re-flows its bays and nothing can drift
 * out of step with the number that governs it.
 */
export function planWalls(plan: DrawItPlan): InsideWall[] {
  const rings = planCircles(plan)
  if (rings.length === 0) return plan.walls
  return [...plan.walls, ...rings.flatMap((c) => circleString(c).walls)]
}

export function initialPlan(first: FootprintBox): DrawItPlan {
  return {
    boxes: [first],
    origin: { x: PAGE_MARGIN_MM, y: PAGE_MARGIN_MM },
    page: { w: first.widthMm + 2 * PAGE_MARGIN_MM, d: first.depthMm + 2 * PAGE_MARGIN_MM },
    walls: [],
  }
}

/** Every box, on the page. */
export function houseRects(plan: DrawItPlan): Rect[] {
  return placeBoxes(plan.boxes).map((r) => ({
    x1: r.x1 + plan.origin.x, y1: r.y1 + plan.origin.y,
    x2: r.x2 + plan.origin.x, y2: r.y2 + plan.origin.y,
  }))
}

/** The outside face of the house, on the page. */
export function houseOutline(plan: DrawItPlan): Point[] {
  return plan.shape ?? footprintOutline(houseRects(plan))
}

function boundsOf(rects: readonly Rect[], walls: readonly InsideWall[], circles: readonly DrawItCircle[] = []): Rect {
  const xs = [...rects.flatMap((r) => [r.x1, r.x2]), ...walls.flatMap((w) => [w.x1, w.x2]),
    ...circles.flatMap((c) => [c.cx - c.r, c.cx + c.r])]
  const ys = [...rects.flatMap((r) => [r.y1, r.y2]), ...walls.flatMap((w) => [w.y1, w.y2]),
    ...circles.flatMap((c) => [c.cy - c.r, c.cy + c.r])]
  return { x1: Math.min(...xs), y1: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) }
}

/**
 * Grow the paper so the house and its walls have clear space round them.
 * Run when a drag ENDS, never during one — paper growing under a moving finger
 * is the page running away from you. It only ever grows: if the house went off
 * the left or top, everything shifts right or down by the same amount.
 */
export function fitPage(plan: DrawItPlan): DrawItPlan {
  // Nothing on the paper yet: there is no extent to fit, and asking for one
  // would produce Infinity and a page to match.
  if (!plan.shape && plan.boxes.length === 0 && plan.walls.length === 0 && planCircles(plan).length === 0) return plan
  const b = boundsOf(plan.shape ? [shapeBounds(plan.shape)] : houseRects(plan), plan.walls, planCircles(plan))
  const dx = Math.max(0, MIN_CLEAR_MM - b.x1)
  const dy = Math.max(0, MIN_CLEAR_MM - b.y1)
  const w = Math.max(plan.page.w + dx, b.x2 + dx + MIN_CLEAR_MM)
  const d = Math.max(plan.page.d + dy, b.y2 + dy + MIN_CLEAR_MM)
  if (!dx && !dy && w === plan.page.w && d === plan.page.d) return plan
  return {
    ...plan,
    origin: { x: plan.origin.x + dx, y: plan.origin.y + dy },
    page: { w, d },
    walls: plan.walls.map((k) => ({ x1: k.x1 + dx, y1: k.y1 + dy, x2: k.x2 + dx, y2: k.y2 + dy })),
    ...(plan.circles ? { circles: plan.circles.map((c) => ({ ...c, cx: c.cx + dx, cy: c.cy + dy })) } : {}),
    ...(plan.shape ? { shape: plan.shape.map((q) => ({ x: q.x + dx, y: q.y + dy })) } : {}),
  }
}

function shapeBounds(shape: readonly Point[]): Rect {
  const xs = shape.map((q) => q.x), ys = shape.map((q) => q.y)
  return { x1: Math.min(...xs), y1: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) }
}

/**
 * The outline after a handle was pulled, from the plan as it was when the drag
 * began. Pulling the left or top wall moves the corner the footprint is
 * measured from, so the origin moves back by the same amount — the wall across
 * the house, and every inside wall, stay where they are on the page.
 */
export function resized(start: DrawItPlan, nextBoxes: FootprintBox[], grip: Grip): DrawItPlan {
  const boxes = normalizeBoxes(nextBoxes)
  const s = cornerShift(start.boxes, boxes, grip)
  return { ...start, boxes, origin: { x: start.origin.x - s.xMm, y: start.origin.y - s.yMm } }
}

/**
 * The house picked up and moved, walls and all — they are inside it, so they
 * go with it. Snapped, and kept on the paper.
 */
export function movedHouse(start: DrawItPlan, dxMm: number, dyMm: number, snapMm: number): DrawItPlan {
  const rel = start.shape
    ? [shapeBounds(start.shape.map((q) => ({ x: q.x - start.origin.x, y: q.y - start.origin.y })))]
    : placeBoxes(start.boxes)
  const minX = Math.min(...rel.map((r) => r.x1)), maxX = Math.max(...rel.map((r) => r.x2))
  const minY = Math.min(...rel.map((r) => r.y1)), maxY = Math.max(...rel.map((r) => r.y2))
  // The DISTANCE moved is snapped, not where the corner lands — a house at
  // 20' 3" on the page moves in clean steps from there rather than jumping
  // onto the grid the moment it is picked up.
  const x = Math.min(Math.max(start.origin.x + snapTo(dxMm, snapMm), -minX), start.page.w - maxX)
  const y = Math.min(Math.max(start.origin.y + snapTo(dyMm, snapMm), -minY), start.page.d - maxY)
  const mx = x - start.origin.x, my = y - start.origin.y
  return {
    ...start,
    origin: { x, y },
    walls: start.walls.map((k) => ({ x1: k.x1 + mx, y1: k.y1 + my, x2: k.x2 + mx, y2: k.y2 + my })),
    ...(start.shape ? { shape: start.shape.map((q) => ({ x: q.x + mx, y: q.y + my })) } : {}),
  }
}

/** Is a page point inside the house? Ray-crossing test against the outline. */
export function insideHouse(plan: DrawItPlan, p: Point): boolean {
  return insidePoly(houseOutline(plan), p)
}

function insidePoly(poly: readonly Point[], p: Point): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j]
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

/** The lines an inside wall can land on: the inside face of the shell, and other inside walls. */
function landingLines(plan: DrawItPlan, shellMm: number, skip?: number, noShell?: boolean): Array<{ a: Point; b: Point }> {
  const out: Array<{ a: Point; b: Point }> = []
  const poly = noShell ? [] : houseOutline(plan)
  // The shell's INSIDE face: each outline edge moved inward by the wall's
  // thickness. An inside wall stops at the face of the wall it meets — that is
  // where the tee is framed. Which way is inward is asked of the outline itself
  // (a step off the edge's middle, in or out), not read off its winding.
  const n = poly.length
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n]
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    if (len < 1e-6) continue
    let nx = -(b.y - a.y) / len, ny = (b.x - a.x) / len
    const mid = { x: (a.x + b.x) / 2 + nx, y: (a.y + b.y) / 2 + ny }
    if (!insidePoly(poly, mid)) { nx = -nx; ny = -ny }
    out.push({ a: { x: a.x + nx * shellMm, y: a.y + ny * shellMm }, b: { x: b.x + nx * shellMm, y: b.y + ny * shellMm } })
  }
  plan.walls.forEach((k, i) => { if (i !== skip) out.push({ a: { x: k.x1, y: k.y1 }, b: { x: k.x2, y: k.y2 } }) })
  return out
}

function nearestOnSegment(p: Point, a: Point, b: Point): Point {
  const dx = b.x - a.x, dy = b.y - a.y
  const l2 = dx * dx + dy * dy
  const t = l2 < 1e-9 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2))
  return { x: a.x + t * dx, y: a.y + t * dy }
}

export interface SnapOpts {
  /** Grid step for a point that lands on nothing. */
  gridMm: number
  /** How close counts as landing on a line or an end. */
  tolMm: number
  /** The shell's thickness, so a wall stops at its inside face. */
  shellMm: number
  /** The wall's other end, when there is one: square to it if nearly square. */
  from?: Point
  /** An inside wall to leave out (the one being edited). */
  skip?: number
  /** Any angle: the wall keeps the angle it was dragged at (see freeWallPoint). */
  free?: boolean
  /** No shell — walls drawn on their own (see wallsPlan). Only other walls are
   *  lines to land on, because there is no outline to land on. */
  noShell?: boolean
}

/**
 * Where a finger's point lands. In order: square to the other end if the drag
 * is nearly square; then onto another wall's end; then onto a wall's face or
 * line; then onto the grid. A square wall that lands on a face stays square —
 * it slides along its own axis to meet it, rather than kinking to reach it.
 */
export function snapWallPoint(plan: DrawItPlan, p: Point, o: SnapOpts): Point {
  if (o.free && o.from) return freeWallPoint(plan, p, { ...o, from: o.from })
  const q = { ...p }
  let lock: 'x' | 'y' | null = null
  if (o.from) {
    const ang = (Math.atan2(Math.abs(p.y - o.from.y), Math.abs(p.x - o.from.x)) * 180) / Math.PI
    if (ang < SQUARE_DEG) { q.y = o.from.y; lock = 'y' }
    else if (ang > 90 - SQUARE_DEG) { q.x = o.from.x; lock = 'x' }
  }

  // Other walls' ends.
  for (const [i, k] of plan.walls.entries()) {
    if (i === o.skip) continue
    for (const e of [{ x: k.x1, y: k.y1 }, { x: k.x2, y: k.y2 }]) {
      if (Math.hypot(e.x - q.x, e.y - q.y) < o.tolMm && (!lock || Math.abs((lock === 'y' ? e.y - q.y : e.x - q.x)) < 1)) return e
    }
  }

  // Faces and lines.
  let best: Point | null = null
  let bestD = o.tolMm
  for (const { a, b } of landingLines(plan, o.shellMm, o.skip, o.noShell)) {
    let c: Point | null
    if (lock) {
      // Slide along the locked axis to where it crosses this line.
      const horizontal = lock === 'y'
      const [u1, u2, v1, v2] = horizontal ? [a.y, b.y, a.x, b.x] : [a.x, b.x, a.y, b.y]
      const at = horizontal ? q.y : q.x
      if (Math.abs(u2 - u1) < 1e-9 || (at - u1) * (at - u2) > 0) { c = null }
      else {
        const v = v1 + ((at - u1) / (u2 - u1)) * (v2 - v1)
        c = horizontal ? { x: v, y: q.y } : { x: q.x, y: v }
      }
    } else {
      c = nearestOnSegment(q, a, b)
    }
    if (!c) continue
    const d = Math.hypot(c.x - q.x, c.y - q.y)
    if (d < bestD) { bestD = d; best = c }
  }
  if (best) return best

  // The grid.
  if (lock !== 'x') q.x = snapTo(q.x, o.gridMm)
  if (lock !== 'y') q.y = snapTo(q.y, o.gridMm)
  if (o.from && lock === 'y') q.y = o.from.y
  if (o.from && lock === 'x') q.x = o.from.x
  return q
}

/**
 * ANY ANGLE. The grid would bend a diagonal — snapping both ends to squared
 * paper turns a 30° drag into whatever angle the nearest grid point makes — so
 * a free wall is snapped the way a carpenter lays one out: a whole-degree angle
 * (square and 45 pull in from a few degrees off) and a clean length along it.
 * It still lands on another wall's end, and still meets a wall or the shell
 * face, sliding along its own line to get there rather than kinking.
 */
function freeWallPoint(plan: DrawItPlan, p: Point, o: SnapOpts & { from: Point }): Point {
  const { from } = o
  for (const [i, k] of plan.walls.entries()) {
    if (i === o.skip) continue
    for (const e of [{ x: k.x1, y: k.y1 }, { x: k.x2, y: k.y2 }]) {
      if (Math.hypot(e.x - p.x, e.y - p.y) < o.tolMm) return e
    }
  }
  const [ax, ay] = freeAnglePoint(from.x, from.y, p.x, p.y)
  const len = Math.hypot(ax - from.x, ay - from.y)
  if (len < 1e-6) return { ...p }
  const ux = (ax - from.x) / len, uy = (ay - from.y) / len
  // Meet a line: where the wall's own line crosses it, if that is near.
  let best: Point | null = null
  let bestD = o.tolMm
  for (const { a, b } of landingLines(plan, o.shellMm, o.skip, o.noShell)) {
    const ex = b.x - a.x, ey = b.y - a.y
    const den = ux * ey - uy * ex
    if (Math.abs(den) < 1e-9) continue
    const qx = a.x - from.x, qy = a.y - from.y
    const t = (qx * ey - qy * ex) / den
    const u = (qx * uy - qy * ux) / den
    if (t <= 0 || u < -1e-6 || u > 1 + 1e-6) continue
    const d = Math.abs(t - len)
    if (d < bestD) { bestD = d; best = { x: from.x + ux * t, y: from.y + uy * t } }
  }
  if (best) return best
  const l = Math.max(o.gridMm, snapTo(len, o.gridMm))
  return { x: from.x + ux * l, y: from.y + uy * l }
}

export function wallLength(w: InsideWall): number {
  return Math.hypot(w.x2 - w.x1, w.y2 - w.y1)
}

/** A typed length: the start stays put and the end moves along the wall. Not snapped. */
export function withLength(w: InsideWall, mm: number): InsideWall {
  const len = wallLength(w)
  if (len < 1e-9 || !(mm > 0)) return w
  const k = mm / len
  return { ...w, x2: w.x1 + (w.x2 - w.x1) * k, y2: w.y1 + (w.y2 - w.y1) * k }
}

/** A drawn wall is kept only if it is long enough to be one and lies inside the house — both ends. */
export function acceptsWall(plan: DrawItPlan, w: InsideWall): boolean {
  if (wallLength(w) < MIN_WALL_MM) return false
  const e = 1   // an end ON the inside face is inside
  const mx = (w.x1 + w.x2) / 2, my = (w.y1 + w.y2) / 2
  const pull = (x: number, y: number) => {
    const d = Math.hypot(mx - x, my - y) || 1
    return { x: x + ((mx - x) / d) * e, y: y + ((my - y) / d) * e }
  }
  return insideHouse(plan, pull(w.x1, w.y1)) && insideHouse(plan, pull(w.x2, w.y2)) && insideHouse(plan, { x: mx, y: my })
}

/**
 * A wall dragged out past the shell stops at the shell's inside face — the
 * first one it meets going from its start — rather than running out through
 * the outside wall.
 */
export function clipToShell(plan: DrawItPlan, from: Point, to: Point, shellMm: number): Point {
  if (!insideHouse(plan, from)) return to
  const shell = landingLines({ ...plan, walls: [] }, shellMm)
  let best = 1
  const dx = to.x - from.x, dy = to.y - from.y
  for (const { a, b } of shell) {
    const ex = b.x - a.x, ey = b.y - a.y
    const den = dx * ey - dy * ex
    if (Math.abs(den) < 1e-9) continue
    const qx = a.x - from.x, qy = a.y - from.y
    const t = (qx * ey - qy * ex) / den
    const u = (qx * dy - qy * dx) / den
    if (t > 1e-6 && t < best && u >= -1e-6 && u <= 1 + 1e-6) best = t
  }
  return { x: from.x + dx * best, y: from.y + dy * best }
}

// ── The house at any angle ─────────────────────────────────────────────────

/** Switch the outline to a shape you can bend: the boxes' outline, as corners. */
export function toShape(plan: DrawItPlan): DrawItPlan {
  return plan.shape ? plan : { ...plan, shape: footprintOutline(houseRects(plan)) }
}

/** Back to boxes: the shape goes, the boxes underneath were never touched. */
export function toBoxes(plan: DrawItPlan): DrawItPlan {
  if (!plan.shape) return plan
  const rest = { ...plan }
  delete rest.shape
  return rest
}

/** Within this many degrees of square, a wall dragged by its corner is square. */
const CORNER_SQUARE_DEG = 4

/**
 * Where a dragged corner lands. In clean steps, and then — the part that makes it
 * easy — a wall off it that is nearly square to its neighbour corner IS square,
 * so pulling one corner out to cut a diagonal does not knock the walls either
 * side of it off by a hair. Anything further off is the angle you meant.
 */
export function placeCorner(shape: readonly Point[], i: number, p: Point, gridMm: number): Point {
  const n = shape.length
  // The DISTANCE moved is snapped, from where the corner was — a house sitting
  // off the grid moves its corners in clean steps from where they are.
  const o0 = shape[i]
  const q = { x: o0.x + snapTo(p.x - o0.x, gridMm), y: o0.y + snapTo(p.y - o0.y, gridMm) }
  for (const k of [(i - 1 + n) % n, (i + 1) % n]) {
    const o = shape[k]
    const ang = (Math.atan2(Math.abs(q.y - o.y), Math.abs(q.x - o.x)) * 180) / Math.PI
    if (ang < CORNER_SQUARE_DEG) q.y = o.y
    else if (ang > 90 - CORNER_SQUARE_DEG) q.x = o.x
  }
  return q
}

export function movedCorner(plan: DrawItPlan, i: number, p: Point, gridMm: number): DrawItPlan {
  if (!plan.shape) return plan
  const at = placeCorner(plan.shape, i, p, gridMm)
  return { ...plan, shape: plan.shape.map((q, k) => (k === i ? at : q)) }
}

/** A new corner in the middle of wall `i` — drag it out for a bay or a point. */
export function addCorner(plan: DrawItPlan, i: number): DrawItPlan {
  if (!plan.shape) return plan
  const a = plan.shape[i], b = plan.shape[(i + 1) % plan.shape.length]
  const shape = [...plan.shape]
  shape.splice(i + 1, 0, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
  return { ...plan, shape }
}

/** Take a corner out; its two walls become one. A house keeps at least three. */
export function removeCorner(plan: DrawItPlan, i: number): DrawItPlan {
  if (!plan.shape || plan.shape.length <= 3) return plan
  return { ...plan, shape: plan.shape.filter((_, k) => k !== i) }
}

/** Wall `i` of the shape typed to a length: its far corner moves along it. */
export function withEdgeLength(plan: DrawItPlan, i: number, mm: number): DrawItPlan {
  if (!plan.shape || !(mm > 0)) return plan
  const n = plan.shape.length
  const a = plan.shape[i], j = (i + 1) % n, b = plan.shape[j]
  const len = Math.hypot(b.x - a.x, b.y - a.y)
  if (len < 1e-9) return plan
  const at = { x: a.x + ((b.x - a.x) / len) * mm, y: a.y + ((b.y - a.y) / len) * mm }
  return { ...plan, shape: plan.shape.map((q, k) => (k === j ? at : q)) }
}

/**
 * A shape a house can be: three corners or more, no wall shorter than a
 * wall, and no wall crossing another. A drag that breaks it is put back.
 */
export function shapeOk(shape: readonly Point[]): boolean {
  const n = shape.length
  if (n < 3) return false
  for (let i = 0; i < n; i++) {
    const a = shape[i], b = shape[(i + 1) % n]
    if (Math.hypot(b.x - a.x, b.y - a.y) < MIN_WALL_MM) return false
  }
  const cross = (p: Point, q: Point, r: Point) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x)
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (j === i + 1 || (i === 0 && j === n - 1)) continue   // neighbours share a corner
      const a = shape[i], b = shape[(i + 1) % n], c = shape[j], d = shape[(j + 1) % n]
      const d1 = cross(c, d, a), d2 = cross(c, d, b), d3 = cross(a, b, c), d4 = cross(a, b, d)
      if (((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0))) return false
    }
  }
  return true
}

/**
 * The shape ready to build: a corner with its two walls running straight on
 * (a + tapped and left where it was) is not a corner, and would frame one wall
 * as two.
 */
export function cleanShape(shape: readonly Point[]): Point[] {
  const out = shape.filter((b, i) => {
    const a = shape[(i - 1 + shape.length) % shape.length], c = shape[(i + 1) % shape.length]
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)
    return Math.abs(cross) > 1e-6 * Math.hypot(b.x - a.x, b.y - a.y) * Math.hypot(c.x - b.x, c.y - b.y)
  })
  return out.length >= 3 ? out : [...shape]
}
