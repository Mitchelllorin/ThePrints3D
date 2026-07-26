/**
 * RailCascade — the slim persistent side menu. Level 0 is the icon rail; slim
 * sub-columns cascade out beside it. Everything thin + semi-transparent so the
 * 3D workspace reads through the gaps. One section open at a time.
 *
 * Wiring status (migrating real content in, section by section):
 *  • PLACE   — REAL. Cascade column of the actual catalog; tapping a row arms
 *              placement (armPlaceExclusive), so you tap the plan to drop it.
 *  • BUILD / SETTINGS — open their existing real drawers (rich content) beside
 *              the rail for now; these become slim columns next.
 *  • ASK     — opens the real panel-less Ask overlay.
 */
import { useState } from 'react'
import { useFloorplanLocalStore } from '../../store/useFloorplanLocalStore'
import { trayItems } from '../../data/objectCatalog'
import styles from './RailCascade.module.css'

type Section = 'build' | 'ask' | 'settings' | 'place'

const RAIL: { id: Section; icon: string; label: string }[] = [
  { id: 'build', icon: '✏', label: 'Build' },
  { id: 'ask', icon: '💬', label: 'Ask' },
  { id: 'settings', icon: '⚙', label: 'Settings' },
  { id: 'place', icon: '▦', label: 'Place' },
]

export default function RailCascade() {
  const traceMode = useFloorplanLocalStore((s) => s.traceMode)
  const buildOpen = useFloorplanLocalStore((s) => s.buildDrawerOpen)
  const askOpen = useFloorplanLocalStore((s) => s.askDrawerOpen)
  const settingsOpen = useFloorplanLocalStore((s) => s.settingsDrawerOpen)
  const setDrawerOpen = useFloorplanLocalStore((s) => s.setDrawerOpen)
  const placeObjectType = useFloorplanLocalStore((s) => s.placeObjectType)
  const setPlaceObjectType = useFloorplanLocalStore((s) => s.setPlaceObjectType)
  const armPlaceExclusive = useFloorplanLocalStore((s) => s.armPlaceExclusive)

  // Place is a cascade column (not a store drawer), so its open state is local.
  const [placeOpen, setPlaceOpen] = useState(false)

  const active: Record<Section, boolean> = {
    build: buildOpen,
    ask: askOpen,
    settings: settingsOpen,
    place: placeOpen,
  }

  const closeDrawers = () => {
    setDrawerOpen('build', false)
    setDrawerOpen('ask', false)
    setDrawerOpen('settings', false)
  }

  const selectSection = (id: Section) => {
    if (active[id]) {
      // Tapping the open section closes it.
      if (id === 'place') { setPlaceOpen(false); setPlaceObjectType(null) }
      else setDrawerOpen(id, false)
      return
    }
    // Open exclusively.
    if (id === 'place') {
      closeDrawers()
      setPlaceOpen(true)
    } else {
      setPlaceOpen(false)
      setDrawerOpen(id, true) // the store closes the other drawers
    }
  }

  const armObject = (type: string) => {
    if (placeObjectType === type) {
      setPlaceObjectType(null)
    } else {
      armPlaceExclusive(type)
      // Selecting an item is the start of an action → retract the menu so the
      // workspace is clear to place (the hi-vis ghost is now on the plan).
      setPlaceOpen(false)
    }
  }

  // Retract entirely while tracing — the workspace stays clear during an action.
  if (traceMode) return null

  return (
    <div className={styles.wrap}>
      <nav className={styles.rail} aria-label="Menus">
        {RAIL.map(({ id, icon, label }) => (
          <button
            key={id}
            className={`${styles.icon} ${active[id] ? styles.active : ''}`}
            onClick={() => selectSection(id)}
            title={label}
            aria-pressed={active[id]}
          >
            <span className={styles.glyph}>{icon}</span>
            <span className={styles.iconLabel}>{label}</span>
          </button>
        ))}
      </nav>

      {placeOpen && (
        <div className={styles.col}>
          {trayItems().map((item) => (
            <button
              key={item.type}
              className={`${styles.row} ${placeObjectType === item.type ? styles.rowActive : ''}`}
              onClick={() => armObject(item.type)}
              title={item.label}
            >
              <span className={styles.rowGlyph}>{item.icon}</span>
              <span className={styles.rowLabel}>{item.short}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
