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

export interface InsideWall { x1: number; y1: number; x2: number; y2: number }

export interface DrawItPlan {
  boxes: FootprintBox[]
  /** The main box's top-left corner, on the page. */
  origin: Point
  /** The paper. */
  page: { w: number; d: number }
  /** Centrelines, in page millimetres. */
  walls: InsideWall[]
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
  return footprintOutline(houseRects(plan))
}

function boundsOf(rects: readonly Rect[], walls: readonly InsideWall[]): Rect {
  const xs = [...rects.flatMap((r) => [r.x1, r.x2]), ...walls.flatMap((w) => [w.x1, w.x2])]
  const ys = [...rects.flatMap((r) => [r.y1, r.y2]), ...walls.flatMap((w) => [w.y1, w.y2])]
  return { x1: Math.min(...xs), y1: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) }
}

/**
 * Grow the paper so the house and its walls have clear space round them.
 * Run when a drag ENDS, never during one — paper growing under a moving finger
 * is the page running away from you. It only ever grows: if the house went off
 * the left or top, everything shifts right or down by the same amount.
 */
export function fitPage(plan: DrawItPlan): DrawItPlan {
  const b = boundsOf(houseRects(plan), plan.walls)
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
  }
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
  const rel = placeBoxes(start.boxes)
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
function landingLines(plan: DrawItPlan, shellMm: number, skip?: number): Array<{ a: Point; b: Point }> {
  const out: Array<{ a: Point; b: Point }> = []
  const poly = houseOutline(plan)
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
}

/**
 * Where a finger's point lands. In order: square to the other end if the drag
 * is nearly square; then onto another wall's end; then onto a wall's face or
 * line; then onto the grid. A square wall that lands on a face stays square —
 * it slides along its own axis to meet it, rather than kinking to reach it.
 */
export function snapWallPoint(plan: DrawItPlan, p: Point, o: SnapOpts): Point {
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
  for (const { a, b } of landingLines(plan, o.shellMm, o.skip)) {
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
