/**
 * TopIcons — persistent global actions, fixed top-right: Undo ↩ plus zoom.
 * Sits BELOW the brand line, not level with it: the wordmark and the mark own
 * the top row on their own, and these four sit underneath.
 * (Clear lives at the foot of the left rail — the most destructive action wants
 * to be nowhere near the buttons you tap without looking.)
 * (Build / Settings / Place open from their own always-visible edge-drawer tabs,
 * so they're no longer icons here.)
 * Plain-text tooltip to the LEFT on hover (CSS ::before). No emoji, no SVG.
 *
 * OPEN A PLAN LIVES HERE BECAUSE IT IS A ONCE-A-SESSION ACT.
 *
 * It used to exist only on the empty workspace — "Open a plan" among the start
 * chips — so the moment there was a drawing loaded the way to open another one
 * was gone, unless you knew that dragging a file onto the canvas worked. Opening
 * the next job is exactly what the top edge is for: status and the things you
 * touch once a session, not the tools you work with. It sits left of Undo
 * because Undo is the one you reach for in a hurry.
 */
import type { ReactNode } from 'react'
import styles from './TopIcons.module.css'
import { zoomCamera } from '../Viewer3D/cameraControls'

/** A plan sheet: page, folded corner, two lines of drawing on it. Drawn for the
 *  same reason the rail's glyphs are — a coloured emoji would be the one blob in
 *  a row of thin monochrome marks, and it would not take the theme's ink. */
function PlanSheetIcon() {
  return (
    <svg
      viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor"
      strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden
    >
      <path d="M6 2.8h8l4 4v14.4H6z" />
      <path d="M14 2.8v4h4" />
      <path d="M9 11.5h6M9 15h4" />
      <path d="M9 18.5h2" />
    </svg>
  )
}

interface BtnProps {
  label: string
  glyph: ReactNode
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
  /** Opens the file picker — the way to the NEXT plan, with one already open. */
  onOpenPlan: () => void
  canUndo?: boolean
}

export default function TopIcons(p: Props) {
  return (
    <div className={styles.bar}>
      <IconBtn label="Open" glyph={<PlanSheetIcon />} showLabel onClick={p.onOpenPlan} />
      <IconBtn label="Undo" glyph="↩" showLabel disabled={!p.canUndo} onClick={p.onUndo} />
      <IconBtn label="Zoom in" glyph="+" onClick={() => zoomCamera(0.83)} />
      <IconBtn label="Zoom out" glyph="−" onClick={() => zoomCamera(1.2)} />
    </div>
  )
}
