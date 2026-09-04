/**
 * GCBubble — the omnipresent G.C., surfaced as one small top-centre
 * bubble. Reads a context snapshot from the stores, asks the pure `generalContractor`
 * module what to say, and (optionally) does the next step for the user. Friendly,
 * alive, never pushy: one suggestion at a time, dismissible, and silent while the
 * user is actually working (the busy gate lives in the G.C. module).
 */
import { useEffect, useState } from 'react'
import { useAppStore } from '../../store/useAppStore'
import { useFloorplanLocalStore } from '../../store/useFloorplanLocalStore'
import { nextSuggestion, type GCActionKind, type GCContext, type GCStorey } from '../../services/generalContractor'
import type { TracedLine } from '../../types'
import styles from './GCBubble.module.css'

function runAction(kind: GCActionKind) {
  const app = useAppStore.getState()
  const fp = useFloorplanLocalStore.getState()
  const drawing = app.drawings.find((d) => d.id === app.floorplanOverlay.drawingId) ?? app.drawings[0] ?? null
  switch (kind) {
    case 'calibrate':
      // Mirror FloorplanPanel.startCalibration — enter the calibration step.
      fp.setTraceMode(false); fp.setTraceStroke([])
      fp.setCalibrationA(null); fp.setCalibrationB(null); fp.setHoverPixel(null); fp.setDistanceInput('')
      app.updateFloorplanOverlay({ calibrationMode: true, guidedStep: 1, locked: false }, false)
      break
    case 'useDetectedScale':
      // Accept the detected scale and move on (counts as "handled").
      if (drawing) fp.markCalibrationHandled(drawing.id)
      break
    case 'layFloor':
      fp.setActiveTraceLayer('floors'); fp.openPicker()
      break
    case 'layRoof':
      fp.setActiveTraceLayer('roof'); fp.openPicker()
      break
    case 'trace':
      fp.setActiveTraceLayer('framing'); fp.openPicker()
      break
    // Doors and windows are placed, not traced, so this one opens the drawer
    // rather than arming a trace layer — the user picks which door from there.
    case 'place':
      fp.setDrawerOpen('place', true)
      break
    case 'autoBuild':
      app.buildForMe()
      break
    // Seed-guided: they traced one, go find the ones that match it. Replaces
    // the old 'build' action, whose button no longer exists and whose job the
    // app now does as you trace.
    case 'findRest': {
      const d = app.drawings.find((x) => x.id === app.floorplanOverlay.drawingId) ?? app.drawings[0]
      if (d) void app.processWithSeeds(d.id)
      break
    }
    /**
     * Re-read at click time rather than carrying the lesson through the
     * suggestion. The ledger derives lessons from state, so the store's own copy
     * is the current one by definition, and a lesson captured at render could
     * only ever be staler than it.
     */
    case 'applyLesson':
      app.applyTopLesson()
      break
  }
}

/**
 * WHAT IS ACTUALLY STANDING, so the G.C. can look at the model and not just at
 * the drawing. Tallied per storey, because every question it asks after a build
 * is about one level: walls with no deck under them, a deck with nothing on it,
 * a shell with no roof over it.
 *
 * `level` is optional throughout (it arrived with multi-floor, and everything
 * traced before that has none), so an absent level means ground — the same
 * default the 3D layers apply when they place these.
 *
 * DELIBERATELY OUT HERE, not an inline IIFE in the component. As one it returned
 * a stale tally: measured in the running app, a model whose second storey went
 * from "walls, no deck" to "deck, no walls" kept being told it had walls with
 * nothing under them, while the store underneath held the new state. Pure input
 * to pure output, at module scope, is the shape that cannot do that — and this
 * function has no business being re-created on every render anyway.
 */
function tallyStoreys(
  drawings: ReturnType<typeof useAppStore.getState>['drawings'],
  floorsAreas: TracedLine[],
  roofAreas: TracedLine[],
): GCStorey[] {
  const byLevel = new Map<number, GCStorey>()
  const at = (lv: number) => {
    const key = lv || 0
    let s = byLevel.get(key)
    if (!s) { s = { level: key, walls: 0, floors: 0, roofs: 0 }; byLevel.set(key, s) }
    return s
  }
  for (const d of drawings) for (const w of d.parsedWalls) at(w.level ?? 0).walls++
  for (const a of floorsAreas) at(a.level ?? 0).floors++
  for (const a of roofAreas) at(a.level ?? 0).roofs++
  return [...byLevel.values()].sort((a, b) => a.level - b.level)
}

export default function GCBubble() {
  /**
   * OPTED OUT OF THE REACT COMPILER, on evidence.
   *
   * With the compiler's memoization in place this component read a STALE model:
   * driving the app through five different build states, the context it handed
   * the G.C. was consistently one state behind the store — a second storey that
   * had just had its deck laid was still being told it had walls with nothing
   * under them. The store was right every time; the memo was serving an old
   * tally. It only caught up when some unrelated slice happened to change, which
   * is why an earlier harness in this repo carries a "poke an unrelated slice"
   * workaround rather than a fix.
   *
   * A suggestion module that reads the model has to read the CURRENT model — a
   * G.C. describing the building as it was one action ago is worse than one that
   * says nothing. This component renders a single small bubble and is not on any
   * hot path, so the memo was buying almost nothing and costing correctness.
   */
  'use no memo'
  const drawings = useAppStore((s) => s.drawings)
  const overlay = useAppStore((s) => s.floorplanOverlay)
  const floorsAreas = useAppStore((s) => s.floorsAreas)
  const roofAreas = useAppStore((s) => s.roofAreas)
  const placedObjects = useAppStore((s) => s.placedObjects)
  const buildResult = useAppStore((s) => s.buildResult)
  const modelStatus = useAppStore((s) => s.model.status)
  const traceMode = useFloorplanLocalStore((s) => s.traceMode)
  const tracePaused = useFloorplanLocalStore((s) => s.tracePaused)
  const activePanel = useFloorplanLocalStore((s) => s.activePanel)
  const calibrationHandledIds = useFloorplanLocalStore((s) => s.calibrationHandledIds)
  /**
   * SILENT WHENEVER A MENU IS OPEN.
   *
   * This G.C. was pulled once for floating over other menus, and that was a
   * fair complaint — a suggestion card sitting on top of the drawer you just
   * opened is in the way of the thing you already decided to do. It has nothing
   * useful to say at that moment anyway: you are mid-action, not looking for
   * the next step.
   *
   * So the rule is the same one the busy gate below already applies to tracing
   * and calibrating — if the user is doing something, say nothing. The bubble
   * is for the pause between actions, which is the only time "what now?" is a
   * real question.
   */
  const buildOpen = useFloorplanLocalStore((s) => s.buildDrawerOpen)
  const askOpen = useFloorplanLocalStore((s) => s.askDrawerOpen)
  const settingsOpen = useFloorplanLocalStore((s) => s.settingsDrawerOpen)
  const aMenuIsOpen = buildOpen || askOpen || settingsOpen
  // The guided tutorial owns the the G.C. while it runs — don't double up.
  const tutorialActive = useFloorplanLocalStore((s) => s.tutorialActive)

  /**
   * The corrections themselves, so a new one re-renders this and the lesson
   * below is re-derived. `correctionLessons` is an action, not a slice, so
   * calling it alone would subscribe to nothing and the G.C. would sit there
   * with the third correction already in the ledger and nothing to show for it.
   */
  const corrections = useAppStore((s) => s.corrections)

  const [dismissedId, setDismissedId] = useState<string | null>(null)

  const drawing = drawings.find((d) => d.id === overlay.drawingId) ?? drawings[0] ?? null
  const isCalibrated = !!drawing && drawing.scaleMmPerPx !== null && drawing.scaleConfidence !== 'fallback'
  const calibrationHandled = !!drawing && calibrationHandledIds.includes(drawing.id)

  const storeys = tallyStoreys(drawings, floorsAreas, roofAreas)

  /**
   * Doors from BOTH places they can come from: read off the print by the opening
   * detector, and dropped in by hand from Place. Counting only one of the two
   * would tell somebody who traced a door that they have no door.
   */
  const doorCount =
    drawings.reduce((n, d) => n + d.parsedOpenings.filter((o) => o.type === 'door').length, 0) +
    placedObjects.filter((o) => o.type === 'door').length

  const ctx: GCContext = {
    hasPlan: !!drawing,
    status: drawing?.status ?? null,
    calibrationCleared: isCalibrated || calibrationHandled,
    calibrationMode: overlay.calibrationMode,
    hasFloor: floorsAreas.length > 0,
    hasWalls: !!drawing && drawing.parsedWalls.length > 0,
    userWallCount: drawing ? drawing.parsedWalls.filter((w) => w.source === 'user').length : 0,
    detectedScaleAvailable: !!drawing && drawing.scaleMmPerPx !== null,
    detectedWallCount: drawing ? drawing.parsedWalls.length : 0,
    // The walls the app GUESSED from room labels rather than read off the ink,
    // so the G.C. can own up to them instead of presenting them as measured.
    roomDerivedWallCount: drawing ? drawing.parsedWalls.filter((w) => w.roomDerived).length : 0,
    roomCount: drawing ? drawing.parsedRooms.length : 0,
    built: buildResult !== null || modelStatus === 'ready',
    traceMode,
    tracePaused,
    activePanel,
    /**
     * What the corrections have taught us about this sheet — the one thing in
     * this context the app could not have worked out on its own.
     */
    lesson: corrections.length ? useAppStore.getState().correctionLessons()[0] ?? null : null,
    /**
     * The reading itself, so the G.C. can second-guess it before offering to
     * build a house on top of it — see the doubt branch in `generalContractor`.
     */
    detection: drawing
      ? {
          scaleConfidence: drawing.scaleConfidence ?? null,
          scaleMmPerPx: drawing.scaleMmPerPx,
          walls: drawing.parsedWalls,
          roomCount: drawing.parsedRooms.length,
          openingCount: drawing.parsedOpenings.length,
        }
      : null,
    /** The model itself — see the post-build walk in `generalContractor`. */
    storeys,
    doorCount,
  }

  const suggestion = tutorialActive || aMenuIsOpen ? null : nextSuggestion(ctx)
  const visibleId = suggestion && suggestion.id !== dismissedId ? suggestion.id : null

  // Auto-hide after ~15s so it never lingers — it reappears on its own when the
  // step changes (a new suggestion id). Timer resets whenever the id changes.
  useEffect(() => {
    if (!visibleId) return
    const t = setTimeout(() => setDismissedId(visibleId), 15000)
    return () => clearTimeout(t)
  }, [visibleId])

  if (!suggestion || suggestion.id === dismissedId) return null

  return (
    // Container is click-through; only the card itself captures input, so the
    // top-centre band never blocks orbiting the workspace behind it.
    <div className={styles.wrap}>
      <div key={suggestion.id} className={`${styles.bubble} ${styles[suggestion.tone]}`} role="status">
        <span className={`${styles.dot} ${suggestion.tone === 'progress' ? styles.dotSpin : ''}`} aria-hidden />
        <span className={styles.message}>{suggestion.message}</span>
        {suggestion.actionKind && suggestion.actionLabel && (
          <button
            className={styles.action}
            onClick={() => runAction(suggestion.actionKind as GCActionKind)}
          >
            {suggestion.actionLabel}
          </button>
        )}
        <button className={styles.dismiss} onClick={() => setDismissedId(suggestion.id)} aria-label="Dismiss">✕</button>
      </div>
    </div>
  )
}
