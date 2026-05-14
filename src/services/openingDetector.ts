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
