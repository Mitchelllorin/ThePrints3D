/**
 * EdgeDrawer — a retractable panel anchored to the left, right, or bottom edge.
 *
 * Fully retracts off-screen leaving only a small toggle tab; slides back in when
 * opened. The body is SOLID (full pointer input) and scrolls with an always-
 * visible, grabbable scrollbar — so unlike the old click-through overlays the
 * content is fully usable. Menus stay out of the way because they're retracted,
 * not because clicks fall through them. One reusable shell for all three edges.
 */
import type { ReactNode } from 'react'
import styles from './EdgeDrawer.module.css'

interface EdgeDrawerProps {
  side: 'left' | 'right' | 'bottom'
  open: boolean
  /** Tab click toggles open/closed. */
  onToggle: () => void
  tabLabel: string
  tabIcon?: ReactNode
  /** Optional header title shown inside the body, with an ✕ that calls onToggle. */
  title?: string
  /**
   * Let taps that land between controls fall THROUGH to the workspace behind.
   * The surface goes transparent and stops catching pointers; only the actual
   * controls + the tab stay live. Used while tracing/calibrating so the open
   * drawer (up to 88vw on a phone) can't swallow taps meant for the print.
   */
  clickThrough?: boolean
  children: ReactNode
  className?: string
}

const SIDE_CLASS = { left: styles.left, right: styles.right, bottom: styles.bottom } as const

export default function EdgeDrawer({ side, open, onToggle, tabLabel, tabIcon, title, clickThrough, children, className }: EdgeDrawerProps) {
  return (
    <div className={`${styles.root} ${SIDE_CLASS[side]} ${open ? styles.open : ''} ${clickThrough ? styles.clickThrough : ''} ${className ?? ''}`}>
      <button
        className={styles.tab}
        onClick={onToggle}
        aria-label={`${open ? 'Hide' : 'Show'} ${tabLabel}`}
        aria-expanded={open}
      >
        {tabIcon && <span className={styles.tabIcon}>{tabIcon}</span>}
        <span className={styles.tabLabel}>{tabLabel}</span>
      </button>
      <div className={styles.inner}>
        {title && (
          <div className={styles.header}>
            <span className={styles.title}>{title}</span>
            <button className={styles.close} onClick={onToggle} aria-label="Close">✕</button>
          </div>
        )}
        <div className={styles.scroll}>{children}</div>
      </div>
    </div>
  )
}
