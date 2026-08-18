/**
 * Room extractor
 * --------------
 * Detects enclosed room regions from a rasterized floor plan image by
 * flood-filling connected light-coloured (non-wall) areas.
 *
 * Algorithm:
 *  1. Downsample the image for performance.
 *  2. Build a binary mask: dark pixels → wall (0), light pixels → open (1).
 *  3. BFS-flood-fill each unvisited open pixel to find connected regions.
 *  4. Discard regions that touch the image border (exterior / margin).
 *  5. Discard regions below the minimum area threshold.
 *  6. Return each remaining region as a ParsedRoom with centroid, bbox, and area.
 */

import type { ParsedRoom } from '../types'

/** Pixels darker than this (0–255 grayscale) are treated as walls. */
const WALL_GRAY_THRESHOLD = 110

/**
 * Compute an Otsu-optimal binary threshold from the image data.
 * Falls back to `fallback` when the image lacks bimodal contrast.
 * This adapts to both high-key architectural prints and dark-background scans.
 */
function otsuThreshold(data: Uint8ClampedArray, width: number, height: number, fallback: number): number {
  const hist = new Int32Array(256)
  const total = width * height
  for (let i = 0; i < total; i++) {
    const gray = Math.round(0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2])
    hist[gray]++
  }

  let sumAll = 0
  for (let t = 0; t < 256; t++) sumAll += t * hist[t]

  let sumB = 0
  let wB = 0
  let maxVar = 0
  let bestT = fallback

  for (let t = 0; t < 256; t++) {
    wB += hist[t]
    if (wB === 0) continue
    const wF = total - wB
    if (wF === 0) break
    sumB += t * hist[t]
    const meanB = sumB / wB
    const meanF = (sumAll - sumB) / wF
    const varBetween = wB * wF * (meanB - meanF) ** 2
    if (varBetween > maxVar) {
      maxVar = varBetween
      bestT = t
    }
  }

  // Only use Otsu result when there's meaningful bimodal contrast.
  // If the between-class variance is tiny the image may be nearly uniform
  // and Otsu would pick a bad threshold; fall back to the fixed default.
  const relativeVar = maxVar / (total * total)
  return relativeVar > 1e-4 ? bestT : fallback
}

/**
 * Downsample factor applied before flood-fill.
 * 2 → every other pixel, making BFS 4× faster at the cost of 2px spatial precision.
 */
const DOWNSAMPLE = 2

export interface RoomExtractorOptions {
  /**
   * Minimum connected-region area in original (pre-downsample) pixels.
   * Filters out tiny alcoves, gaps in text, etc.
   * @default 600
   */
  minAreaPx?: number
  /**
   * Grayscale threshold below which a pixel counts as a wall.
   * When omitted an Otsu-optimal threshold is computed automatically from the
   * image histogram, which adapts to different scan exposures.
   * @default auto (Otsu)
   */
  wallThreshold?: number
  /** Real-world scale used to compute areaSqM. */
  scaleMmPerPx?: number | null
  /**
   * Where the drawing's own room labels sit, in original pixels.
   *
   * A label is a guaranteed interior point and, more usefully, a COUNT: five
   * labels means five rooms. That is the only ground truth available here, and
   * it is what lets the extractor know its answer is wrong — if one filled
   * region contains two labels, the fill escaped through a doorway and the seal
   * needs to be wider. Without labels it still works; it just cannot check
   * itself.
   */
  labels?: { x: number; y: number }[]
  /**
   * How wide an opening to seal, in original pixels. Derived from
   * `scaleMmPerPx` when omitted (a doorway is about 900mm), with a small fixed
   * guess when the scale is unknown.
   */
  sealPx?: number
}

/**
 * Extract enclosed room polygons from a rasterized floor plan.
 *
 * @param imageData - Raw RGBA image from a rasterized drawing sheet.
 * @param options   - Tuning parameters.
 * @returns Array of detected rooms, sorted by area descending.
 */
export function extractRooms(
  imageData: ImageData,
  options: RoomExtractorOptions = {},
): ParsedRoom[] {
  const {
    minAreaPx = 600,
    wallThreshold: wallThresholdOpt,
    scaleMmPerPx = null,
    labels = [],
    sealPx,
  } = options

  const { data, width, height } = imageData

  // Use caller-supplied threshold if provided, otherwise auto-compute via Otsu.
  const wallThreshold =
    wallThresholdOpt !== undefined
      ? wallThresholdOpt
      : otsuThreshold(data, width, height, WALL_GRAY_THRESHOLD)
  const dw = Math.ceil(width / DOWNSAMPLE)
  const dh = Math.ceil(height / DOWNSAMPLE)

  // ── Build downsampled binary mask ──────────────────────────────────────────
  const binary = new Uint8Array(dw * dh)
  for (let dy = 0; dy < dh; dy++) {
    for (let dx = 0; dx < dw; dx++) {
      const sx = Math.min(dx * DOWNSAMPLE, width - 1)
      const sy = Math.min(dy * DOWNSAMPLE, height - 1)
      const i = (sy * width + sx) * 4
      const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
      binary[dy * dw + dx] = gray > wallThreshold ? 1 : 0
    }
  }

  /**
   * A DOORWAY IS A HOLE IN A WALL, AND A FLOOD FILL WALKS STRAIGHT THROUGH IT.
   *
   * That is why the ADU screenshot in data/test-prints/ reported ONE room. The
   * plan has five, every one of them reachable from the next through a door
   * opening, so the fill crossed the whole floor and came back with a single
   * region — and nothing in the app knew it was wrong. On the studio capture the
   * same code returned ten, over-segmenting on hatched walls. Both answers were
   * useless in the same way: unverifiable.
   *
   * Every enclosed-region approach to floor plans has to deal with this, and the
   * standard answer is to SEAL the openings before filling: thicken the walls by
   * about half a doorway, so the gaps close and the rooms separate. Then grow the
   * regions back afterwards, because a room measured on thickened walls is
   * measurably too small and its area feeds the takeoff.
   *
   * The seal is sized from the scale — a doorway is roughly 900mm — so it closes
   * doors without closing a hallway. With no scale it falls back to a few
   * pixels, which is better than nothing and honest about being a guess.
   *
   * And if labels were supplied, the result is CHECKED: one region holding two
   * labels means the fill still leaked, so the seal widens and it tries again.
   * Five labels really do mean five rooms.
   */
  const labelPts = labels
    .map((l) => ({ x: Math.floor(l.x / DOWNSAMPLE), y: Math.floor(l.y / DOWNSAMPLE) }))
    .filter((l) => l.x >= 0 && l.y >= 0 && l.x < dw && l.y < dh)

  /**
   * NO SCALE, NO SEAL.
   *
   * The seal has to be about half a doorway wide, and "half a doorway" is only
   * meaningful in millimetres. Guessing a pixel count instead is how this first
   * went wrong: a fixed ten-pixel guess erased every room in a small image
   * outright, because a seal wide enough to close a door on a 2000px sheet is
   * wider than an entire room on a 40px one.
   *
   * So sealing is a thing we do when we KNOW the scale — which, now that the
   * drawing's own stated area can be read, is most of the time. Without it the
   * behaviour is exactly what it always was, which is the honest default: no
   * silent shrinking, no invented rooms.
   */
  const sealBasePx = sealPx != null
    ? sealPx
    : scaleMmPerPx != null && scaleMmPerPx > 0
      ? 900 / scaleMmPerPx
      : 0
  const maxRadius = Math.floor(Math.min(dw, dh) / 6)
  const baseRadius = Math.max(0, Math.min(maxRadius, Math.round(sealBasePx / 2 / DOWNSAMPLE)))

  let best: { open: Uint8Array; radius: number } | null = null
  for (const radius of [baseRadius, baseRadius + 2, baseRadius + 4]) {
    const sealed = closeWalls(binary, dw, dh, Math.min(radius, maxRadius))
    best = { open: sealed, radius }
    if (radius === 0 || labelPts.length < 2) break
    const regions = fillRegions(sealed, dw, dh)
    const worst = Math.max(
      0,
      ...regions.map((r) => labelPts.filter((pt) => r.has(pt.y * dw + pt.x)).length),
    )
    // One label per region is the goal; stop as soon as nothing holds two.
    if (worst <= 1) break
  }
  const sealedOpen = best!.open

  const rooms: ParsedRoom[] = []
  let nextId = 0

  /**
   * Label the sealed regions, then GROW THEM BACK.
   *
   * The seal that separates the rooms also eats `growRadius` off every wall
   * face, and a room measured that way is measurably too small — its area feeds
   * the takeoff, so the error would be quoted. Growing each region back over the
   * ORIGINAL open space restores the floor it actually has.
   *
   * Multi-source BFS, all regions advancing together one ring at a time: a pixel
   * goes to whichever room reaches it first, and where two rooms meet across a
   * doorway they stop against each other instead of merging. That boundary is
   * exactly the seal that was needed to tell them apart.
   */
  const NONE = -1
  const regionOf = new Int32Array(dw * dh).fill(NONE)
  let regionCountTotal = 0
  const borderRegion = new Set<number>()

  for (let i = 0; i < sealedOpen.length; i++) {
    if (!sealedOpen[i] || regionOf[i] !== NONE) continue
    const id = regionCountTotal++
    const queue = [i]
    regionOf[i] = id
    let head = 0
    while (head < queue.length) {
      const cur = queue[head++]
      const x = cur % dw
      const y = (cur - x) / dw
      if (x === 0 || y === 0 || x === dw - 1 || y === dh - 1) borderRegion.add(id)
      if (y > 0 && sealedOpen[cur - dw] && regionOf[cur - dw] === NONE) { regionOf[cur - dw] = id; queue.push(cur - dw) }
      if (y < dh - 1 && sealedOpen[cur + dw] && regionOf[cur + dw] === NONE) { regionOf[cur + dw] = id; queue.push(cur + dw) }
      if (x > 0 && sealedOpen[cur - 1] && regionOf[cur - 1] === NONE) { regionOf[cur - 1] = id; queue.push(cur - 1) }
      if (x < dw - 1 && sealedOpen[cur + 1] && regionOf[cur + 1] === NONE) { regionOf[cur + 1] = id; queue.push(cur + 1) }
    }
  }

  // ── Stats per region ──────────────────────────────────────────────────────
  interface Acc { n: number; sx: number; sy: number; x1: number; y1: number; x2: number; y2: number }
  const acc = new Map<number, Acc>()
  for (let i = 0; i < regionOf.length; i++) {
    const id = regionOf[i]
    if (id === NONE || borderRegion.has(id)) continue
    const x = i % dw
    const y = (i - x) / dw
    const a = acc.get(id)
    if (!a) acc.set(id, { n: 1, sx: x, sy: y, x1: x, y1: y, x2: x, y2: y })
    else {
      a.n++; a.sx += x; a.sy += y
      if (x < a.x1) a.x1 = x
      if (x > a.x2) a.x2 = x
      if (y < a.y1) a.y1 = y
      if (y > a.y2) a.y2 = y
    }
  }

  for (const a of acc.values()) {
    const areaPx = a.n * DOWNSAMPLE * DOWNSAMPLE
    if (areaPx < minAreaPx) continue
    const areaSqM =
      scaleMmPerPx != null ? (areaPx * scaleMmPerPx * scaleMmPerPx) / 1_000_000 : null
    rooms.push({
      id: `room-${nextId++}`,
      cx: Math.round((a.sx / a.n) * DOWNSAMPLE),
      cy: Math.round((a.sy / a.n) * DOWNSAMPLE),
      x1: a.x1 * DOWNSAMPLE,
      y1: a.y1 * DOWNSAMPLE,
      x2: a.x2 * DOWNSAMPLE,
      y2: a.y2 * DOWNSAMPLE,
      areaPx,
      areaSqM,
    })
  }

  // Largest rooms first
  return rooms.sort((a, b) => b.areaPx - a.areaPx)
}

/**
 * Thicken the walls by `radius`, which is the same thing as shrinking the open
 * space. Chebyshev (square) structuring element, done as two 1-D passes so the
 * cost is O(pixels) per axis rather than O(pixels * radius^2).
 *
 * Sealing the openings is what stops a fill escaping through a doorway; see the
 * note at the fill itself.
 */
function dilateOpen(open: Uint8Array, w: number, h: number, radius: number): Uint8Array {
  if (radius <= 0) return open
  const rowPass = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let any = 0
      for (let d = -radius; d <= radius && !any; d++) {
        const xx = x + d
        if (xx >= 0 && xx < w && open[y * w + xx]) any = 1
      }
      rowPass[y * w + x] = any
    }
  }
  const out = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let any = 0
      for (let d = -radius; d <= radius && !any; d++) {
        const yy = y + d
        if (yy >= 0 && yy < h && rowPass[yy * w + x]) any = 1
      }
      out[y * w + x] = any
    }
  }
  return out
}

/**
 * CLOSE THE GAPS IN THE WALLS, without making the rooms smaller.
 *
 * Morphological closing of the wall mask: thicken the walls until the doorways
 * are bridged, then thin them back. Gaps narrower than the kernel stay closed
 * once bridged, which is the whole trick — the doorway is sealed and every room
 * keeps the floor area it really has. Eroding the open space instead seals the
 * doors and shrinks every room by the same amount, and a room's area is quoted
 * in the takeoff.
 */
function closeWalls(open: Uint8Array, w: number, h: number, radius: number): Uint8Array {
  if (radius <= 0) return open
  return dilateOpen(erodeOpen(open, w, h, radius), w, h, radius)
}

function erodeOpen(open: Uint8Array, w: number, h: number, radius: number): Uint8Array {
  if (radius <= 0) return open
  const rowPass = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let keep = 1
      for (let d = -radius; d <= radius && keep; d++) {
        const xx = x + d
        if (xx < 0 || xx >= w || !open[y * w + xx]) keep = 0
      }
      rowPass[y * w + x] = keep
    }
  }
  const out = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let keep = 1
      for (let d = -radius; d <= radius && keep; d++) {
        const yy = y + d
        if (yy < 0 || yy >= h || !rowPass[yy * w + x]) keep = 0
      }
      out[y * w + x] = keep
    }
  }
  return out
}

/**
 * Every enclosed region of an open mask, as sets of pixel indices.
 *
 * Used only to ASK A QUESTION — does any one region contain two room labels,
 * meaning the fill leaked — so it collects membership and nothing else. Regions
 * touching the border are the outside and are dropped.
 */
function fillRegions(open: Uint8Array, w: number, h: number): Set<number>[] {
  const seen = new Uint8Array(w * h)
  const regions: Set<number>[] = []
  for (let i = 0; i < open.length; i++) {
    if (!open[i] || seen[i]) continue
    const set = new Set<number>()
    const queue = [i]
    seen[i] = 1
    let border = false
    let head = 0
    while (head < queue.length) {
      const cur = queue[head++]
      set.add(cur)
      const x = cur % w
      const y = (cur - x) / w
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) border = true
      if (y > 0 && open[cur - w] && !seen[cur - w]) { seen[cur - w] = 1; queue.push(cur - w) }
      if (y < h - 1 && open[cur + w] && !seen[cur + w]) { seen[cur + w] = 1; queue.push(cur + w) }
      if (x > 0 && open[cur - 1] && !seen[cur - 1]) { seen[cur - 1] = 1; queue.push(cur - 1) }
      if (x < w - 1 && open[cur + 1] && !seen[cur + 1]) { seen[cur + 1] = 1; queue.push(cur + 1) }
    }
    if (!border) regions.push(set)
  }
  return regions
}
