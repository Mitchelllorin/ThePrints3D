/**
 * corpusWiring — the subscription that makes the corpus actually fill up.
 *
 * ONE PLACE, NOT TWENTY.
 *
 * Corrections are appended from all over the store: correcting a wall type,
 * recalibrating the scale by hand, tracing in a wall the detector missed,
 * deleting one it invented. Threading a `corpus.remember(...)` call through every
 * one of those would be twenty chances to forget, and the twenty-first kind of
 * correction — the one added next month — would silently not be kept.
 *
 * So nothing in the store knows about the corpus at all. This watches the two
 * pieces of state that matter and writes what it sees:
 *
 *   drawings   → a print reaching 'ready' is captured, pixels and all
 *   corrections→ anything new is filed against the sheet it was made on
 *
 * It also runs the trade in the other direction. When a print is captured and
 * turns out to be one the corpus already holds, whatever the user taught us
 * about it before comes straight back into this session — see
 * `useAppStore.mergeCorrections`.
 *
 * Everything here is fire-and-forget and every failure is swallowed. Recording
 * the work must never be able to interrupt the work.
 */
import { useAppStore } from '../store/useAppStore'
import { captureSheet, correctionsForSheet, rememberCorrections } from './corpus'

/** in-session drawing id → the sheet's content hash in the corpus. */
const sheetIdByDrawing = new Map<string, string>()
/** Drawings a capture has been started for, so it happens once each. */
const capturing = new Set<string>()

let started = false
let stop: () => void = () => {}

/** Pull the raster back out of its blob URL, the way projectStorage does. */
async function blobFrom(url: string | null | undefined): Promise<Blob | null> {
  if (!url) return null
  try {
    const r = await fetch(url)
    return await r.blob()
  } catch {
    // A revoked object URL. The sheet is still worth keeping for its source file.
    return null
  }
}

async function pixelSize(blob: Blob | null): Promise<{ width: number; height: number }> {
  if (!blob || typeof createImageBitmap !== 'function') return { width: 0, height: 0 }
  try {
    const bmp = await createImageBitmap(blob)
    const size = { width: bmp.width, height: bmp.height }
    bmp.close?.()
    return size
  } catch {
    return { width: 0, height: 0 }
  }
}

async function captureDrawing(drawingId: string): Promise<void> {
  const app = useAppStore.getState()
  const d = app.drawings.find((x) => x.id === drawingId)
  if (!d) return

  const raster = await blobFrom(d.rasterUrl)
  const { width, height } = await pixelSize(raster)
  const sheetId = await captureSheet({
    name: d.name,
    raster,
    source: d.file ?? null,
    sourceName: d.file?.name ?? d.name,
    width,
    height,
    read: {
      scaleMmPerPx: d.scaleMmPerPx,
      scaleConfidence: d.scaleConfidence ?? null,
      wallCount: d.parsedWalls.length,
      roomCount: d.parsedRooms.length,
      openingCount: d.parsedOpenings.length,
      symbolCount: d.parsedSymbols?.length ?? 0,
      textCount: d.parsedText?.length ?? 0,
    },
  })
  if (!sheetId) return
  sheetIdByDrawing.set(drawingId, sheetId)

  // Anything this print was already taught, said again to this session.
  const past = await correctionsForSheet(sheetId)
  if (past.length > 0) useAppStore.getState().mergeCorrections(past, drawingId)

  // And anything corrected before the capture finished — a fast user beats a
  // raster decode — goes in now rather than waiting for the next correction.
  const mine = useAppStore
    .getState()
    .corrections.filter((c) => c.drawingId === drawingId)
  if (mine.length > 0) void rememberCorrections(sheetId, mine)
}

/**
 * Start watching. Idempotent, and returns the unsubscribe so a test or a teardown
 * can stop it.
 */
export function startCorpusCapture(): () => void {
  if (started) return stop
  started = true

  const unsubDrawings = useAppStore.subscribe((state, prev) => {
    if (state.drawings === prev.drawings) return
    for (const d of state.drawings) {
      if (d.status !== 'ready') continue
      if (capturing.has(d.id)) continue
      capturing.add(d.id)
      void captureDrawing(d.id)
    }
  })

  const unsubCorrections = useAppStore.subscribe((state, prev) => {
    if (state.corrections === prev.corrections) return
    // Group by the sheet each record was made on: one write per sheet, and a
    // record whose drawing has not been captured yet waits for that capture,
    // which files it on the way past.
    const bySheet = new Map<string, typeof state.corrections>()
    for (const c of state.corrections) {
      const sheetId = sheetIdByDrawing.get(c.drawingId)
      if (!sheetId) continue
      const list = bySheet.get(sheetId) ?? []
      list.push(c)
      bySheet.set(sheetId, list)
    }
    for (const [sheetId, records] of bySheet) {
      void rememberCorrections(sheetId, records)
    }
  })

  stop = () => {
    unsubDrawings()
    unsubCorrections()
    started = false
  }
  return stop
}

/** The sheet a drawing was filed under, once its capture has finished. */
export function sheetIdFor(drawingId: string): string | undefined {
  return sheetIdByDrawing.get(drawingId)
}
