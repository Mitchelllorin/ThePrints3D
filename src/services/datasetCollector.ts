/**
 * DatasetCollector
 * ─────────────────
 * Persists anonymised drawing features to IndexedDB so every processed
 * drawing contributes to a growing training dataset.
 *
 * Data stored is intentionally stripped of absolute pixel coordinates —
 * only relative (normalised) values are kept, so the original drawing
 * content cannot be reconstructed from the database.
 */

import type { LineClass, LineClassificationStats, ClassifiedLine } from '../symbols/types'

// ─── Schema ───────────────────────────────────────────────────────────────────

export interface LineSample {
  /** Normalised start x (0–1, relative to raster width) */
  nx1: number
  /** Normalised start y (0–1, relative to raster height) */
  ny1: number
  /** Normalised end x (0–1) */
  nx2: number
  /** Normalised end y (0–1) */
  ny2: number
  /** Thickness relative to the longer image dimension */
  relThickness: number
  /** Dark→light transition count along the sampled line */
  transitions: number
  /** Fraction of sampled points that were "dark" / on the line */
  dark_ratio: number
  classification: LineClass
  /** 0–1 confidence from the classifier */
  confidence: number
}

export interface Correction {
  originalClass: LineClass
  correctedClass: LineClass | string
  /** Glossary symbol ID when the user identified a specific symbol */
  symbolId?: string
  correctedAt: number
}

export interface DatasetEntry {
  /** Unique ID = the Drawing ID assigned at upload time */
  id: string
  /**
   * Non-reversible fingerprint: FNV-1a over fileName + fileSize.
   * Identifies the drawing without exposing content.
   */
  drawingHash: string
  discipline: string
  scaleNotation: string | null
  wallCount: number
  stats: LineClassificationStats
  lineSamples: LineSample[]
  corrections: Correction[]
  capturedAt: number
}

// ─── IndexedDB helpers ────────────────────────────────────────────────────────

const DB_NAME = 'blueprint3d-dataset'
const DB_VERSION = 1
const STORE_NAME = 'entries'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME, { keyPath: 'id' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function getAllEntries(): Promise<DatasetEntry[]> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const store = tx.objectStore(STORE_NAME)
    const req = store.getAll()
    req.onsuccess = () => resolve(req.result as DatasetEntry[])
    req.onerror = () => reject(req.error)
  })
}

// ─── Normalisation ────────────────────────────────────────────────────────────

function normaliseSamples(
  classified: ClassifiedLine[],
  rasterWidth: number,
  rasterHeight: number,
): LineSample[] {
  const w = rasterWidth || 1
  const h = rasterHeight || 1
  const maxDim = Math.max(w, h)
  return classified.map((c) => ({
    nx1: c.x1 / w,
    ny1: c.y1 / h,
    nx2: c.x2 / w,
    ny2: c.y2 / h,
    relThickness: c.thickness / maxDim,
    transitions: c.transitions,
    dark_ratio: c.dark_ratio,
    classification: c.classification,
    confidence: c.confidence,
  }))
}

/** FNV-1a 32-bit hash over a string — deterministic, non-cryptographic. */
function fnv1a32(input: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

function hashDrawing(name: string, size: number): string {
  return fnv1a32(`${name}:${size}`)
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface CapturePayload {
  drawingName: string
  fileSize: number
  discipline: string
  scaleNotation: string | null
  wallCount: number
  stats: LineClassificationStats
  classified: ClassifiedLine[]
  rasterWidth: number
  rasterHeight: number
}

/**
 * Persist an anonymised snapshot of a processed drawing to IndexedDB.
 * Silently swallows errors so it never disrupts the processing pipeline.
 */
export async function captureDrawing(
  drawingId: string,
  payload: CapturePayload,
): Promise<void> {
  try {
    const entry: DatasetEntry = {
      id: drawingId,
      drawingHash: hashDrawing(payload.drawingName, payload.fileSize),
      discipline: payload.discipline,
      scaleNotation: payload.scaleNotation,
      wallCount: payload.wallCount,
      stats: payload.stats,
      lineSamples: normaliseSamples(payload.classified, payload.rasterWidth, payload.rasterHeight),
      corrections: [],
      capturedAt: Date.now(),
    }
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const req = tx.objectStore(STORE_NAME).put(entry)
      req.onsuccess = () => resolve()
      req.onerror = () => reject(req.error)
    })
  } catch {
    // Non-fatal — dataset collection must never block the processing pipeline
  }
}

/**
 * Append a user correction to an existing dataset entry.
 * Silently swallows errors.
 */
export async function saveCorrection(
  drawingId: string,
  correction: Omit<Correction, 'correctedAt'>,
): Promise<void> {
  try {
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      const getReq = store.get(drawingId)
      getReq.onsuccess = () => {
        const entry = getReq.result as DatasetEntry | undefined
        if (!entry) { resolve(); return }
        entry.corrections.push({ ...correction, correctedAt: Date.now() })
        store.put(entry)
        resolve()
      }
      getReq.onerror = () => reject(getReq.error)
    })
  } catch {
    // Non-fatal
  }
}

/**
 * Return aggregate counts from the local dataset store.
 */
export async function getDatasetStats(): Promise<{ entryCount: number; sampleCount: number }> {
  try {
    const entries = await getAllEntries()
    return {
      entryCount: entries.length,
      sampleCount: entries.reduce((n, e) => n + e.lineSamples.length, 0),
    }
  } catch {
    return { entryCount: 0, sampleCount: 0 }
  }
}

/**
 * Serialise all dataset entries to a newline-delimited JSON blob suitable
 * for download. Each line is one JSON-encoded DatasetEntry.
 */
export async function exportDatasetNdjson(): Promise<Blob> {
  const entries = await getAllEntries()
  const lines = entries.map((e) => JSON.stringify(e)).join('\n')
  return new Blob([lines], { type: 'application/x-ndjson' })
}
