/**
 * TopIcons — persistent global actions, fixed top-right: Undo ↩ plus zoom.
 * (Build / Settings / Place open from their own always-visible edge-drawer tabs,
 * so they're no longer icons here.)
 * Plain-text tooltip to the LEFT on hover (CSS ::before). No emoji, no SVG.
 */
import styles from './TopIcons.module.css'
import { zoomCamera } from '../Viewer3D/cameraControls'

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
  onUndo: () => void
  canUndo?: boolean
}

export default function TopIcons(p: Props) {
  return (
    <div className={styles.bar}>
      <IconBtn label="Undo" glyph="↩" disabled={!p.canUndo} onClick={p.onUndo} />
      <IconBtn label="Zoom in" glyph="+" onClick={() => zoomCamera(0.83)} />
      <IconBtn label="Zoom out" glyph="−" onClick={() => zoomCamera(1.2)} />
    </div>
  )
}
