/**
 * A HOUSE IS A SERIES OF BOXES.
 *
 * "Draw it" started by asking for one width and one depth, which draws a square
 * box — and almost nothing is a square box. An L off the back for the kitchen, a
 * bump-out for the dining room, a garage on the side, a U round a courtyard: the
 * shape is a few rectangles stuck together, which is how a builder describes it
 * too ("thirty-two by twenty-six, with a twelve by fourteen off the back").
 *
 * So the footprint is a list of boxes. This turns that list into ONE outline —
 * the outside face of the building, with the shared edges between boxes gone,
 * because there is no wall where two boxes meet — and then into the wall
 * centrelines, half a thickness inside that face.
 *
 * Everything is rectilinear, which is what lets it be exact rather than a
 * polygon-clipping library's opinion: cut the plane at every box edge, ask of
 * each cell whether it is inside the building, and keep the edges where the
 * answer changes. That is the outline, and it is right for any arrangement of
 * boxes including ones that only touch at a corner.
 *
 * Coordinates are millimetres in sheet space: +x right, +y DOWN the page, the
 * way the print is drawn and the way walls are stored.
 */

export type AttachSide = 'top' | 'bottom' | 'left' | 'right'

export interface FootprintBox {
  /** Across the page, millimetres. */
  widthMm: number
  /** Down the page, millimetres. */
  depthMm: number
  /**
   * Which side of the MAIN box this one hangs off, and how far along that side
   * it starts. The first box has none — it is the main one. Measured from the
   * side's left end (for top/bottom) or top end (for left/right), so 0 means
   * flush with that corner and a negative value runs back past it.
   */
  attach?: { side: AttachSide; offsetMm: number }
}

export interface Rect { x1: number; y1: number; x2: number; y2: number }
export interface Point { x: number; y: number }

/** Where each box actually sits, with the main box's top-left at the origin. */
export function placeBoxes(boxes: readonly FootprintBox[]): Rect[] {
  if (boxes.length === 0) return []
  const main = boxes[0]
  const out: Rect[] = [{ x1: 0, y1: 0, x2: main.widthMm, y2: main.depthMm }]
  for (let i = 1; i < boxes.length; i++) {
    const b = boxes[i]
    const off = b.attach?.offsetMm ?? 0
    switch (b.attach?.side) {
      case 'left':
        out.push({ x1: -b.widthMm, y1: off, x2: 0, y2: off + b.depthMm }); break
      case 'top':
        out.push({ x1: off, y1: -b.depthMm, x2: off + b.widthMm, y2: 0 }); break
      case 'bottom':
        out.push({ x1: off, y1: main.depthMm, x2: off + b.widthMm, y2: main.depthMm + b.depthMm }); break
      case 'right':
      default:
        out.push({ x1: main.widthMm, y1: off, x2: main.widthMm + b.widthMm, y2: off + b.depthMm }); break
    }
  }
  return out
}

const EPS = 1e-6
const uniq = (vs: number[]): number[] => {
  const s = [...vs].sort((a, b) => a - b)
  const out: number[] = []
  for (const v of s) if (out.length === 0 || Math.abs(v - out[out.length - 1]) > EPS) out.push(v)
  return out
}

/** Total area covered, millimetres squared — shared overlap counted once. */
export function footprintAreaMm2(rects: readonly Rect[]): number {
  const xs = uniq(rects.flatMap((r) => [r.x1, r.x2]))
  const ys = uniq(rects.flatMap((r) => [r.y1, r.y2]))
  let area = 0
  for (let i = 0; i < xs.length - 1; i++) {
    for (let j = 0; j < ys.length - 1; j++) {
      const cx = (xs[i] + xs[i + 1]) / 2
      const cy = (ys[j] + ys[j + 1]) / 2
      if (rects.some((r) => cx > r.x1 && cx < r.x2 && cy > r.y1 && cy < r.y2)) {
        area += (xs[i + 1] - xs[i]) * (ys[j + 1] - ys[j])
      }
    }
  }
  return area
}

/**
 * The outside face of the building: one closed loop, corners only, running
 * clockwise in sheet coordinates (+y down).
 *
 * Boxes that overlap or share an edge come out as one outline with no wall
 * through the middle of the building, which is the whole point — the join
 * between a house and its bump-out is an opening in the framing, not a wall.
 */
export function footprintOutline(rects: readonly Rect[]): Point[] {
  if (rects.length === 0) return []
  const xs = uniq(rects.flatMap((r) => [r.x1, r.x2]))
  const ys = uniq(rects.flatMap((r) => [r.y1, r.y2]))
  const inside = (i: number, j: number): boolean => {
    if (i < 0 || j < 0 || i >= xs.length - 1 || j >= ys.length - 1) return false
    const cx = (xs[i] + xs[i + 1]) / 2
    const cy = (ys[j] + ys[j + 1]) / 2
    return rects.some((r) => cx > r.x1 && cx < r.x2 && cy > r.y1 && cy < r.y2)
  }

  // Boundary edges, each stored pointing so the building is on its RIGHT —
  // which makes the whole loop run clockwise with +y down.
  const edges: Array<[Point, Point]> = []
  for (let i = 0; i < xs.length - 1; i++) {
    for (let j = 0; j < ys.length - 1; j++) {
      if (!inside(i, j)) continue
      const [x1, x2, y1, y2] = [xs[i], xs[i + 1], ys[j], ys[j + 1]]
      if (!inside(i, j - 1)) edges.push([{ x: x1, y: y1 }, { x: x2, y: y1 }])   // top, left→right
      if (!inside(i + 1, j)) edges.push([{ x: x2, y: y1 }, { x: x2, y: y2 }])   // right, top→bottom
      if (!inside(i, j + 1)) edges.push([{ x: x2, y: y2 }, { x: x1, y: y2 }])   // bottom, right→left
      if (!inside(i - 1, j)) edges.push([{ x: x1, y: y2 }, { x: x1, y: y1 }])   // left, bottom→top
    }
  }
  if (edges.length === 0) return []

  // Chain them: every edge's end is some edge's start. Walking from the
  // top-left-most corner keeps the result stable rather than depending on
  // whichever cell happened to be visited first.
  const key = (p: Point) => `${Math.round(p.x * 1000)},${Math.round(p.y * 1000)}`
  const from = new Map<string, Array<[Point, Point]>>()
  for (const e of edges) {
    const list = from.get(key(e[0]))
    if (list) list.push(e)
    else from.set(key(e[0]), [e])
  }
  let start = edges[0][0]
  for (const e of edges) {
    if (e[0].y < start.y - EPS || (Math.abs(e[0].y - start.y) < EPS && e[0].x < start.x - EPS)) start = e[0]
  }
  const loop: Point[] = [start]
  let at = start
  for (let guard = 0; guard < edges.length + 2; guard++) {
    const options = from.get(key(at))
    if (!options || options.length === 0) break
    // At a pinch point two edges leave the same corner; take the first unused.
    const next = options.shift()!
    at = next[1]
    if (key(at) === key(start)) break
    loop.push(at)
  }

  // Drop the points that are not corners — three points in a line is one wall.
  const corners: Point[] = []
  for (let i = 0; i < loop.length; i++) {
    const prev = loop[(i - 1 + loop.length) % loop.length]
    const cur = loop[i]
    const next = loop[(i + 1) % loop.length]
    const straight =
      (Math.abs(prev.x - cur.x) < EPS && Math.abs(cur.x - next.x) < EPS) ||
      (Math.abs(prev.y - cur.y) < EPS && Math.abs(cur.y - next.y) < EPS)
    if (!straight) corners.push(cur)
  }
  return corners.length >= 4 ? corners : loop
}

/** Twice the signed area — negative means clockwise with +y down. */
function signedArea2(poly: readonly Point[]): number {
  let s = 0
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length]
    s += a.x * b.y - b.x * a.y
  }
  return s
}

/**
 * The wall CENTRELINES: the outline pulled in by half a wall thickness.
 *
 * Every edge slides inward along its own normal and neighbouring edges are
 * re-intersected, so an inside corner stays a corner instead of two lines
 * crossing past each other. Rectilinear throughout, so an intersection is just
 * "x from the vertical one, y from the horizontal one".
 */
export function insetOutline(poly: readonly Point[], byMm: number): Point[] {
  const n = poly.length
  if (n < 4 || byMm === 0) return [...poly]
  // With +y down, a clockwise loop has negative signed area; inward is then the
  // left-hand normal of each edge. Work it out rather than assume it.
  const inwardLeft = signedArea2(poly) < 0
  const lines = poly.map((a, i) => {
    const b = poly[(i + 1) % n]
    const dx = Math.sign(b.x - a.x), dy = Math.sign(b.y - a.y)
    // Left normal of (dx,dy) is (dy,-dx); right normal is (-dy,dx).
    const nx = inwardLeft ? dy : -dy
    const ny = inwardLeft ? -dx : dx
    return { vertical: Math.abs(b.x - a.x) < EPS, x: a.x + nx * byMm, y: a.y + ny * byMm }
  })
  const out: Point[] = []
  for (let i = 0; i < n; i++) {
    const prev = lines[(i - 1 + n) % n]
    const cur = lines[i]
    // Consecutive edges of a rectilinear loop are perpendicular: one gives the
    // x, the other the y.
    out.push(cur.vertical ? { x: cur.x, y: prev.y } : { x: prev.x, y: cur.y })
  }
  return out
}

/** The outline's bounding box — what a tape reads across the whole building. */
export function outlineBounds(poly: readonly Point[]): Rect {
  const xs = poly.map((p) => p.x), ys = poly.map((p) => p.y)
  return { x1: Math.min(...xs), y1: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) }
}

/** Move every point so the whole footprint starts at (dx, dy). */
export function translateOutline(poly: readonly Point[], dx: number, dy: number): Point[] {
  return poly.map((p) => ({ x: p.x + dx, y: p.y + dy }))
}
