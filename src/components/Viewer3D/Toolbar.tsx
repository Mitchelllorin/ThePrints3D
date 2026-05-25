import { useAppStore } from '../../store/useAppStore'
import { canUndo, canRedo, undo, redo, getUndoCount, getRedoCount } from '../../services/editing/undoRedo'
import { useState, useEffect } from 'react'
import styles from './ModelViewer.module.css'

const EDIT_TOOLS = [
  { id: 'select' as const, label: 'Select', icon: 'â¬†' },
  { id: 'move' as const, label: 'Move', icon: 'âœ›' },
  { id: 'resize' as const, label: 'Scale', icon: 'â¬›' },
] as const

export default function Toolbar() {
  const activeTool = useAppStore((s) => s.activeTool)
  const setActiveTool = useAppStore((s) => s.setActiveTool)
  const seedMode    = useAppStore((s) => s.seedMode)
  const measureMode = useAppStore((s) => s.measureMode)
  const annotateMode = useAppStore((s) => s.annotateMode)
  const anyModeActive = seedMode || measureMode || annotateMode
  const [undoCount, setUndoCount] = useState(0)
  const [redoCount, setRedoCount] = useState(0)

  useEffect(() => {
    const update = () => {
      setUndoCount(getUndoCount())
      setRedoCount(getRedoCount())
    }
    const interval = setInterval(update, 500)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className={styles.toolbarLeft}>
      {anyModeActive && (
        <>
          <button
            className={styles.toolBtn}
            style={{ color: '#ef4444', fontWeight: 700 }}
            onClick={() => useAppStore.setState({ seedMode: false, measureMode: false, annotateMode: false })}
          >
            <span className={styles.toolIcon}>X</span>
            <span className={styles.toolLabel}>{seedMode ? "Exit Trace" : measureMode ? "Exit Measure" : "Exit Annotate"}</span>
          </button>
          <div className={styles.toolbarDivider} />
        </>
      )}
      <div className={styles.toolbarGroupLabel}>Edit</div>
      {EDIT_TOOLS.map((t) => (
        <button
          key={t.id}
          className={`${styles.toolBtn} ${activeTool === t.id ? styles.toolBtnActive : ''}`}
          onClick={() => setActiveTool(activeTool === t.id ? 'select' : t.id)}
        >
          <span className={styles.toolIcon}>{t.icon}</span>
          <span className={styles.toolLabel}>{t.label}</span>
        </button>
      ))}

      <div className={styles.toolbarDivider} />

      <div className={styles.toolbarGroupLabel}>History</div>
      <button
        className={`${styles.toolBtn} ${!canUndo() ? styles.toolBtnDisabled : ''}`}
        onClick={undo}
        disabled={!canUndo()}
      >
        <span className={styles.toolIcon}>â†©</span>
        <span className={styles.toolLabel}>Undo{undoCount > 0 ? ` ${undoCount}` : ''}</span>
      </button>
      <button
        className={`${styles.toolBtn} ${!canRedo() ? styles.toolBtnDisabled : ''}`}
        onClick={redo}
        disabled={!canRedo()}
      >
        <span className={styles.toolIcon}>â†ª</span>
        <span className={styles.toolLabel}>Redo{redoCount > 0 ? ` ${redoCount}` : ''}</span>
      </button>
    </div>
  )
}
