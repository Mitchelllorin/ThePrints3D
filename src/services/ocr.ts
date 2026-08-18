/**
 * READ THE WORDS ON THE DRAWING.
 *
 * A plan states its own answers in plain text and the app has never been able
 * to see them. Text arrives from exactly one place — `page.getTextContent()`,
 * the PDF's text layer (pdfRasterizer) — so on a PDF we get the words for free
 * and on anything else we get nothing at all. The type has always admitted it:
 * `source: 'pdf_text' | 'ocr'`, with nothing ever producing 'ocr'.
 *
 * "Anything else" is most of what people actually hand you. A screenshot, a
 * photo of a sheet on a tailgate, a scan. Those are pixels of letters, and the
 * two captures in data/test-prints/ are exactly that.
 *
 * What the words are worth, in order:
 *
 *   SCALE   "TOTAL AREA = 71 m²" is printed on the ADU capture. One stated
 *           area over a measurable pixel footprint gives mm/px exactly — no
 *           assumption about what a wall is made of. Scale is the error that
 *           poisons every dimension downstream, and inferring it from line
 *           weight was 3x out on that very file.
 *   ROOMS   "Bathroom", "KITCHEN", "WALK - IN CLOSET". A named room is a room
 *           that gets tile backer and the right circuits — the reasoning is
 *           already built (roomNames, wetWalls, constructionCode) and has been
 *           starved of input on every raster.
 *   COUNT   Five labels means five rooms. Room extraction currently reports one
 *           on that plan, and nothing in the app knows it is wrong.
 *
 * Tesseract, Apache-2.0, on-device, lazily imported so its wasm never lands in
 * the main bundle. Deliberately best-effort: OCR that fails must cost us the
 * words, never the build.
 */

import type { RasterTextToken } from './pdfRasterizer'

/**
 * A token that still remembers how wide it was.
 *
 * `RasterTextToken` carries only a centre point, which is all the rest of the
 * app needs. Joining words into phrases needs the width too: the gap between
 * two words is the distance between their EDGES, and comparing centres instead
 * measures word-width-plus-space and splits every phrase. That is what left
 * "TOTAL AREA = 71 m²" as the single word "TOTAL", with no number and no unit
 * for the scale oracle to read.
 */
export interface SizedTextToken extends RasterTextToken {
  /** Word width in pixels. */
  w?: number
  /** Word height in pixels — a rough stand-in for the size of a space. */
  h?: number
}
import { normalizeForDetection, type RasterLike } from './rasterNormalize'

export interface OcrOptions {
  /**
   * Words below this confidence are dropped. Tesseract reports 0-100. A
   * drawing is a hostile input — hatching, dimension ticks and furniture all
   * produce confident nonsense — so this sits high on purpose: a wrong room
   * name is worse than no room name, because it silently changes what gets
   * built.
   */
  minConfidence?: number
  /** Give up after this long rather than hold the pipeline. */
  timeoutMs?: number
}

/** Is a raster worth running OCR over at all? */
export function shouldOcr(existingTokens: RasterTextToken[] | undefined | null): boolean {
  // A PDF text layer is exact, already positioned, and free. OCR is a fallback
  // for the rasters that have no layer to read, never a second opinion on one
  // that does.
  return !existingTokens || existingTokens.length === 0
}

/**
 * OCR a raster into positioned text tokens.
 *
 * Returns [] on any failure — a missing worker, a blocked download, a timeout.
 * The caller carries on without words, which is where it was before this
 * existed.
 */
export async function ocrRaster(
  img: RasterLike,
  options: OcrOptions = {},
): Promise<SizedTextToken[]> {
  const { minConfidence = 60, timeoutMs = 25_000 } = options
  if (!img.width || !img.height) return []

  try {
    // Normalised first, for the same reason detection is: the recogniser was
    // trained on documents, and a washed-out screenshot with its ink at 120 is
    // not what it expects. A clean render passes through untouched.
    const prepared = normalizeForDetection(img).image

    const canvas = toCanvas(prepared)
    if (!canvas) return []

    const { createWorker } = await import('tesseract.js')
    const worker = await createWorker('eng')
    try {
      // `blocks` must be asked for. Word positions are the whole point here —
      // a label only names a room if we know WHICH room it sits in — and in
      // this version they live under blocks > paragraphs > lines > words.
      // There is no `data.words`; reading one got undefined and quietly
      // produced no text at all.
      const run = worker.recognize(canvas, {}, { blocks: true, text: true })
      const result = await withTimeout(run, timeoutMs)
      if (!result) return []

      const words = wordsOf(result.data as OcrPage)
      const tokens: SizedTextToken[] = []
      for (const w of words) {
        const text = (w.text ?? '').trim()
        if (!text) continue
        if ((w.confidence ?? 0) < minConfidence) continue
        const b = w.bbox
        if (!b) continue
        tokens.push({
          text,
          // Centre of the word, matching how PDF text tokens are positioned and
          // how symbolDetection tests a label against a room's bounding box.
          x: Math.round((b.x0 + b.x1) / 2),
          y: Math.round((b.y0 + b.y1) / 2),
          // Normalised to the 0-1 the rest of the app uses.
          confidence: Math.max(0, Math.min(1, (w.confidence ?? 0) / 100)),
          w: Math.abs(b.x1 - b.x0),
          h: Math.abs(b.y1 - b.y0),
        })
      }
      return tokens
    } finally {
      await worker.terminate().catch(() => {})
    }
  } catch (err) {
    // Best-effort by design — but SAY SO. Swallowing this silently meant a
    // failed run and a drawing with genuinely no words looked identical from
    // the outside, and there was no way to tell which had happened.
    console.warn('[ocr] recognition failed, continuing without words:', err)
    return []
  }
}

interface OcrWord {
  text?: string
  confidence?: number
  bbox?: { x0: number; y0: number; x1: number; y1: number }
}

/** Only the parts of the result we read — blocks may be absent or null. */
interface OcrPage {
  blocks?: { paragraphs?: { lines?: { words?: OcrWord[] }[] }[] }[] | null
}

/** Flatten the block/paragraph/line tree down to the words. */
function wordsOf(page: OcrPage): OcrWord[] {
  const out: OcrWord[] = []
  for (const block of page.blocks ?? []) {
    for (const para of block.paragraphs ?? []) {
      for (const line of para.lines ?? []) {
        for (const w of line.words ?? []) out.push(w)
      }
    }
  }
  return out
}

function toCanvas(img: RasterLike): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  canvas.width = img.width
  canvas.height = img.height
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  const bytes = new Uint8ClampedArray(img.data.length)
  bytes.set(img.data)
  ctx.putImageData(new ImageData(bytes, img.width, img.height), 0, 0)
  return canvas
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), ms)
    p.then((v) => { clearTimeout(t); resolve(v) }).catch(() => { clearTimeout(t); resolve(null) })
  })
}

/**
 * A phrase reassembled from the words that sit on one line.
 *
 * OCR returns words, and a room is often named in two or three of them —
 * "Kitchen & Dining Area", "WALK - IN CLOSET", "TOTAL AREA = 71 m²". Matching a
 * vocabulary against single words would find "Kitchen" and lose "Dining", and
 * would never see the total area at all. Words within `gapPx` on the same
 * baseline belong to the same phrase.
 */
export function groupIntoLines(
  tokens: SizedTextToken[],
  /** Multiples of the word height that still count as one space, not a new
   *  phrase. Measured EDGE to EDGE — see SizedTextToken. */
  gapFactor = 1.6,
  lineTolFactor = 0.8,
): RasterTextToken[] {
  if (tokens.length === 0) return []
  const heights = tokens.map((t) => t.h ?? 12).filter((h) => h > 0).sort((a, b) => a - b)
  const medianH = heights.length ? heights[Math.floor(heights.length / 2)] : 12
  const lineTolPx = Math.max(6, medianH * lineTolFactor)
  const gapPx = Math.max(10, medianH * gapFactor)

  const sorted = [...tokens].sort((a, b) => (a.y - b.y) || (a.x - b.x))
  const lines: SizedTextToken[][] = []
  for (const t of sorted) {
    const line = lines.find((l) => Math.abs(l[0].y - t.y) <= lineTolPx)
    if (line) line.push(t)
    else lines.push([t])
  }

  const out: RasterTextToken[] = []
  for (const line of lines) {
    line.sort((a, b) => a.x - b.x)
    let run: SizedTextToken[] = []
    const flush = () => {
      if (run.length === 0) return
      const text = run.map((r) => r.text).join(' ')
      out.push({
        text,
        x: Math.round(run.reduce((s, r) => s + r.x, 0) / run.length),
        y: Math.round(run.reduce((s, r) => s + r.y, 0) / run.length),
        confidence: run.reduce((s, r) => s + r.confidence, 0) / run.length,
      })
      run = []
    }
    for (const t of line) {
      if (run.length) {
        const prev = run[run.length - 1]
        // Edge to edge, not centre to centre.
        const gap = (t.x - (t.w ?? 0) / 2) - (prev.x + (prev.w ?? 0) / 2)
        if (gap > gapPx) flush()
      }
      run.push(t)
    }
    flush()
  }
  // Keep the individual words too: a single-word label ("BEDROOM") is already a
  // phrase, and a room's label may be the only word on its line.
  return [...out, ...tokens]
}
