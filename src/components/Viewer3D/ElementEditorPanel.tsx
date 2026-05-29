/**
 * ElementEditorPanel
 *
 * DOM panel displayed outside the R3F Canvas when a wall is selected in edit mode.
 * Shows wall properties and allows:
 *  - Editing thickness (in mm)
 *  - Viewing wall type, source, and computed length
 *  - Deleting the wall
 *  - Deselecting
 */

import { useMemo } from 'react'
import { useAppStore } from '../../store/useAppStore'
import styles from './ElementEditorPanel.module.css'

const DEFAULT_SCALE_MM_PER_PX = 23.5

export default function ElementEditorPanel() {
  const editMode = useAppStore((s) => s.editMode)
  const selectedWallKey = useAppStore((s) => s.selectedWallKey)
  const drawings = useAppStore((s) => s.drawings)
  const setSelectedWallKey = useAppStore((s) => s.setSelectedWallKey)
  const updateParsedWall = useAppStore((s) => s.updateParsedWall)
  const deleteParsedWall = useAppStore((s) => s.deleteParsedWall)

  const { drawingId, wallIndex, wall, drawing } = useMemo(() => {
    if (!selectedWallKey) return { drawingId: null, wallIndex: -1, wall: null, drawing: null }
    const [dId, wIdxStr] = selectedWallKey.split(':')
    const wIdx = parseInt(wIdxStr, 10)
    const d = drawings.find((dr) => dr.id === dId) ?? null
    const w = (d && wIdx >= 0 && wIdx < d.parsedWalls.length) ? d.parsedWalls[wIdx] : null
    return { drawingId: dId, wallIndex: wIdx, wall: w, drawing: d }
  }, [selectedWallKey, drawings])

  if (!editMode || !wall || drawingId === null || wallIndex < 0) return null

  const mmPerPx = drawing?.scaleMmPerPx ?? DEFAULT_SCALE_MM_PER_PX

  const lengthPx = Math.sqrt((wall.x2 - wall.x1) ** 2 + (wall.y2 - wall.y1) ** 2)
  const lengthMm = lengthPx * mmPerPx
  const lengthDisplay = lengthMm >= 1000
    ? `${(lengthMm / 1000).toFixed(2)} m`
    : `${Math.round(lengthMm)} mm`

  const thicknessMm = wall.thickness > 0 ? wall.thickness * mmPerPx : null
  const thicknessDisplay = thicknessMm !== null ? Math.round(thicknessMm) : '—'

  function handleThicknessChange(e: React.ChangeEvent<HTMLInputElement>) {
    const mm = parseFloat(e.target.value)
    if (!isNaN(mm) && mm > 0 && drawingId !== null) {
      const pxVal = mm / mmPerPx
      updateParsedWall(drawingId, wallIndex, { thickness: pxVal })
    }
  }

  function handleDelete() {
    if (drawingId === null) return
    if (confirm('Delete this wall segment?')) {
      deleteParsedWall(drawingId, wallIndex)
    }
  }

  const sourceLabel = wall.source === 'user' ? '✏️ User-traced' : '🤖 Auto-detected'
  const wallTypeLabel = wall.wallType ?? 'unknown'
  const confidence = wall.detectionConfidence !== undefined
    ? `${Math.round(wall.detectionConfidence * 100)}%`
    : '—'

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <span className={styles.title}>🧱 Wall Editor</span>
        <button
          className={styles.closeBtn}
          onClick={() => setSelectedWallKey(null)}
          title="Deselect"
        >
          ✕
        </button>
      </div>

      <div className={styles.body}>
        <div className={styles.hint}>Drag the highlighted wall in the 3D view to move it.</div>

        <div className={styles.row}>
          <span className={styles.label}>Source</span>
          <span className={styles.value}>{sourceLabel}</span>
        </div>

        <div className={styles.row}>
          <span className={styles.label}>Wall type</span>
          <span className={styles.value}>{wallTypeLabel}</span>
        </div>

        <div className={styles.row}>
          <span className={styles.label}>Length</span>
          <span className={styles.value}>{lengthDisplay}</span>
        </div>

        <div className={styles.row}>
          <span className={styles.label}>Confidence</span>
          <span className={styles.value}>{confidence}</span>
        </div>

        <div className={styles.fieldRow}>
          <label className={styles.fieldLabel} htmlFor="wall-thickness">
            Thickness (mm)
          </label>
          <input
            id="wall-thickness"
            className={styles.fieldInput}
            type="number"
            min={20}
            max={800}
            step={5}
            defaultValue={thicknessDisplay !== '—' ? String(thicknessDisplay) : ''}
            placeholder="e.g. 150"
            onBlur={handleThicknessChange}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                handleThicknessChange(e as unknown as React.ChangeEvent<HTMLInputElement>)
              }
            }}
          />
        </div>

        <div className={styles.actions}>
          <button
            className={styles.deleteBtn}
            onClick={handleDelete}
            title="Delete this wall segment"
          >
            🗑 Delete Wall
          </button>
        </div>

        <div className={styles.hint} style={{ marginTop: 4 }}>
          Edits are undoable (Ctrl+Z / ⌘Z).
        </div>
      </div>
    </div>
  )
}
