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

  // ── Auto-advance only steps the user COMPLETES (not ones done on arrival) ────
  const arrivalDone = useRef<Record<number, boolean>>({})
  useEffect(() => {
    if (!active) { arrivalDone.current = {}; return }
    if (!(step in arrivalDone.current)) arrivalDone.current[step] = done
    if (arrivalDone.current[step] || nextIndex === null) return
    const t = setTimeout(() => setStep(nextIndex), 900)
    return () => clearTimeout(t)
  }, [active, step, done, nextIndex, setStep])

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

  if (!active) return null

  const total = TUTORIAL_STEPS.length
  const isLast = step >= total - 1

  // Put the card opposite the spotlight so it never covers what you must tap.
  const targetInTopHalf = rect ? rect.top < window.innerHeight / 2 : false
  const cardVertical = targetInTopHalf
    ? { bottom: 14 as number | undefined, top: undefined }
    : { top: 14 as number | undefined, bottom: undefined }

  return createPortal(
    <>
      <style>{`@keyframes tourPulse {
        0%,100% { box-shadow: 0 0 0 9999px rgba(2,6,23,0.55), 0 0 0 3px rgba(96,165,250,0.95), 0 0 16px 5px rgba(96,165,250,0.55); }
        50%     { box-shadow: 0 0 0 9999px rgba(2,6,23,0.55), 0 0 0 5px rgba(96,165,250,1), 0 0 26px 9px rgba(96,165,250,0.85); }
      }`}</style>

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

      <div
        style={{
          position: 'fixed', left: '50%', transform: 'translateX(-50%)',
          ...cardVertical,
          zIndex: 71, width: 'min(460px, calc(100vw - 24px))',
          background: 'rgba(11,17,32,0.97)', color: '#e5e7eb',
          border: '1px solid rgba(96,165,250,0.45)', borderRadius: 12,
          boxShadow: '0 10px 34px rgba(0,0,0,0.6)', padding: '12px 14px',
          fontSize: 13, lineHeight: 1.5,
        }}
        role="dialog"
        aria-label="Guided tutorial"
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: '#60a5fa', textTransform: 'uppercase' }}>
            Guided build · {step + 1}/{total}
          </span>
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 16, color: done ? '#34d399' : '#475569' }} aria-hidden>
            {done ? '✓' : '○'}
          </span>
          <button
            onClick={exit}
            style={{ background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', fontSize: 16, lineHeight: 1 }}
            aria-label="Exit tutorial"
          >
            ✕
          </button>
        </div>

        <div style={{ display: 'flex', gap: 3, marginBottom: 8 }}>
          {TUTORIAL_STEPS.map((s, i) => (
            <span
              key={s.id}
              style={{
                flex: 1, height: 3, borderRadius: 2,
                background: i < step ? '#34d399' : i === step ? '#60a5fa' : 'rgba(255,255,255,0.12)',
              }}
            />
          ))}
        </div>

        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 3 }}>{current.title}</div>
        <div style={{ color: '#cbd5e1', marginBottom: 6 }}>{current.body}</div>
        <div style={{ color: '#93a4b6', fontSize: 12, fontStyle: 'italic', marginBottom: 10 }}>👉 {current.hint}</div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', alignItems: 'center' }}>
          <button
            onClick={() => setStep(step - 1)}
            disabled={step === 0}
            style={{
              background: 'none', border: '1px solid rgba(255,255,255,0.18)', borderRadius: 7,
              color: step === 0 ? '#475569' : '#cbd5e1', padding: '5px 12px', fontSize: 12,
              cursor: step === 0 ? 'default' : 'pointer',
            }}
          >
            ← Back
          </button>
          <span style={{ flex: 1 }} />
          {isLast ? (
            <button
              onClick={exit}
              style={{ background: '#34d399', border: 'none', borderRadius: 7, color: '#06281c', fontWeight: 700, padding: '6px 16px', fontSize: 12, cursor: 'pointer' }}
            >
              Finish 🎉
            </button>
          ) : (
            <button
              onClick={() => setStep(step + 1)}
              style={{ background: '#2f80ff', border: 'none', borderRadius: 7, color: '#fff', fontWeight: 600, padding: '6px 16px', fontSize: 12, cursor: 'pointer' }}
            >
              Next →
            </button>
          )}
        </div>
      </div>
    </>,
    document.body,
  )
}
