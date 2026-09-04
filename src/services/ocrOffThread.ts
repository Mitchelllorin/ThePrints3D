/**
 * Client for the OCR worker — with the main-thread reader as a fallback.
 *
 * Same shape as `detectOffThread`, and for the same reason: workers are absent
 * in a few real places (an old WebView, a locked-down browser, the unit test
 * runner), and a drawing must still be readable there. This is a strict
 * optimisation — same image in, same tokens out, just somewhere that cannot be
 * starved by the pipeline running around it.
 *
 * WHY THE TIMEOUT GOT BIGGER, NOT SMALLER.
 *
 * The inline version raced a 25 second wall clock and lost: measured at 42
 * seconds on a 759x622 screenshot, returning nothing, having successfully read
 * 35 words. A tight budget is only protective when the thing it interrupts is
 * holding the UI hostage. Out here nothing it waits on paints, so the honest
 * budget is "long enough that a phone finishes" — a slow device with a cold
 * cache has several megabytes of model to fetch before it reads a single
 * letter, and cutting it off at that point wastes the download AND the words.
 *
 * The ceiling still exists so a wedged worker cannot hang a drawing forever.
 */
import { ocrRaster, type SizedTextToken } from './ocr'
import type { RasterLike } from './rasterNormalize'
import type { OcrRequest, OcrResponse } from '../workers/ocr.worker'

/**
 * Generous on purpose — see above. First run on a cold cache pays for the
 * language model download; every run after it is far quicker.
 */
/**
 * A budget, not a deadline for correctness. Words are a BONUS — room names and
 * a stated area sharpen the read, and a print with none still builds. So when
 * this runs out the answer is "no words", not "do it all again somewhere worse".
 * 45s is long enough for a real sheet on a phone and short enough that nobody
 * watches a blank workspace wondering if it crashed.
 */
const OFF_THREAD_TIMEOUT_MS = 45_000

let worker: Worker | null = null
let nextId = 1
/** Null until tried; false once we know this environment cannot do it. */
let workerUsable: boolean | null = null

function getWorker(): Worker | null {
  if (workerUsable === false) return null
  if (worker) return worker
  try {
    worker = new Worker(new URL('../workers/ocr.worker.ts', import.meta.url), { type: 'module' })
    workerUsable = true
    return worker
  } catch {
    workerUsable = false
    return null
  }
}

/**
 * Read the words off a raster without being starved by the main thread.
 *
 * Never throws and never rejects: a drawing with no words still has to build.
 * A failure out here falls back to the inline reader rather than giving up, so
 * the worst case is the behaviour this replaced.
 */
/** Distinguishes "too slow" from "broken" — they want opposite answers. */
export class OcrTimeout extends Error {
  constructor() { super('ocr worker timed out') ; this.name = 'OcrTimeout' }
}

export async function ocrRasterOffThread(
  img: RasterLike,
  minConfidence = 60,
): Promise<{ tokens: SizedTextToken[]; offThread: boolean }> {
  if (!img.width || !img.height) return { tokens: [], offThread: false }

  const w = getWorker()
  if (!w) return { tokens: await ocrRaster(img), offThread: false }

  const id = nextId++
  // COPY, not transfer. The caller still needs these pixels — this runs
  // alongside room extraction, which reads the same raster — and half a
  // megapixel copies in about a millisecond.
  const buffer = new Uint8ClampedArray(img.data).buffer as ArrayBuffer
  const req: OcrRequest = { id, width: img.width, height: img.height, buffer, minConfidence }

  try {
    const tokens = await new Promise<SizedTextToken[]>((resolve, reject) => {
      const timer = setTimeout(() => { cleanup(); reject(new OcrTimeout()) }, OFF_THREAD_TIMEOUT_MS)
      const cleanup = () => {
        clearTimeout(timer)
        w.removeEventListener('message', onMessage)
        w.removeEventListener('error', onError)
      }
      const onMessage = (e: MessageEvent<OcrResponse>) => {
        if (e.data.id !== id) return
        cleanup()
        if (e.data.error) reject(new Error(e.data.error))
        else resolve(e.data.tokens ?? [])
      }
      const onError = (err: ErrorEvent) => { cleanup(); reject(new Error(err.message)) }
      w.addEventListener('message', onMessage)
      w.addEventListener('error', onError)
      w.postMessage(req, [buffer])
    })
    return { tokens, offThread: true }
  } catch (err) {
    /**
     * A TIMEOUT IS NOT A FAILURE, AND THE FALLBACK WAS WORSE THAN IT.
     *
     * This used to answer every rejection by running the whole OCR AGAIN on the
     * main thread — the one thing the worker exists to prevent. So a slow sheet
     * cost its 120s budget in the worker and then blocked the UI for as long
     * again, which is why a 732x727 screenshot could take over four minutes
     * with the workspace apparently frozen. It also set `workerUsable = false`,
     * so every later print in the session skipped the worker too: one slow
     * sheet poisoned the whole run.
     *
     * Slowness and breakage want opposite answers. If the worker is merely
     * slow, the work is already being done and repeating it on the thread that
     * has to paint is strictly worse — take "no words" and carry on; the print
     * still builds, just without room names. If the worker is genuinely broken
     * — it could not be constructed, or it threw — then the main thread is the
     * only place left, and that fallback is kept exactly as it was.
     */
    if (err instanceof OcrTimeout) {
      console.warn('[ocr] worker exceeded its budget; continuing without words')
      return { tokens: [], offThread: true }
    }
    // SAY SO. A silent failure here is indistinguishable from a drawing that
    // genuinely has no words on it, which is precisely how this went unnoticed.
    console.warn('[ocr] worker failed, falling back to the main thread:', err)
    workerUsable = false
    worker = null
    return { tokens: await ocrRaster(img), offThread: false }
  }
}
