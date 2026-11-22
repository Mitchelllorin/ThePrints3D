/**
 * AN IMPORT SURVIVES THE PAGE DYING UNDER IT.
 *
 * On a phone, picking a print sends the page to the background (the file
 * picker or the camera is another app), and reading a big photo is the
 * heaviest moment the app has. Android is free to kill the tab at either
 * point, and the user comes back to a cold start: the front door, no print,
 * and no idea why. Mitchell hit exactly that on his own phone, every time.
 *
 * So the import leaves a trail, and the file goes to IndexedDB the moment
 * it is picked, before anything heavy touches it:
 *
 *   picker   the picker was opened
 *   picked   a file came back, and is now saved
 *   raster   the file is being read into pixels
 *   detect   the print is on screen; walls are being read off it
 *   done     the import finished (or failed in a way the app reported)
 *
 * On the next cold start, `takeUnfinishedImport` reads where it stopped:
 *
 *   • stopped at `picker` — the page died while the picker was open. The file
 *     never reached the app, so there is nothing to recover; say what happened.
 *   • stopped at `picked`, `raster` or `detect` — the file is saved, so the
 *     import resumes ONCE, straight into the workspace. If the resume dies too,
 *     the next start does not try a third time; it says so instead, so a print
 *     that crashes the page cannot trap the user in a reload loop.
 *
 * The trail lives in localStorage because it has to be written synchronously
 * in the instant before the page goes to the background; the file lives in
 * IndexedDB because it is a Blob.
 */
import { openDB, type IDBPDatabase } from 'idb'
import { phoneLog } from '../dev/phoneLog'

export type ImportStage = 'picker' | 'picked' | 'raster' | 'detect' | 'done'

type Trail = {
  stage: ImportStage
  /** True when this attempt is itself a resume. */
  resumed: boolean
  name?: string
  at: number
}

const TRAIL_KEY = 'tp3d.importTrail'
const DB_NAME = 'tp3d-pending-import'
const STORE = 'file'
const KEY = 'pending'
/** A trail older than this is a different session's business. */
const STALE_MS = 30 * 60 * 1000

function readTrail(): Trail | null {
  try {
    const raw = localStorage.getItem(TRAIL_KEY)
    return raw ? (JSON.parse(raw) as Trail) : null
  } catch {
    return null
  }
}

function writeTrail(t: Trail | null) {
  try {
    if (t) localStorage.setItem(TRAIL_KEY, JSON.stringify(t))
    else localStorage.removeItem(TRAIL_KEY)
  } catch {
    // Storage blocked: the import still works, it just cannot be recovered.
  }
}

let dbp: Promise<IDBPDatabase> | null = null
function db() {
  dbp ??= openDB(DB_NAME, 1, { upgrade: (d) => { d.createObjectStore(STORE) } })
  return dbp
}

/** Whether the import now running is a resume — carried into every stage. */
let resuming = false

export function markImport(stage: ImportStage, name?: string) {
  phoneLog(`import ${stage}${name ? ` ${name}` : ''}`)
  const prev = readTrail()
  if (stage === 'done') {
    writeTrail(null)
    resuming = false
    void db().then((d) => d.delete(STORE, KEY)).catch(() => {})
    return
  }
  // The processing stages only extend a trail a pick started — reprocessing a
  // sheet or opening a sample is not an import and has no file to recover.
  if ((stage === 'raster' || stage === 'detect') && !prev) return
  writeTrail({ stage, resumed: resuming, name: name ?? prev?.name, at: Date.now() })
}

/** Save the picked file before anything reads it. Fire-and-forget. */
export function savePickedFile(file: File) {
  markImport('picked', file.name)
  void db()
    .then((d) => d.put(STORE, { blob: file, name: file.name, type: file.type, lastModified: file.lastModified }, KEY))
    .catch(() => {})
}

export type UnfinishedImport =
  | { kind: 'resume'; file: File }
  | { kind: 'lost-in-picker' }
  | { kind: 'gave-up'; name?: string }

/**
 * Read — and clear — what the last session left unfinished. Called once, at
 * boot. A 'resume' arms the resume flag, so if the page dies again the next
 * start reports instead of retrying.
 */
export async function takeUnfinishedImport(): Promise<UnfinishedImport | null> {
  const t = readTrail()
  phoneLog(`boot trail: ${t ? `${t.stage}${t.resumed ? ' (resumed)' : ''}` : 'none'}`)
  writeTrail(null)
  if (!t || t.stage === 'done' || Date.now() - t.at > STALE_MS) return null
  if (t.stage === 'picker') return { kind: 'lost-in-picker' }
  if (t.resumed) {
    void db().then((d) => d.delete(STORE, KEY)).catch(() => {})
    return { kind: 'gave-up', name: t.name }
  }
  try {
    const rec = (await (await db()).get(STORE, KEY)) as
      | { blob: Blob; name: string; type: string; lastModified: number }
      | undefined
    if (!rec) return { kind: 'gave-up', name: t.name }
    resuming = true
    // Re-arm the trail as a resume, so a second death is caught as one.
    writeTrail({ stage: 'picked', resumed: true, name: rec.name, at: Date.now() })
    return { kind: 'resume', file: new File([rec.blob], rec.name, { type: rec.type, lastModified: rec.lastModified }) }
  } catch {
    return { kind: 'gave-up', name: t.name }
  }
}

/**
 * Watch every file input in the app, wherever it lives — there are several
 * (start card, workspace, plan panel, uploader) and each would otherwise need
 * the same two lines. Capture phase, so it runs before the input's own handler.
 * Only drawing inputs count: an input that takes PDFs or images.
 */
export function watchFileInputs() {
  const isPrintInput = (el: EventTarget | null): el is HTMLInputElement =>
    el instanceof HTMLInputElement && el.type === 'file' && /pdf|image|\.png|\.jpe?g/i.test(el.accept)
  document.addEventListener('click', (e) => {
    if (isPrintInput(e.target)) markImport('picker')
  }, true)
  document.addEventListener('change', (e) => {
    if (!isPrintInput(e.target)) return
    const file = e.target.files?.[0]
    if (file) savePickedFile(file)
    else markImport('done') // picker cancelled
  }, true)
  // A cancelled picker fires 'cancel' (or, on older webviews, nothing at all).
  // Either way a trail still sitting at 'picker' once the page is back and
  // settled was a cancel, not a death — clear it so the next start is quiet.
  document.addEventListener('cancel', (e) => {
    if (isPrintInput(e.target)) markImport('done')
  }, true)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return
    setTimeout(() => { if (readTrail()?.stage === 'picker') markImport('done') }, 4000)
  })
}
