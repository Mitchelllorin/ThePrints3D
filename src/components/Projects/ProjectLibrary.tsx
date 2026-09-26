import { useEffect, useRef, useState } from 'react'
import { useIsPro } from '../Pro/usePro'
import type { SavedProject } from '../../services/projectStorage'
import {
  currentJobId,
  flushJob,
  listJobs,
  newJob,
  onJobSaved,
  openJob,
  removeJob,
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

  const open = (id: string) => {
    void run(async () => {
      await openJob(id)
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
          <h2 className={styles.title}>Jobs</h2>
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
                        data-testid={`open-project-${p.id}`}
                      >
                        Open
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
