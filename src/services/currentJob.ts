/**
 * THE JOBS ON THIS PHONE — saved as you go, opened when you ask for them.
 *
 * There is no Save button to forget. A phone kills a backgrounded app whenever
 * it likes, and a framer who switches to the camera to shoot a print should not
 * come back to an empty sheet. So the open job is written to IndexedDB a moment
 * after every change, and straight away when the app goes to the background.
 *
 * A COLD START DOES NOT REOPEN IT. Last night's job is in Jobs with everything
 * that was on the sheet; what does not come back is the job being OPEN. Coming
 * back to yesterday's plan unasked puts the drawing you were about to measure
 * behind someone else's walls, one careless edit away from being saved over.
 * See beginSession, which is the whole difference.
 *
 * What is saved is the store's own undo snapshot (see captureJob) plus the
 * drawings, whose files and rasters go in as Blobs.
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

const DEBOUNCE_MS = 1200

/** The store fields that make up a job. A change to any of them is a save. */
const JOB_FIELDS = [
  'drawings', 'layers', 'model', 'measurements', 'annotations',
  'productPlacements', 'placedObjects', 'plumbingLines', 'electricalLines',
  'hvacLines', 'floorsAreas', 'roofAreas', 'circuits', 'userTraces',
  'floorplanOverlay', 'wizardState', 'wizardInputs', 'buildResult',
  'constructionDecisions', 'detectedWallTypes', 'corrections',
] as const

// Which job is open is a fact about THIS session, held in memory on purpose.
// Persisting it is what used to reopen the last job before the front door had
// even been tapped.
let currentId: string | null = null
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

/**
 * WHAT A NEW JOB IS CALLED.
 *
 * The sheet it was started from, because that is what a framer recognises in a
 * list — "ground-floor.pdf", not "Job 11/3/2026" beside three others from the
 * same week. Renaming is one tap when the file name is not the job's name.
 */
function defaultName(): string {
  const first = useAppStore.getState().drawings[0]
  const base = first?.name?.replace(/\.[a-z0-9]+$/i, '').trim()
  return base || `Job ${new Date().toLocaleDateString()}`
}

/** Listeners for the "saved" readout in the Projects list. */
type SavedListener = (at: number) => void
const listeners = new Set<SavedListener>()
export function onJobSaved(fn: SavedListener): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

/**
 * A SAVE THAT FAILED HAS TO SAY SO.
 *
 * This used to end in `.catch(() => {})` — the failure vanished, and a full
 * device looked exactly like a saved job until the app was reopened and the
 * afternoon's tracing was gone. IndexedDB quotas are not theoretical once a few
 * print rasters are in a job, so the outcome is now a piece of state that the
 * UI can read and subscribe to. See components/Layout/SaveStatus.
 */
export type JobSaveState =
  | { status: 'saved'; at: number }
  | { status: 'error'; message: string }

let saveState: JobSaveState | null = null

/** The last thing that happened to the autosave, or null before the first one. */
export function readSaveState(): JobSaveState | null {
  return saveState
}

type StateListener = (s: JobSaveState) => void
const stateListeners = new Set<StateListener>()

/** Every save, and every failure. Returns the unsubscribe. */
export function onJobSaveState(fn: StateListener): () => void {
  stateListeners.add(fn)
  return () => { stateListeners.delete(fn) }
}

function report(next: JobSaveState): void {
  saveState = next
  for (const fn of stateListeners) fn(next)
}

/**
 * WHY a save failed, in words that name the fix.
 *
 * "Something went wrong" is not a message, it is a shrug — and the one thing a
 * framer can actually do about a failed save is different for each cause. A
 * quota error is fixed by deleting a job; private browsing is fixed by leaving
 * it; anything else is worth retrying.
 */
function describeSaveFailure(e: unknown): string {
  const err = e as { name?: string; message?: string } | null
  const name = err?.name ?? ''
  if (name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED') {
    return 'No room left on this device to save this job. Delete a job you no longer need in Jobs, and it will save again.'
  }
  if (name === 'SecurityError' || name === 'InvalidStateError' || name === 'NotAllowedError') {
    return 'This browser is blocking local storage, so the job cannot be saved. Private browsing does this — open the app normally and your work will save.'
  }
  return 'This job did not save just now. It is still on screen, and it will try again on your next change.'
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
  report({ status: 'saved', at: now })
  for (const fn of listeners) fn(now)
}

/** Save the open job now, and wait for it. Chained, so two saves never race. */
export function flushJob(): Promise<void> {
  if (timer) { clearTimeout(timer); timer = null }
  saving = saving
    .then(writeNow)
    .catch((e) => {
      // Still does not throw at the caller — the workspace must not fall over
      // because a save failed — but it is no longer silent. The next change
      // tries again, and a success clears this by itself.
      report({ status: 'error', message: describeSaveFailure(e) })
    })
  return saving
}

function schedule(): void {
  if (restoring) return
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => { timer = null; void flushJob() }, DEBOUNCE_MS)
}

/**
 * START A SESSION WITH NOTHING OPEN.
 *
 * The saved job stays in the library exactly as it is — only the pointer to it
 * is dropped. That drop is the whole fix: with a pointer, the first wall built
 * this session would be written back into last night's record and replace it.
 * Without one, the session's work becomes a new job the moment something is on
 * the sheet, and last night's is still there to open.
 */
export function beginSession(): void {
  if (timer) { clearTimeout(timer); timer = null }
  currentId = null
  currentName = null
  createdAt = 0
}

let started = false
/**
 * Save every change from here on, in a session that starts clean. Called once
 * at startup; nothing is reopened (see beginSession).
 */
export function startJobAutosave(): void {
  if (started) return
  started = true
  beginSession()
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
    if (id === currentId) currentId = null
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
  // A job that just opened is saved, whatever the last write did.
  report({ status: 'saved', at: p.updatedAt })
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
  }
  await deleteProject(id)
}

export { listProjects as listJobs }
