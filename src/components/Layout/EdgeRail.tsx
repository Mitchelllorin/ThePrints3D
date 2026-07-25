/**
 * EdgeRail — the persistent, scrolling icon rail on the left edge.
 *
 * One always-visible strip of icons drives every edge menu (Build, Ask,
 * Settings, Place). Panels open BESIDE the rail (they're inset by its width in
 * EdgeDrawer.module.css → `.inRail`), so an open menu can never cover the
 * toggles — the overlap problem that killed stacking tabs on one edge. Tap the
 * active icon to close it; tap another to switch in a single tap. The rail
 * scrolls vertically, so more icons (or a short landscape screen) never crowd
 * it. Retracts entirely while tracing — the workspace stays clear during an
 * action.
 *
 * Keep the rail width (CSS) in sync with the `.inRail` inset in
 * EdgeDrawer.module.css (both 46px).
 */
import { useFloorplanLocalStore } from '../../store/useFloorplanLocalStore'
import styles from './EdgeRail.module.css'

type Which = 'build' | 'ask' | 'settings' | 'place'

const ITEMS: { which: Which; icon: string; label: string }[] = [
  { which: 'build', icon: '✏', label: 'Build' },
  { which: 'ask', icon: '💬', label: 'Ask' },
  { which: 'settings', icon: '⚙', label: 'Settings' },
  { which: 'place', icon: '▦', label: 'Place' },
]

export default function EdgeRail() {
  const traceMode = useFloorplanLocalStore((s) => s.traceMode)
  const buildOpen = useFloorplanLocalStore((s) => s.buildDrawerOpen)
  const askOpen = useFloorplanLocalStore((s) => s.askDrawerOpen)
  const settingsOpen = useFloorplanLocalStore((s) => s.settingsDrawerOpen)
  const placeOpen = useFloorplanLocalStore((s) => s.placeDrawerOpen)
  const setDrawerOpen = useFloorplanLocalStore((s) => s.setDrawerOpen)

  // Retract entirely while tracing — nothing chrome sits over the workspace
  // during an action (the same rule the drawers follow).
  if (traceMode) return null

  const openState: Record<Which, boolean> = {
    build: buildOpen,
    ask: askOpen,
    settings: settingsOpen,
    place: placeOpen,
  }

  return (
    <nav className={styles.rail} aria-label="Menus">
      {ITEMS.map(({ which, icon, label }) => {
        const active = openState[which]
        return (
          <button
            key={which}
            className={`${styles.item} ${active ? styles.active : ''}`}
            onClick={() => setDrawerOpen(which, !active)}
            aria-label={active ? `Hide ${label}` : `Show ${label}`}
            aria-pressed={active}
            title={label}
          >
            <span className={styles.icon}>{icon}</span>
            <span className={styles.label}>{label}</span>
          </button>
        )
      })}
    </nav>
  )
}
