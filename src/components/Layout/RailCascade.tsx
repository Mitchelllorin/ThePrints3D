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
import { useAppStore } from '../../store/useAppStore'
import { trayItems } from '../../data/objectCatalog'
import LayersPanel from './LayersPanel'
import { planViewCamera } from '../../services/builtScene'
import { requirePro } from '../Pro/usePro'
import styles from './RailCascade.module.css'

/** Wastebasket, drawn rather than typed — the rail's glyphs are thin monochrome
 *  marks and an emoji bin would be the one colour blob among them. Takes
 *  currentColor, so it dims and highlights with its neighbours. */
function BinIcon() {
  return (
    <svg
      viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor"
      strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden
    >
      <path d="M4 7h16" />
      <path d="M9.5 7V5.2A1.2 1.2 0 0 1 10.7 4h2.6a1.2 1.2 0 0 1 1.2 1.2V7" />
      <path d="M6.4 7l.9 12.1A1.9 1.9 0 0 0 9.2 21h5.6a1.9 1.9 0 0 0 1.9-1.9L17.6 7" />
      <path d="M10.4 11v6M13.6 11v6" />
    </svg>
  )
}

/** Plan view: a sheet seen square on, versus a box seen in perspective. */
function PlanIcon({ flat }: { flat: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor"
      strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden
    >
      {flat ? (
        <>
          {/* In 2D the button offers 3D: draw the box. */}
          <path d="M12 3.2 20 7.6v8.8L12 20.8 4 16.4V7.6Z" />
          <path d="M4 7.6 12 12l8-4.4M12 12v8.8" />
        </>
      ) : (
        <>
          {/* In 3D the button offers the plan: draw the sheet. */}
          <rect x="4" y="4" width="16" height="16" rx="1.4" />
          <path d="M4 9.5h16M9.5 9.5V20" />
        </>
      )}
    </svg>
  )
}

/** Pencil, or a tick once you're in edit mode. Drawn for the same reason as the
 *  bin: the rail is thin monochrome marks and an emoji would be the odd one out. */
function EditIcon({ done }: { done: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor"
      strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden
    >
      {done ? (
        <path d="M4.5 12.5 9.5 17.5 19.5 6.5" />
      ) : (
        <>
          <path d="M16.7 3.9a2.1 2.1 0 0 1 3 3L9.4 17.2l-4 1 1-4Z" />
          <path d="M15.2 5.4 18.2 8.4" />
          <path d="M4 21h16" />
        </>
      )}
    </svg>
  )
}

type Section = 'build' | 'ask' | 'settings' | 'place' | 'layers'

const RAIL: { id: Section; icon: string; label: string }[] = [
  { id: 'build', icon: '✏', label: 'Build' },
  { id: 'ask', icon: '💬', label: 'Ask' },
  { id: 'settings', icon: '⚙', label: 'Settings' },
  { id: 'place', icon: '▦', label: 'Place' },
  // LAYERS — what the model is made of, and what you want to see of it.
  // The list itself already existed and was already registry-shaped (Structure /
  // Envelope / Trades / View, bridging both stores). It was just mounted deep
  // inside FloorplanPanel, so the only way to reach the trade toggles was
  // through another drawer. A thing you reach for constantly does not live two
  // levels down.
  { id: 'layers', icon: '◫', label: 'Layers' },
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
  const clearWorkspace = useAppStore((s) => s.clearWorkspace)
  const hasDrawings = useAppStore((s) => s.drawings.length > 0)
  const editMode = useFloorplanLocalStore((s) => s.editMode)
  const planView = useFloorplanLocalStore((s) => s.planView)
  const setPlanView = useFloorplanLocalStore((s) => s.setPlanView)
  const setCameraPreset = useAppStore((s) => s.setCameraPreset)
  const setEditMode = useFloorplanLocalStore((s) => s.setEditMode)
  // Reachable once there's ANYTHING to grab — a built model, or any traced
  // wall, floor, roof or placed object. If you can select it you can edit it,
  // so the same things that make a selection possible make Edit reachable.
  // (Gating on the built model alone hid Edit on a plan you had traced but not
  // yet built, which is exactly when you most want to nudge a wall.) Returns a
  // boolean from one selector so an unrelated store write cannot re-render the
  // whole rail.
  const hasSomethingToEdit = useAppStore((s) =>
    s.buildResult !== null
    || s.model.status === 'ready'
    || s.floorsAreas.length > 0
    || s.roofAreas.length > 0
    || s.placedObjects.length > 0
    || s.plumbingLines.length > 0
    || s.electricalLines.length > 0
    || s.hvacLines.length > 0
    || s.drawings.some((d) => d.parsedWalls.some((w) => w.source === 'user')),
  )

  // Place is a cascade column (not a store drawer), so its open state is local.
  const [placeOpen, setPlaceOpen] = useState(false)
  const [layersOpen, setLayersOpen] = useState(false)
  // First tap arms Clear, second does it. See the button for why.
  const [clearArmed, setClearArmed] = useState(false)

  const active: Record<Section, boolean> = {
    build: buildOpen,
    ask: askOpen,
    settings: settingsOpen,
    place: placeOpen,
    layers: layersOpen,
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
      else if (id === 'layers') setLayersOpen(false)
      else setDrawerOpen(id, false)
      return
    }
    // Open exclusively — one surface at a time, so the workspace stays clear.
    if (id === 'place') {
      closeDrawers(); setLayersOpen(false)
      setPlaceOpen(true)
    } else if (id === 'layers') {
      closeDrawers(); setPlaceOpen(false); setPlaceObjectType(null)
      setLayersOpen(true)
    } else {
      setPlaceOpen(false); setLayersOpen(false)
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

        {/* PLAN / 3D — a MODE, switchable both ways at any time.
            Not the old one-way "Build 3D" button: 2D is where you make
            decisions (tune the detector, confirm the walls, answer the
            questions) and 3D is where you check them, so you need to move
            between them freely. Entering plan view snaps the camera straight
            overhead and locks rotation; leaving it hands the view back
            untouched, since the 3D camera is wherever you last left it. */}
        {hasDrawings && (
          <button
            className={`${styles.icon} ${planView ? styles.active : ''}`}
            onClick={() => {
              const next = !planView
              setPlanView(next)
              if (next) {
                // Frame against the REAL viewport shape — a tall phone needs the
                // camera much further back than a square one for the same sheet.
                const aspect = window.innerWidth / Math.max(1, window.innerHeight)
                setCameraPreset(planViewCamera(useAppStore.getState().floorplanOverlay, aspect))
              }
            }}
            aria-pressed={planView}
            title={planView ? 'Back to 3D' : 'Plan view — look straight down at the drawing'}
          >
            <span className={styles.glyph}><PlanIcon flat={planView} /></span>
            <span className={styles.iconLabel}>{planView ? '3D' : 'Plan'}</span>
          </button>
        )}

        {/* EDIT — a verb, so it belongs with the other verbs.
            It used to float on its own at bottom-left, which put it directly
            beside CLEAR: the exact adjacency Clear was moved to the foot to
            escape. Sitting the button people press most next to the one that
            wipes the workspace is the hazard, whichever of the two moved there
            last. In the rail it is discoverable, stays on the perimeter, and
            leaves Clear alone at the bottom with the whole gap between them.
            A toggle rather than a section, so it lights up instead of
            cascading a column. */}
        {hasDrawings && hasSomethingToEdit && !traceMode && (
          <button
            className={`${styles.icon} ${editMode ? styles.active : ''}`}
            // Only ENTERING is gated. Leaving edit mode must always work, or a
            // lapsed state could strand someone inside a mode they cannot exit.
            onClick={() => (editMode ? setEditMode(false) : requirePro('Editing the model', () => setEditMode(true)))}
            aria-pressed={editMode}
            title={editMode ? 'Done editing' : 'Edit anything — drag to move it'}
          >
            <span className={styles.glyph}><EditIcon done={editMode} /></span>
            <span className={styles.iconLabel}>{editMode ? 'Done' : 'Edit'}</span>
          </button>
        )}

        {/* CLEAR — pushed to the FOOT of the rail, and it asks first.
            It was sitting six pixels under PLACE, in the middle of the
            navigation column: tap PLACE a little low on a phone and the whole
            workspace went, dropping you back to the Browse/Scan screen with no
            idea why. Moving it off the top icons was right and not enough — the
            danger was never Undo's neighbours, it was being adjacent to the
            button people press most.
            So: margin-auto pins it to the bottom, well clear of the four menu
            items, and the first tap only ARMS it. The confirm lives on the
            button itself rather than in a dialog, because a modal in the middle
            of the workspace is the thing this app does not do. It disarms on
            its own after a few seconds so it cannot sit there loaded. */}
        <button
          className={`${styles.icon} ${styles.railFoot}`}
          onClick={() => {
            if (!hasDrawings) return
            if (!clearArmed) { setClearArmed(true); return }
            setClearArmed(false)
            clearWorkspace()
          }}
          onBlur={() => setClearArmed(false)}
          title={clearArmed ? 'Tap again to clear everything' : 'Clear workspace'}
          aria-label={clearArmed ? 'Tap again to clear everything' : 'Clear workspace'}
          disabled={!hasDrawings}
          style={hasDrawings ? undefined : { opacity: 0.22, cursor: 'default' }}
        >
          <span className={styles.glyph} style={clearArmed ? { color: '#f87171' } : undefined}><BinIcon /></span>
          <span className={styles.iconLabel} style={clearArmed ? { color: '#f87171' } : undefined}>
            {clearArmed ? 'Sure?' : 'Clear'}
          </span>
        </button>
      </nav>

      {layersOpen && (
        <div className={styles.col} style={{ minWidth: 168, maxHeight: '100%' }}>
          <LayersPanel />
        </div>
      )}

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
