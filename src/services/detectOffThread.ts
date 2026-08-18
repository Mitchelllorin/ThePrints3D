/**
 * Client for the detection worker — with a synchronous fallback.
 *
 * The fallback matters more than it looks. Workers are unavailable in a few
 * real places (an old WebView, a locked-down browser, and unit tests), and the
 * app must still detect walls there rather than fail. So this is a strict
 * optimisation: same inputs, same result, just not on the thread that has to
 * paint.
 *
 * One worker is kept alive for the session. Spinning one up per drawing costs
 * a module parse each time, and the whole point is the seconds.
 */
import { detectWalls, type DetectWallsResult } from './wallDetector'
import type { DetectPass, DetectRequest, DetectResponse } from '../workers/detect.worker'

let worker: Worker | null = null
let nextId = 1
/** Null until tried; false once we know this environment cannot do it. */
let workerUsable: boolean | null = null

function getWorker(): Worker | null {
  if (workerUsable === false) return null
  if (worker) return worker
  try {
    worker = new Worker(new URL('../workers/detect.worker.ts', import.meta.url), { type: 'module' })
    workerUsable = true
    return worker
  } catch {
    workerUsable = false
    return null
  }
}

/** Run the pass ladder on the main thread — the fallback, and the old behaviour. */
function detectInline(image: ImageData, passes: DetectPass[]): { result: DetectWallsResult; passUsed: number } {
  let result = detectWalls(image, passes[0])
  let passUsed = 0
  for (let i = 1; i < passes.length && result.walls.length === 0; i++) {
    result = detectWalls(image, passes[i])
    passUsed = i
  }
  return { result, passUsed }
}

/**
 * Detect walls without blocking the UI.
 *
 * Tries each pass in order and returns the first that finds anything — the same
 * ladder the processor used to walk inline, moved somewhere it cannot freeze
 * the tab.
 */
export async function detectWallsOffThread(
  image: ImageData,
  passes: DetectPass[],
): Promise<{ result: DetectWallsResult; passUsed: number; offThread: boolean }> {
  const w = getWorker()
  if (!w) {
    const { result, passUsed } = detectInline(image, passes)
    return { result, passUsed, offThread: false }
  }

  const id = nextId++
  // COPY, not transfer: the caller still needs these pixels for room
  // extraction. Ten megabytes copies in a few milliseconds and this saves tens
  // of seconds, so the trade is not close.
  const buffer = image.data.buffer.slice(0) as ArrayBuffer
  const req: DetectRequest = { id, width: image.width, height: image.height, buffer, passes }

  try {
    return await new Promise((resolve, reject) => {
      const onMessage = (e: MessageEvent<DetectResponse>) => {
        if (e.data.id !== id) return
        w.removeEventListener('message', onMessage)
        w.removeEventListener('error', onError)
        if (e.data.error || !e.data.result) reject(new Error(e.data.error ?? 'no result'))
        else resolve({ result: e.data.result, passUsed: e.data.passUsed ?? 0, offThread: true })
      }
      const onError = (err: ErrorEvent) => {
        w.removeEventListener('message', onMessage)
        w.removeEventListener('error', onError)
        reject(new Error(err.message))
      }
      w.addEventListener('message', onMessage)
      w.addEventListener('error', onError)
      w.postMessage(req, [buffer])
    })
  } catch {
    // A worker that dies must not take detection down with it — one drawing
    // failing to detect is a far worse outcome than a slow one.
    workerUsable = false
    worker = null
    const { result, passUsed } = detectInline(image, passes)
    return { result, passUsed, offThread: false }
  }
}
