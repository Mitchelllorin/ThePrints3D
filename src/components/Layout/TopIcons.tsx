/**
 * TopIcons — the ONLY persistent chrome: five icon buttons, top-right.
 * Rebuild · Trace walls · Layers · Settings · Undo. Stroke-only white SVGs
 * (no emoji, no fills), 40×40, dark translucent, tooltip on hover.
 */
import styles from './TopIcons.module.css'

const SVG = {
  width: 20,
  height: 20,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

interface BtnProps {
  label: string
  active?: boolean
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}

function IconBtn({ label, active, disabled, onClick, children }: BtnProps) {
  return (
    <button
      className={`${styles.btn} ${active ? styles.active : ''}`}
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
    >
      {children}
    </button>
  )
}

interface Props {
  onRebuild: () => void
  onTrace: () => void
  onLayers: () => void
  onSettings: () => void
  onUndo: () => void
  traceActive?: boolean
  layersActive?: boolean
  settingsActive?: boolean
  canUndo?: boolean
}

export default function TopIcons(p: Props) {
  return (
    <div className={styles.bar}>
      <IconBtn label="Rebuild" onClick={p.onRebuild}>
        <svg {...SVG}><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></svg>
      </IconBtn>
      <IconBtn label="Trace walls" active={p.traceActive} onClick={p.onTrace}>
        <svg {...SVG}><path d="M4 20h4L20 8l-4-4L4 16v4z" /><path d="M14 6l4 4" /></svg>
      </IconBtn>
      <IconBtn label="Layers" active={p.layersActive} onClick={p.onLayers}>
        <svg {...SVG}><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></svg>
      </IconBtn>
      <IconBtn label="Settings" active={p.settingsActive} onClick={p.onSettings}>
        <svg {...SVG}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
      </IconBtn>
      <IconBtn label="Undo" disabled={!p.canUndo} onClick={p.onUndo}>
        <svg {...SVG}><path d="M3 7v6h6" /><path d="M3 13a9 9 0 1 0 3-7.7L3 8" /></svg>
      </IconBtn>
    </div>
  )
}
