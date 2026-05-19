import { useState, useEffect } from 'react'
import {
  TOOLS,
  getActiveTool,
  setActiveTool,
  type ToolId,
} from '../../services/editing/toolSystem'
import { canUndo, canRedo, undo, redo, getUndoCount, getRedoCount } from '../../services/editing/undoRedo'
import styles from './ModelViewer.module.css'

export default function Toolbar() {
  const [activeTool, setActiveToolState] = useState<ToolId>(() => getActiveTool())
  const [undoCount, setUndoCount] = useState(0)
  const [redoCount, setRedoCount] = useState(0)

  useEffect(() => {
    const check = () => {
      setActiveToolState(getActiveTool())
      setUndoCount(getUndoCount())
      setRedoCount(getRedoCount())
    }
    window.addEventListener('tool-changed', check)
    const interval = setInterval(check, 500)
    return () => {
      window.removeEventListener('tool-changed', check)
      clearInterval(interval)
    }
  }, [])

  const handleTool = (toolId: ToolId) => {
    if (toolId === 'delete') {
      setActiveTool(toolId)
      window.dispatchEvent(new CustomEvent('tool-changed'))
      // Reset to select after a brief delay so user can tap to delete
      setTimeout(() => {
        setActiveTool('select')
        window.dispatchEvent(new CustomEvent('tool-changed'))
      }, 3000)
      return
    }
    setActiveTool(activeTool === toolId ? 'select' : toolId)
    window.dispatchEvent(new CustomEvent('tool-changed'))
  }

  return (
    <div className={styles.toolbarLeft}>
      <div className={styles.toolbarGroupLabel}>Edit</div>
      {TOOLS.map((t) => (
        <button
          key={t.id}
          className={`${styles.toolBtn} ${activeTool === t.id ? styles.toolBtnActive : ''}`}
          onClick={() => handleTool(t.id)}
          data-tooltip={`${t.label}`}
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
        data-tooltip={`Undo${undoCount > 0 ? ` (${undoCount})` : ''}`}
      >
        <span className={styles.toolIcon}>↩</span>
        <span className={styles.toolLabel}>Undo{undoCount > 0 ? ` ${undoCount}` : ''}</span>
      </button>
      <button
        className={`${styles.toolBtn} ${!canRedo() ? styles.toolBtnDisabled : ''}`}
        onClick={redo}
        disabled={!canRedo()}
        data-tooltip={`Redo${redoCount > 0 ? ` (${redoCount})` : ''}`}
      >
        <span className={styles.toolIcon}>↪</span>
        <span className={styles.toolLabel}>Redo{redoCount > 0 ? ` ${redoCount}` : ''}</span>
      </button>
    </div>
  )
}
