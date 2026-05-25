import { useRef, useState } from 'react'
import { useAppStore } from '../../store/useAppStore'
import type { Annotation } from '../../types'
import styles from './AnnotationPanel.module.css'

// ─── Preset colours ────────────────────────────────────────────────────────────

const PRESET_COLORS = [
  '#f87171', // red
  '#fb923c', // orange
  '#facc15', // yellow
  '#4ade80', // green
  '#38bdf8', // sky
  '#818cf8', // indigo
  '#e879f9', // fuchsia
  '#f1f5f9', // white
]

const PRESET_ICONS = ['📌', '⚠️', '💡', '❓', '✅', '🔧', '📏', '🔴', '⭐', '🏷️', '💬', '🚩']

// ─── Single editable row ───────────────────────────────────────────────────────

interface RowProps {
  ann: Annotation
  selected: boolean
  onSelect: () => void
  onRemove: () => void
  onUpdate: (patch: Partial<Pick<Annotation, 'text' | 'icon' | 'color'>>) => void
}

function AnnotationRow({ ann, selected, onSelect, onRemove, onUpdate }: RowProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(ann.text)

  function commitEdit() {
    const trimmed = draft.trim()
    if (trimmed) onUpdate({ text: trimmed })
    setEditing(false)
  }

  return (
    <div
      className={`${styles.row} ${selected ? styles.rowSelected : ''}`}
      onClick={() => !editing && onSelect()}
    >
      <div className={styles.rowHeader}>
        <span
          className={styles.iconPill}
          style={{ borderColor: ann.color, background: `${ann.color}22` }}
        >
          {ann.icon}
        </span>

        {editing ? (
          <textarea
            className={styles.textEdit}
            value={draft}
            autoFocus
            rows={2}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitEdit() }
              if (e.key === 'Escape') { setDraft(ann.text); setEditing(false) }
            }}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className={styles.rowText}>{ann.text}</span>
        )}

        <div className={styles.rowActions} onClick={(e) => e.stopPropagation()}>
          {editing ? (
            <button className={styles.actionIcon} title="Save (Enter)" onClick={commitEdit}>✓</button>
          ) : (
            <button className={styles.actionIcon} title="Edit text" onClick={() => { setDraft(ann.text); setEditing(true) }}>✎</button>
          )}
          <button className={styles.actionIcon} title="Delete annotation" onClick={onRemove}>✕</button>
        </div>
      </div>

      {/* Inline colour + icon pickers shown when row is selected */}
      {selected && !editing && (
        <div className={styles.pickers} onClick={(e) => e.stopPropagation()}>
          <div className={styles.pickerRow}>
            {PRESET_COLORS.map((c) => (
              <button
                key={c}
                className={`${styles.colorSwatch} ${ann.color === c ? styles.swatchActive : ''}`}
                style={{ background: c }}
                title={c}
                onClick={() => onUpdate({ color: c })}
              />
            ))}
          </div>
          <div className={styles.pickerRow}>
            {PRESET_ICONS.map((ic) => (
              <button
                key={ic}
                className={`${styles.iconSwatch} ${ann.icon === ic ? styles.swatchActive : ''}`}
                title={ic}
                onClick={() => onUpdate({ icon: ic })}
              >
                {ic}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Panel ─────────────────────────────────────────────────────────────────────

export default function AnnotationPanel() {
  const annotations = useAppStore((s) => s.annotations)
  const selectedAnnotationId = useAppStore((s) => s.selectedAnnotationId)
  const setSelectedAnnotationId = useAppStore((s) => s.setSelectedAnnotationId)
  const removeAnnotation = useAppStore((s) => s.removeAnnotation)
  const clearAnnotations = useAppStore((s) => s.clearAnnotations)
  const updateAnnotation = useAppStore((s) => s.updateAnnotation)
  const importAnnotations = useAppStore((s) => s.importAnnotations)
  const annotateMode = useAppStore((s) => s.annotateMode)
  const setAnnotateMode = useAppStore((s) => s.setAnnotateMode)
  const fileRef = useRef<HTMLInputElement>(null)

  function handleExport() {
    const json = JSON.stringify(annotations, null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `blueprint3d-annotations-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      try { importAnnotations(JSON.parse(ev.target?.result as string)) }
      catch { alert('Invalid annotation file') }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  return (
    <div className={styles.panel}>
      {/* Mode toggle */}
      <button
        className={`${styles.modeBtn} ${annotateMode ? styles.modeBtnActive : ''}`}
        onClick={() => setAnnotateMode(!annotateMode)}
        title={annotateMode ? 'Exit annotation mode' : 'Click the model to add annotations'}
      >
        📌 {annotateMode ? 'Click model to place…' : 'Add Annotation'}
      </button>

      {/* Annotation list */}
      {annotations.length === 0 ? (
        <p className={styles.empty}>
          {annotateMode
            ? 'Click any surface on the model to place a pin.'
            : 'No annotations yet. Click "Add Annotation" to start.'}
        </p>
      ) : (
        <div className={styles.list}>
          {annotations.map((ann) => (
            <AnnotationRow
              key={ann.id}
              ann={ann}
              selected={ann.id === selectedAnnotationId}
              onSelect={() => setSelectedAnnotationId(ann.id === selectedAnnotationId ? null : ann.id)}
              onRemove={() => removeAnnotation(ann.id)}
              onUpdate={(patch) => updateAnnotation(ann.id, patch)}
            />
          ))}
        </div>
      )}

      {/* Footer actions */}
      <div className={styles.footer}>
        <input
          ref={fileRef}
          type="file"
          accept=".json"
          style={{ display: 'none' }}
          onChange={handleImportFile}
        />
        {annotations.length > 0 && (
          <>
            <button className={styles.footerBtn} onClick={handleExport} title="Download annotations as JSON">
              📤 Export
            </button>
            <button className={styles.footerBtn} onClick={clearAnnotations} title="Remove all annotations">
              🗑 Clear
            </button>
          </>
        )}
        <button className={styles.footerBtn} onClick={() => fileRef.current?.click()} title="Import annotations from JSON file">
          📥 Import
        </button>
      </div>
    </div>
  )
}
