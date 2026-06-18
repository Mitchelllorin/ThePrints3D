/**
 * TopIcons — the ONLY persistent chrome: five icon buttons, fixed top-right.
 * Rebuild ⟳ · Trace ✏ · Layers ≡ · Settings ⚙ · Undo ↩.
 * Plain-text tooltip to the LEFT on hover (CSS ::before). No emoji, no SVG.
 */
import styles from './TopIcons.module.css'

interface BtnProps {
  label: string
  glyph: string
  active?: boolean
  disabled?: boolean
  onClick: () => void
}

function IconBtn({ label, glyph, active, disabled, onClick }: BtnProps) {
  return (
    <button
      className={`${styles.btn} ${active ? styles.active : ''}`}
      onClick={onClick}
      disabled={disabled}
      data-tip={label}
      aria-label={label}
    >
      {glyph}
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
      <IconBtn label="Rebuild" glyph="⟳" onClick={p.onRebuild} />
      <IconBtn label="Trace" glyph="✏" active={p.traceActive} onClick={p.onTrace} />
      <IconBtn label="Layers" glyph="≡" active={p.layersActive} onClick={p.onLayers} />
      <IconBtn label="Settings" glyph="⚙" active={p.settingsActive} onClick={p.onSettings} />
      <IconBtn label="Undo" glyph="↩" disabled={!p.canUndo} onClick={p.onUndo} />
    </div>
  )
}
