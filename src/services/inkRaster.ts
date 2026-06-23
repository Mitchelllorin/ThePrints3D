/**
 * Trace-time "ink" raster.
 *
 * The upfront wall-detection pass (Sobel + line classifier) only keeps lines it
 * is confident are walls — thin/faint/dashed lines get thrown away as
 * dimensions or noise. That left tracing with nothing to snap to on perfectly
 * good prints ("the wall snapping isn't working").
 *
 * This module keeps a lightweight grayscale buffer of each drawing's rasterized
 * image so a traced segment can snap onto the ACTUAL dark line under the stroke,
 * regardless of whether detection found it. One clean print can then trace
 * reliably wall-by-wall.
 *
 * Buffers are cached by drawing id (a small LRU), populated during processing
 * and rebuilt lazily from the raster URL after a reload. Coordinates are in the
 * same raster-pixel space the trace tools already use (rasterWidth × height).
 */

export interface InkBuffer {
  width: number
  height: number
  /** Per-pixel ink strength: 0 = white/empty, 255 = darkest. Row-major. */
  ink: Uint8Array
}

const cache = new Map<string, InkBuffer>()
const order: string[] = [] // LRU of drawing ids, oldest first
const MAX_BUFFERS = 4

function remember(id: string, buf: InkBuffer): void {
  cache.set(id, buf)
  const i = order.indexOf(id)
  if (i >= 0) order.splice(i, 1)
  order.push(id)
  while (order.length > MAX_BUFFERS) {
    const evict = order.shift()
    if (evict && evict !== id) cache.delete(evict)
  }
}

/** Build an ink buffer from raw RGBA ImageData (called during processing). */
export function setInkBuffer(id: string, image: ImageData): void {
  const { width, height, data } = image
  const ink = new Uint8Array(width * height)
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    // Rec.601 luminance, inverted so dark ink → high value.
    const lum = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114
    ink[p] = 255 - (lum | 0)
  }
  remember(id, { width, height, ink })
}

export function getInkBuffer(id: string): InkBuffer | null {
  return cache.get(id) ?? null
}

export function clearInkBuffer(id: string): void {
  cache.delete(id)
  const i = order.indexOf(id)
  if (i >= 0) order.splice(i, 1)
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = url
  })
}

/**
 * Lazily build the buffer from a raster URL — after a page reload the in-memory
 * cache is empty but the drawing still has its rasterUrl. Safe to call repeatedly;
 * returns the cached buffer once built, or null if the image can't be read.
 */
export async function ensureInkBuffer(id: string, rasterUrl: string | null): Promise<InkBuffer | null> {
  if (!rasterUrl) return null
  const existing = cache.get(id)
  if (existing) return existing
  try {
    const img = await loadImage(rasterUrl)
    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth
    canvas.height = img.naturalHeight
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return null
    ctx.drawImage(img, 0, 0)
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height)
    setInkBuffer(id, image)
    return cache.get(id) ?? null
  } catch {
    return null
  }
}

// ── Snapping ────────────────────────────────────────────────────────────────

/** Ink strength above this counts as part of a printed line (not paper noise). */
const INK_THRESHOLD = 64

/** Nearest-pixel ink lookup; 0 outside the image. */
function inkAt(buf: InkBuffer, x: number, y: number): number {
  const xi = x | 0
  const yi = y | 0
  if (xi < 0 || yi < 0 || xi >= buf.width || yi >= buf.height) return 0
  return buf.ink[yi * buf.width + xi]
}

/**
 * Snap a traced segment perpendicular onto the darkest ink line running under
 * it.
 *
 * Samples along the segment; at each sample it scans ±searchPx perpendicular and
 * takes the offset of the strongest ink (ties resolved toward the trace, so a
 * nearby dimension line doesn't win over the wall the user aimed at). If enough
 * samples land on ink it shifts the whole segment onto that line and applies a
 * small, bounded re-angle so a slightly skewed trace squares up to the print.
 *
 * Returns null when there's no consistent ink under the trace — the caller then
 * keeps the user's own segment untouched.
 */
export function snapSegmentToInk(
  x1: number, y1: number, x2: number, y2: number,
  buf: InkBuffer,
  searchPx = 26,
): { x1: number; y1: number; x2: number; y2: number } | null {
  const dx = x2 - x1
  const dy = y2 - y1
  const len = Math.hypot(dx, dy)
  if (len < 4) return null
  const nx = -dy / len // perpendicular unit
  const ny = dx / len

  const samples = Math.max(8, Math.min(64, Math.round(len / 6)))
  const offsets: Array<{ t: number; off: number }> = []
  for (let s = 0; s <= samples; s++) {
    const t = s / samples
    const cx = x1 + dx * t
    const cy = y1 + dy * t
    let bestVal = INK_THRESHOLD
    let bestOff = 0
    let found = false
    for (let o = -searchPx; o <= searchPx; o++) {
      const v = inkAt(buf, cx + nx * o, cy + ny * o)
      if (v > bestVal || (v === bestVal && Math.abs(o) < Math.abs(bestOff))) {
        bestVal = v
        bestOff = o
        found = true
      }
    }
    if (found) offsets.push({ t, off: bestOff })
  }

  // Require ink under a solid majority of samples before trusting it.
  if (offsets.length < Math.ceil((samples + 1) * 0.5)) return null

  const sorted = offsets.map((o) => o.off).sort((a, b) => a - b)
  const medOff = sorted[sorted.length >> 1]
  if (Math.abs(medOff) > searchPx) return null

  // Linear fit off = a + b·t for a gentle re-angle, then clamp how far the two
  // ends may diverge so noisy ink can't swing the wall off the user's intent.
  const n = offsets.length
  let st = 0, so = 0, stt = 0, sto = 0
  for (const { t, off } of offsets) {
    st += t; so += off; stt += t * t; sto += t * off
  }
  const denom = n * stt - st * st
  let a = medOff
  let b = 0
  if (Math.abs(denom) > 1e-6) {
    b = (n * sto - st * so) / denom
    a = (so - b * st) / n
  }
  const maxTilt = searchPx * 0.6
  if (b > maxTilt) b = maxTilt
  if (b < -maxTilt) b = -maxTilt
  const off1 = a
  const off2 = a + b
  return {
    x1: x1 + nx * off1, y1: y1 + ny * off1,
    x2: x2 + nx * off2, y2: y2 + ny * off2,
  }
}
