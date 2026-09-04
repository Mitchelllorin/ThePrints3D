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
import { captureSheet, correctionsForSheet, rememberCorrections, rememberTruth } from './corpus'

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
    /**
     * The reading itself, not just its size. Counts say how the detector did;
     * only the segments, symbols and words it produced can be put next to a
     * correction and turned into an example to learn from.
     */
    detected: {
      walls: d.parsedWalls ?? [],
      rooms: d.parsedRooms ?? [],
      openings: d.parsedOpenings ?? [],
      symbols: d.parsedSymbols ?? [],
      text: d.parsedText ?? [],
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

  /**
   * RECORD THE ANSWER, NOT JUST THE GUESS.
   *
   * captureDrawing fires once, when a drawing reaches `ready`, and stores the
   * raster next to what the DETECTOR produced. Everything the user then does to
   * those walls — tracing the ones we missed, dragging the ones we put in the
   * wrong place, deleting the ones that were never there — was applied to the
   * model and never written down. So the corpus held a pile of predictions with
   * nothing to score them against, and could not have trained anything: a
   * labelled example needs the label.
   *
   * This writes the user's own reading back. Debounced because a drag fires on
   * every pointer move and only where it lands is worth keeping.
   */
  const truthTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const unsubTruth = useAppStore.subscribe((state, prev) => {
    for (const d of state.drawings) {
      const before = prev.drawings.find((p) => p.id === d.id)
      if (!before || before.parsedWalls === d.parsedWalls) continue
      const sheetId = sheetIdByDrawing.get(d.id)
      if (!sheetId) continue
      // Only the user's hand counts as truth. A re-detect is another guess.
      const userWallCount = d.parsedWalls.filter((w) => w.source === 'user').length
      const beforeUser = before.parsedWalls.filter((w) => w.source === 'user').length
      if (userWallCount === 0 && userWallCount === beforeUser) continue
      clearTimeout(truthTimers.get(d.id))
      truthTimers.set(d.id, setTimeout(() => {
        truthTimers.delete(d.id)
        const now = useAppStore.getState().drawings.find((x) => x.id === d.id)
        if (!now) return
        void rememberTruth(sheetId, now.parsedWalls, userWallCount)
      }, 1500))
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
    for (const t of truthTimers.values()) clearTimeout(t)
    truthTimers.clear()
    unsubTruth()
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
