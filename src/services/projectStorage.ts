/**
 * Project library — persists scan sessions to IndexedDB so testers can keep
 * multiple jobs open and switch between them. IndexedDB natively stores
 * Blob/File objects, so we keep the raw uploaded files alongside the parsed
 * walls / scale / measurements.
 */
import { openDB, type IDBPDatabase } from 'idb'
import type { Drawing, Layer, Measurement, Model3D } from '../types'

const DB_NAME = 'theprints3d'
const DB_VERSION = 1
const STORE = 'projects'

export interface SavedProject {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  thumbnail?: string // data URL of canvas snapshot, optional
  drawings: SerializableDrawing[]
  layers: Layer[]
  measurements: Measurement[]
  model: Model3D
}

/**
 * Drawing as persisted: same as Drawing but the File / blob fields are stored
 * as actual Blob references (IDB handles this natively).
 */
export type SerializableDrawing = Omit<Drawing, 'file' | 'rasterUrl'> & {
  fileBlob: Blob | null
  fileName: string
  rasterBlob: Blob | null
}

let _dbPromise: Promise<IDBPDatabase> | null = null
function db(): Promise<IDBPDatabase> {
  if (!_dbPromise) {
    _dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(d) {
        if (!d.objectStoreNames.contains(STORE)) {
          d.createObjectStore(STORE, { keyPath: 'id' })
        }
      },
    })
  }
  return _dbPromise
}

export async function saveProject(p: SavedProject): Promise<void> {
  const d = await db()
  await d.put(STORE, p)
}

export async function loadProject(id: string): Promise<SavedProject | null> {
  const d = await db()
  return (await d.get(STORE, id)) ?? null
}

export async function listProjects(): Promise<SavedProject[]> {
  const d = await db()
  const all = (await d.getAll(STORE)) as SavedProject[]
  return all.sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function deleteProject(id: string): Promise<void> {
  const d = await db()
  await d.delete(STORE, id)
}

/** Convert a Drawing (in-memory) → serializable form for IDB. */
export async function serializeDrawing(drawing: Drawing): Promise<SerializableDrawing> {
  let rasterBlob: Blob | null = null
  if (drawing.rasterUrl) {
    try {
      const r = await fetch(drawing.rasterUrl)
      rasterBlob = await r.blob()
    } catch {
      // blob URL may have been revoked — ignore, restore will be visual-only
    }
  }
  const { file, rasterUrl: unusedRasterUrl, ...rest } = drawing
  void unusedRasterUrl
  return {
    ...rest,
    fileBlob: file ?? null,
    fileName: file?.name ?? 'unknown',
    rasterBlob,
  }
}

/** Convert SerializableDrawing → Drawing on load. */
export function deserializeDrawing(sd: SerializableDrawing): Drawing {
  const { fileBlob, fileName, rasterBlob, ...rest } = sd
  const file =
    fileBlob instanceof Blob
      ? new File([fileBlob], fileName, { type: fileBlob.type })
      : (null as unknown as File)
  const rasterUrl = rasterBlob ? URL.createObjectURL(rasterBlob) : ''
  return {
    ...rest,
    file,
    rasterUrl,
  } as Drawing
}

export function newProjectId(): string {
  return `proj_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}
