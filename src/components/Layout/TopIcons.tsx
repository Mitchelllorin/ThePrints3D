/**
 * TopIcons — persistent global actions, fixed top-right: Undo ↩ plus zoom.
 * Sits BELOW the brand line, not level with it: the wordmark and the mark own
 * the top row on their own, and these four sit underneath.
 * (Clear lives at the foot of the left rail — the most destructive action wants
 * to be nowhere near the buttons you tap without looking.)
 * (Build / Settings / Place open from their own always-visible edge-drawer tabs,
 * so they're no longer icons here.)
 * Plain-text tooltip to the LEFT on hover (CSS ::before). No emoji, no SVG.
 */
import styles from './TopIcons.module.css'
import { zoomCamera } from '../Viewer3D/cameraControls'

interface BtnProps {
  label: string
  glyph: string
  /** Print the label under the glyph instead of only on hover. */
  showLabel?: boolean
  active?: boolean
  disabled?: boolean
  onClick: () => void
}

function IconBtn({ label, glyph, showLabel, active, disabled, onClick }: BtnProps) {
  return (
    <button
      className={`${styles.btn} ${active ? styles.active : ''}`}
      onClick={onClick}
      disabled={disabled}
      data-tip={showLabel ? undefined : label}
      aria-label={label}
    >
      <span aria-hidden="true">{glyph}</span>
      {showLabel && <span className={styles.btnLabel} aria-hidden="true">{label}</span>}
    </button>
  )
}

interface Props {
  onUndo: () => void
  canUndo?: boolean
}

export default function TopIcons(p: Props) {
  return (
    <div className={styles.bar}>
      <IconBtn label="Undo" glyph="↩" showLabel disabled={!p.canUndo} onClick={p.onUndo} />
      <IconBtn label="Zoom in" glyph="+" onClick={() => zoomCamera(0.83)} />
      <IconBtn label="Zoom out" glyph="−" onClick={() => zoomCamera(1.2)} />
    </div>
  )
}
