/**
 * DO THESE WALLS ACTUALLY MAKE ROOMS?
 *
 * The one question the pipeline could never answer about its own output. Wall
 * COUNT cannot answer it — measured on the corpus, a configuration finding 164
 * walls on a five-room studio scored better than one finding 19, and it was
 * detecting noise. Enclosure is two-sided: too few walls and the rooms merge
 * into one, too many and the plan shatters into slivers.
 *
 * It exists so the detector can tell when it has FAILED. Everything in this
 * pipeline is a cascade — the AI model, then the heuristic ladder, then the
 * returns pass, then rejoining across doorways — and each step only knows to
 * try because the previous one produced nothing at all. "Nothing at all" is a
 * poor test: a print can come back with fifty walls that enclose no rooms,
 * which is a failure that looks like a success. This is the better test.
 *
 * Pure and canvas-free so it can run in a worker, in node, and in a test.
 */

import type { ParsedWall } from '../types'

/** Work at this width regardless of the print — enclosure is a shape question. */
const GRID_W = 360

/** Below this share of the grid a region is a sliver between two lines. */
const MIN_AREA_SHARE = 0.004

function stamp(mask: Uint8Array, w: number, h: number, x: number, y: number, r: number): void {
  const x0 = Math.max(0, Math.floor(x - r)), x1 = Math.min(w - 1, Math.ceil(x + r))
  const y0 = Math.max(0, Math.floor(y - r)), y1 = Math.min(h - 1, Math.ceil(y + r))
  for (let yy = y0; yy <= y1; yy++) {
    for (let xx = x0; xx <= x1; xx++) {
      if ((xx - x) ** 2 + (yy - y) ** 2 <= r * r) mask[yy * w + xx] = 1
    }
  }
}

/**
 * How many enclosed regions do these walls form?
 *
 * Walls are drawn into a small grid and the open space is flood-filled. Regions
 * touching the border are the paper around the plan, not rooms, so they do not
 * count — which is what makes an unclosed plan score zero rather than one.
 */
export function enclosedRegions(
  walls: ParsedWall[],
  imageWidth: number,
  imageHeight: number,
): number {
  if (walls.length === 0 || imageWidth <= 0 || imageHeight <= 0) return 0

  const k = GRID_W / imageWidth
  const w = GRID_W
  const h = Math.max(1, Math.round(imageHeight * k))
  const mask = new Uint8Array(w * h)

  for (const wall of walls) {
    const ax = wall.x1 * k, ay = wall.y1 * k
    const bx = wall.x2 * k, by = wall.y2 * k
    if (![ax, ay, bx, by].every(Number.isFinite)) continue
    // Half-thickness, floored at half a cell so a hairline still separates.
    const r = Math.max(0.5, (wall.thickness * k) / 2)
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay)))
    for (let s = 0; s <= steps; s++) {
      const t = s / steps
      stamp(mask, w, h, ax + (bx - ax) * t, ay + (by - ay) * t, r)
    }
  }

  const seen = new Uint8Array(w * h)
  const minArea = Math.max(20, w * h * MIN_AREA_SHARE)
  const stack: number[] = []
  let regions = 0

  for (let start = 0; start < w * h; start++) {
    if (mask[start] || seen[start]) continue
    let area = 0
    let touchesBorder = false
    stack.length = 0
    stack.push(start)
    seen[start] = 1
    while (stack.length) {
      const q = stack.pop() as number
      area++
      const x = q % w
      const y = (q - x) / w
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) touchesBorder = true
      if (x > 0 && !mask[q - 1] && !seen[q - 1]) { seen[q - 1] = 1; stack.push(q - 1) }
      if (x < w - 1 && !mask[q + 1] && !seen[q + 1]) { seen[q + 1] = 1; stack.push(q + 1) }
      if (y > 0 && !mask[q - w] && !seen[q - w]) { seen[q - w] = 1; stack.push(q - w) }
      if (y < h - 1 && !mask[q + w] && !seen[q + w]) { seen[q + w] = 1; stack.push(q + w) }
    }
    if (area >= minArea && !touchesBorder) regions++
  }

  return regions
}
