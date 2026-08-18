/**
 * Opening detector
 * ----------------
 * Detects door and window openings as gaps between co-linear wall segments.
 *
 * Algorithm:
 *  1. Separate walls into horizontal (H) and vertical (V) sets.
 *  2. Group each set by approximate position on the perpendicular axis
 *     (Y for horizontal walls, X for vertical walls) within a snapping tolerance.
 *  3. Within each group, sort segments by their start coordinate.
 *  4. Identify gaps between consecutive segment endpoints.
 *  5. Filter gaps by size range (minGapPx … maxGapPx).
 *  6. Classify each gap as door, window, or unknown based on real-world width.
 */

import type { ParsedOpening } from '../types'
import type { ParsedWall } from '../types'

/** Typical single/double door widths in mm. */
const DOOR_MIN_MM = 600
const DOOR_MAX_MM = 1800

/** Typical window widths in mm (narrow sidelight to wide picture window). */
const WINDOW_MIN_MM = 250
const WINDOW_MAX_MM = 3000

/**
 * Maximum wall-to-wall perpendicular offset (px) that still counts as the
 * "same wall line" when grouping co-linear segments.
 * Increased from 8 → 16 to tolerate slight raster skew, scan noise, and
 * the fact that thick walls produce two edge lines up to ~15 px apart.
 */
const LINE_SNAP_PX = 16

export interface OpeningDetectorOptions {
  /** Real-world scale used to classify opening type. */
  scaleMmPerPx?: number | null
  /**
   * Minimum gap width in pixels to be considered an opening.
   * @default 12
   */
  minGapPx?: number
  /**
   * Maximum gap width in pixels to be considered an opening.
   * When scale is known this defaults to 3 000 mm / scaleMmPerPx.
   * When scale is unknown it defaults to 300 px.
   */
  maxGapPx?: number
}

function classifyByWidth(widthMm: number | null): ParsedOpening['type'] {
  if (widthMm === null) return 'unknown'
  if (widthMm >= DOOR_MIN_MM && widthMm <= DOOR_MAX_MM) return 'door'
  if (widthMm >= WINDOW_MIN_MM && widthMm <= WINDOW_MAX_MM) return 'window'
  return 'unknown'
}

/**
 * A DOORWAY IS A GAP IN A LINE, AND A LINE CAN POINT ANYWHERE.
 *
 * This used to split the walls into "horizontal" and "vertical" piles, bucket
 * each pile by a single coordinate (`y1` or `x1`), and scan for gaps along one
 * axis. Everything about that is fine on a rectangular house and wrong the
 * moment a wall runs at an angle: a bay, a splayed corner, anything on a
 * diagonal grid. Two segments either side of a real doorway in a 30-degree wall
 * were filed under "horizontal" (because the run is wider than it is tall),
 * bucketed by whichever `y1` they happened to start at — which differ, because
 * the wall is climbing — and so never compared. The doorway was invisible.
 *
 * The general version is no harder: group segments that lie on the same
 * INFINITE LINE, measure along that line's own direction, and a gap is a gap
 * whichever way the wall points.
 */

/** The infinite line a wall lies on: unit direction + signed offset from origin. */
interface WallLine { ux: number; uy: number; c: number; angle: number }

/** How far two lines may differ in direction and still count as the same one. */
const ANGLE_SNAP_RAD = (10 * Math.PI) / 180

function lineOf(w: ParsedWall): WallLine | null {
  const dx = w.x2 - w.x1, dy = w.y2 - w.y1
  if (Math.hypot(dx, dy) < 1e-6) return null
  // Canonical direction in [0, PI): a wall and the same wall traced backwards
  // are one line, and must land in one group.
  let angle = Math.atan2(dy, dx)
  if (angle < 0) angle += Math.PI
  if (angle >= Math.PI - 1e-9) angle = 0
  // Snap the near-zero component so axis-aligned walls stay EXACT — callers
  // compare welded endpoints against whole pixels.
  const rawX = Math.cos(angle), rawY = Math.sin(angle)
  const ux = Math.abs(rawX) < 1e-12 ? 0 : rawX
  const uy = Math.abs(rawY) < 1e-12 ? 0 : rawY
  return { ux, uy, c: -w.x1 * uy + w.y1 * ux, angle }
}

/** Smallest angle between two undirected line directions. */
function angleDiff(a: number, b: number): number {
  const d = Math.abs(a - b) % Math.PI
  return Math.min(d, Math.PI - d)
}

/** Distance from a point to a line, along the line's normal. */
const perpDist = (l: WallLine, x: number, y: number) => Math.abs(-x * l.uy + y * l.ux - l.c)

/** The point at parameter `s` along a line. Inverse of `param`. */
const pointAt = (l: WallLine, s: number) => ({
  x: -l.c * l.uy + s * l.ux,
  y: l.c * l.ux + s * l.uy,
})

/** How far along a line a point sits. */
const param = (l: WallLine, x: number, y: number) => x * l.ux + y * l.uy

/** Walls sorted into sets that share one infinite line. */
function collinearGroups(walls: ParsedWall[]): { line: WallLine; walls: ParsedWall[] }[] {
  const groups: { line: WallLine; walls: ParsedWall[] }[] = []
  for (const w of walls) {
    const l = lineOf(w)
    if (!l) continue
    const mx = (w.x1 + w.x2) / 2, my = (w.y1 + w.y2) / 2
    const g = groups.find(
      (grp) =>
        angleDiff(l.angle, grp.line.angle) <= ANGLE_SNAP_RAD &&
        // Measured at the MIDPOINT, so two walls that share a start point but
        // splay apart are not mistaken for one line.
        perpDist(grp.line, mx, my) <= LINE_SNAP_PX,
    )
    if (g) g.walls.push(w)
    else groups.push({ line: l, walls: [w] })
  }
  return groups
}

function findGaps(
  walls: ParsedWall[],
  minGapPx: number,
  maxGapPx: number,
  scaleMmPerPx: number | null,
): ParsedOpening[] {
  if (walls.length === 0) return []

  const openings: ParsedOpening[] = []

  for (const group of collinearGroups(walls)) {
    if (group.walls.length < 2) continue
    const line = group.line

    // Each wall as the span it occupies ALONG its own line.
    const spans = group.walls
      .map((w) => {
        const s1 = param(line, w.x1, w.y1)
        const s2 = param(line, w.x2, w.y2)
        return { lo: Math.min(s1, s2), hi: Math.max(s1, s2), w }
      })
      .sort((a, b) => a.lo - b.lo)

    let end = spans[0].hi
    let endWall = spans[0].w
    for (let i = 1; i < spans.length; i++) {
      const next = spans[i]
      const gap = next.lo - end

      if (gap >= minGapPx && gap <= maxGapPx) {
        const sMid = end + gap / 2
        // Sit the opening on the average of the two lines it bridges, the way
        // the axis-aligned version averaged the two walls' perpendicular coord.
        const before = lineOf(endWall)
        const after = lineOf(next.w)
        const c = before && after ? (before.c + after.c) / 2 : line.c
        const p = pointAt({ ...line, c }, sMid)
        const widthMm = scaleMmPerPx != null ? gap * scaleMmPerPx : null

        openings.push({
          x: Math.round(p.x),
          y: Math.round(p.y),
          widthPx: Math.round(gap),
          widthMm: widthMm != null ? Math.round(widthMm) : null,
          orientation: Math.abs(line.ux) >= Math.abs(line.uy) ? 'horizontal' : 'vertical',
          angle: line.angle,
          type: classifyByWidth(widthMm),
        })
      }

      // Overlapping segments must not open a phantom gap behind them.
      if (next.hi > end) { end = next.hi; endWall = next.w }
    }
  }

  return openings
}

/**
 * Detect door/window openings as gaps between co-linear wall segments.
 *
 * @param walls   - Detected wall segments in pixel space.
 * @param options - Tuning parameters.
 * @returns Array of detected openings.
 */
export function detectOpenings(
  walls: ParsedWall[],
  options: OpeningDetectorOptions = {},
): ParsedOpening[] {
  const { scaleMmPerPx = null, minGapPx = 8 } = options

  const defaultMaxGapPx =
    scaleMmPerPx != null ? Math.round(WINDOW_MAX_MM / scaleMmPerPx) : 300
  const maxGapPx = options.maxGapPx ?? defaultMaxGapPx

  // No horizontal/vertical split any more: collinear grouping separates walls
  // that point different ways on its own, and keeps the ones that point the
  // same way together no matter WHICH way that is.
  return findGaps(walls, minGapPx, maxGapPx, scaleMmPerPx)
}

/**
 * REJOIN WALLS ACROSS THEIR OPENINGS.
 *
 * A doorway is not a break in a wall. On site the wall runs through: the studs
 * stop, king and jack studs frame the sides, a header spans it and the plate
 * carries straight over the top. The hole itself has a name — a ROUGH OPENING,
 * the R.O. — and it is sized to the unit plus shim space, in wood or steel
 * alike. On a print it may be DRAWN as a break, but structurally it is one wall
 * with an R.O. in it.
 *
 * The detector had no idea. It bridges gaps of 4–8px (`mergeGapPx`), which is
 * scan-noise territory — a 900mm door at ~23.5mm/px is about 38px, five to ten
 * times that. So every doorway split its wall into two stub walls with a hole
 * between them, and everything downstream inherited the lie: framing put a
 * plate end and a pair of studs where a header belongs, the takeoff counted two
 * walls, and anything routing INSIDE a wall stopped dead at the door.
 *
 * So: segments on the same line, separated by a gap the size of a real door or
 * window, become ONE wall spanning both — and the opening that used to be a
 * hole is returned alongside, to be carried by the wall rather than to
 * interrupt it.
 *
 * Conservative on purpose. Only gaps that classify as a door or a window are
 * bridged; an `unknown` gap is left alone, because a genuine hole in a wall
 * (a missing segment the detector failed on, a corridor, a change in wall type)
 * must not be silently papered over. Guessing wrong here welds together two
 * walls that were never one.
 */
export function rejoinAcrossOpenings(
  walls: ParsedWall[],
  options: OpeningDetectorOptions = {},
): { walls: ParsedWall[]; openings: ParsedOpening[] } {
  const openings = detectOpenings(walls, options)
  if (openings.length === 0) return { walls, openings }

  /**
   * A DOORWAY IS STILL A DOORWAY WHEN NOBODY KNOWS THE SCALE.
   *
   * Welding used to require `type` to be door or window, and that type comes
   * from `classifyByWidth`, which needs MILLIMETRES. No scale, no millimetres,
   * so every gap classified as `unknown` and not one of them bridged. The gaps
   * were found — they were simply all rejected.
   *
   * That is the "26 walls on a one-bed" report. A house has maybe eight or ten
   * real runs; put a doorway in most of them and leave every doorway splitting
   * its wall in two, and the count roughly doubles. Framing then puts a plate
   * end and a pair of studs where a header belongs, at every door in the plan.
   *
   * A drawing does not need a scale to tell you a gap is a door, because the
   * wall itself is the ruler: an opening is a few multiples of the thickness of
   * the wall it sits in — a 900mm door in a 100mm wall is nine. That ratio is
   * scale-free, so it still works on a photo, a screenshot, or any print whose
   * scale we could not read. It is deliberately a WIDE band and only ever used
   * when the metric answer is unavailable; a gap outside it is still left
   * alone, because welding a corridor shut invents a wall that is not there.
   */
  const thicknesses = walls.map((w) => w.thickness).filter((t) => t > 0).sort((a, b) => a - b)
  const medianThickness = thicknesses.length
    ? thicknesses[Math.floor(thicknesses.length / 2)]
    : 0
  const OPENING_MIN_RATIO = 4
  const OPENING_MAX_RATIO = 20
  const plausibleForWallThickness = (o: ParsedOpening) =>
    o.widthMm == null &&
    medianThickness > 0 &&
    o.widthPx >= medianThickness * OPENING_MIN_RATIO &&
    o.widthPx <= medianThickness * OPENING_MAX_RATIO

  // Only real openings weld. See the note above.
  const bridgeable = openings.filter(
    (o) => o.type === 'door' || o.type === 'window' || plausibleForWallThickness(o),
  )

  const out = walls.slice()
  const consumed = new Set<number>()

  for (const o of bridgeable) {
    // Work in the opening's OWN line direction, so a doorway in a wall running
    // at any angle is measured along that wall rather than along the page.
    const angle = o.angle ?? (o.orientation === 'horizontal' ? 0 : Math.PI / 2)
    const rawX = Math.cos(angle), rawY = Math.sin(angle)
    const ux = Math.abs(rawX) < 1e-12 ? 0 : rawX
    const uy = Math.abs(rawY) < 1e-12 ? 0 : rawY
    const oLine: WallLine = { ux, uy, c: -o.x * uy + o.y * ux, angle }
    const oS = param(oLine, o.x, o.y)
    const gapStart = oS - o.widthPx / 2
    const gapEnd = oS + o.widthPx / 2

    // The two segments this gap sits between: same line, ends meeting the gap.
    let left = -1
    let right = -1
    for (let i = 0; i < out.length; i++) {
      if (consumed.has(i)) continue
      const w = out[i]
      const l = lineOf(w)
      if (!l || angleDiff(l.angle, angle) > ANGLE_SNAP_RAD) continue
      if (perpDist(oLine, (w.x1 + w.x2) / 2, (w.y1 + w.y2) / 2) > LINE_SNAP_PX) continue

      const s1 = param(oLine, w.x1, w.y1)
      const s2 = param(oLine, w.x2, w.y2)
      const start = Math.min(s1, s2)
      const end = Math.max(s1, s2)

      if (Math.abs(end - gapStart) <= 2) left = i
      if (Math.abs(start - gapEnd) <= 2) right = i
    }
    if (left < 0 || right < 0 || left === right) continue

    // One wall, spanning both, keeping the left segment's identity — its
    // framing type, role and materials are the wall's, and a doorway does not
    // change them. Its own line is kept too, so welding cannot shift the wall
    // sideways onto the neighbour's.
    const a = out[left]
    const b = out[right]
    const aLine = lineOf(a)
    if (!aLine) continue
    const ends = [
      param(aLine, a.x1, a.y1), param(aLine, a.x2, a.y2),
      param(aLine, b.x1, b.y1), param(aLine, b.x2, b.y2),
    ]
    const p1 = pointAt(aLine, Math.min(...ends))
    const p2 = pointAt(aLine, Math.max(...ends))
    out[left] = { ...a, x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y }
    consumed.add(right)
  }

  return {
    walls: out.filter((_, i) => !consumed.has(i)),
    openings,
  }
}
