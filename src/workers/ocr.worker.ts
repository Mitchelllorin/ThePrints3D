/**
 * Reading the words on a drawing, off the main thread.
 *
 * THE PROBLEM THIS SOLVES, measured rather than assumed.
 *
 * `ocrRaster` was called inline from the processing pipeline and given a 25
 * second budget. Run twice against the same 759x622 screenshot in
 * data/test-prints/, it returned 35 words the first time and ZERO the second,
 * taking 42 seconds to do it. Same image, same code, different answer — because
 * the budget is wall-clock and the thing it was racing was not the recogniser.
 *
 * Tesseract already does its own work in its own worker. What it still needs
 * from the main thread is the two things a promise needs: a message handler to
 * run, and a microtask to resolve on. The pipeline around it — room extraction,
 * symbol detection, normalisation — saturates that thread for a long time (174
 * seconds end-to-end on that screenshot), so the recogniser finishes and then
 * sits there unable to hand its answer back until the timeout has already
 * fired. The words were read and then thrown away.
 *
 * That one fact explains the complaint it came from: a plan clearly labelled
 * KITCHEN, and nothing in the model knowing it. And it cascades, which is the
 * part that is not obvious — the stated area ("TOTAL AREA = 71 m²") is the only
 * route to a scale that is READ rather than inferred from line weight. Lose the
 * words, lose the scale; miss the scale and every wall thickness in millimetres
 * is wrong; get those wrong and the classifier buckets nothing, which is why 21
 * of 28 walls on that sheet came back `unknown` and every one of them rendered
 * at the same default size.
 *
 * So the whole chain moves here — normalise, draw, recognise, map to tokens —
 * where no amount of main-thread work can starve it, and where the timeout can
 * be generous because nothing it waits on is holding a paint.
 */
import { normalizeForDetection } from '../services/rasterNormalize'
import { tokensFromPage, type OcrPage, type SizedTextToken } from '../services/ocr'

export interface OcrRequest {
  id: number
  width: number
  height: number
  buffer: ArrayBuffer
  minConfidence: number
}

export interface OcrResponse {
  id: number
  tokens?: SizedTextToken[]
  error?: string
}

self.onmessage = async (e: MessageEvent<OcrRequest>) => {
  const { id, width, height, buffer, minConfidence } = e.data
  try {
    const data = new Uint8ClampedArray(buffer)
    // Normalised for the same reason detection is: the recogniser was trained
    // on documents, and a washed-out screenshot with its ink at 120 is not what
    // it expects. A clean render passes through untouched.
    const prepared = normalizeForDetection({ width, height, data }).image

    // OffscreenCanvas, because there is no `document` out here. This is the one
    // real difference from the main-thread path and the reason the two cannot
    // simply be the same function.
    const canvas = new OffscreenCanvas(prepared.width, prepared.height)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('no 2d context in worker')
    const bytes = new Uint8ClampedArray(prepared.data.length)
    bytes.set(prepared.data)
    ctx.putImageData(new ImageData(bytes, prepared.width, prepared.height), 0, 0)

    const { createWorker } = await import('tesseract.js')
    const worker = await createWorker('eng')
    try {
      // `blocks` must be asked for. Word positions are the whole point — a
      // label only names a room if we know WHICH room it sits in — and in this
      // version they live under blocks > paragraphs > lines > words.
      const result = await worker.recognize(canvas, {}, { blocks: true, text: true })
      const res: OcrResponse = { id, tokens: tokensFromPage(result.data as OcrPage, minConfidence) }
      self.postMessage(res)
    } finally {
      await worker.terminate().catch(() => {})
    }
  } catch (err) {
    const res: OcrResponse = { id, error: String(err) }
    self.postMessage(res)
  }
}
