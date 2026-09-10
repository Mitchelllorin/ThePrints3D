/**
 * IF WE KNOW WHERE THE KITCHEN IS, WE KNOW THERE ARE WALLS AROUND IT.
 *
 * The detector reads ink bottom-up: it finds line segments and hopes they add
 * up to a building. On a screenshot they often do not — measured on
 * data/test-prints/screenshot-adu-71sqm.png, the detected walls enclosed ZERO
 * rooms across 42 threshold configurations and 2 after corner-joining, while
 * holding 50-plus wall segments. The lines were there; they never closed.
 *
 * Meanwhile `extractRooms` was quietly succeeding on the same image, top-down:
 * it floods the raster, seals doorways, reads the labels, and returned 7 rooms
 * against a stated truth of 5. The app already knew where the kitchen was. That
 * knowledge was then thrown away, because nothing ever turned a room back into
 * the walls that must be around it.
 *
 * This is that step. A room's boundary IS walls — that is what a room is — so
 * a plan whose rooms are known has a floor plan whether or not the ink parsed
 * cleanly. Rooms that share a boundary share a wall, so coordinates are snapped
 * to a common grid and duplicate edges collapse into one.
 *
 * These are an ESTIMATE from the room's bounding box, not a reading of the ink,
 * and they are marked `roomDerived` so the rest of the app can tell the
 * difference and the user can correct them. That is the trade the project has
 * already chosen: a model you can fix beats a blank workspace.
 */

import type { ParsedRoom, ParsedWall } from '../types'

/** Coordinates within this fraction of the median room size are the same line. */
const SNAP_FRACTION = 0.06

/**
 * A ROOM THAT SMALL IS NOT A ROOM.
 *
 * `extractRooms` floods enclosed regions, and on a sheet that is not purely a
 * floor plan it finds enclosed regions that are not rooms. Measured on
 * portland-residential-permit-plans — a permit booklet page with body text
 * above the drawing — it returned FIFTY-SEVEN rooms for a two-bedroom plan,
 * and this function dutifully built four walls around each one: 228 fabricated
 * walls on top of the 69 actually read off the ink. The model was mostly
 * paragraphs.
 *
 * The tell is size. Measured as a share of the page:
 *
 *   portland  largest 8.6%,  tail down to 0.05%  (the tail is lettering)
 *   adu-71sqm largest 56.5%, smallest 2.3%       (all seven are real rooms)
 *
 * MEASURED AGAINST THE PAGE, NOT AGAINST THE LARGEST ROOM. Relative-to-largest
 * was tried first and it is wrong, because the biggest "room" is often the
 * whole footprint read as one region — adu-71sqm's largest is 56.5% of the
 * page. A twentieth of THAT condemns real rooms: screenshot-studio-1bed lost
 * five of its six, and bungalow-ukiah lost the one room that was holding its
 * enclosure together (5 enclosed regions down to 2). The ratio punishes a plan
 * for having one big space in it.
 *
 * Page share separates the two populations cleanly and with a wide margin, and
 * it is resolution-independent, which a pixel count is not:
 *
 *   real rooms      2.3% of the page and up
 *   lettering       0.07% and down
 *
 * Nothing in the corpus falls between. The cut sits near the bottom of that
 * gap rather than in the middle of it, because the costs are asymmetric:
 * keeping one doubtful region costs four walls the user can delete, while
 * dropping a real room leaves a hole in their building.
 */
const MIN_ROOM_PAGE_SHARE = 0.004

function median(values: number[]): number {
  if (values.length === 0) return 0
  const s = [...values].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m]
}

export interface RoomWallsResult {
  walls: ParsedWall[]
  /** Edges that collapsed onto a neighbour — i.e. walls shared between rooms. */
  shared: number
  snapPx: number
  /** Regions rejected as too small to be rooms — see MIN_ROOM_PAGE_SHARE. */
  rejected: number
}

/**
 * Build the walls implied by a set of rooms.
 *
 * `thicknessPx` should be the median thickness the detector actually measured
 * on this drawing where it has one, so room-derived walls sit at the same
 * weight as read ones rather than at a number typed in here.
 */
export function wallsFromRooms(
  rooms: ParsedRoom[],
  thicknessPx = 6,
  /** Area of the drawing in px². Without it nothing is rejected — a caller
   *  that cannot say how big the page is has not earned the right to throw
   *  a room away. */
  imageArea?: number,
): RoomWallsResult {
  const usable = rooms.filter(
    (r) => Number.isFinite(r.x1) && Number.isFinite(r.y1) &&
           Number.isFinite(r.x2) && Number.isFinite(r.y2) &&
           r.x2 > r.x1 && r.y2 > r.y1,
  )
  if (usable.length === 0) return { walls: [], shared: 0, snapPx: 0, rejected: 0 }

  /**
   * Drop the regions that are too small to be rooms before building anything.
   * Done here rather than in the extractor because the extractor's job is to
   * report what it found; this function's job is to decide what deserves walls
   * around it, and only one of those two should be making that call.
   */
  const areaOf = (r: ParsedRoom) => Math.abs((r.x2 - r.x1) * (r.y2 - r.y1))
  const roomy = imageArea && imageArea > 0
    ? usable.filter((r) => areaOf(r) / imageArea >= MIN_ROOM_PAGE_SHARE)
    : usable
  const rejected = usable.length - roomy.length
  if (roomy.length === 0) return { walls: [], shared: 0, snapPx: 0, rejected }

  // Scale-free, like every other tolerance in this pipeline: a shared wall is
  // shared by a fraction of a room, not by a fixed number of pixels.
  const typical = median(roomy.map((r) => Math.min(r.x2 - r.x1, r.y2 - r.y1)))
  const snapPx = Math.max(2, typical * SNAP_FRACTION)
  const snap = (v: number) => Math.round(v / snapPx) * snapPx

  /**
   * NEIGHBOURS SHARE A LINE, NOT AN EDGE.
   *
   * The first version of this keyed each edge on its exact four coordinates,
   * so two rooms collapsed onto one wall only when they shared the WHOLE
   * edge — identical from end to end. Rooms on a real plan almost never do.
   * A deep living room beside a stacked kitchen and bath share the same party
   * line, but in three different spans, and all three were built:
   *
   *   x=200 party line → [0→295.8], [0→132.6], [132.6→295.8]
   *
   * One wall, drawn three times, stacked on itself. Measured on the LA County
   * plan A layout that left 26 walls with 2 collapsed, against 28 for rooms
   * treated as wholly independent — the collapse was recovering almost
   * nothing, which is why `sharedEdges` read 0 on print after print.
   *
   * So edges are grouped by the LINE they sit on and merged by span. Only
   * genuine overlap merges: two spans that merely touch end-to-end are left
   * alone, because a gap between spans on one line is a doorway or a
   * courtyard, and a butt joint is two rooms' walls meeting rather than one
   * wall counted twice.
   */
  type Span = { lo: number; hi: number }
  /** Vertical edges keyed by x, horizontal by y. */
  const vertical = new Map<number, Span[]>()
  const horizontal = new Map<number, Span[]>()

  for (const r of roomy) {
    const x1 = snap(r.x1), y1 = snap(r.y1)
    const x2 = snap(r.x2), y2 = snap(r.y2)
    if (x1 !== x2) {
      for (const y of [y1, y2]) {
        const at = horizontal.get(y) ?? []
        at.push({ lo: Math.min(x1, x2), hi: Math.max(x1, x2) })
        horizontal.set(y, at)
      }
    }
    if (y1 !== y2) {
      for (const x of [x1, x2]) {
        const at = vertical.get(x) ?? []
        at.push({ lo: Math.min(y1, y2), hi: Math.max(y1, y2) })
        vertical.set(x, at)
      }
    }
  }

  let shared = 0

  /** Sweep one line's spans, merging those that genuinely overlap. */
  const mergeSpans = (spans: Span[]): Span[] => {
    const sorted = [...spans].sort((a, b) => a.lo - b.lo || a.hi - b.hi)
    const out: Span[] = []
    for (const s of sorted) {
      const last = out[out.length - 1]
      // Strictly overlapping — touching end-to-end is not the same wall.
      if (last && s.lo < last.hi) {
        if (s.hi > last.hi) last.hi = s.hi
        shared++
      } else {
        out.push({ ...s })
      }
    }
    return out
  }

  const walls: ParsedWall[] = []
  const wall = (ax: number, ay: number, bx: number, by: number) =>
    ({
      x1: ax, y1: ay, x2: bx, y2: by,
      thickness: thicknessPx,
      source: 'auto',
      roomDerived: true,
      detectionConfidence: 0.5,
    } as ParsedWall)

  for (const [y, spans] of horizontal) {
    for (const s of mergeSpans(spans)) walls.push(wall(s.lo, y, s.hi, y))
  }
  for (const [x, spans] of vertical) {
    for (const s of mergeSpans(spans)) walls.push(wall(x, s.lo, x, s.hi))
  }

  return { walls, shared, snapPx, rejected }
}
