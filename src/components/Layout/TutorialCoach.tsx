/**
 * TutorialCoach — the interactive guided "build a whole house" walkthrough.
 * Unlike a passive checklist it DRIVES the app: each step opens the right drawer
 * and pre-selects the tool (so you're not hunting), SPOTLIGHTS the control to
 * tap (dim the rest, pulse a ring), and REACTS when you do the action (ticks the
 * step and slides to the next). The script + goals live in the pure tutorial
 * module; this shell wires it to the live stores and the DOM.
 */
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useAppStore } from '../../store/useAppStore'
import { useFloorplanLocalStore } from '../../store/useFloorplanLocalStore'
import { TUTORIAL_STEPS, tutorialAdvance, clampStep, type TutorialContext, type TutorialEnter } from '../../services/tutorial'

/**
 * Highlight the words that carry the lesson.
 *
 * The copy is plain prose in tutorial.ts, written by the person who knows the
 * trade — so the markup has to be something you can type mid-sentence without
 * thinking about it. Wrap a phrase in *asterisks* and it comes out in the
 * accent colour: the terms worth remembering (calibration, find the rest,
 * ThePrints3D) stand out of a paragraph that is otherwise read once and
 * skimmed.
 *
 * Deliberately the ONLY markup. Anything richer turns the script into a
 * template language and the copy into something you have to escape.
 */
function highlighted(body: string) {
  return body.split(/(\*[^*]+\*)/g).map((chunk, i) => (
    chunk.startsWith('*') && chunk.endsWith('*') && chunk.length > 2
      ? (
        <span key={i} style={{ color: 'var(--bp-accent, #38bdf8)', fontWeight: 700 }}>
          {chunk.slice(1, -1)}
        </span>
      )
      : chunk
  ))
}

export default function TutorialCoach() {
  const active = useFloorplanLocalStore((s) => s.tutorialActive)
  const rawStep = useFloorplanLocalStore((s) => s.tutorialStep)
  const setStep = useFloorplanLocalStore((s) => s.setTutorialStep)
  const exit = useFloorplanLocalStore((s) => s.exitTutorial)
  const calibrationHandledIds = useFloorplanLocalStore((s) => s.calibrationHandledIds)
  const setActiveTraceLayer = useFloorplanLocalStore((s) => s.setActiveTraceLayer)
  const setDrawerOpen = useFloorplanLocalStore((s) => s.setDrawerOpen)
  const setTraceMode = useFloorplanLocalStore((s) => s.setTraceMode)
  const closeAllPanels = useFloorplanLocalStore((s) => s.closeAllPanels)
  // What else is currently on screen — the coach has to work around it.
  const buildOpen = useFloorplanLocalStore((s) => s.buildDrawerOpen)
  const settingsOpen = useFloorplanLocalStore((s) => s.settingsDrawerOpen)
  const askOpen = useFloorplanLocalStore((s) => s.askDrawerOpen)
  const placeOpen = useFloorplanLocalStore((s) => s.placeDrawerOpen)
  /** Tracing owns the bottom-left corner (layer chip + Done), so the coach moves. */
  const traceMode = useFloorplanLocalStore((s) => s.traceMode)

  const drawings = useAppStore((s) => s.drawings)
  const overlay = useAppStore((s) => s.floorplanOverlay)
  const floorsAreas = useAppStore((s) => s.floorsAreas)
  const roofAreas = useAppStore((s) => s.roofAreas)
  const plumbingLines = useAppStore((s) => s.plumbingLines)
  const electricalLines = useAppStore((s) => s.electricalLines)
  const placedObjects = useAppStore((s) => s.placedObjects)
  const buildResult = useAppStore((s) => s.buildResult)
  const modelStatus = useAppStore((s) => s.model.status)

  const step = clampStep(rawStep)
  const current = TUTORIAL_STEPS[step]
  const drawing = drawings.find((d) => d.id === overlay.drawingId) ?? drawings[0] ?? null
  const isCalibrated = !!drawing && drawing.scaleMmPerPx !== null && drawing.scaleConfidence !== 'fallback'
  const calibrationHandled = !!drawing && calibrationHandledIds.includes(drawing.id)

  const ctx: TutorialContext = {
    hasPlan: !!drawing,
    calibrationCleared: isCalibrated || calibrationHandled,
    userWallCount: drawing ? drawing.parsedWalls.filter((w) => w.source === 'user').length : 0,
    totalWallCount: drawing ? drawing.parsedWalls.length : 0,
    hasFloor: floorsAreas.length > 0,
    hasRoof: roofAreas.length > 0,
    built: buildResult !== null || modelStatus === 'ready',
    openingCount: placedObjects.filter((o) => o.type === 'door' || o.type === 'window').length,
    plumbingCount: plumbingLines.length,
    electricalCount: electricalLines.length,
  }

  const { done, nextIndex } = tutorialAdvance(step, ctx)

  // ── Drive the UI when a step opens (once per entry) ──────────────────────────
  const enteredStep = useRef<number | null>(null)
  useEffect(() => {
    if (!active) { enteredStep.current = null; return }
    if (enteredStep.current === step) return
    enteredStep.current = step
    const e: TutorialEnter | undefined = TUTORIAL_STEPS[step].enter
    if (!e) return
    // Always clear any selection first — a selected wall/area otherwise forces the
    // Build drawer open (selection-driven), fighting this step's intended state.
    closeAllPanels()
    if (e === 'place') { setTraceMode(false); setDrawerOpen('place', true) }
    else if (e === 'settings') { setTraceMode(false); setDrawerOpen('settings', true) }
    else if (e === 'closeDrawers') { setTraceMode(false); setDrawerOpen('build', false) }
    else {
      // A tracing step (floors/framing/roof/plumbing/electrical): select the
      // layer AND drop straight into trace mode so a tap on the plan actually
      // draws — selecting the layer alone leaves taps inert. Trace mode retracts
      // the drawer (workspace clear); the coach guides the action.
      setActiveTraceLayer(e)
      setTraceMode(true)
    }
  }, [active, step, setActiveTraceLayer, setDrawerOpen, setTraceMode, closeAllPanels])

  /**
   * A TOUR WITHOUT A PLAN IS NARRATING AN EMPTY ROOM.
   *
   * Every step from here on talks about "the print", points at it, and draws on
   * it. Tap CLEAR mid-tour — or start the tour some way that skips the preset —
   * and it carries on cheerfully describing a drawing that is not on screen.
   *
   * So it stands down. Only once a plan has actually been seen, otherwise the
   * first frame of a starting tour (preset still loading) would close it before
   * it began.
   */
  const sawPlan = useRef(false)
  useEffect(() => {
    if (!active) { sawPlan.current = false; return }
    if (drawings.length > 0) { sawPlan.current = true; return }
    if (sawPlan.current) exit()
  }, [active, drawings.length, exit])

  // ── Auto-advance only steps the user COMPLETES (not ones done on arrival) ────
  const arrivalDone = useRef<Record<number, boolean>>({})
  useEffect(() => {
    if (!active) { arrivalDone.current = {}; return }
    if (!(step in arrivalDone.current)) arrivalDone.current[step] = done
    if (arrivalDone.current[step] || nextIndex === null) return
    const t = setTimeout(() => setStep(nextIndex), 900)
    return () => clearTimeout(t)
  }, [active, step, done, nextIndex, setStep])

  // ── A step with nothing to detect moves on by itself ─────────────────────────
  // Otherwise the opening line waits forever on a Next the user has not spotted,
  // and the tour appears to have hung on its own first sentence. Cancelled if
  // they navigate first, so it can never fight a deliberate tap.
  useEffect(() => {
    if (!active) return
    const ms = TUTORIAL_STEPS[step].autoAdvanceMs
    if (!ms || step >= TUTORIAL_STEPS.length - 1) return
    const t = setTimeout(() => setStep(step + 1), ms)
    return () => clearTimeout(t)
  }, [active, step, setStep])

  /**
   * FIND THE REST — lit first, then pressed.
   *
   * The step names the control while the spotlight is on it, and a beat later
   * the tour presses it for real: you see WHERE it lives and WHAT it does in
   * one movement, instead of being told about a button and left to find it.
   * The pause is the point — pressing it the instant the step opens would look
   * like the walls simply appeared on their own.
   */
  const processWithSeeds = useAppStore((s) => s.processWithSeeds)
  const pressedFindRest = useRef(false)
  useEffect(() => {
    if (!active) { pressedFindRest.current = false; return }
    if (TUTORIAL_STEPS[step].perform !== 'findRest' || pressedFindRest.current) return
    const d = drawings[0]
    if (!d) return
    pressedFindRest.current = true
    const t = setTimeout(() => { void processWithSeeds(d.id) }, 2600)
    return () => clearTimeout(t)
  }, [active, step, drawings, processWithSeeds])

  // ── Track the spotlight target's on-screen rect (drawers animate, so poll) ───
  const target = current.target
  const [rect, setRect] = useState<DOMRect | null>(null)
  useEffect(() => {
    if (!active || !target) { setRect(null); return }
    const update = () => {
      const el = document.querySelector(`[data-tour="${target}"]`)
      setRect(el ? (el.getBoundingClientRect() as DOMRect) : null)
    }
    update()
    const id = window.setInterval(update, 200)
    window.addEventListener('resize', update)
    return () => { window.clearInterval(id); window.removeEventListener('resize', update) }
  }, [active, target, step])

  /**
   * TELL THE 3D HOW MUCH ROOM IT ACTUALLY HAS.
   *
   * The text is not a panel, but it still occupies screen: on a phone the last
   * line was sitting right on the bottom edge, and the print was framed to the
   * whole window as though the words were not there. So the coach measures the
   * band it fills and hands the number over; the framing shifts up by half of
   * it, which lands the print centred in what is LEFT rather than centred in a
   * window whose bottom strip is spoken for.
   *
   * Shifting the FRAMING, not the canvas — an earlier attempt shrank the canvas
   * and the print came out small and shoved to the top, which was worse than
   * the problem. This is the same view-offset the app already uses to recentre
   * beside an open drawer.
   */
  const bandRef = useRef<HTMLDivElement | null>(null)
  const setCoachBand = useFloorplanLocalStore((s) => s.setCoachBand)
  useEffect(() => {
    if (!active) { setCoachBand(0); return }
    const measure = () => {
      const el = bandRef.current
      if (!el) return
      const r = el.getBoundingClientRect()
      const vh = window.innerHeight
      // Only a band it is actually SITTING ON counts — text docked to the top
      // or beside a spotlight costs the print nothing at the bottom.
      const fromBottom = vh - r.bottom
      setCoachBand(fromBottom < vh * 0.25 ? Math.round(vh - r.top) : 0)
    }
    measure()
    const id = window.setInterval(measure, 300)
    window.addEventListener('resize', measure)
    return () => {
      window.clearInterval(id)
      window.removeEventListener('resize', measure)
      setCoachBand(0)
    }
  }, [active, step, setCoachBand])

  if (!active) return null

  const total = TUTORIAL_STEPS.length
  const isLast = step >= total - 1

  // Dock the coach to a top corner, OUT of the centre column where the print and
  // every trace gesture live — the old centered banner sat right over the
  // footprint you were told to tap. All spotlight targets (trace bar, Place tab,
  // Settings tab) sit along the bottom/right edges, so a top dock never covers
  // them either. If a target ever lands in the top-left, flip to the right.
  const targetTopLeft = rect ? rect.top < 220 && rect.left < window.innerWidth * 0.45 : false
  const cardSide = targetTopLeft
    ? { right: 14 as number | undefined, left: undefined }
    : { left: 14 as number | undefined, right: undefined }
  void cardSide

  // ── WHERE THE WORDS GO ───────────────────────────────────────────────────
  // Not one fixed spot. A tutorial that prints every line in the same corner
  // reads like a status bar and stops being looked at by step three; the copy
  // should travel to whatever it is talking about.
  //
  // With a spotlight target, the text sits BESIDE it — on whichever side has
  // room — so the sentence and the thing it names are read together, and the
  // target is never covered. Without one, it alternates edges by step so the
  // eye has to come back to it. Everything stays clamped to the perimeter; the
  // middle of the workspace is never a candidate.
  const vw = window.innerWidth
  const vh = window.innerHeight

  // AN OPEN DRAWER IS AN OBSTACLE, not just decoration.
  // The tour says "tap BUILD", the drawer slides out over the left third of the
  // screen, and the coach line was still sitting where the drawer now is — two
  // sets of unrelated words stacked on each other. So the coach treats the open
  // drawer as taken space and works to the right of it. The rail is 46px and a
  // drawer opens beside it at up to 248px wide; 310 clears both with air.
  const drawerOpen = buildOpen || settingsOpen || askOpen || placeOpen
  const leftEdge = drawerOpen ? Math.min(310, vw * 0.5) : 58

  const place = (): React.CSSProperties => {
    // With a drawer out there is only one honest place for the copy: clear of
    // it, along the bottom. Chasing the spotlight as well would walk the text
    // back under the drawer on a narrow screen.
    if (drawerOpen) {
      return {
        left: leftEdge,
        right: '5%',
        bottom: 'calc(30px + env(safe-area-inset-bottom, 0px))',
        maxWidth: 'min(52ch, calc(100vw - 340px))',
      }
    }
    // TRACING: go to the TOP. The bottom-left belongs to the trace HUD — the
    // layer chip and the Done button — and the coach was landing on top of it,
    // two live surfaces in one corner. The top band is empty while tracing (the
    // logo is centred, the icons are hard right), and it is as far from the
    // fingers as the screen allows.
    if (traceMode) {
      return { top: 56, left: 58, right: '8%', maxWidth: 'min(58ch, calc(100vw - 120px))' }
    }
    if (rect) {
      const roomRight = vw - rect.right
      const onLeft = roomRight > 260          // the rail case: text to its right
      const top = Math.min(Math.max(12, rect.top - 8), vh - 190)
      return onLeft
        ? { left: Math.min(rect.right + 16, vw - 300), top, maxWidth: 'min(46ch, calc(100vw - 40px))' }
        : { right: Math.min(vw - rect.left + 16, vw - 300), top, maxWidth: 'min(46ch, calc(100vw - 40px))' }
    }
    // Otherwise: the bottom edge, always left-aligned. It used to alternate
    // corners "so the eye tracks it", which in practice produced a ragged
    // right-aligned block over the drawing every other step. Movement is not
    // interest if it makes the words harder to read.
    return {
      left: 'max(58px, 6%)',
      bottom: 'calc(30px + env(safe-area-inset-bottom, 0px))',
      maxWidth: 'min(56ch, calc(100vw - 90px))',
    }
  }

  return createPortal(
    <>
      {/* The dim was 0.55 — dark enough that the model you are being taught
          about went to mud. It only has to bias the eye, not black the room
          out, so it drops to 0.28 and the ring does the pointing. */}
      <style>{`@keyframes tourPulse {
        0%,100% { box-shadow: 0 0 0 9999px rgba(2,6,23,0.28), 0 0 0 3px rgba(96,165,250,0.95), 0 0 16px 5px rgba(96,165,250,0.55); }
        50%     { box-shadow: 0 0 0 9999px rgba(2,6,23,0.28), 0 0 0 5px rgba(96,165,250,1), 0 0 26px 9px rgba(96,165,250,0.85); }
      }`}</style>

      {/* The worked example is NOT here — it is drawn in the scene, on the plan
          itself (Viewer3D/TourGhost). A demonstration floating on the glass in
          front of the drawing teaches the shape of a diagram; one performed on
          the real print, at real coordinates, teaches the gesture. */}

      {/* Spotlight: dims the screen except the target rect (the box-shadow hole),
          with a pulsing ring. pointer-events:none so the tap still reaches it. */}
      {rect && (
        <div
          aria-hidden
          style={{
            position: 'fixed',
            left: rect.left - 6, top: rect.top - 6,
            width: rect.width + 12, height: rect.height + 12,
            borderRadius: 10, zIndex: 68, pointerEvents: 'none',
            animation: 'tourPulse 1.6s ease-in-out infinite',
          }}
        />
      )}

      {/* NO PANEL. This was a 320px bordered card with a fill and a drop shadow,
          floating over the workspace while explaining the workspace — a lesson
          printed on top of its own subject. It teaches better as bare text on
          the bottom edge: a line of copy with a shadow doing the separating,
          the progress bar as a hairline, and the controls as plain words. The
          model stays visible the entire time, which is the whole point of
          pointing at it. Bottom edge rather than top because every spotlight
          target sits along the left rail or the top-right, and the copy must
          never land on the thing it is telling you to tap. */}
      <div
        ref={bandRef}
        style={{
          position: 'fixed',
          ...place(),
          zIndex: 71,
          color: '#f8fafc', fontSize: 12.5, lineHeight: 1.45,
          // With no panel behind it, contrast is the ONLY thing separating this
          // text from whatever it floats over — pale siding and a scanned print
          // included. Brightening the ink means the shadow has to carry more,
          // so it gets a tight dark core plus a wider halo. Stopping just short
          // of pure white on purpose: white is the same value as the sheet
          // goods and the print, and washes straight into them.
          textShadow: '0 1px 3px rgba(0,0,0,1), 0 0 8px rgba(0,0,0,0.95), 0 0 18px rgba(0,0,0,0.7)',
          pointerEvents: 'none',   // the gaps fall through to the workspace
          transition: 'left 0.25s ease, right 0.25s ease, top 0.25s ease',
        }}
        role="dialog"
        aria-label="Guided tutorial"
      >
        {/* TWO LINES. The previous layout stacked a counter row, a progress bar,
            a title, a body, a hint and a button row — six bands of chrome for
            one sentence, measuring 208px of a 550px screen. Without a fill it
            still read as a slab, because a slab of text is a slab. So: the
            sentence, then one quiet row of controls under it. Everything else
            (the tick, the minimise button, the segmented bar) was status about
            the tutorial rather than help with the building, and is gone. */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 7, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.6, color: '#60a5fa', flexShrink: 0 }}>
            {step + 1}/{total}
          </span>
          <span style={{ fontWeight: 700 }}>{current.title}</span>
          <span style={{ color: '#e2e8f0' }}>{highlighted(current.body)}</span>
          {current.hint && <span style={{ color: '#9fb1c4', fontStyle: 'italic' }}>{current.hint}</span>}
        </div>

        <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginTop: 5, pointerEvents: 'auto' }}>
          {step > 0 && (
            <button
              onClick={() => setStep(step - 1)}
              style={{ background: 'none', border: 'none', padding: 0, color: '#9fb1c4', fontSize: 11.5, cursor: 'pointer' }}
            >← Back</button>
          )}
          <button
            onClick={isLast ? exit : () => setStep(step + 1)}
            style={{
              background: 'none', border: 'none', padding: 0,
              color: 'var(--bp-accent, #38bdf8)', fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
            }}
          >{isLast ? 'Finish' : 'Next →'}</button>
          <span style={{ flex: 1 }} />
          <button
            onClick={exit}
            style={{ background: 'none', border: 'none', padding: 0, color: '#7c8ba1', fontSize: 11, cursor: 'pointer' }}
            aria-label="Exit tutorial"
          >Skip</button>
        </div>
      </div>
    </>,
    document.body,
  )
}
