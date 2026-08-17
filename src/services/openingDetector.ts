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

function findGaps(
  walls: ParsedWall[],
  orientation: 'horizontal' | 'vertical',
  minGapPx: number,
  maxGapPx: number,
  scaleMmPerPx: number | null,
): ParsedOpening[] {
  if (walls.length === 0) return []

  const openings: ParsedOpening[] = []

  // Group walls that lie on the same "line" (within LINE_SNAP_PX perpendicular)
  const groups = new Map<number, ParsedWall[]>()
  for (const w of walls) {
    const perpKey = orientation === 'horizontal' ? w.y1 : w.x1
    const bucket = Math.round(perpKey / LINE_SNAP_PX) * LINE_SNAP_PX
    if (!groups.has(bucket)) groups.set(bucket, [])
    groups.get(bucket)!.push(w)
  }

  for (const group of groups.values()) {
    if (group.length < 2) continue

    // Sort by start position along the wall's axis
    const sorted =
      orientation === 'horizontal'
        ? group.slice().sort((a, b) => a.x1 - b.x1)
        : group.slice().sort((a, b) => a.y1 - b.y1)

    // Scan for gaps between consecutive segments
    for (let i = 0; i < sorted.length - 1; i++) {
      const a = sorted[i]
      const b = sorted[i + 1]

      const aEnd = orientation === 'horizontal' ? a.x2 : a.y2
      const bStart = orientation === 'horizontal' ? b.x1 : b.y1
      const gap = bStart - aEnd

      if (gap < minGapPx || gap > maxGapPx) continue

      // Mid-point of the gap
      const parallelMid = aEnd + gap / 2
      const perpMid =
        orientation === 'horizontal'
          ? (a.y1 + b.y1) / 2
          : (a.x1 + b.x1) / 2

      const [ox, oy] =
        orientation === 'horizontal'
          ? [parallelMid, perpMid]
          : [perpMid, parallelMid]

      const widthMm = scaleMmPerPx != null ? gap * scaleMmPerPx : null

      openings.push({
        x: Math.round(ox),
        y: Math.round(oy),
        widthPx: Math.round(gap),
        widthMm: widthMm != null ? Math.round(widthMm) : null,
        orientation,
        type: classifyByWidth(widthMm),
      })
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

  const horiz = walls.filter(
    (w) => Math.abs(w.x2 - w.x1) >= Math.abs(w.y2 - w.y1),
  )
  const vert = walls.filter(
    (w) => Math.abs(w.y2 - w.y1) > Math.abs(w.x2 - w.x1),
  )

  return [
    ...findGaps(horiz, 'horizontal', minGapPx, maxGapPx, scaleMmPerPx),
    ...findGaps(vert, 'vertical', minGapPx, maxGapPx, scaleMmPerPx),
  ]
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

  const horizontal = (w: ParsedWall) => Math.abs(w.x2 - w.x1) >= Math.abs(w.y2 - w.y1)
  // Only real openings weld. See the note above.
  const bridgeable = openings.filter((o) => o.type === 'door' || o.type === 'window')

  const out = walls.slice()
  const consumed = new Set<number>()

  for (const o of bridgeable) {
    const along = o.orientation === 'horizontal'
    // The two segments this gap sits between: same line, ends meeting the gap.
    let left = -1
    let right = -1
    for (let i = 0; i < out.length; i++) {
      if (consumed.has(i)) continue
      const w = out[i]
      if (horizontal(w) !== along) continue
      const perp = along ? (w.y1 + w.y2) / 2 : (w.x1 + w.x2) / 2
      const oPerp = along ? o.y : o.x
      if (Math.abs(perp - oPerp) > LINE_SNAP_PX) continue

      const end = along ? Math.max(w.x1, w.x2) : Math.max(w.y1, w.y2)
      const start = along ? Math.min(w.x1, w.x2) : Math.min(w.y1, w.y2)
      const gapStart = (along ? o.x : o.y) - o.widthPx / 2
      const gapEnd = (along ? o.x : o.y) + o.widthPx / 2

      if (Math.abs(end - gapStart) <= 2) left = i
      if (Math.abs(start - gapEnd) <= 2) right = i
    }
    if (left < 0 || right < 0 || left === right) continue

    // One wall, spanning both, keeping the left segment's identity — its
    // framing type, role and materials are the wall's, and a doorway does not
    // change them.
    const a = out[left]
    const b = out[right]
    out[left] = along
      ? { ...a, x1: Math.min(a.x1, b.x1), x2: Math.max(a.x2, b.x2) }
      : { ...a, y1: Math.min(a.y1, b.y1), y2: Math.max(a.y2, b.y2) }
    consumed.add(right)
  }

  return {
    walls: out.filter((_, i) => !consumed.has(i)),
    openings,
  }
}
