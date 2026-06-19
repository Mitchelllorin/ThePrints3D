import type { ReactNode } from 'react'
import { useUISettingsStore } from '../../store/useUISettingsStore'
import styles from './SettingsPanel.module.css'

interface SliderProps {
  label: string
  hint?: string
  value: number
  min: number
  max: number
  step: number
  unit?: string
  onChange: (v: number) => void
}

function Slider({ label, hint, value, min, max, step, unit = '', onChange }: SliderProps) {
  return (
    <label className={styles.row}>
      <span className={styles.rowLabel}>
        {label}
        {hint && <span className={styles.rowHint}>{hint}</span>}
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className={styles.slider}
      />
      <span className={styles.rowValue}>{value}{unit}</span>
    </label>
  )
}

interface ColorRowProps {
  label: string
  hint?: string
  value: string
  onChange: (v: string) => void
}

function ColorRow({ label, hint, value, onChange }: ColorRowProps) {
  return (
    <label className={styles.row}>
      <span className={styles.rowLabel}>
        {label}
        {hint && <span className={styles.rowHint}>{hint}</span>}
      </span>
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={styles.colorPicker}
      />
      <span className={styles.rowValue}>{value}</span>
    </label>
  )
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className={styles.group}>
      <h3 className={styles.groupTitle}>{title}</h3>
      {children}
    </div>
  )
}

export default function SettingsPanel({ onClose }: { onClose: () => void }) {
  const s = useUISettingsStore()

  // The single "UI opacity" drives every chrome surface at once.
  const uiOpacityPct = Math.round(s.panelOpacity * 100)
  const setUiOpacity = (pct: number) => {
    const v = pct / 100
    s.set({ panelOpacity: v, topbarOpacity: v, sidebarOpacity: v })
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.panel} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h2 className={styles.title}>Display Settings</h2>
          <button className={styles.closeBtn} onClick={onClose}>✕</button>
        </div>

        <div className={styles.body}>
          <Group title="Appearance">
            <ColorRow
              label="UI colour"
              hint="Menus, toolbars, panels & buttons"
              value={s.panelColor}
              onChange={(v) => s.set({ panelColor: v })}
            />
            <Slider
              label="UI opacity"
              hint="0% = fully see-through · 100% = solid"
              value={uiOpacityPct}
              min={0} max={100} step={1} unit="%"
              onChange={setUiOpacity}
            />
            <ColorRow
              label="Text — primary"
              hint="Main labels & button text"
              value={s.textColor}
              onChange={(v) => s.set({ textColor: v })}
            />
            <ColorRow
              label="Text — secondary"
              hint="Hints & dimmed text"
              value={s.textColorDim}
              onChange={(v) => s.set({ textColorDim: v })}
            />
            <ColorRow
              label="Accent"
              hint="Highlights the active / selected item"
              value={s.accentColor}
              onChange={(v) => s.set({ accentColor: v })}
            />
          </Group>

          <Group title="3D Grid">
            <Slider
              label="Opacity"
              value={Math.round(s.gridOpacity * 100)}
              min={5} max={100} step={1} unit="%"
              onChange={(v) => s.set({ gridOpacity: v / 100 })}
            />
            <ColorRow
              label="Color"
              value={s.gridColor}
              onChange={(v) => s.set({ gridColor: v })}
            />
            <Slider
              label="Spacing"
              value={s.gridCellSize}
              min={0.5} max={10} step={0.5} unit=" m"
              onChange={(v) => s.set({ gridCellSize: v })}
            />
          </Group>
        </div>

        <div className={styles.footer}>
          <button className={styles.resetBtn} onClick={s.reset}>
            Reset to defaults
          </button>
        </div>
      </div>
    </div>
  )
}
