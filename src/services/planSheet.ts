/**
 * Which page of a drawing set is the FLOOR PLAN?
 *
 * A real drawing set is not one image. The sample 1-&-2-family set is seven
 * sheets: site plan, floor plans, framing, elevations, sections, details. The
 * rasterizer took page 1 and detected walls on it, so the app built a 3D model
 * of a site plan's title block — a row of framed slabs with no shape to them.
 * pageCount was read and then never used.
 *
 * Picking the sheet by NAME does not work here: this set (and most scanned ones)
 * has no text layer at all — seven pages, zero text items. So the answer has to
 * come from the image.
 *
 * What separates a floor plan from every other sheet is the WALL SIGNATURE: long
 * axis-aligned THIN lines that come in close parallel pairs — the two faces of a
 * wall. Elevations have long lines but few pairs. Sections have pairs but few of
 * them. A hatched framing plan is dense with ink and almost none of it is a thin
 * axis-aligned pair. Notes and schedules are short runs. Counting that signature
 * ranks the sheets, and the ranking is the pick.
 *
 * Deliberately cheap and self-contained: it runs on a small thumbnail of each
 * page, so scoring a seven-page set costs one low-resolution render per page
 * rather than seven full rasterizations. Pure function over pixels — no DOM, no
 * model, testable in node.
 */

/**
 * Longest side of the thumbnails to score.
 *
 * Not arbitrary, and not as small as it could be. The signature being looked
 * for is a wall's TWO FACES as two separate lines, and on a 36" sheet at
 * 1/4"=1'-0" a 6" wall is an eighth of an inch of paper. At 320px across the
 * sheet that is one pixel and the pair is gone; at 1000px it is three or four
 * and it survives. Still cheap — a thumbnail is ~7% of the pixels of a full
 * 1.5× render, so scoring a seven-sheet set costs about half of one page.
 */
export const SHEET_THUMB_PX = 1000

/** Render scale that lands the longest side of a page on `target` pixels. */
export function thumbnailScale(widthPt: number, heightPt: number, target = SHEET_THUMB_PX): number {
  const longest = Math.max(widthPt, heightPt)
  if (!Number.isFinite(longest) || longest <= 0) return 1
  // Never UPscale: a small page is already cheap to render, and blowing it up
  // would invent thickness the picker would then read as a wall.
  return Math.min(1, target / longest)
}

/** Just the pixel fields; accepts a real ImageData or a plain test fixture. */
export interface PixelSource {
  data: Uint8ClampedArray | Uint8Array | number[]
  width: number
  height: number
}

export interface PlanSheetScore {
  /** How strongly this sheet reads as a floor plan. Higher wins. */
  score: number
  /** Thin axis-aligned parallel line-pairs found — the wall signature itself. */
  wallPairs: number
  /** Share of the sheet covered in ink. Near 0 = blank, high = hatch/fill. */
  inkFraction: number
}

/** One ink run along a scanline: the row/column it sits on and its extent. */
interface Run {
  /** Row for a horizontal run, column for a vertical one. */
  line: number
  start: number
  end: number
}

const INK_LUMA = 150

/**
 * Ink mask plus, for every pixel, how thick the ink is ACROSS each axis.
 *
 * Thickness is what tells a wall face from a filled region. A wall face is a
 * thin line; hatch, poché and solid fill are not. Without this test a hatched
 * framing sheet outscores the floor plan, because at thumbnail size its fill
 * reads as a very long ink run on every row.
 */
function inkMasks(img: PixelSource): {
  ink: Uint8Array
  /** Vertical ink run-length through each pixel (thickness of a horizontal line). */
  vThick: Uint16Array
  /** Horizontal ink run-length through each pixel (thickness of a vertical line). */
  hThick: Uint16Array
  inkCount: number
} {
  const { width: w, height: h, data } = img
  const ink = new Uint8Array(w * h)
  let inkCount = 0
  for (let i = 0; i < w * h; i++) {
    const luma = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]
    if (luma < INK_LUMA) { ink[i] = 1; inkCount++ }
  }

  const vThick = new Uint16Array(w * h)
  for (let x = 0; x < w; x++) {
    let y = 0
    while (y < h) {
      if (!ink[y * w + x]) { y++; continue }
      let end = y
      while (end < h && ink[end * w + x]) end++
      const run = end - y
      for (let k = y; k < end; k++) vThick[k * w + x] = run
      y = end
    }
  }

  const hThick = new Uint16Array(w * h)
  for (let y = 0; y < h; y++) {
    let x = 0
    while (x < w) {
      if (!ink[y * w + x]) { x++; continue }
      let end = x
      while (end < w && ink[y * w + end]) end++
      const run = end - x
      for (let k = x; k < end; k++) hThick[y * w + k] = run
      x = end
    }
  }

  return { ink, vThick, hThick, inkCount }
}

/** Ink runs along one axis that are long enough AND thin enough to be a wall face. */
function findThinRuns(
  ink: Uint8Array,
  thick: Uint16Array,
  w: number,
  h: number,
  axis: 'h' | 'v',
  minRun: number,
  maxThick: number,
): Run[] {
  const runs: Run[] = []
  const lines = axis === 'h' ? h : w
  const span = axis === 'h' ? w : h
  const at = (line: number, i: number) => (axis === 'h' ? line * w + i : i * w + line)

  for (let line = 0; line < lines; line++) {
    let start = -1
    for (let i = 0; i <= span; i++) {
      // A run continues only while the ink stays THIN. Ink that thickens into a
      // filled region ends the run there rather than carrying it across, so a
      // poché wall or a hatch block cannot masquerade as one enormous face.
      const on = i < span && ink[at(line, i)] === 1 && thick[at(line, i)] <= maxThick
      if (on && start === -1) start = i
      else if (!on && start !== -1) {
        if (i - start >= minRun) runs.push({ line, start, end: i })
        start = -1
      }
    }
  }
  return runs
}

/** How much two runs overlap along their shared axis, as a fraction of the shorter. */
function overlapFraction(a: Run, b: Run): number {
  const lo = Math.max(a.start, b.start)
  const hi = Math.min(a.end, b.end)
  const shared = hi - lo
  if (shared <= 0) return 0
  return shared / Math.min(a.end - a.start, b.end - b.start)
}

/**
 * Count runs that have a parallel partner nearby — one wall, two faces.
 *
 * Pairing is one-to-one and nearest-first: a face is spent once it is matched,
 * so a stack of title-block rules cannot each claim the same neighbour and
 * inflate the count.
 */
function countPairs(runs: Run[], minSep: number, maxSep: number, minOverlap: number): number {
  const byLine = [...runs].sort((a, b) => a.line - b.line)
  const taken = new Uint8Array(byLine.length)
  let pairs = 0

  for (let i = 0; i < byLine.length; i++) {
    if (taken[i]) continue
    let best = -1
    let bestSep = Infinity
    for (let j = i + 1; j < byLine.length; j++) {
      if (taken[j]) continue
      const sep = byLine[j].line - byLine[i].line
      if (sep < minSep) continue
      if (sep > maxSep) break        // sorted by line: nothing further can qualify
      if (overlapFraction(byLine[i], byLine[j]) < minOverlap) continue
      if (sep < bestSep) { bestSep = sep; best = j }
    }
    if (best >= 0) { taken[i] = 1; taken[best] = 1; pairs++ }
  }
  return pairs
}

/** Thresholds as fractions of the sheet, so the same numbers work at any size. */
function thresholds(w: number, h: number) {
  const shortSide = Math.min(w, h)
  return {
    long: Math.max(12, Math.round(shortSide * 0.03)),
    thin: Math.max(2, Math.round(shortSide * 0.008)),
    minSep: 2,
    maxSep: Math.max(6, Math.round(shortSide * 0.045)),
  }
}

/** The scoring itself, once the faces have been found — by whichever route. */
function scoreFromRuns(hRuns: Run[], vRuns: Run[], w: number, h: number, inkFraction: number): PlanSheetScore {
  const { minSep, maxSep } = thresholds(w, h)
  const hPairs = countPairs(hRuns, minSep, maxSep, 0.5)
  const vPairs = countPairs(vRuns, minSep, maxSep, 0.5)
  const wallPairs = hPairs + vPairs

  // A floor plan is walls in BOTH directions. A sheet of stacked horizontal
  // rules — a schedule, a title block, an elevation's floor lines — can pile up
  // pairs on one axis alone, so the score is the balanced mean of the two rather
  // than their sum. Getting one direction for free buys nothing.
  const balanced = wallPairs > 0 ? (2 * hPairs * vPairs) / wallPairs : 0

  // A nearly blank sheet and a sheet that is mostly fill are both not plans.
  const blank = inkFraction < 0.002 ? 0 : 1

  return { score: balanced * blank, wallPairs, inkFraction }
}

/**
 * Score how strongly one sheet reads as a floor plan, FROM ITS PIXELS.
 *
 * The route for anything that arrives as an image: a photo, a scan, a page with
 * no vector geometry to read. For a vector PDF prefer the segment route below —
 * it is the same scoring off much cheaper input.
 */
export function scorePlanSheet(img: PixelSource): PlanSheetScore {
  const { width: w, height: h } = img
  if (w < 32 || h < 32) return { score: 0, wallPairs: 0, inkFraction: 0 }

  const { ink, vThick, hThick, inkCount } = inkMasks(img)
  const { long, thin } = thresholds(w, h)

  const hRuns = findThinRuns(ink, vThick, w, h, 'h', long, thin)
  const vRuns = findThinRuns(ink, hThick, w, h, 'v', long, thin)

  return scoreFromRuns(hRuns, vRuns, w, h, inkCount / (w * h))
}

/**
 * Rank already-rendered thumbnails and name the winner.
 *
 * Returns a 1-based page number so it can be handed straight to pdf.getPage,
 * and the full ranking so the UI can offer "not this sheet — try the next one"
 * without re-scoring.
 */
export interface PlanPagePick {
  /** 1-based page to build from. */
  page: number
  /** Every page, best first. */
  ranked: Array<{ page: number } & PlanSheetScore>
  /** True when no page carried a usable wall signature — caller should fall back. */
  weak: boolean
}

export function pickPlanPage(thumbnails: PixelSource[]): PlanPagePick {
  return rankPlanPages(thumbnails.map((img, i) => ({ page: i + 1, ...scorePlanSheet(img) })))
}

/**
 * Same verdict, from scores already in hand.
 *
 * Split out because the two routes to a score — pixels and vector segments —
 * can be MIXED within one document: a set can hold six CAD sheets and one
 * scanned page, and each should be scored the cheap way that fits it. The
 * decision about which page wins must not care which route each score took.
 */
export function rankPlanPages(scores: Array<{ page: number } & PlanSheetScore>): PlanPagePick {
  const ranked = [...scores].sort((a, b) => b.score - a.score)

  const best = ranked[0]
  // Nothing scored: a single-sheet upload, a photo, a sheet the signature does
  // not fit. Page 1 stays the answer — the same page the app used before — so a
  // weak pick can never be WORSE than not picking at all.
  if (!best || best.score < 1) {
    return { page: 1, ranked, weak: true }
  }
  return { page: best.page, ranked, weak: false }
}
