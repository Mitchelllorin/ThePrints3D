import { useState } from 'react'
import type { ParsedWall, WallTypePreset } from '../../types'
import styles from './WallTypePicker.module.css'

const STORAGE_KEY = 'blueprint3d-wall-preset'

const WALL_PRESETS: WallTypePreset[] = [
  { id: 'stud-2x4',    label: 'Stud 2×4',    description: 'Timber stud, 90mm', thicknessMm: 90,   category: 'stud',   defaultLoadBearing: false, defaultInternal: true,  color: '#fbbf24' },
  { id: 'stud-2x6',    label: 'Stud 2×6',    description: 'Timber stud, 140mm', thicknessMm: 140,  category: 'stud',   defaultLoadBearing: true,  defaultInternal: false, color: '#f59e0b' },
  { id: 'steel-stud',  label: 'Steel Stud',  description: 'Light-gauge steel', thicknessMm: 92,    category: 'steel',  defaultLoadBearing: false, defaultInternal: true,  color: '#94a3b8' },
  { id: 'steel-ls',    label: 'Steel L/S',   description: 'Heavy-gauge load-bearing steel stud', thicknessMm: 150, category: 'steel', defaultLoadBearing: true,  defaultInternal: false, color: '#64748b' },
  { id: 'block-4',     label: 'Block 4″',    description: 'Concrete block, 100mm', thicknessMm: 100, category: 'block',  defaultLoadBearing: true,  defaultInternal: false, color: '#a78bfa' },
  { id: 'block-6',     label: 'Block 6″',    description: 'Concrete block, 150mm', thicknessMm: 150, category: 'block',  defaultLoadBearing: true,  defaultInternal: false, color: '#8b5cf6' },
  { id: 'block-8',     label: 'Block 8″',    description: 'Concrete block, 200mm', thicknessMm: 200, category: 'block',  defaultLoadBearing: true,  defaultInternal: false, color: '#7c3aed' },
  { id: 'cavity',      label: 'Cavity Wall', description: 'Brick/block cavity, ~300mm', thicknessMm: 300, category: 'other', defaultLoadBearing: true,  defaultInternal: false, color: '#fb923c' },
  { id: 'partition-2', label: 'Partition 2½″', description: 'Light timber, 63mm', thicknessMm: 63,  category: 'stud',   defaultLoadBearing: false, defaultInternal: true,  color: '#fde68a' },
  { id: 'slab-conc',   label: 'Concrete Slab', description: 'Cast in-situ concrete', thicknessMm: 200, category: 'other', defaultLoadBearing: true,  defaultInternal: false, color: '#d4d4d8' },
]

interface WallTypePickerProps {
  wall: ParsedWall
  position: { x: number; y: number }
  onConfirm: (wall: ParsedWall) => void
  onDismiss: () => void
  onContinueDrawing?: (wall: ParsedWall) => void
}

const CATEGORY_LABELS: Record<string, string> = {
  stud: 'Timber Stud',
  steel: 'Steel',
  block: 'Block / Masonry',
  other: 'Other',
}

export default function WallTypePicker({ wall, position, onConfirm, onDismiss, onContinueDrawing }: WallTypePickerProps) {
  const lastPresetId = typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null
  const defaultPreset = WALL_PRESETS.find((p) => p.id === lastPresetId) ?? WALL_PRESETS[0]
  const [selectedPreset, setSelectedPreset] = useState<WallTypePreset>(defaultPreset)
  const [customMm, setCustomMm] = useState('')
  const [showCustom, setShowCustom] = useState(false)
  const [loadBearing, setLoadBearing] = useState(WALL_PRESETS[0].defaultLoadBearing)
  const [isInternal, setIsInternal] = useState(WALL_PRESETS[0].defaultInternal)
  const [showFullList, setShowFullList] = useState(false)

  const handlePresetSelect = (p: WallTypePreset) => {
    setSelectedPreset(p)
    setLoadBearing(p.defaultLoadBearing)
    setIsInternal(p.defaultInternal)
    setShowCustom(false)
    localStorage.setItem(STORAGE_KEY, p.id)
  }

  const handleConfirm = () => {
    const thicknessMm = showCustom ? parseFloat(customMm) || selectedPreset.thicknessMm : selectedPreset.thicknessMm
    onConfirm({
      ...wall,
      framingMm: thicknessMm,
      finishedMm: thicknessMm + (isInternal ? 25 : 50),
      wallType: selectedPreset.id as any,
      isLoadBearing: loadBearing,
      isInternal,
    })
  }

  const categories = [...new Set(WALL_PRESETS.map(p => p.category))] as string[]

  const quickPresets = WALL_PRESETS.slice(0, 5)

  return (
    <div className={styles.overlay} onClick={onDismiss}>
      <div
        className={styles.picker}
        style={{ left: Math.min(position.x, window.innerWidth - 340), top: Math.min(position.y, window.innerHeight - 420) }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.header}>
          <span className={styles.title}>Wall Type</span>
          <div className={styles.toggles}>
            <button
              className={`${styles.toggle} ${loadBearing ? styles.toggleActive : ''}`}
              onClick={() => setLoadBearing(!loadBearing)}
            >
              {loadBearing ? '⬛' : '⬜'} Load-bearing
            </button>
            <button
              className={`${styles.toggle} ${isInternal ? styles.toggleActive : ''}`}
              onClick={() => setIsInternal(!isInternal)}
            >
              {isInternal ? '⬛' : '⬜'} Internal
            </button>
          </div>
        </div>

        {/* Quick picks — top 5 most common */}
        <div className={styles.quickRow}>
          {quickPresets.map((p) => (
            <button
              key={p.id}
              className={`${styles.quickBtn} ${selectedPreset.id === p.id && !showCustom ? styles.quickBtnActive : ''}`}
              style={{ '--accent': p.color } as React.CSSProperties}
              onClick={() => handlePresetSelect(p)}
              title={p.description}
            >
              {p.label}
            </button>
          ))}
        </div>

        {showFullList && (
          <div className={styles.fullList}>
            {categories.map((cat) => (
              <div key={cat} className={styles.categoryGroup}>
                <div className={styles.categoryLabel}>{CATEGORY_LABELS[cat]}</div>
                <div className={styles.categoryRow}>
                  {WALL_PRESETS.filter(p => p.category === cat).map((p) => (
                    <button
                      key={p.id}
                      className={`${styles.presetBtn} ${selectedPreset.id === p.id && !showCustom ? styles.presetBtnActive : ''}`}
                      style={{ '--accent': p.color } as React.CSSProperties}
                      onClick={() => handlePresetSelect(p)}
                    >
                      <span className={styles.presetLabel}>{p.label}</span>
                      <span className={styles.presetDesc}>{p.description}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        <button className={styles.showMoreBtn} onClick={() => setShowFullList(!showFullList)}>
          {showFullList ? '▲ Show less' : '▼ Show all types'}
        </button>

        {/* Custom thickness */}
        <div className={styles.customRow}>
          <label className={styles.customLabel}>
            <input type="checkbox" checked={showCustom} onChange={() => setShowCustom(!showCustom)} />
            Custom thickness
          </label>
          {showCustom && (
            <div className={styles.customInputRow}>
              <input
                className={styles.customInput}
                type="number"
                value={customMm}
                placeholder={String(selectedPreset.thicknessMm)}
                onChange={(e) => setCustomMm(e.target.value)}
                min={10}
                max={600}
              />
              <span className={styles.customUnit}>mm</span>
            </div>
          )}
        </div>

        {showCustom && customMm && (
          <div className={styles.preview}>
            {customMm}mm wall • {loadBearing ? 'Load-bearing' : 'Non-load-bearing'} • {isInternal ? 'Internal' : 'External'}
          </div>
        )}

        <div className={styles.actions}>
          <button className={styles.confirmBtn} onClick={handleConfirm}>
            ✓ Apply
          </button>
          <button className={styles.continueBtn} onClick={() => { onContinueDrawing?.({
            ...wall,
            framingMm: showCustom ? parseFloat(customMm) || selectedPreset.thicknessMm : selectedPreset.thicknessMm,
            finishedMm: (showCustom ? parseFloat(customMm) || selectedPreset.thicknessMm : selectedPreset.thicknessMm) + (isInternal ? 25 : 50),
            wallType: selectedPreset.id as any,
            isLoadBearing: loadBearing,
            isInternal,
          }) }}>
            ✓ Apply & Continue Drawing
          </button>
          <button className={styles.dismissBtn} onClick={onDismiss}>
            ✕ Skip
          </button>
        </div>
      </div>
    </div>
  )
}
