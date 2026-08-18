import { useEffect, useState } from 'react'
import {
  saveProject,
  loadProject,
  listProjects,
  deleteProject,
  serializeDrawing,
  deserializeDrawing,
  newProjectId,
  type SavedProject,
} from '../../services/projectStorage'
import { useAppStore } from '../../store/useAppStore'
import { useFloorplanLocalStore } from '../../store/useFloorplanLocalStore'
import styles from './ProjectLibrary.module.css'

/** How many saved jobs the free tier keeps. One is enough to show that the app
 *  remembers your work; the second is what Pro is for. */
const FREE_PROJECT_LIMIT = 1

/** Modal-ish overlay showing saved projects + save-current button. */
/**
 * `inline` drops the modal shell so the library can live in a drawer section.
 * Saving a job is not a thing you do in the middle of the workspace with the
 * model hidden behind a dialog — and until now it was not a thing you could do
 * at all, because this component was never imported anywhere. An uploaded print
 * died on reload.
 */
export default function ProjectLibrary({ onClose, inline }: { onClose?: () => void; inline?: boolean }) {
  const [projects, setProjects] = useState<SavedProject[]>([])
  const [busy, setBusy] = useState(false)
  const drawings = useAppStore((s) => s.drawings)
  const layers = useAppStore((s) => s.layers)
  const measurements = useAppStore((s) => s.measurements)
  const model = useAppStore((s) => s.model)
  const setView = useAppStore((s) => s.setView)
  const isPro = useAppStore((s) => s.isPro)
  const openUpgrade = useFloorplanLocalStore((s) => s.openUpgrade)

  const refresh = async () => {
    setProjects(await listProjects())
  }

  useEffect(() => {
    let cancelled = false
    void listProjects().then((items) => {
      if (!cancelled) setProjects(items)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const saveCurrent = async () => {
    if (drawings.length === 0) {
      alert('Upload at least one drawing before saving the project.')
      return
    }
    // Free keeps one job on the shelf — enough to prove the app remembers your
    // work, which is the thing that has to be believed before anyone pays. The
    // second job is the upgrade. Overwriting the existing one still works, so
    // nobody is stuck: this blocks a NEW save, not saving.
    if (!isPro && projects.length >= FREE_PROJECT_LIMIT) {
      openUpgrade('Saving more than one project')
      return
    }
    const name = prompt('Project name?', `Job ${new Date().toLocaleDateString()}`)
    if (!name) return
    setBusy(true)
    try {
      const id = newProjectId()
      const canvas = document.querySelector('canvas') as HTMLCanvasElement | null
      let thumbnail: string | undefined
      try {
        thumbnail = canvas ? canvas.toDataURL('image/png') : undefined
      } catch { /* ignore */ }
      const serialized = await Promise.all(drawings.map(serializeDrawing))
      await saveProject({
        id,
        name,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        thumbnail,
        drawings: serialized,
        layers,
        measurements,
        model,
      })
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  const openProject = async (id: string) => {
    setBusy(true)
    try {
      const p = await loadProject(id)
      if (!p) return
      const restored = p.drawings.map(deserializeDrawing)
      const updatedAt = typeof p.updatedAt === 'number' ? p.updatedAt : Date.now()
      const fallbackStart = updatedAt - p.measurements.length * 1000
      const restoredMeasurements = p.measurements.map((m, idx) => ({
        ...m,
        createdAt: typeof m.createdAt === 'number' ? m.createdAt : fallbackStart + idx * 1000,
      }))
      useAppStore.setState({
        drawings: restored,
        layers: p.layers,
        measurements: restoredMeasurements,
        model: p.model,
        view: restored.length > 0 ? 'model' : 'upload',
      })
      setView(restored.length > 0 ? 'model' : 'upload')
      // Inline there is no dialog to dismiss — the drawer stays where it is.
      onClose?.()
    } finally {
      setBusy(false)
    }
  }

  const removeProject = async (id: string) => {
    if (!confirm('Delete this project? This cannot be undone.')) return
    await deleteProject(id)
    await refresh()
  }

  return (
    <div className={inline ? styles.inlineWrap : styles.overlay} onClick={inline ? undefined : onClose}>
      <div className={inline ? styles.inlineBody : styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header} style={inline ? { display: 'none' } : undefined}>
          <h2 className={styles.title}>📁 My Projects</h2>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Close">×</button>
        </div>

        <button
          className={styles.saveBtn}
          onClick={saveCurrent}
          disabled={busy || drawings.length === 0}
          data-testid="save-current-project-btn"
        >
          💾 Save current session as a new project
        </button>

        {projects.length === 0 ? (
          <p className={styles.empty}>No saved projects yet. Save your first one with the button above.</p>
        ) : (
          <ul className={styles.list}>
            {projects.map((p) => (
              <li key={p.id} className={styles.item}>
                {p.thumbnail ? (
                  <img src={p.thumbnail} alt="" className={styles.thumb} />
                ) : (
                  <div className={`${styles.thumb} ${styles.thumbPlaceholder}`}>🗎</div>
                )}
                <div className={styles.info}>
                  <div className={styles.name}>{p.name}</div>
                  <div className={styles.meta}>
                    {p.drawings.length} drawing{p.drawings.length !== 1 ? 's' : ''} ·{' '}
                    {new Date(p.updatedAt).toLocaleString()}
                  </div>
                </div>
                <div className={styles.actions}>
                  <button
                    className={styles.openBtn}
                    onClick={() => openProject(p.id)}
                    disabled={busy}
                    data-testid={`open-project-${p.id}`}
                  >
                    Open
                  </button>
                  <button
                    className={styles.deleteBtn}
                    onClick={() => removeProject(p.id)}
                    aria-label="Delete project"
                    data-testid={`delete-project-${p.id}`}
                  >
                    🗑
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
