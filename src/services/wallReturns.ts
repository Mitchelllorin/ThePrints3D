/**
 * FIND THE RETURNS — the short walls detection is built to throw away.
 *
 * A tradesperson named this one: "do you know the term 'return' in
 * construction? like a wall return? its missing those everytime". A return is
 * the short leg where a wall turns back on itself — the stub beside a window or
 * an entry recess, the piece that comes back off a bay or an offset. They run
 * roughly 4 to 24 inches, and they live on the PERIMETER, which is why it was
 * consistently the outside walls that came up missing.
 *
 * Two separate things were hiding them, and only the first was obvious. The
 * ladder's shortest pass demands `minWallLengthPx: 55` on a screenshot, which
 * at 14.65 mm/px is 806 mm — two foot eight, longer than any return. Underneath
 * that, `classifyLine` calls anything shorter than 40px a 'leader' before it
 * looks at the ink at all, and no caller could reach that number. So the first
 * version of this file relaxed the length and still found EXACTLY ZERO returns
 * on both test prints, because the 40 was still standing.
 *
 * Dropping the ladder's own thresholds is not the fix: the title block's rule
 * lines, the dimension ticks and the lettering all come back as walls, which is
 * the "72 walls across 18 rooms" failure. So this is a second, deliberately
 * permissive sweep whose ONLY job is short segments, and then four questions
 * that a return answers and a serif does not. Each one was added because the
 * overlay showed what the previous set was letting through:
 *
 *   IT IS ATTACHED    a return joins the wall it returns from. Lettering,
 *                     hatching and dimension ticks float in open space.
 *   IT TURNS          a return comes BACK — that is what the word means. A
 *                     short piece lying along the wall it touches is a fragment
 *                     of that wall, not a return.
 *   IT IS ALONE       hatching, cabinet fronts, stair treads and dimension
 *                     ladders repeat: parallel, same length, evenly spaced. A
 *                     return has no twin four pixels beside it. (`combMembers`)
 *   IT IS DRAWN LIKE  a return is the wall, so it carries the wall's weight of
 *   THE WALL          ink. Furniture is drawn thin. (`drawnLikeTheWall`)
 *
 * The first two live in `attachedReturnAnchor`. Measured on the two real
 * screenshots: attachment alone rescued 34 and 49 segments and the overlay
 * showed them landing on a hatched band, a run of kitchen cabinets, the toilet,
 * the bed and the sofa. Adding the family test took that to 22 and 2; adding
 * the ink test took it to 1 and 1. The one kept on the ADU sheet is the jamb
 * return at the bathroom door — the real thing, and the first one the app has
 * ever found.
 *
 * Everything it finds is marked `isReturn`, and it never touches the main
 * result: the walls the app found before this file existed are exactly the
 * walls it finds now, plus returns.
 */
import { detectWallsOffThread } from './detectOffThread'
import { attachedReturnAnchor } from './modelWalls'
import type { ParsedWall } from '../types'

/**
 * How short a segment may be and still be looked at. Deliberately far below
 * anything the main ladder allows — the whole point is the range it excludes.
 */
const RETURN_MIN_LEN_PX = 10

/**
 * How long is too long to be a return. Above this the main passes would have
 * found it themselves, and anything they missed at that length is a wall we
 * have a different problem with.
 */
const RETURN_MAX_LEN_PX = 60

/**
 * THROW AWAY COMBS.
 *
 * Attachment alone is not enough, and the overlay says so plainly. On the
 * studio print the segments this pass rescued were a HATCHED band along the
 * bottom of the sheet — twelve vertical ticks, four pixels apart, identical
 * length — and on the ADU print they were the divisions in a run of kitchen
 * cabinets, the toilet, the bed and the sofa. Every one of them touched
 * something the detector had called a wall, so every one of them passed.
 *
 * What separates them from a return is not where they touch. It is that THEY
 * COME IN FAMILIES. Hatching, cabinet fronts, stair treads and dimension
 * ladders are repeated: parallel, the same length, evenly spaced. A wall return
 * has no twin sitting four pixels beside it at the same length — a building
 * does not repeat a stub of wall a hand's width apart, a dozen times.
 *
 * So group the candidates by orientation and by the span they occupy across
 * their own axis, and drop any group with three or more members. Two is left
 * alone: a window with a return on each side is a pair, and pairs are real.
 */
const COMB_MIN_MEMBERS = 3

/** How far apart two members can sit and still read as one repeated pattern. */
const COMB_MAX_SPACING_PX = 28

function combKey(w: ParsedWall): string {
  const horizontal = Math.abs(w.x2 - w.x1) >= Math.abs(w.y2 - w.y1)
  // The span ACROSS the run — two hatch ticks share it exactly; two returns off
  // different walls do not. Bucketed to survive a pixel of raster skew.
  const a = horizontal ? w.x1 : w.y1
  const b = horizontal ? w.x2 : w.y2
  const lo = Math.round(Math.min(a, b) / 3) * 3
  const hi = Math.round(Math.max(a, b) / 3) * 3
  return `${horizontal ? 'h' : 'v'}:${lo}:${hi}`
}

/** The position along the axis the family repeats down. */
function combOffset(w: ParsedWall): number {
  return Math.abs(w.x2 - w.x1) >= Math.abs(w.y2 - w.y1) ? w.y1 : w.x1
}

/** Members of a repeated pattern — hatching, cabinet fronts, stair treads. */
export function combMembers(candidates: readonly ParsedWall[]): Set<ParsedWall> {
  const groups = new Map<string, ParsedWall[]>()
  for (const w of candidates) {
    const k = combKey(w)
    const g = groups.get(k)
    if (g) g.push(w)
    else groups.set(k, [w])
  }
  const combs = new Set<ParsedWall>()
  for (const group of groups.values()) {
    if (group.length < COMB_MIN_MEMBERS) continue
    // Evenly spaced is what makes it a pattern rather than a coincidence, so
    // walk the run and only condemn members that have close neighbours.
    const sorted = [...group].sort((a, b) => combOffset(a) - combOffset(b))
    let run: ParsedWall[] = [sorted[0]]
    const flush = () => {
      if (run.length >= COMB_MIN_MEMBERS) for (const m of run) combs.add(m)
    }
    for (let i = 1; i < sorted.length; i++) {
      if (combOffset(sorted[i]) - combOffset(sorted[i - 1]) <= COMB_MAX_SPACING_PX) {
        run.push(sorted[i])
      } else {
        flush()
        run = [sorted[i]]
      }
    }
    flush()
  }
  return combs
}

/**
 * IS IT DRAWN LIKE A WALL, OR DRAWN LIKE A CHAIR?
 *
 * The comb test clears out hatching and cabinet runs, and what is left on a
 * real print is still mostly FURNITURE: the dining table pushed against the
 * wall, the vanity, the bed, the wardrobe. Of course it is — furniture is drawn
 * touching walls and square to them, which is the whole of the attachment test.
 *
 * The thing that actually tells them apart is on the page and always has been.
 * A return IS the wall — it is drawn with the wall's own weight, the heavy
 * poché or the same paired faces. Furniture is drawn thin, a single light
 * stroke, because a plan reader is meant to see through it to the room. So
 * measure the INK: walk out perpendicular from the middle of the segment until
 * the page goes light, and ask whether what it is made of resembles what the
 * wall it touches is made of.
 *
 * Measured against the anchor rather than against a fixed number, so it does
 * not care whether the sheet is a heavy CAD poché or a faint scan — the wall on
 * the same page is the ruler. Same reasoning as `rejoinAcrossOpenings`.
 */
const DARK = 150

/** How wide the dark band is, perpendicular to the segment, at `t` along it. */
export function inkWidth(image: ImageData, w: ParsedWall, t = 0.5): number {
  const len = Math.hypot(w.x2 - w.x1, w.y2 - w.y1)
  if (len < 1) return 0
  // The normal — a wall's thickness runs across it, not along it.
  const nx = -(w.y2 - w.y1) / len
  const ny = (w.x2 - w.x1) / len
  const mx = w.x1 + (w.x2 - w.x1) * t
  const my = w.y1 + (w.y2 - w.y1) * t
  const dark = (x: number, y: number): boolean => {
    const px = Math.round(x), py = Math.round(y)
    if (px < 0 || py < 0 || px >= image.width || py >= image.height) return false
    const i = (py * image.width + px) * 4
    return 0.299 * image.data[i] + 0.587 * image.data[i + 1] + 0.114 * image.data[i + 2] < DARK
  }
  // Anchored on the ink itself: an edge-derived coordinate can sit a pixel off
  // the stroke, and starting in the white would measure a width of nothing.
  let ox = 0
  if (!dark(mx, my)) {
    for (const probe of [1, -1, 2, -2]) {
      if (dark(mx + nx * probe, my + ny * probe)) { ox = probe; break }
    }
    if (ox === 0) return 0
  }
  const MAX = 80
  let width = 1
  for (let k = 1; k <= MAX && dark(mx + nx * (ox + k), my + ny * (ox + k)); k++) width++
  for (let k = 1; k <= MAX && dark(mx + nx * (ox - k), my + ny * (ox - k)); k++) width++
  return width
}

/**
 * Does this segment carry the same weight of ink as the wall it comes off?
 *
 * Half is deliberately generous. A return meeting a wall is drawn to the same
 * weight, but the midpoint of a short stub can land where a door swing or a
 * dimension line crosses it, and losing a real return costs more than keeping a
 * chair — the chair is one wrong wall the user drags away, the missing return
 * is the complaint this started from.
 */
export function drawnLikeTheWall(image: ImageData, w: ParsedWall, anchor: ParsedWall): boolean {
  /**
   * The MEDIAN along the wall, not one reading. A single sample can land on a
   * junction — a return meeting the wall, a door swing crossing it, another
   * wall tee-ing in — and read as several times the wall's real weight, which
   * would then reject the very return that widened it.
   */
  const reads = [0.25, 0.5, 0.75].map((t) => inkWidth(image, anchor, t)).sort((a, b) => a - b)
  const anchorInk = Math.max(reads[1], anchor.thickness || 0)
  if (anchorInk < 2) return true  // Nothing to compare against — do not invent a reason to drop it.
  return inkWidth(image, w) >= Math.max(2, anchorInk * 0.5)
}

/**
 * ONLY LOOK WHERE A RETURN COULD BE.
 *
 * This is a second detection sweep, and detection is O(pixels) — measured at 6
 * seconds on a 759x622 screenshot and 13 on a 732x727 one, on top of a read
 * that already takes tens of seconds. A sheet is mostly not the building: title
 * block, revision table, notes, the margin.
 *
 * A return has to touch a wall, so it cannot be outside the box the walls are
 * already in. Cropping to that box is free accuracy as well as speed — every
 * rule line in the title block that would have had to be argued with is simply
 * never looked at.
 */
const CROP_PAD_PX = 24

/** Crop to the walls, or null when the walls already fill the sheet. */
export function cropToWalls(
  image: ImageData,
  found: readonly ParsedWall[],
): { image: ImageData; dx: number; dy: number } | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const w of found) {
    x0 = Math.min(x0, w.x1, w.x2); x1 = Math.max(x1, w.x1, w.x2)
    y0 = Math.min(y0, w.y1, w.y2); y1 = Math.max(y1, w.y1, w.y2)
  }
  if (!Number.isFinite(x0)) return null
  x0 = Math.max(0, Math.floor(x0) - CROP_PAD_PX)
  y0 = Math.max(0, Math.floor(y0) - CROP_PAD_PX)
  x1 = Math.min(image.width, Math.ceil(x1) + CROP_PAD_PX)
  y1 = Math.min(image.height, Math.ceil(y1) + CROP_PAD_PX)
  const w = x1 - x0, h = y1 - y0
  if (w < 32 || h < 32) return null
  // Not worth the copy if it saves almost nothing.
  if (w * h > image.width * image.height * 0.9) return null
  const data = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    const src = ((y + y0) * image.width + x0) * 4
    data.set(image.data.subarray(src, src + w * 4), y * w * 4)
  }
  // detectWalls only reads width/height/data, and the worker takes them apart
  // into a message anyway, so a structural stand-in is enough here too.
  return { image: { width: w, height: h, data } as ImageData, dx: x0, dy: y0 }
}

/** Already in the model? Same line, same place — do not add it twice. */
function duplicateOf(w: ParsedWall, existing: readonly ParsedWall[]): boolean {
  for (const e of existing) {
    const sameEnds =
      (Math.hypot(w.x1 - e.x1, w.y1 - e.y1) < 4 && Math.hypot(w.x2 - e.x2, w.y2 - e.y2) < 4) ||
      (Math.hypot(w.x1 - e.x2, w.y1 - e.y2) < 4 && Math.hypot(w.x2 - e.x1, w.y2 - e.y1) < 4)
    if (sameEnds) return true
  }
  return false
}

/**
 * Look for returns off the walls already found.
 *
 * Returns ONLY the extra segments — the caller appends them. Never throws: a
 * print with no returns, or a browser that cannot run the pass, must still
 * build exactly as it did.
 */
export async function findWallReturns(
  image: ImageData,
  found: readonly ParsedWall[],
  isRasterPhoto: boolean,
): Promise<ParsedWall[]> {
  // Nothing to attach to means nothing can be a return, and the permissive pass
  // would just be an expensive way to collect lettering.
  if (found.length === 0) return []
  try {
    const crop = cropToWalls(image, found)
    const { result } = await detectWallsOffThread(crop ? crop.image : image, [
      {
        /**
         * NOT the lenient pass's numbers. Tried that first — `edgeThreshold` 16
         * with no length floor — and it worked but took ninety seconds on a
         * 759x622 screenshot, turning a 32 second read into 123. A print nobody
         * waits for is a print nobody uses, and that is the whole reason the
         * detection work happened at all.
         *
         * The cost is the candidate count: a very low edge threshold over a
         * whole sheet finds every serif and hatch line, and the work after that
         * is superlinear in how many it found. So this asks the SAME question
         * the successful pass asked — same edges, same thickness band — and only
         * relaxes the one thing that hides returns, which is length.
         */
        edgeThreshold: isRasterPhoto ? 26 : 30,
        minWallLengthPx: RETURN_MIN_LEN_PX,
        /**
         * THE THING THAT WAS ACTUALLY HIDING RETURNS. `classifyLine` calls any
         * line shorter than this a 'leader' — an arrow tail pointing at a note
         * — before it looks at the ink at all, and the limit was a hardcoded 40
         * that no caller could reach. So a 20px return was never a wall
         * candidate that got rejected; it was never a candidate. Measured: with
         * the limit at 40, the shortest segment this pass could produce on a
         * real screenshot was 42px, and it found ZERO returns on both test
         * prints. The main ladder is untouched — it never sets this, so its 40
         * still stands.
         */
        leaderMaxLengthPx: 8,
        /**
         * A return is short, and `detectWallPairs` only pairs faces that
         * overlap by more than 20px — so a return's two faces never pair and it
         * arrives with thickness 1. Demanding 2 here would throw it out as a
         * 'dimension' line for the crime of being too short to measure.
         */
        minWallThicknessPx: 1,
        maxWallThicknessPx: 72,
        requirePairedEdges: false,
        // Tighter than the lenient pass's 8: a return is short, and a merge gap
        // near its own length would swallow it into its neighbour.
        mergeGapPx: 3,
      },
    ])

    // Back into the raster's coordinates before anything else looks at them —
    // the anchors, the ink and the model are all expressed there.
    const dx = crop ? crop.dx : 0, dy = crop ? crop.dy : 0
    const detected = crop
      ? result.walls.map((w) => ({ ...w, x1: w.x1 + dx, y1: w.y1 + dy, x2: w.x2 + dx, y2: w.y2 + dy }))
      : result.walls
    const inBand = detected.filter((w) => {
      const len = Math.hypot(w.x2 - w.x1, w.y2 - w.y1)
      return len >= RETURN_MIN_LEN_PX && len <= RETURN_MAX_LEN_PX
    })
    // Judged across ALL the short candidates, before attachment thins them out —
    // a comb has to be seen as a family to be recognised as one.
    const combs = combMembers(inBand)

    const out: ParsedWall[] = []
    for (const w of inBand) {
      if (duplicateOf(w, found) || duplicateOf(w, out)) continue
      if (combs.has(w)) continue
      // Anchored against the walls the real ladder found — never against each
      // other, or a row of lettering walks itself in one serif at a time.
      const anchor = attachedReturnAnchor(w, found)
      if (!anchor) continue
      // Attached and square to a wall describes a bed as well as a return. The
      // ink is what tells them apart — see `drawnLikeTheWall`.
      if (!drawnLikeTheWall(image, w, anchor)) continue
      out.push({ ...w, source: 'auto', isReturn: true })
    }
    return out
  } catch {
    // A return we failed to look for is a return missing, which is where this
    // started. It is not a reason to lose the drawing.
    return []
  }
}
