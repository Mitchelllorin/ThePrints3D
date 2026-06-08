import type { ReactNode } from 'react'
import { useUISettingsStore } from '../../store/useUISettingsStore'
import styles from './SettingsPanel.module.css'

interface SliderProps {
  label: string
  value: number
  min: number
  max: number
  step: number
  unit?: string
  onChange: (v: number) => void
}

function Slider({ label, value, min, max, step, unit = '', onChange }: SliderProps) {
  return (
    <label className={styles.row}>
      <span className={styles.rowLabel}>{label}</span>
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
  value: string
  onChange: (v: string) => void
}

function ColorRow({ label, value, onChange }: ColorRowProps) {
  return (
    <label className={styles.row}>
      <span className={styles.rowLabel}>{label}</span>
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

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.panel} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h2 className={styles.title}>Display Settings</h2>
          <button className={styles.closeBtn} onClick={onClose}>✕</button>
        </div>

        <div className={styles.body}>
          <Group title="Panels &amp; Toolbars">
            <Slider
              label="Top bar"
              value={Math.round(s.topbarOpacity * 100)}
              min={20} max={100} step={1} unit="%"
              onChange={(v) => s.set({ topbarOpacity: v / 100 })}
            />
            <Slider
              label="Sidebar"
              value={Math.round(s.sidebarOpacity * 100)}
              min={20} max={100} step={1} unit="%"
              onChange={(v) => s.set({ sidebarOpacity: v / 100 })}
            />
            <Slider
              label="Floating panels"
              value={Math.round(s.panelOpacity * 100)}
              min={20} max={100} step={1} unit="%"
              onChange={(v) => s.set({ panelOpacity: v / 100 })}
            />
          </Group>

          <Group title="Logo">
            <Slider
              label="Opacity"
              value={Math.round(s.logoOpacity * 100)}
              min={0} max={100} step={1} unit="%"
              onChange={(v) => s.set({ logoOpacity: v / 100 })}
            />
            <Slider
              label="Size"
              value={Math.round(s.logoSize * 100)}
              min={50} max={200} step={5} unit="%"
              onChange={(v) => s.set({ logoSize: v / 100 })}
            />
          </Group>

          <Group title="3D Grid">
            <Slider
              label="Opacity"
              value={Math.round(s.gridOpacity * 100)}
              min={0} max={100} step={1} unit="%"
              onChange={(v) => s.set({ gridOpacity: v / 100 })}
            />
            <ColorRow
              label="Color"
              value={s.gridColor}
              onChange={(v) => s.set({ gridColor: v })}
            />
            <Slider
              label="Cell size"
              value={s.gridCellSize}
              min={0.5} max={10} step={0.5} unit=" m"
              onChange={(v) => s.set({ gridCellSize: v })}
            />
            <Slider
              label="Divisions"
              value={s.gridDivisions}
              min={2} max={40} step={1}
              onChange={(v) => s.set({ gridDivisions: v })}
            />
          </Group>

          <Group title="Accent Color">
            <ColorRow
              label="Highlight color"
              value={s.accentColor}
              onChange={(v) => s.set({ accentColor: v })}
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
