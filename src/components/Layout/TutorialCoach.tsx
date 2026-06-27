/**
 * TutorialCoach — the guided "build a whole house" walkthrough. A persistent
 * card (portaled to <body> so the 3D canvas can't bury it) that shows the
 * current step, ticks it off when its goal is met, and auto-advances. The user
 * can step Back/Skip or Exit at any time. The script + goals live in the pure
 * tutorial module; this is just the shell that feeds it live store context.
 */
import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useAppStore } from '../../store/useAppStore'
import { useFloorplanLocalStore } from '../../store/useFloorplanLocalStore'
import { TUTORIAL_STEPS, tutorialAdvance, clampStep, type TutorialContext } from '../../services/tutorial'

export default function TutorialCoach() {
  const active = useFloorplanLocalStore((s) => s.tutorialActive)
  const rawStep = useFloorplanLocalStore((s) => s.tutorialStep)
  const setStep = useFloorplanLocalStore((s) => s.setTutorialStep)
  const exit = useFloorplanLocalStore((s) => s.exitTutorial)
  const calibrationHandledIds = useFloorplanLocalStore((s) => s.calibrationHandledIds)

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

  // Auto-advance only steps the user actually COMPLETES during the tutorial.
  // Steps already satisfied on arrival (e.g. plan + scale on a preset) are held
  // so the user can read them and tap Next — otherwise the intro flips past too
  // fast to follow. arrivalDone remembers each step's goal-state when first seen.
  const arrivalDone = useRef<Record<number, boolean>>({})
  useEffect(() => {
    if (!active) return
    if (!(step in arrivalDone.current)) arrivalDone.current[step] = done
    if (arrivalDone.current[step] || nextIndex === null) return
    const t = setTimeout(() => setStep(nextIndex), 900)
    return () => clearTimeout(t)
  }, [active, step, done, nextIndex, setStep])

  // Reset the arrival memory whenever the tutorial (re)starts.
  useEffect(() => {
    if (!active) arrivalDone.current = {}
  }, [active])

  if (!active) return null

  const current = TUTORIAL_STEPS[step]
  const total = TUTORIAL_STEPS.length
  const isLast = step >= total - 1

  return createPortal(
    <div
      style={{
        position: 'fixed', top: 12, left: '50%', transform: 'translateX(-50%)',
        zIndex: 70, width: 'min(460px, calc(100vw - 24px))',
        background: 'rgba(11,17,32,0.97)', color: '#e5e7eb',
        border: '1px solid rgba(96,165,250,0.45)', borderRadius: 12,
        boxShadow: '0 10px 34px rgba(0,0,0,0.55)', padding: '12px 14px',
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

      {/* Progress rail. */}
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
            {done ? 'Next →' : 'Skip →'}
          </button>
        )}
      </div>
    </div>,
    document.body,
  )
}
