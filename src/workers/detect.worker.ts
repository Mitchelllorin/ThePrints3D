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
  error?: string
}

self.onmessage = (e: MessageEvent<DetectRequest>) => {
  const { id, width, height, buffer, passes } = e.data
  try {
    // detectWalls only reads width/height/data, so a structural stand-in is
    // enough — ImageData itself is not constructible everywhere in a worker.
    const image = { width, height, data: new Uint8ClampedArray(buffer) } as ImageData

    let result = detectWalls(image, passes[0])
    let passUsed = 0
    for (let i = 1; i < passes.length && result.walls.length === 0; i++) {
      result = detectWalls(image, passes[i])
      passUsed = i
    }
    const res: DetectResponse = { id, result, passUsed }
    self.postMessage(res)
  } catch (err) {
    const res: DetectResponse = { id, error: String(err) }
    self.postMessage(res)
  }
}
