/**
 * THE OPEN JOB — saved as you go, back where you left it on the next launch.
 *
 * There is no Save button to forget. A phone kills a backgrounded app whenever
 * it likes, and a framer who switches to the camera to shoot a print should not
 * come back to an empty sheet. So the open job is written to IndexedDB a moment
 * after every change, and straight away when the app goes to the background.
 *
 * What is saved is the store's own undo snapshot (see captureJob) plus the
 * drawings, whose files and rasters go in as Blobs. The job's id is kept in
 * localStorage so the next cold start knows which one to reopen.
 */
import { useAppStore, captureJob, restoreJob, resetJob } from '../store/useAppStore'
import {
  deleteProject,
  deserializeDrawing,
  listProjects,
  loadProject,
  newProjectId,
  saveProject,
  serializeDrawing,
  type SavedProject,
  type SerializableDrawing,
} from './projectStorage'
import type { Drawing } from '../types'

const CURRENT_KEY = 'theprints3d.currentJob'
const DEBOUNCE_MS = 1200

/** The store fields that make up a job. A change to any of them is a save. */
const JOB_FIELDS = [
  'drawings', 'layers', 'model', 'measurements', 'annotations',
  'productPlacements', 'placedObjects', 'plumbingLines', 'electricalLines',
  'hvacLines', 'floorsAreas', 'roofAreas', 'circuits', 'userTraces',
  'floorplanOverlay', 'wizardState', 'wizardInputs', 'buildResult',
  'constructionDecisions', 'detectedWallTypes', 'corrections',
] as const

function readCurrentId(): string | null {
  try { return localStorage.getItem(CURRENT_KEY) } catch { return null }
}
function writeCurrentId(id: string | null): void {
  try {
    if (id) localStorage.setItem(CURRENT_KEY, id)
    else localStorage.removeItem(CURRENT_KEY)
  } catch { /* storage off — the job still saves, it just won't reopen */ }
}

let currentId: string | null = readCurrentId()
let currentName: string | null = null
let createdAt = 0
let timer: ReturnType<typeof setTimeout> | null = null
let saving: Promise<void> = Promise.resolve()
/** Held while a job is being put on the workspace, so loading it isn't a save. */
let restoring = false

/** A drawing's file and raster only change when the drawing is replaced, so
 *  they are turned into Blobs once, not on every wall edit. */
const blobCache = new Map<string, { rasterUrl: string | null; file: File; blobs: Pick<SerializableDrawing, 'fileBlob' | 'fileName' | 'rasterBlob'> }>()

async function serialize(d: Drawing): Promise<SerializableDrawing> {
  const hit = blobCache.get(d.id)
  if (hit && hit.rasterUrl === d.rasterUrl && hit.file === d.file) {
    const { file, rasterUrl, ...rest } = d
    void file; void rasterUrl
    return { ...rest, ...hit.blobs }
  }
  const sd = await serializeDrawing(d)
  blobCache.set(d.id, {
    rasterUrl: d.rasterUrl,
    file: d.file,
    blobs: { fileBlob: sd.fileBlob, fileName: sd.fileName, rasterBlob: sd.rasterBlob },
  })
  return sd
}

function defaultName(): string {
  return `Job ${new Date().toLocaleDateString()}`
}

/** Listeners for the "saved" readout in the Projects list. */
type SavedListener = (at: number) => void
const listeners = new Set<SavedListener>()
export function onJobSaved(fn: SavedListener): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

async function writeNow(): Promise<void> {
  const s = useAppStore.getState()
  // Nothing on the sheet and nothing saved yet: there is no job to keep.
  // Once a job exists, emptying it (Clear) is saved too, so a cleared job does
  // not come back from the dead on the next launch.
  if (s.drawings.length === 0 && !currentId) return

  if (!currentId) {
    currentId = newProjectId()
    currentName = defaultName()
    createdAt = Date.now()
    writeCurrentId(currentId)
  }
  if (!currentName || !createdAt) {
    const existing = await loadProject(currentId)
    currentName = existing?.name ?? defaultName()
    createdAt = existing?.createdAt ?? Date.now()
  }

  const drawings = await Promise.all(s.drawings.map(serialize))
  const now = Date.now()
  const record: SavedProject = {
    id: currentId,
    name: currentName,
    createdAt,
    updatedAt: now,
    drawings,
    layers: s.layers,
    measurements: s.measurements,
    model: s.model,
    snapshot: captureJob(),
  }
  await saveProject(record)
  for (const fn of listeners) fn(now)
}

/** Save the open job now, and wait for it. Chained, so two saves never race. */
export function flushJob(): Promise<void> {
  if (timer) { clearTimeout(timer); timer = null }
  saving = saving.then(writeNow).catch(() => { /* a failed save is retried on the next change */ })
  return saving
}

function schedule(): void {
  if (restoring) return
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => { timer = null; void flushJob() }, DEBOUNCE_MS)
}

let started = false
/**
 * Reopen the last job, then save every change from here on. Called once at
 * startup. The reopen happens first so the empty starting state is never
 * written over the job it is about to load.
 */
export async function startJobAutosave(): Promise<void> {
  if (started) return
  started = true
  if (currentId) {
    try { await openJob(currentId, { flushFirst: false }) } catch { /* unreadable save: start clean */ }
  }
  useAppStore.subscribe((state, prev) => {
    for (const k of JOB_FIELDS) {
      if (state[k] !== prev[k]) { schedule(); return }
    }
  })
  // Going to the background is the last chance before Android may kill the app.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flushJob()
  })
  window.addEventListener('pagehide', () => { void flushJob() })
}

export function currentJobId(): string | null {
  return currentId
}

/** Put a saved job on the workspace and make it the one being saved. */
export async function openJob(id: string, opts: { flushFirst?: boolean } = {}): Promise<boolean> {
  if (opts.flushFirst !== false) await flushJob()
  const p = await loadProject(id)
  if (!p) {
    if (id === currentId) { currentId = null; writeCurrentId(null) }
    return false
  }
  restoring = true
  try {
    restoreJob(
      p.drawings.map(deserializeDrawing),
      p.snapshot ?? null,
      { layers: p.layers, measurements: p.measurements, model: p.model },
    )
  } finally {
    restoring = false
  }
  currentId = p.id
  currentName = p.name
  createdAt = p.createdAt
  writeCurrentId(p.id)
  return true
}

/** Save the open job and start an empty one. It gets saved (and named) once
 *  something is on the sheet. */
export async function newJob(): Promise<void> {
  await flushJob()
  restoring = true
  try { resetJob() } finally { restoring = false }
  currentId = null
  currentName = null
  createdAt = 0
  writeCurrentId(null)
}

export async function renameJob(id: string, name: string): Promise<void> {
  const clean = name.trim()
  if (!clean) return
  if (id === currentId) {
    currentName = clean
    await flushJob()
    return
  }
  const p = await loadProject(id)
  if (p) await saveProject({ ...p, name: clean })
}

/** Delete a job. Deleting the open one also empties the workspace. */
export async function removeJob(id: string): Promise<void> {
  if (id === currentId) {
    if (timer) { clearTimeout(timer); timer = null }
    await saving
    restoring = true
    try { resetJob() } finally { restoring = false }
    currentId = null
    currentName = null
    createdAt = 0
    writeCurrentId(null)
  }
  await deleteProject(id)
}

export { listProjects as listJobs }
