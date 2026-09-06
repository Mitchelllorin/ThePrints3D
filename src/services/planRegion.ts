/**
 * WHERE IS THE BUILDING ON THIS PAGE?
 *
 * The engine has never asked. It runs detection across the whole sheet — title
 * block, general notes, the door schedule, the stair section, and the three
 * other drawings on sheet 3 of 7 — and then spends the rest of the pipeline
 * filtering out ink it should never have looked at.
 *
 * That is not a guess. Measured across the corpus, `noiseRatio` runs 0.766 to
 * 0.856: roughly FOUR FIFTHS of the ink on a real permit sheet is not the
 * building. Several separate-looking failures are that one fact:
 *
 *   - portland derives 57 rooms and rejects 46 of them. Paragraphs of body
 *     text enclose white space, so a flood fill calls them rooms.
 *   - the studio sheet's largest "room" covers 86.9% of the page.
 *   - roughly half the final walls are inferred from rooms rather than read
 *     from ink, because the ink that WAS read is mostly not walls.
 *
 * So: find the drawing before reading it.
 *
 * The signal is stroke length, not ink density. A wall is a long straight run
 * of dark pixels. Body text is the same darkness — often darker — but made of
 * strokes a few pixels long. Density alone would pick the general notes, which
 * are the densest ink on the sheet; density of LONG RUNS picks the plan.
 */

/** A rectangle in the source image's own pixel coordinates. */
export interface PlanRegion {
  x1: number
  y1: number
  x2: number
  y2: number
  /** Share of the sheet's long-run ink that fell inside this rectangle. */
  inkShare: number
  /** Share of the sheet's area this rectangle covers. */
  areaShare: number
}

/**
 * Why the step did or did not commit.
 *
 * A guard that silently returns null is untunable — the first run of this on
 * the real corpus masked NOTHING on all six prints, and the log said only
 * `masked: false`, which does not tell you which threshold to move. The reason
 * is part of the answer.
 */
export type PlanRegionReason =
  | 'ok'
  | 'image-too-small'
  | 'no-structural-ink'
  | 'ink-not-dominant'
  | 'region-too-small'
  | 'covers-page'

export interface PlanRegionResult {
  region: PlanRegion | null
  reason: PlanRegionReason
  /** Share of structural ink held by the best block, whether or not it won. */
  inkShare: number
  /** Share of the page that block covers, whether or not it won. */
  areaShare: number
}

/** Analysed at a quarter scale: this is looking for walls, not for detail. */
const DOWNSAMPLE = 4

/** Dark enough to be ink. Deliberately generous — a faint scan is still ink. */
const INK_THRESHOLD = 160

/**
 * How long a run of ink has to be before it counts as structure rather than
 * lettering, as a fraction of the image's short side.
 *
 * Relative, never an absolute pixel count: a threshold that separates a wall
 * from a word on a 3888px sheet is longer than an entire wall on a 732px
 * screenshot, and a fixed number silently turns one of the two into noise.
 */
const MIN_RUN_FRACTION = 0.05
const MIN_RUN_FLOOR = 6

/**
 * AND A RUN CAN BE TOO LONG TO BE A WALL.
 *
 * The sheet border is a single stroke down the full height and across the full
 * width of the page, and so are the rules boxing in a title block or a
 * schedule. They are the longest runs on the drawing, so a length-based signal
 * scores them highest of all — and because they touch everything, an
 * 8-connected search welds the plan, the notes and the schedules into one blob
 * covering the whole page.
 *
 * That is not theory. Measured on bungalow-ukiah-adu before this cap: one
 * region, inkShare 0.958, areaShare 1.0, declined as `covers-page`. The step
 * did nothing on any of the six corpus prints.
 *
 * A wall does not run the width of a drawing sheet. Page furniture does.
 */
const MAX_RUN_FRACTION = 0.7

/** Cells across the short side of the image. Coarse on purpose. */
const GRID = 24

/**
 * A region has to hold this much of the sheet's structural ink before it is
 * allowed to speak for the drawing.
 *
 * The rule is a RATIO, not a taste: the winner must hold at least half as much
 * again as everything else on the sheet put together — 0.6 of the ink against
 * 0.4, or 1.5x. Stating it that way is what keeps this from being a number
 * chosen to make one print pass.
 *
 * Above one half is the part that matters. Two equally-sized plans on one sheet
 * — a first floor beside a second floor, which is how permit sets are actually
 * drawn — split the structural ink about 50/50, or 1.0x, and any threshold at
 * or below half lets one win and silently deletes the other. A sheet like that
 * is left alone instead, which is the honest answer until choosing BETWEEN
 * plans is built properly.
 *
 * Measured: portland's plan holds 0.62 against the rest of its sheet, which is
 * dominance; a 50/50 split is not.
 */
const MIN_INK_SHARE = 0.6

/**
 * Below this share of the page, a "plan" is more likely a title block or a
 * detail callout that happens to be made of long lines.
 */
const MIN_AREA_SHARE = 0.02

/**
 * Above this, there is nothing worth masking — the drawing already fills the
 * page, and cropping would only risk shaving a wall off the edge.
 */
const MAX_AREA_SHARE = 0.85

/** Padding added around the found region, as a share of its own size. */
const PAD = 0.04

/**
 * Locate the floor plan on a drawing sheet.
 *
 * @returns The plan's bounding box, or `null` when the sheet should be left
 *          alone — either nothing plan-like stood out, or the drawing already
 *          covers the page. Returning `null` is a normal outcome, not an error.
 */
export function findPlanRegion(image: ImageData): PlanRegionResult {
  const { data, width, height } = image
  const decline = (reason: PlanRegionReason, inkShare = 0, areaShare = 0): PlanRegionResult =>
    ({ region: null, reason, inkShare, areaShare })
  if (width < 16 || height < 16) return decline('image-too-small')

  const dw = Math.ceil(width / DOWNSAMPLE)
  const dh = Math.ceil(height / DOWNSAMPLE)

  // ── Ink mask at quarter scale ─────────────────────────────────────────────
  const ink = new Uint8Array(dw * dh)
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      const sx = Math.min(x * DOWNSAMPLE, width - 1)
      const sy = Math.min(y * DOWNSAMPLE, height - 1)
      const i = (sy * width + sx) * 4
      const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
      ink[y * dw + x] = gray < INK_THRESHOLD ? 1 : 0
    }
  }

  /**
   * Keep only ink that belongs to a long straight run.
   *
   * Two passes, horizontal and vertical, each marking every pixel of any run at
   * least `minRun` long. A pixel in either pass survives — walls run both ways,
   * and a corner belongs to both.
   */
  const minRun = Math.max(MIN_RUN_FLOOR, Math.round(Math.min(dw, dh) * MIN_RUN_FRACTION))
  const structural = new Uint8Array(dw * dh)

  const maxRunX = dw * MAX_RUN_FRACTION
  const maxRunY = dh * MAX_RUN_FRACTION

  const markRun = (start: number, end: number, step: number, max: number) => {
    const len = (end - start) / step
    if (len < minRun || len > max) return
    for (let i = start; i < end; i += step) structural[i] = 1
  }

  for (let y = 0; y < dh; y++) {
    let run = -1
    for (let x = 0; x <= dw; x++) {
      const on = x < dw && ink[y * dw + x] === 1
      if (on && run < 0) run = x
      else if (!on && run >= 0) { markRun(y * dw + run, y * dw + x, 1, maxRunX); run = -1 }
    }
  }
  for (let x = 0; x < dw; x++) {
    let run = -1
    for (let y = 0; y <= dh; y++) {
      const on = y < dh && ink[y * dw + x] === 1
      if (on && run < 0) run = y
      else if (!on && run >= 0) { markRun(run * dw + x, y * dw + x, dw, maxRunY); run = -1 }
    }
  }

  // ── Score a coarse grid by how much structural ink each cell holds ─────────
  const cell = Math.max(1, Math.floor(Math.min(dw, dh) / GRID))
  const gw = Math.ceil(dw / cell)
  const gh = Math.ceil(dh / cell)
  const cellInk = new Int32Array(gw * gh)
  let totalStructural = 0
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      if (!structural[y * dw + x]) continue
      totalStructural++
      cellInk[Math.floor(y / cell) * gw + Math.floor(x / cell)]++
    }
  }
  if (totalStructural === 0) return decline('no-structural-ink')

  /**
   * A cell counts as part of a drawing when it carries a real share of the
   * structural ink. The threshold is relative to this sheet's own busiest cell,
   * so a faint scan and a heavy blackline are judged the same way.
   */
  let busiest = 0
  for (const v of cellInk) if (v > busiest) busiest = v
  const cellFloor = Math.max(1, busiest * 0.08)
  const isPlan = new Uint8Array(gw * gh)
  for (let i = 0; i < cellInk.length; i++) isPlan[i] = cellInk[i] >= cellFloor ? 1 : 0

  // ── Largest connected block of plan cells ─────────────────────────────────
  const seen = new Uint8Array(gw * gh)
  let best: { ink: number; x1: number; y1: number; x2: number; y2: number } | null = null
  for (let start = 0; start < isPlan.length; start++) {
    if (!isPlan[start] || seen[start]) continue
    const queue = [start]
    seen[start] = 1
    let head = 0
    let inkSum = 0
    let x1 = gw, y1 = gh, x2 = -1, y2 = -1
    while (head < queue.length) {
      const cur = queue[head++]
      const cx = cur % gw
      const cy = (cur - cx) / gw
      inkSum += cellInk[cur]
      if (cx < x1) x1 = cx
      if (cx > x2) x2 = cx
      if (cy < y1) y1 = cy
      if (cy > y2) y2 = cy
      // 8-connected: a plan's rooms meet at corners as well as edges, and
      // 4-connectivity splits an L-shaped footprint into two regions.
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = cx + dx
          const ny = cy + dy
          if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue
          const n = ny * gw + nx
          if (isPlan[n] && !seen[n]) { seen[n] = 1; queue.push(n) }
        }
      }
    }
    if (!best || inkSum > best.ink) best = { ink: inkSum, x1, y1, x2, y2 }
  }
  if (!best) return decline('no-structural-ink')

  const inkShare = best.ink / totalStructural

  // Back to source pixels, with a little padding so a wall on the boundary
  // keeps its thickness.
  const toX = (g: number) => g * cell * DOWNSAMPLE
  const toY = (g: number) => g * cell * DOWNSAMPLE
  let rx1 = toX(best.x1)
  let ry1 = toY(best.y1)
  let rx2 = Math.min(width, toX(best.x2 + 1))
  let ry2 = Math.min(height, toY(best.y2 + 1))
  const padX = (rx2 - rx1) * PAD
  const padY = (ry2 - ry1) * PAD
  rx1 = Math.max(0, Math.floor(rx1 - padX))
  ry1 = Math.max(0, Math.floor(ry1 - padY))
  rx2 = Math.min(width, Math.ceil(rx2 + padX))
  ry2 = Math.min(height, Math.ceil(ry2 + padY))

  const areaShare = ((rx2 - rx1) * (ry2 - ry1)) / (width * height)

  /**
   * REFUSE RATHER THAN GUESS.
   *
   * A step that cannot help is not allowed to do harm. If the winning block
   * does not hold most of the structural ink, the sheet's drawings are spread
   * out and picking one would throw away the others. If it is tiny, we found a
   * title block. If it already fills the page, there is nothing to remove.
   */
  if (inkShare < MIN_INK_SHARE) return decline('ink-not-dominant', inkShare, areaShare)
  if (areaShare < MIN_AREA_SHARE) return decline('region-too-small', inkShare, areaShare)
  if (areaShare > MAX_AREA_SHARE) return decline('covers-page', inkShare, areaShare)

  return {
    region: { x1: rx1, y1: ry1, x2: rx2, y2: ry2, inkShare, areaShare },
    reason: 'ok',
    inkShare,
    areaShare,
  }
}

/**
 * Blank everything outside the region to white.
 *
 * MASK, NOT CROP. Every coordinate downstream — walls, rooms, openings, the
 * print overlay the user sees behind the model — lives in this image's pixel
 * space. Returning a smaller image would shift all of it by the crop origin,
 * and a silent constant offset in wall positions is a bug this project has
 * paid for before. Same dimensions in, same dimensions out, nothing to remap.
 *
 * The speed that a real crop would buy is worth having, but it is a separate
 * change with its own coordinate mapping to verify.
 */
export function maskToPlanRegion(image: ImageData, region: PlanRegion): ImageData {
  const { data, width, height } = image
  const out = new Uint8ClampedArray(data.length)
  out.set(data)
  for (let y = 0; y < height; y++) {
    const inRows = y >= region.y1 && y < region.y2
    for (let x = 0; x < width; x++) {
      if (inRows && x >= region.x1 && x < region.x2) continue
      const i = (y * width + x) * 4
      out[i] = 255
      out[i + 1] = 255
      out[i + 2] = 255
      out[i + 3] = 255
    }
  }
  /**
   * `ImageData` is a browser constructor and does not exist under the test
   * runner, so build one only where one can be built. The shape is identical
   * either way, and every consumer here reads `data`/`width`/`height`.
   */
  if (typeof ImageData !== 'undefined') return new ImageData(out, width, height)
  return { data: out, width, height, colorSpace: 'srgb' } as ImageData
}
