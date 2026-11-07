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
import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useFloorplanLocalStore } from '../../store/useFloorplanLocalStore'
import { useAppStore } from '../../store/useAppStore'
import { trayItems } from '../../data/objectCatalog'
import LayersPanel from './LayersPanel'
import FramingPanel from './FramingPanel'
import FusePanel from './FusePanel'
import ArenaPanel from './ArenaPanel'
import { useCanBuyPro, useIsPro } from '../Pro/usePro'
import { sharePicture, type ShareOutcome } from '../../services/sharePicture'
import { PRO_REASON_GENERAL } from '../Pro/UpgradeSheet'
import { planViewCamera } from '../../services/builtScene'
import FamilyDrawer, { FamilyGlyph } from './FamilyDrawer'
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

/** Framing: a top plate on three studs, drawn to match the rail's thin marks. */
function StudsIcon() {
  return (
    <svg
      viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor"
      strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden
    >
      <path d="M3.5 5h17" />
      <path d="M3.5 19h17" />
      <path d="M6 5v14M12 5v14M18 5v14" />
    </svg>
  )
}

/** Share: the usual box with an arrow leaving it, in the rail's thin marks. */
function ShareIcon() {
  return (
    <svg
      viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor"
      strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden
    >
      <path d="M12 3.5v11" />
      <path d="M8 7.5 12 3.5l4 4" />
      <path d="M8.5 11H6.2A1.2 1.2 0 0 0 5 12.2v7.1A1.2 1.2 0 0 0 6.2 20.5h11.6a1.2 1.2 0 0 0 1.2-1.2v-7.1A1.2 1.2 0 0 0 17.8 11h-2.3" />
    </svg>
  )
}

/** Patio door: two glass panels lapping on one track, seen square on. The tray
 *  used to show 🚪 for this — the same glyph as a plain swing door, which is the
 *  one thing a patio slider is not. Two panes at different fills say "one slides
 *  past the other" even at 16px, which no emoji door can. */
function SliderDoorIcon() {
  return (
    <svg
      viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
      strokeWidth="1.6" strokeLinejoin="round" aria-hidden
    >
      <rect x="2" y="5" width="20" height="14" rx="1" />
      <rect x="4" y="7" width="8.4" height="10" fill="currentColor" opacity="0.18" stroke="none" />
      <rect x="12.6" y="7" width="7.4" height="10" fill="currentColor" opacity="0.34" stroke="none" />
      <path d="M12.6 5v14" />
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

/**
 * F.U.S.E.'s bolt — the same mark the wordmark opens with, drawn as a glyph so
 * it sits with the rail's other thin monochrome marks instead of being the one
 * coloured blob in the column. The colour belongs on the panel's own wordmark,
 * where it is the brand; on the rail this is just the way in.
 */
function BoltIcon() {
  return (
    <svg
      viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor"
      strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden
    >
      <path d="M13.4 2.5 5.6 13.2h5l-.9 8.3 8.3-11h-5.1z" />
    </svg>
  )
}

/**
 * Arena: a beam on two supports, seen edge on. The bench's mark, drawn for the
 * same reason as the bolt and the studs — the rail is thin monochrome marks.
 */
function BenchIcon() {
  return (
    <svg
      viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor"
      strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden
    >
      <path d="M3 17h18" />
      <path d="M4 17V8M20 17V8" />
      <path d="M4 9.2h16" />
      <path d="M12 3.6l4.2 5.6H7.8z" />
    </svg>
  )
}

type Section = 'build' | 'ask' | 'fuse' | 'arena' | 'settings' | 'place' | 'layers' | 'framing'

const RAIL: { id: Section; icon: ReactNode; label: string }[] = [
  { id: 'build', icon: '✏', label: 'Build' },
  { id: 'ask', icon: '💬', label: 'Ask' },
  // F.U.S.E. — the years. The build review says what is wrong with the drawing
  // today; this says what goes first and when. Both are readings of the same
  // model, so they sit next to each other rather than in Settings.
  { id: 'fuse', icon: <BoltIcon />, label: 'Fuse' },
  // ARENA — the other half of F.U.S.E.: the years panel ages a wall, the bench
  // loads a beam to the figures on its own plate. Same engine, same grades; the
  // specimen and the stressor are what change.
  { id: 'arena', icon: <BenchIcon />, label: 'Arena' },
  { id: 'settings', icon: '⚙', label: 'Settings' },
  { id: 'place', icon: '▦', label: 'Place' },
  // LAYERS — what the model is made of, and what you want to see of it.
  // The list itself already existed and was already registry-shaped (Structure /
  // Envelope / Trades / View, bridging both stores). It was just mounted deep
  // inside FloorplanPanel, so the only way to reach the trade toggles was
  // through another drawer. A thing you reach for constantly does not live two
  // levels down.
  { id: 'layers', icon: '◫', label: 'Layers' },
  // STUDS — the stud layout and colour-by-member: ways of LOOKING at the
  // framing. They were rows in Layers nobody could find; see FramingPanel.
  // Not labelled "Framing": the Build panel already has a Framing tab, the one
  // you draw walls from, and two different things with one name is how a
  // person ends up in the wrong one.
  { id: 'framing', icon: <StudsIcon />, label: 'Studs' },
]

export default function RailCascade() {
  const traceMode = useFloorplanLocalStore((s) => s.traceMode)
  const buildOpen = useFloorplanLocalStore((s) => s.buildDrawerOpen)
  const askOpen = useFloorplanLocalStore((s) => s.askDrawerOpen)
  const settingsOpen = useFloorplanLocalStore((s) => s.settingsDrawerOpen)
  const setDrawerOpen = useFloorplanLocalStore((s) => s.setDrawerOpen)
  const placeObjectType = useFloorplanLocalStore((s) => s.placeObjectType)
  const setPlaceObjectType = useFloorplanLocalStore((s) => s.setPlaceObjectType)
  const setTraceStroke = useFloorplanLocalStore((s) => s.setTraceStroke)
  const setTraceStart = useFloorplanLocalStore((s) => s.setTraceStart)
  const setHoverPixel = useFloorplanLocalStore((s) => s.setHoverPixel)
  const setTraceMode = useFloorplanLocalStore((s) => s.setTraceMode)
  /** Put the tool down — mirrors cancelTracing in FloorplanPanel. */
  const endTracing = () => {
    setTraceMode(false); setTraceStroke([]); setTraceStart(null); setHoverPixel(null)
  }
  const armPlaceExclusive = useFloorplanLocalStore((s) => s.armPlaceExclusive)
  const clearWorkspace = useAppStore((s) => s.clearWorkspace)
  const hasDrawings = useAppStore((s) => s.drawings.length > 0)
  const editMode = useFloorplanLocalStore((s) => s.editMode)
  const planView = useFloorplanLocalStore((s) => s.planView)
  const setPlanView = useFloorplanLocalStore((s) => s.setPlanView)
  const setCameraPreset = useAppStore((s) => s.setCameraPreset)
  const setEditMode = useFloorplanLocalStore((s) => s.setEditMode)
  /**
   * EDIT IS ALWAYS THERE ONCE THERE IS A PLAN — no "is there anything to grab
   * yet" test in front of it.
   *
   * It used to appear only when the model had something selectable: a built
   * model, a traced wall, a placed object. The reasoning was that a mode you
   * cannot do anything in is a dead button, and on a half-built plan that was
   * the intent. In practice it reads as the app losing the tool: open a plan, or
   * look at a sample, and EDIT has simply gone — and the one moment you most
   * want to nudge a wall is the moment you have just imported it and the
   * detector got a line wrong. A verb that comes and goes teaches people not to
   * look for it.
   *
   * So it is on whenever a plan is open, in any state — traced, detected,
   * built or bare. With nothing under it yet it is a mode waiting for the first
   * wall, which is exactly what a tool is.
   */

  // Place is a cascade column (not a store drawer), so its open state is local.
  const [placeOpen, setPlaceOpen] = useState(false)
  const [layersOpen, setLayersOpen] = useState(false)
  const [framingOpen, setFramingOpen] = useState(false)
  const [fuseOpen, setFuseOpen] = useState(false)
  const [arenaOpen, setArenaOpen] = useState(false)
  // The family drawer is its own sheet, not a rail section: it closes nothing
  // and nothing closes it but itself.
  const [familyOpen, setFamilyOpen] = useState(false)
  const closeFamily = useCallback(() => setFamilyOpen(false), [])
  const setRailPanelOpen = useFloorplanLocalStore((s) => s.setRailPanelOpen)
  const openUpgrade = useFloorplanLocalStore((s) => s.openUpgrade)
  const canBuyPro = useCanBuyPro()
  const isPro = useIsPro()
  // What the last share did, said on the button for a moment instead of a dialog.
  const [shareSaid, setShareSaid] = useState<ShareOutcome | null>(null)
  // The native sheet takes a beat to open; a second tap in that beat is not a second share.
  const [sharing, setSharing] = useState(false)
  const share = async () => {
    if (sharing) return
    setSharing(true)
    const outcome = await sharePicture(isPro).finally(() => setSharing(false))
    if (outcome === 'cancelled' || outcome === 'shared') return
    setShareSaid(outcome)
    window.setTimeout(() => setShareSaid(null), 2500)
  }
  useEffect(() => { setRailPanelOpen(layersOpen || placeOpen || framingOpen || fuseOpen || arenaOpen) }, [layersOpen, placeOpen, framingOpen, fuseOpen, arenaOpen, setRailPanelOpen])
  // First tap arms Clear, second does it. See the button for why.
  const [clearArmed, setClearArmed] = useState(false)

  /**
   * TWO COLUMNS WHEN THE LIST IS TALLER THAN THE SCREEN.
   *
   * Measured, not pinned to a breakpoint: how many tools the rail carries
   * depends on what is loaded (Plan, Share, Edit and Pro only appear once there
   * is a plan), so any viewport height chosen for today's count is wrong the day
   * a tool is added. The moment the list needs more room than the column has, it
   * wraps into two 44px columns — every tool visible, at full tap size, instead
   * of the tail scrolling off the bottom where nobody can see it.
   *
   * `needed` is the height the list wants as ONE column, which does not change
   * when it wraps — so this cannot oscillate between the two layouts.
   */
  const railRef = useRef<HTMLElement | null>(null)
  const [railWrap, setRailWrap] = useState(false)
  useEffect(() => {
    const rail = railRef.current
    const col = rail?.parentElement
    if (!rail || !col) return
    const measure = () => {
      const kids = Array.from(rail.children) as HTMLElement[]
      if (!kids.length) return
      const cs = getComputedStyle(rail)
      const gap = parseFloat(cs.rowGap) || 0
      const pad = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0)
      const needed = kids.reduce((h, k) => h + k.getBoundingClientRect().height, 0)
        + gap * (kids.length - 1) + pad
      // Clear sits outside the list and keeps its own height at the foot.
      const foot = (col.lastElementChild as HTMLElement | null)?.offsetHeight ?? 0
      setRailWrap(needed > col.clientHeight - foot - 12 + 1)
    }
    measure()
    // The list itself changes length as tools appear; the column changes size as
    // the screen does. Watch both — a ResizeObserver on the column alone would
    // never hear about a tool being added to a list that still fits the box.
    const ro = new ResizeObserver(measure)
    ro.observe(col)
    const mo = new MutationObserver(measure)
    mo.observe(rail, { childList: true })
    return () => { ro.disconnect(); mo.disconnect() }
  }, [])
  // The rail's width is a token the ambient guide and the nameplates lay
  // themselves out against (see --rail-w), so the second column has to say so.
  useEffect(() => {
    document.documentElement.style.setProperty('--rail-w', railWrap ? '96px' : '44px')
    return () => { document.documentElement.style.removeProperty('--rail-w') }
  }, [railWrap])

  const active: Record<Section, boolean> = {
    build: buildOpen,
    ask: askOpen,
    fuse: fuseOpen,
    arena: arenaOpen,
    settings: settingsOpen,
    place: placeOpen,
    layers: layersOpen,
    framing: framingOpen,
  }

  const closeDrawers = () => {
    setDrawerOpen('build', false)
    setDrawerOpen('ask', false)
    setDrawerOpen('settings', false)
  }

  const selectSection = (id: Section) => {
    /**
     * MID-TRACE, THE RAIL IS THE WAY OUT.
     *
     * The trace bar's "✓ Done" button is gone — it was a button whose only job
     * was to undo the mode you were in, sitting permanently in the corner of the
     * workspace. Escape does it on a desktop, but a phone has no Escape, so
     * tapping the rail item you started from now puts the tool down. It is the
     * same gesture as closing an open drawer, and it costs no chrome.
     */
    if (traceMode) {
      endTracing()
      if (id === 'build') return
    }
    /**
     * ARENA IS A CASCADE LIKE THE OTHERS, and it opens over the model on
     * purpose: a bench you cannot see the building behind is a separate app.
     * It is one surface at a time, so opening it shuts the rest and opening
     * anything else shuts it.
     */
    if (id === 'arena') {
      const next = !arenaOpen
      closeDrawers(); setPlaceOpen(false); setPlaceObjectType(null)
      setLayersOpen(false); setFramingOpen(false); setFuseOpen(false)
      setArenaOpen(next)
      return
    }
    if (arenaOpen) setArenaOpen(false)

    if (active[id]) {

      // Tapping the open section closes it.
      if (id === 'place') { setPlaceOpen(false); setPlaceObjectType(null) }
      else if (id === 'layers') setLayersOpen(false)
      else if (id === 'fuse') setFuseOpen(false)
      else if (id === 'framing') setFramingOpen(false)
      else setDrawerOpen(id, false)
      return
    }
    // Open exclusively — one surface at a time, so the workspace stays clear.
    if (id === 'place') {
      closeDrawers(); setLayersOpen(false); setFramingOpen(false); setFuseOpen(false)
      setPlaceOpen(true)
    } else if (id === 'layers') {
      closeDrawers(); setPlaceOpen(false); setPlaceObjectType(null); setFramingOpen(false); setFuseOpen(false)
      setLayersOpen(true)
    } else if (id === 'framing') {
      closeDrawers(); setPlaceOpen(false); setPlaceObjectType(null); setLayersOpen(false); setFuseOpen(false)
      setFramingOpen(true)
    } else if (id === 'fuse') {
      closeDrawers(); setPlaceOpen(false); setPlaceObjectType(null); setLayersOpen(false); setFramingOpen(false)
      setFuseOpen(true)
    } else {
      setPlaceOpen(false); setLayersOpen(false); setFramingOpen(false); setFuseOpen(false)
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

  /**
   * THE RAIL STAYS WHILE TRACING, BECAUSE IT IS THE WAY OUT.
   *
   * This used to `return null` the moment trace mode began, and that quietly
   * removed the only exit the app had. Follow the trail: the trace bar's "Done"
   * was deleted on purpose — a permanent button in the corner of the workspace
   * whose only job was to leave the mode you were in — on the grounds that
   * Escape does it on a desktop and tapping the rail does it on a phone.
   * selectSection above still implements exactly that, comment and all.
   *
   * It could never run. Unmounting the rail during a trace deleted the control
   * that was supposed to be the answer, so on a phone — no Escape key — once
   * you started tracing there was no way out at all. Trace some walls, press
   * Find the rest, and you are stranded in a mode with every door removed.
   *
   * So it stays mounted, and stays out of the way instead: dimmed and narrowed
   * to the edge, no cascade, no labels competing with the drawing. The
   * workspace is still clear — the centre is untouched, which is what "clear"
   * has to mean. Chrome you cannot see is not restraint if it takes the exit
   * with it.
   */
  return (
    <div className={`${styles.wrap} ${traceMode ? styles.tracing : ''} ${layersOpen || placeOpen || framingOpen || fuseOpen || arenaOpen ? styles.wrapSheet : ''}`}>
      {/* The list scrolls; CLEAR sits outside the scroll port, below it. See the
          note on .railCol — when the list got longer than the screen, Clear (its
          last child, pinned to the foot) was the first thing pushed out of it. */}
      <div className={styles.railCol}>
        <nav ref={railRef} className={`${styles.rail} ${railWrap ? styles.railWrap : ''}`} aria-label="Menus">
          {RAIL.filter((r) => r.id !== 'framing' || hasDrawings).map(({ id, icon, label }) => (
            <Fragment key={id}>
              <button
                className={`${styles.icon} ${active[id] ? styles.active : ''}`}
                onClick={() => selectSection(id)}
                title={label}
                aria-pressed={active[id]}
                // So the tutorial can spotlight the real control instead of
                // describing where it is and hoping. Until now only two elements in
                // the whole app could be pointed at.
                data-tour={`rail-${id}`}
              >
                <span className={styles.glyph}>{icon}</span>
                <span className={styles.iconLabel}>{label}</span>
              </button>
              {/* The 3D Learning Family — beside the gear, the same small button
                  in every family app. A glyph only; its name is for screen
                  readers and the desktop tooltip. */}
              {id === 'settings' && !traceMode && (
                <button
                  className={`${styles.icon} ${familyOpen ? styles.active : ''}`}
                  onClick={() => setFamilyOpen(!familyOpen)}
                  title="3D Family"
                  aria-label="3D Family"
                  aria-expanded={familyOpen}
                >
                  <span className={styles.glyph}><FamilyGlyph /></span>
                </button>
              )}
            </Fragment>
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

          {/* SHARE — the picture, straight to the phone's share sheet.
              Mitchell, 25 Oct 2026: he drew a layout on a real job, framed it and
              screenshotted it to his boss. The screenshot was the workaround; the
              old Share PNG was a download buried in Settings. One tap here, from
              whatever the view is showing. See services/sharePicture. */}
          {hasDrawings && !traceMode && (
            <button
              className={styles.icon}
              onClick={share}
              disabled={sharing}
              aria-busy={sharing}
              title="Share a picture of this view — text, email, anywhere"
            >
              <span className={styles.glyph}><ShareIcon /></span>
              <span className={styles.iconLabel}>
                {sharing ? 'Wait' : shareSaid === 'downloaded' ? 'Saved' : shareSaid === 'failed' ? 'Retry' : 'Share'}
              </span>
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
          {hasDrawings && !traceMode && (
            <button
              className={`${styles.icon} ${editMode ? styles.active : ''}`}
              // Free. Mitchell, 24 Sep 2026: fixing your own drawing is part of
              // drawing it. Pro is what you take to the yard: the cut list.
              onClick={() => setEditMode(!editMode)}
              aria-pressed={editMode}
              title={editMode ? 'Done editing' : 'Edit anything — drag to move it'}
            >
              <span className={styles.glyph}><EditIcon done={editMode} /></span>
              <span className={styles.iconLabel}>{editMode ? 'Done' : 'Edit'}</span>
            </button>
          )}

          {/* PRO — the one door to buying that is always there. Every locked
              feature opens the sheet too, but those only appear once you reach for
              that feature; someone who already wants Pro should not have to go
              hunting through Settings for the way to pay. Shown only while there
              is something to buy and it is not owned, so it goes the moment they
              buy it and never appears on a build with no store. */}
          {canBuyPro && (
            <button
              className={`${styles.icon} ${styles.proCta}`}
              onClick={() => openUpgrade(PRO_REASON_GENERAL)}
              title="Unlock Pro: the full cut list, takeoff, tape and more"
              data-tour="rail-pro"
            >
              <span className={styles.glyph}>★</span>
              <span className={styles.iconLabel}>Pro</span>
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
        </nav>

        {/* CLEAR — outside the scrolling list, at the foot of the column.
            0.45, not 0.22: on an empty workspace it is disabled, and at 0.22 it
            was not dimmed, it was invisible — the same report as the button
            having gone. Dim enough to read as unavailable, present enough to
            find when you come looking for it. */}
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
          style={hasDrawings ? undefined : { opacity: 0.45, cursor: 'default' }}
        >
          <span className={styles.glyph} style={clearArmed ? { color: '#f87171' } : undefined}><BinIcon /></span>
          <span className={styles.iconLabel} style={clearArmed ? { color: '#f87171' } : undefined}>
            {clearArmed ? 'Sure?' : 'Clear'}
          </span>
        </button>
      </div>

      <FamilyDrawer open={familyOpen} onClose={closeFamily} />

      {layersOpen && (
        <div className={styles.col} style={{ minWidth: 168, maxHeight: '100%' }}>
          <LayersPanel />
        </div>
      )}

      {arenaOpen && (
        <div className={styles.col} style={{ minWidth: 208, maxHeight: '100%' }}>
          <ArenaPanel />
        </div>
      )}

      {/* The timeline is tall and scrolls itself: it carries the scrubber, a
          verdict and four answers, and it must fit on a phone without the
          verdict being pushed off the bottom of the screen. */}
      {fuseOpen && (
        <div className={styles.col} style={{ minWidth: 196, maxHeight: '100%' }}>
          <FusePanel />
        </div>
      )}

      {/* Only as tall as what is in it. These switches change the model, so
          the model has to stay in view to see them work — a full-height column
          put glass over the very thing you had just switched. */}
      {framingOpen && (
        <div className={styles.col} style={{ alignSelf: 'flex-start' }}>
          <FramingPanel />
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
              <span className={styles.rowGlyph}>
                {item.glyph === 'patio-slider' ? <SliderDoorIcon /> : item.icon}
              </span>
              <span className={styles.rowLabel}>{item.short}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
