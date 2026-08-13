/**
 * Wall detection, off the main thread.
 *
 * THE PROBLEM THIS SOLVES. Detection ran inline, and the comment where it did
 * said "runs in main thread — acceptable for most drawing sizes". On a real
 * architectural sheet it is not: RASTER_SCALE 1.5 over a 36x24" page is around
 * ten megapixels, and the processor makes up to THREE full passes over it —
 * strict, then looser if that found nothing, then very lenient. Worst case is
 * thirty megapixels of edge-walking with no yield anywhere.
 *
 * Measured with `__scorePrints()`: the smallest print in the corpus (1.3MB) had
 * not returned after ninety-five seconds, and the tab was locked hard enough
 * that the debugger itself timed out talking to it.
 *
 * That one fact explains a set of symptoms that looked unrelated all week — an
 * upload that "froze", a viewport that came up black until you resized it (the
 * resize did not fix anything; the work had simply finished by then), and
 * repeated tooling timeouts. A blocked main thread cannot repaint, so it
 * presents as a different bug every time you look at it.
 *
 * WHY ALL THREE PASSES LIVE IN HERE. The fallbacks only run when the previous
 * pass found nothing, so posting each one separately would mean up to three
 * round trips and three copies of a ten-megapixel buffer. The worker owns the
 * whole ladder and returns the first pass that finds walls.
 *
 * The image arrives as a COPY rather than a transfer: the main thread still
 * needs the same pixels afterwards for room extraction, and copying ten
 * megabytes costs a few milliseconds against the tens of seconds this saves.
 */
import { detectWalls } from '../services/wallDetector'
import type { DetectWallsResult } from '../services/wallDetector'

export interface DetectPass {
  edgeThreshold: number
  minWallLengthPx: number
  minWallThicknessPx: number
  maxWallThicknessPx: number
  requirePairedEdges: boolean
  mergeGapPx: number
}

export interface DetectRequest {
  id: number
  width: number
  height: number
  buffer: ArrayBuffer
  /** Tried in order; the first that finds any walls wins. */
  passes: DetectPass[]
}

export interface DetectResponse {
  id: number
  result?: DetectWallsResult
  /** Which pass produced it — 0-based. Useful for the scoring harness. */
  passUsed?: number
  /** 1 if detected at full size, 2 if halved. Results are already scaled back. */
  scaledBy?: number
  error?: string
}

/**
 * DETECT AT HALF SIZE, REPORT AT FULL SIZE.
 *
 * Detection is O(pixels) and a 36x24" sheet at RASTER_SCALE 1.5 is about ten
 * megapixels — times up to three passes. Halving each dimension is FOUR TIMES
 * less work, which is the single biggest lever there is.
 *
 * The tempting version of this is lowering RASTER_SCALE, and it is a trap: the
 * detector's thresholds are all in PIXELS (min wall thickness, min length,
 * merge gap), so shrinking the raster silently changes what counts as a wall.
 * Doing it here instead means the app's raster is untouched — the print still
 * displays at full resolution and room extraction still gets the real pixels —
 * and the thresholds are scaled EXPLICITLY alongside the image, so the detector
 * is asked the same question about the same building, just in smaller units.
 * Wall coordinates are multiplied back on the way out.
 *
 * Only when it is worth it. Below the threshold the copy costs more than the
 * saving, and a small drawing has thin lines that a downsample can lose.
 */
const DOWNSAMPLE_ABOVE_PX = 6_000_000

/** Average k x k blocks. Averaging rather than dropping pixels, so a thin dark
 *  line survives as a grey one instead of vanishing between samples. */
function halve(src: Uint8ClampedArray, w: number, h: number): { data: Uint8ClampedArray<ArrayBuffer>; w: number; h: number } {
  const nw = w >> 1, nh = h >> 1
  const out = new Uint8ClampedArray(nw * nh * 4)
  for (let y = 0; y < nh; y++) {
    const r0 = (y * 2) * w, r1 = (y * 2 + 1) * w
    for (let x = 0; x < nw; x++) {
      const a = (r0 + x * 2) * 4, b = a + 4, c = (r1 + x * 2) * 4, d = c + 4
      const o = (y * nw + x) * 4
      for (let ch = 0; ch < 4; ch++) {
        out[o + ch] = (src[a + ch] + src[b + ch] + src[c + ch] + src[d + ch]) >> 2
      }
    }
  }
  return { data: out, w: nw, h: nh }
}

/** Pixel-domain options, restated in the smaller image's units. */
function scalePass(p: DetectPass, k: number): DetectPass {
  return {
    // Intensity, not distance — a gradient does not change because the image did.
    edgeThreshold: p.edgeThreshold,
    minWallLengthPx: Math.max(4, Math.round(p.minWallLengthPx / k)),
    minWallThicknessPx: Math.max(1, Math.round(p.minWallThicknessPx / k)),
    maxWallThicknessPx: Math.max(2, Math.round(p.maxWallThicknessPx / k)),
    requirePairedEdges: p.requirePairedEdges,
    mergeGapPx: Math.max(1, Math.round(p.mergeGapPx / k)),
  }
}

self.onmessage = (e: MessageEvent<DetectRequest>) => {
  const { id, width, height, buffer, passes } = e.data
  try {
    let data: Uint8ClampedArray<ArrayBuffer> = new Uint8ClampedArray(buffer)
    let w = width, h = height, k = 1
    if (w * h > DOWNSAMPLE_ABOVE_PX) {
      const small = halve(data, w, h)
      data = small.data; w = small.w; h = small.h; k = 2
    }
    // detectWalls only reads width/height/data, so a structural stand-in is
    // enough — ImageData itself is not constructible everywhere in a worker.
    const image = { width: w, height: h, data } as ImageData
    const laddered = k === 1 ? passes : passes.map((p) => scalePass(p, k))

    let result = detectWalls(image, laddered[0])
    let passUsed = 0
    for (let i = 1; i < laddered.length && result.walls.length === 0; i++) {
      result = detectWalls(image, laddered[i])
      passUsed = i
    }

    if (k !== 1) {
      // Back into the raster's own coordinates, which is what everything
      // downstream — the overlay, the model, the takeoff — is expressed in.
      result = {
        ...result,
        walls: result.walls.map((wall) => ({
          ...wall,
          x1: wall.x1 * k, y1: wall.y1 * k,
          x2: wall.x2 * k, y2: wall.y2 * k,
          thickness: wall.thickness * k,
        })),
      }
    }

    const res: DetectResponse = { id, result, passUsed, scaledBy: k }
    self.postMessage(res)
  } catch (err) {
    const res: DetectResponse = { id, error: String(err) }
    self.postMessage(res)
  }
}
