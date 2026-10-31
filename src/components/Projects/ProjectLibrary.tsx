import { useEffect, useRef, useState } from 'react'
import { useIsPro } from '../Pro/usePro'
import type { SavedProject } from '../../services/projectStorage'
import {
  currentJobId,
  flushJob,
  listJobs,
  newJob,
  onJobSaved,
  onJobSaveState,
  openJob,
  removeJob,
  readSaveState,
  renameJob,
} from '../../services/currentJob'
import { useFloorplanLocalStore } from '../../store/useFloorplanLocalStore'
import styles from './ProjectLibrary.module.css'

/** How many saved jobs the free tier keeps. One is enough to show that the app
 *  remembers your work; the second is what Pro is for. */
const FREE_PROJECT_LIMIT = 1

/** "just now", "4 min ago", "3 h ago", else the date. */
function ago(t: number, now: number): string {
  const s = Math.max(0, Math.round((now - t) / 1000))
  if (s < 45) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} h ago`
  return new Date(t).toLocaleDateString()
}

/**
 * THE JOBS ON THIS PHONE.
 *
 * The open job saves itself (services/currentJob), so there is no Save button
 * here — only the things you do to jobs: start a new one, open another, rename,
 * delete. It used to save by hand as a NEW project every time, through the
 * browser's prompt/alert/confirm boxes, and a free user could never update the
 * one job they had.
 *
 * `inline` drops the modal shell so the list can live in a drawer section.
 */
export default function ProjectLibrary({ onClose, inline }: { onClose?: () => void; inline?: boolean }) {
  const [projects, setProjects] = useState<SavedProject[]>([])
  const [busy, setBusy] = useState(false)
  const [openId, setOpenId] = useState<string | null>(currentJobId())
  const [now, setNow] = useState(() => Date.now())
  const [renaming, setRenaming] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')
  const [armedDelete, setArmedDelete] = useState<string | null>(null)
  /** Which job the user has asked to open, waiting for the second tap. */
  const [confirmOpen, setConfirmOpen] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  /** The last autosave failed. This is the screen about saving, so it is the
   *  worst possible place to look like everything is fine. */
  const [saveError, setSaveError] = useState<string | null>(() => {
    const state = readSaveState()
    return state?.status === 'error' ? state.message : null
  })
  const disarmTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isPro = useIsPro()   // the one Pro rule — see Pro/usePro
  const openUpgrade = useFloorplanLocalStore((s) => s.openUpgrade)

  const refresh = async () => {
    setProjects(await listJobs())
    setOpenId(currentJobId())
    setNow(Date.now())
  }

  useEffect(() => {
    let live = true
    // Save first, so the open job's row is current when the list is read.
    void flushJob().then(listJobs).then((items) => {
      if (!live) return
      setProjects(items)
      setOpenId(currentJobId())
    })
    const off = onJobSaved(() => {
      void listJobs().then((items) => {
        if (!live) return
        setProjects(items)
        setOpenId(currentJobId())
        setNow(Date.now())
      })
    })
    return () => {
      live = false
      off()
      if (disarmTimer.current) clearTimeout(disarmTimer.current)
    }
  }, [])

  useEffect(() => onJobSaveState((state) => {
    setSaveError(state.status === 'error' ? state.message : null)
  }), [])

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    try { await fn() } finally {
      setBusy(false)
      await refresh()
    }
  }

  const startNew = () => {
    // Free keeps one job. Clear on the rail starts that one over; a second job
    // is the upgrade.
    if (!isPro && projects.length >= FREE_PROJECT_LIMIT) {
      openUpgrade('Keeping more than one job')
      return
    }
    void run(newJob)
  }

  /**
   * OPENING IS TWO TAPS, AND SAYS WHAT HAPPENS TO THE JOB YOU ARE ON.
   *
   * The save itself was already safe — openJob flushes the current job before
   * it loads another — but nothing on screen said so, so switching jobs felt
   * like it might throw the open one away. The first tap now arms it and states
   * the fact (the current job is saved first); the second opens. A failure is
   * also reported instead of silently doing nothing, which is what a missing or
   * unreadable save used to look like.
   */
  const open = (id: string) => {
    if (confirmOpen !== id) {
      setConfirmOpen(id)
      setLoadError(null)
      return
    }
    setConfirmOpen(null)
    void run(async () => {
      const ok = await openJob(id)
      if (!ok) {
        setLoadError('That job could not be opened — its saved copy is missing or unreadable.')
        return
      }
      onClose?.()
    })
  }

  const beginRename = (p: SavedProject) => {
    setRenaming(p.id)
    setDraftName(p.name)
  }
  const commitRename = () => {
    const id = renaming
    setRenaming(null)
    if (id && draftName.trim()) void run(() => renameJob(id, draftName))
  }

  // Two taps, like Clear on the rail: the first arms it and says it can't be
  // undone, the second deletes. It disarms itself if the second tap never comes.
  const tapDelete = (id: string) => {
    if (disarmTimer.current) clearTimeout(disarmTimer.current)
    if (armedDelete === id) {
      setArmedDelete(null)
      void run(() => removeJob(id))
      return
    }
    setArmedDelete(id)
    disarmTimer.current = setTimeout(() => setArmedDelete(null), 3500)
  }

  return (
    <div className={inline ? styles.inlineWrap : styles.overlay} onClick={inline ? undefined : onClose}>
      <div className={inline ? styles.inlineBody : styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header} style={inline ? { display: 'none' } : undefined}>
          <h2 className={styles.title}>Save &amp; load</h2>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Close">×</button>
        </div>

        <button
          className={styles.saveBtn}
          onClick={startNew}
          disabled={busy}
          data-testid="new-job-btn"
        >
          New job
        </button>

        {/* WHAT IS OPEN RIGHT NOW, and the promise that switching does not
            cost you it. Shown above the list because it is the question a job
            list is being read to answer. */}
        {(() => {
          const openProject = projects.find((p) => p.id === openId)
          if (!openProject) return null
          return (
            <div className={styles.current}>
              <span>
                Open now: <strong>{openProject.name}</strong>
                {' · '}{openProject.drawings.length === 0 ? 'empty' : `${openProject.drawings.length} sheet${openProject.drawings.length === 1 ? '' : 's'}`}
                {' · saved '}{ago(openProject.updatedAt, now)}
              </span>
              <span className={styles.currentNote}>
                Work saves automatically. Opening another job saves this one first.
              </span>
            </div>
          )
        })()}
        {saveError && <p className={styles.error} role="alert">{saveError}</p>}
        {loadError && <p className={styles.error} role="alert">{loadError}</p>}

        {projects.length === 0 ? (
          <p className={styles.empty}>Jobs save as you work. Start one and it shows here.</p>
        ) : (
          <ul className={styles.list}>
            {projects.map((p) => {
              const isOpen = p.id === openId
              const sheets = p.drawings.length
              return (
                <li key={p.id} className={`${styles.item} ${isOpen ? styles.itemOpen : ''}`}>
                  <div className={styles.info}>
                    {renaming === p.id ? (
                      <input
                        className={styles.nameInput}
                        value={draftName}
                        autoFocus
                        aria-label="Job name"
                        onChange={(e) => setDraftName(e.target.value)}
                        onBlur={commitRename}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commitRename()
                          if (e.key === 'Escape') setRenaming(null)
                        }}
                      />
                    ) : (
                      <button
                        className={styles.nameBtn}
                        onClick={() => beginRename(p)}
                        aria-label={`Rename ${p.name}`}
                      >
                        {p.name}
                      </button>
                    )}
                    <div className={styles.meta}>
                      {isOpen ? 'Open now · ' : ''}
                      {sheets === 0 ? 'Empty' : `${sheets} sheet${sheets !== 1 ? 's' : ''}`}
                      {' · saved '}{ago(p.updatedAt, now)}
                    </div>
                  </div>
                  <div className={styles.actions}>
                    {!isOpen && (
                      <button
                        className={styles.openBtn}
                        onClick={() => open(p.id)}
                        disabled={busy}
                        aria-label={confirmOpen === p.id ? `Open ${p.name} now` : `Open ${p.name}`}
                        data-testid={`open-project-${p.id}`}
                      >
                        {confirmOpen === p.id ? 'Open it' : 'Open'}
                      </button>
                    )}
                    <button
                      className={`${styles.deleteBtn} ${armedDelete === p.id ? styles.deleteArmed : ''}`}
                      onClick={() => tapDelete(p.id)}
                      disabled={busy}
                      aria-label={armedDelete === p.id ? `Delete ${p.name} — can't undo` : `Delete ${p.name}`}
                      data-testid={`delete-project-${p.id}`}
                    >
                      {armedDelete === p.id ? "Delete — can't undo" : 'Delete'}
                    </button>
                  </div>
                  {/* The confirmation, in the row it belongs to. */}
                  {confirmOpen === p.id && (
                    <div className={styles.confirm} role="alert">
                      <span>
                        {openId && openId !== p.id
                          ? 'The job you have open is saved first. Then this one opens — nothing is lost.'
                          : 'This job opens on the workspace.'}
                      </span>
                      <div className={styles.confirmBtns}>
                        <button className={styles.openBtn} onClick={() => open(p.id)} disabled={busy}>Open it</button>
                        <button className={styles.deleteBtn} onClick={() => setConfirmOpen(null)}>Cancel</button>
                      </div>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}

        {!isPro && (
          <p className={styles.empty}>Free keeps one job. Clear on the rail starts it over.</p>
        )}
      </div>
    </div>
  )
}
