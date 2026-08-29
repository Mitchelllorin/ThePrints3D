/**
 * corpus — every print the app has been shown, and everything it got told it
 * was wrong about, kept on the device.
 *
 * WHY THIS EXISTS
 * ---------------
 * The app already had two places that held data and neither of them held THIS.
 * `projectStorage` saves a job — but only when the user names it and presses
 * save, and the free tier keeps one. The `correctionLedger` holds the corrections
 * — but only in memory, so closing the tab threw away the one thing in this
 * whole product that cannot be bought, downloaded, or synthesised: a real
 * drawing, paired with a real tradesperson saying what the app got wrong on it.
 *
 * That pairing is the asset. A raster on its own is a picture; a correction on
 * its own is an opinion. Together, and in quantity, they are a training set for
 * a detector that reads prints the way the people who build from them do — and
 * nobody else is collecting it, because nobody else has a tradesperson tapping
 * walls in a 3D model of their own drawing.
 *
 * So: keep it all. The raster it was measured from, the file the user actually
 * handed over, what we read off it, and every correction against it.
 *
 * WHAT THIS IS NOT
 * ----------------
 * It never leaves the device. This is IndexedDB on the user's phone, the same
 * as the rest of the app's storage — no upload, no account, no third party. If
 * that ever changes it is a product decision with consent attached, and it will
 * be made somewhere other than a storage module. `forgetEverything` is here from
 * the first commit for the same reason: data you cannot delete is not kept, it
 * is taken.
 *
 * A SHEET IS ITS PIXELS
 * ---------------------
 * Sheets are keyed by the content hash of the raster, not by a session id. Upload
 * the same print next month and it is the same sheet: the corrections you made
 * on it are still there, and the app starts out already knowing what you taught
 * it. That is the difference between storing data and learning from it.
 */
import { openDB, type IDBPDatabase } from 'idb'
import type { CorrectionRecord } from './correctionLedger'

const DB_NAME = 'theprints3d-corpus'
const DB_VERSION = 1
const SHEETS = 'sheets'
const CORRECTIONS = 'corrections'

/**
 * NOT EVERY BYTE IS WORTH THE SAME.
 * ---------------------------------
 * "Keep it all" was the right instinct and the wrong storage policy. Weighed on
 * a phone, what the corpus holds falls into three very different piles:
 *
 *   the labelled half   what we read, and what we were told was wrong about it.
 *                       KILOBYTES. Cannot be re-obtained at any price — it only
 *                       exists because a tradesperson tapped a wall and said no.
 *                       Never dropped, for any reason, ever.
 *
 *   the pixels          the raster the reading was measured from. MEGABYTES.
 *                       Needed, because a label with no image is not an example
 *                       — but needed at reading size, not at the ~10MP the
 *                       detector rasterises to. Kept under a budget.
 *
 *   the source file     the PDF the user handed over. MEGABYTES, and the one
 *                       thing here they already have a copy of, on the same
 *                       phone, in their own downloads. Nothing measures it.
 *                       First to go, always.
 *
 * So the rule is: the cheap half is permanent and the expensive half is
 * budgeted, oldest and least-taught first. A sheet nobody has corrected is a
 * picture of a drawing; a sheet with twelve corrections on it is the asset.
 * When space runs out, the pictures go and the assets stay.
 */

/**
 * The long edge the raster is stored at.
 *
 * Detection rasterises at RASTER_SCALE 1.5 — around 3900px across a 36" sheet —
 * because thresholds all over the detector are tuned in those pixels. That is a
 * working resolution, not an archival one. At 2048 a 1/4"=1' wall line is still
 * about three pixels wide, which is enough to see and to learn from, for roughly
 * a third of the bytes. Nothing in the live pipeline reads this: detection has
 * already run and finished by the time the corpus sees anything.
 */
const RASTER_MAX_EDGE = 2048

/**
 * What the pixels are allowed to occupy in total.
 *
 * Deliberately a soft internal ceiling rather than a quota negotiation: hitting
 * the browser's real limit means a failed write in the middle of somebody's job,
 * and this is the module that promised never to interrupt the work.
 */
const BUDGET_BYTES = 64 * 1024 * 1024

/** What we read off a sheet — our answer, kept so it can be judged later. */
export interface CorpusReading {
  scaleMmPerPx: number | null
  scaleConfidence: string | null
  wallCount: number
  roomCount: number
  openingCount: number
  symbolCount: number
  textCount: number
}

/**
 * What the detector actually produced, not how much of it.
 *
 * A count is a score, and a score cannot train anything. The pixels plus the
 * segments, symbols and words we pulled off them — against the corrections that
 * say which of those were wrong — is a labelled example. This is geometry and
 * short strings, kilobytes next to a raster's megabytes, and it is the half of
 * the pair that makes the raster worth keeping.
 *
 * Stored as `unknown[]` on purpose: the shapes of `ParsedWall`, `ParsedSymbol`
 * and the rest belong to the app and will keep changing, and a record written
 * two versions ago must still load. What is on disk is a snapshot of what the
 * detector said on the day, not a live type.
 */
export interface CorpusDetection {
  walls: unknown[]
  rooms: unknown[]
  openings: unknown[]
  symbols: unknown[]
  text: unknown[]
}

export interface CorpusSheet {
  /** Content hash of the raster. The same print twice is one sheet. */
  id: string
  name: string
  capturedAt: number
  lastSeenAt: number
  /** How many separate times this print has come through the app. */
  seenCount: number
  /**
   * The rasterized page, stored at reading size rather than detection size —
   * see `shrinkRaster`. Null once the pixels have been let go for space; the
   * record itself survives that, because the record is the part that matters.
   */
  raster: Blob | null
  /** The file the user actually handed us (PDF, JPG, PNG). First to go. */
  source: Blob | null
  sourceName: string
  sourceType: string
  /**
   * Pixel size the reading was MEASURED at — the coordinate space every stored
   * correction's x/y lives in. Not necessarily the size of the blob above.
   */
  width: number
  height: number
  /** Pixel size of the raster as actually stored, if one is stored. */
  rasterWidth?: number
  rasterHeight?: number
  read: CorpusReading
  /** The first reading in full — see `CorpusDetection`. */
  detected?: CorpusDetection
}

/** A correction, tied to the pixels it was made against. */
export interface CorpusCorrection extends CorrectionRecord {
  /** The sheet's content hash — how the pixels are found again. */
  sheetId: string
}

export interface CorpusStats {
  sheets: number
  corrections: number
  /** Bytes of raster + source held, as far as the browser will tell us. */
  bytes: number
  /** How many of those sheets still have their pixels. */
  withPixels: number
  /** The ceiling the pixels are kept under, so a UI can show the headroom. */
  budgetBytes: number
}

// ─── availability ────────────────────────────────────────────────────────────

/**
 * Storage is a privilege, not a given: private windows, locked-down WebViews and
 * the node test runner all lack IndexedDB. Nothing here may throw into the app —
 * a job that cannot be recorded is still a job that has to work.
 */
export function corpusAvailable(): boolean {
  try {
    return typeof indexedDB !== 'undefined'
  } catch {
    return false
  }
}

let _db: Promise<IDBPDatabase> | null = null
function db(): Promise<IDBPDatabase> {
  if (!_db) {
    _db = openDB(DB_NAME, DB_VERSION, {
      upgrade(d) {
        if (!d.objectStoreNames.contains(SHEETS)) {
          d.createObjectStore(SHEETS, { keyPath: 'id' })
        }
        if (!d.objectStoreNames.contains(CORRECTIONS)) {
          const s = d.createObjectStore(CORRECTIONS, { keyPath: 'id' })
          s.createIndex('bySheet', 'sheetId')
        }
      },
    })
  }
  return _db
}

// ─── identity ────────────────────────────────────────────────────────────────

/**
 * The sheet's id is a hash of its own pixels.
 *
 * SHA-256 where the platform offers it. `crypto.subtle` is missing on an
 * insecure origin, which is exactly where a tradesperson testing over a LAN
 * address ends up, so there is a plain hash behind it. Collisions there are
 * vanishingly unlikely at this scale and the cost of one is a merged sheet, not
 * a lost one.
 */
export async function sheetIdFor(bytes: ArrayBuffer): Promise<string> {
  try {
    if (typeof crypto !== 'undefined' && crypto.subtle) {
      const digest = await crypto.subtle.digest('SHA-256', bytes)
      return [...new Uint8Array(digest)]
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
        .slice(0, 32)
    }
  } catch {
    /* fall through to the plain hash */
  }
  return fnv1a(new Uint8Array(bytes))
}

/** 64-bit FNV-1a over the bytes, hex. Not a cryptographic hash; not asked to be. */
function fnv1a(bytes: Uint8Array): string {
  let h = 0xcbf29ce484222325n
  const prime = 0x100000001b3n
  const mask = 0xffffffffffffffffn
  // Every byte of a multi-megabyte raster is more work than this needs. A stride
  // over the whole image separates two different prints just as well.
  const stride = Math.max(1, Math.floor(bytes.length / 65536))
  for (let i = 0; i < bytes.length; i += stride) {
    h = ((h ^ BigInt(bytes[i])) * prime) & mask
  }
  h = ((h ^ BigInt(bytes.length)) * prime) & mask
  return h.toString(16).padStart(16, '0')
}

// ─── writing ─────────────────────────────────────────────────────────────────

export interface SheetCapture {
  name: string
  raster: Blob | null
  source: Blob | null
  sourceName: string
  width: number
  height: number
  read: CorpusReading
  detected?: CorpusDetection
}

/** What actually gets written for the pixels, once they have been cut down. */
interface StoredRaster {
  blob: Blob | null
  width: number
  height: number
}

/**
 * Cut the raster down to reading size before it is written.
 *
 * The id is hashed from the ORIGINAL bytes, upstream of this, and must stay that
 * way: resampling is only deterministic within one browser build, so a sheet
 * keyed off a resized copy would stop recognising itself after an update. The
 * hash identifies the print; this only decides how much of it we keep.
 *
 * Every failure here returns the raster untouched. Storing a big image is a cost;
 * storing no image is a loss.
 */
async function shrinkRaster(
  blob: Blob | null,
  width: number,
  height: number,
): Promise<StoredRaster> {
  if (!blob) return { blob: null, width: 0, height: 0 }
  const longEdge = Math.max(width, height)
  if (!longEdge || longEdge <= RASTER_MAX_EDGE) {
    return { blob, width, height }
  }
  try {
    if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas === 'undefined') {
      return { blob, width, height }
    }
    const scale = RASTER_MAX_EDGE / longEdge
    const w = Math.max(1, Math.round(width * scale))
    const h = Math.max(1, Math.round(height * scale))
    const bmp = await createImageBitmap(blob, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' })
    const canvas = new OffscreenCanvas(w, h)
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      bmp.close?.()
      return { blob, width, height }
    }
    ctx.drawImage(bmp, 0, 0)
    bmp.close?.()
    // PNG, not JPEG or lossy WebP: this is line art, and the artefacts those
    // leave around a thin wall line are exactly the detail being kept.
    const out = await canvas.convertToBlob({ type: 'image/png' })
    // A resize that came back bigger has done nothing but cost time.
    return out.size < blob.size ? { blob: out, width: w, height: h } : { blob, width, height }
  } catch {
    return { blob, width, height }
  }
}

/**
 * Bring the pixels back under the budget, cheapest thing first.
 *
 * Order is by what the bytes buy, not by age alone: every source file goes
 * before any raster does, and among rasters the least-taught sheet loses its
 * pixels first — a sheet with no corrections against it is a picture, a sheet
 * with a dozen is a labelled example.
 *
 * NOTHING IS EVER DELETED HERE. The record, the reading and every correction
 * stay exactly where they are; a pruned sheet is one that still knows what it
 * was read as and what it got wrong, and no longer carries the image.
 */
async function pruneToBudget(): Promise<void> {
  if (!corpusAvailable()) return
  try {
    const d = await db()
    const sheets = (await d.getAll(SHEETS)) as CorpusSheet[]
    let total = sheets.reduce((n, s) => n + (s.raster?.size ?? 0) + (s.source?.size ?? 0), 0)
    if (total <= BUDGET_BYTES) return

    const taught = new Map<string, number>()
    for (const c of (await d.getAll(CORRECTIONS)) as CorpusCorrection[]) {
      taught.set(c.sheetId, (taught.get(c.sheetId) ?? 0) + 1)
    }
    /** Least taught first; between equals, the one seen longest ago. */
    const byValue = [...sheets].sort(
      (a, b) =>
        (taught.get(a.id) ?? 0) - (taught.get(b.id) ?? 0) ||
        a.lastSeenAt - b.lastSeenAt,
    )

    const shed = async (pick: (s: CorpusSheet) => Blob | null, drop: (s: CorpusSheet) => CorpusSheet) => {
      for (const s of byValue) {
        if (total <= BUDGET_BYTES) return
        const blob = pick(s)
        if (!blob) continue
        total -= blob.size
        await d.put(SHEETS, drop(s))
      }
    }

    // Pass one: the user's own files, which the user already has.
    await shed((s) => s.source, (s) => ({ ...s, source: null }))
    // Pass two, only if that was not enough: pixels, least-taught sheet first.
    await shed(
      (s) => s.raster,
      (s) => ({ ...s, raster: null, rasterWidth: undefined, rasterHeight: undefined }),
    )
  } catch {
    // Over budget is a worse state than the one we were in, not a broken one.
  }
}

/**
 * Put a sheet in the corpus, or recognise one already there.
 *
 * Returns the sheet id — which the caller wants whether the sheet was new or
 * not, because it is the key its corrections hang off.
 *
 * A sheet seen again is NOT overwritten. The first capture holds what the app
 * read the first time it ever saw this print, and that reading is evidence:
 * comparing it against a later one is how we will know whether the detector
 * actually improved. Only the counters move.
 */
export async function captureSheet(input: SheetCapture): Promise<string | null> {
  if (!corpusAvailable()) return null
  try {
    const bytes = input.raster
      ? await input.raster.arrayBuffer()
      : input.source
        ? await input.source.arrayBuffer()
        : null
    if (!bytes || bytes.byteLength === 0) return null
    const id = await sheetIdFor(bytes)

    const d = await db()
    const existing = (await d.get(SHEETS, id)) as CorpusSheet | undefined
    if (existing) {
      // Only pay for the resize if there is actually a gap to fill. A sheet that
      // already has its pixels — or that had them pruned on purpose — is left be.
      const fill = !existing.raster && existing.rasterWidth === undefined
      const px = fill
        ? await shrinkRaster(input.raster, input.width, input.height)
        : { blob: existing.raster, width: existing.rasterWidth ?? 0, height: existing.rasterHeight ?? 0 }
      await d.put(SHEETS, {
        ...existing,
        lastSeenAt: Date.now(),
        seenCount: (existing.seenCount ?? 1) + 1,
        // A sheet captured before the raster was ready gets its pixels now.
        raster: px.blob,
        rasterWidth: px.blob ? px.width : existing.rasterWidth,
        rasterHeight: px.blob ? px.height : existing.rasterHeight,
        source: existing.source ?? input.source,
        // Likewise a sheet stored before we kept the full reading — but a
        // reading already on record is never replaced, because comparing the
        // first one against a later one is how we will know the detector got
        // better rather than just different.
        detected: existing.detected ?? input.detected,
      })
      await pruneToBudget()
      return id
    }

    const px = await shrinkRaster(input.raster, input.width, input.height)
    const sheet: CorpusSheet = {
      id,
      name: input.name,
      capturedAt: Date.now(),
      lastSeenAt: Date.now(),
      seenCount: 1,
      raster: px.blob,
      rasterWidth: px.blob ? px.width : undefined,
      rasterHeight: px.blob ? px.height : undefined,
      source: input.source,
      sourceName: input.sourceName,
      sourceType: input.source?.type ?? '',
      // The size the reading was measured at, which is what a correction's
      // coordinates mean — never the size the blob was cut down to.
      width: input.width,
      height: input.height,
      read: input.read,
      detected: input.detected,
    }
    await d.put(SHEETS, sheet)
    await pruneToBudget()
    return id
  } catch {
    // Quota, a locked database, a revoked blob URL — the job carries on.
    return null
  }
}

/**
 * Keep the corrections made against a sheet. Idempotent: a record already held
 * is written again with the same key rather than duplicated, so a caller may
 * hand over the whole ledger every time without growing it.
 *
 * Returns how many records the corpus now holds for that sheet.
 */
export async function rememberCorrections(
  sheetId: string,
  records: readonly CorrectionRecord[],
): Promise<number> {
  if (!corpusAvailable() || !sheetId) return 0
  try {
    const d = await db()
    const tx = d.transaction(CORRECTIONS, 'readwrite')
    for (const r of records) {
      // Keyed by sheet AND record id: two sheets can each have a 'corr-1'.
      await tx.store.put({ ...r, id: `${sheetId}:${r.id}`, sheetId })
    }
    await tx.done
    return await d.countFromIndex(CORRECTIONS, 'bySheet', sheetId)
  } catch {
    return 0
  }
}

// ─── reading ─────────────────────────────────────────────────────────────────

/**
 * What the user has already taught us about this print — the reason a sheet is
 * keyed by its pixels. Ids are returned as they were written by the ledger, not
 * as they are keyed here, so the records can go straight back into the store.
 */
export async function correctionsForSheet(
  sheetId: string,
): Promise<CorrectionRecord[]> {
  if (!corpusAvailable() || !sheetId) return []
  try {
    const d = await db()
    const rows = (await d.getAllFromIndex(
      CORRECTIONS,
      'bySheet',
      sheetId,
    )) as CorpusCorrection[]
    return rows
      .map(({ sheetId: _sheet, ...rec }) => ({
        ...rec,
        id: String(rec.id).startsWith(`${sheetId}:`)
          ? String(rec.id).slice(sheetId.length + 1)
          : rec.id,
      }))
      .sort((a, b) => a.at - b.at) as CorrectionRecord[]
  } catch {
    return []
  }
}

export async function listSheets(): Promise<CorpusSheet[]> {
  if (!corpusAvailable()) return []
  try {
    const d = await db()
    const all = (await d.getAll(SHEETS)) as CorpusSheet[]
    return all.sort((a, b) => b.lastSeenAt - a.lastSeenAt)
  } catch {
    return []
  }
}

/** How much the corpus is actually worth, in the only terms it can count itself. */
export async function corpusStats(): Promise<CorpusStats> {
  const empty: CorpusStats = {
    sheets: 0, corrections: 0, bytes: 0, withPixels: 0, budgetBytes: BUDGET_BYTES,
  }
  if (!corpusAvailable()) return empty
  try {
    const d = await db()
    const sheets = (await d.getAll(SHEETS)) as CorpusSheet[]
    const bytes = sheets.reduce(
      (n, s) => n + (s.raster?.size ?? 0) + (s.source?.size ?? 0),
      0,
    )
    return {
      sheets: sheets.length,
      corrections: await d.count(CORRECTIONS),
      bytes,
      withPixels: sheets.filter((s) => !!s.raster).length,
      budgetBytes: BUDGET_BYTES,
    }
  } catch {
    return empty
  }
}

/**
 * The corpus as text, for a training run that happens somewhere else.
 *
 * Metadata and correction pairs only — the rasters stay where they are. A JSON
 * file with a few hundred megabytes of base64 in it is not an export, it is a
 * way to crash a phone. Each entry carries its sheet id, which is the hash of
 * the pixels, so an image exported separately can always be matched back.
 */
export async function exportCorpus(): Promise<string> {
  const sheets = await listSheets()
  const corrections = corpusAvailable()
    ? await (async () => {
        try {
          const d = await db()
          return (await d.getAll(CORRECTIONS)) as CorpusCorrection[]
        } catch {
          return []
        }
      })()
    : []
  return JSON.stringify(
    {
      version: 1,
      exportedAt: Date.now(),
      sheets: sheets.map(({ raster, source, ...meta }) => ({
        ...meta,
        rasterBytes: raster?.size ?? 0,
        sourceBytes: source?.size ?? 0,
      })),
      corrections,
    },
    null,
    2,
  )
}

/**
 * Delete the lot. Present from the first commit, because the answer to "what do
 * you keep about me?" has to come with a way to make the answer nothing.
 */
export async function forgetEverything(): Promise<void> {
  if (!corpusAvailable()) return
  try {
    const d = await db()
    await d.clear(SHEETS)
    await d.clear(CORRECTIONS)
  } catch {
    /* nothing to do — it is already unreachable */
  }
}
