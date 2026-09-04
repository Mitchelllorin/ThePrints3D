/**
 * MAKE DETECTED WALLS MEET EACH OTHER.
 *
 * A traced wall gets tied in: FloorplanOverlay runs `snapPointToWalls` and
 * `extendWallToNearbyWall` on everything the user draws, so a stroke that stops
 * short of another wall is carried to it. A DETECTED wall gets none of that.
 * The detector emits independent segments read off the ink, and nothing has
 * ever joined them.
 *
 * Measured on the corpus, that is the binding constraint — not thresholds.
 * screenshot-adu-71sqm enclosed 0 or 1 rooms across 42 threshold
 * configurations while holding 50-57 walls: the walls were there, they simply
 * never closed a loop. A plan whose walls do not meet cannot become a building,
 * whatever the detector's numbers are set to.
 *
 * `rejoinAcrossOpenings` already handles the COLLINEAR case — a doorway gap in
 * an otherwise straight run. This handles the perpendicular one: corners where
 * two walls stop a few pixels short of each other.
 *
 * The tolerance is derived from the walls themselves, never a pixel constant.
 * The whole reason detection has been fragile across sources is thresholds tuned
 * against one raster size; a corner gap is a fraction of a wall, so the median
 * wall length is the ruler.
 */

import type { ParsedWall } from '../types'
import { extendWallToNearbyWall } from './wallTraceReducer'

/** Corner gaps worth closing are small next to the walls they join. */
const GAP_AS_FRACTION_OF_MEDIAN = 0.35

/** Below this many walls there is no meaningful median to measure against. */
const MIN_WALLS = 4

function lengthOf(w: ParsedWall): number {
  return Math.hypot(w.x2 - w.x1, w.y2 - w.y1)
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const s = [...values].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m]
}

export interface JoinResult {
  walls: ParsedWall[]
  /** How many endpoints were carried to meet another wall. */
  joined: number
  /** The tolerance actually used, for the record. */
  maxExtendPx: number
}

/**
 * Extend detected walls so their endpoints land on the walls they nearly touch.
 *
 * Two passes, both against a FIXED reference set rather than the running
 * result. Extending against already-extended walls compounds: a wall carried
 * 10px becomes a longer target for the next one, which reaches further again,
 * and a plan can inflate. The second pass exists only so that a corner needing
 * both of its walls moved can close, and it is bounded by the same tolerance.
 */
export function joinDetectedWalls(walls: ParsedWall[]): JoinResult {
  if (walls.length < MIN_WALLS) return { walls, joined: 0, maxExtendPx: 0 }

  const med = median(walls.map(lengthOf))
  const maxExtendPx = Math.max(4, med * GAP_AS_FRACTION_OF_MEDIAN)

  let joined = 0
  const moved = (a: ParsedWall, b: ParsedWall) =>
    (a.x1 !== b.x1 || a.y1 !== b.y1 ? 1 : 0) + (a.x2 !== b.x2 || a.y2 !== b.y2 ? 1 : 0)

  const pass = (input: ParsedWall[]): ParsedWall[] =>
    input.map((w) => {
      const out = extendWallToNearbyWall(w, input, maxExtendPx)
      joined += moved(out, w)
      // Preserve everything the detector recorded — only the endpoints move.
      return out.x1 === w.x1 && out.y1 === w.y1 && out.x2 === w.x2 && out.y2 === w.y2
        ? w
        : { ...w, x1: out.x1, y1: out.y1, x2: out.x2, y2: out.y2 }
    })

  const first = pass(walls)
  const second = pass(first)
  return { walls: second, joined, maxExtendPx }
}
