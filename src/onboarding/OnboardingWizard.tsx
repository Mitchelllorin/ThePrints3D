import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAppStore } from '../store/useAppStore'
import DrawingUploader from '../components/Upload/DrawingUploader'
import { inferProjectMeta } from './inference'
import { loadWizardState, mergeMeta, saveWizardState } from './storage'
import {
  DEFAULT_WIZARD_STATE,
  type BuildingType,
  type DrywallConfig,
  type FramingMaterial,
  type OnboardingWizardState,
  type ProjectMeta,
  type WizardStep,
} from './types'
import styles from './OnboardingWizard.module.css'

export default function OnboardingWizard() {
  const drawings = useAppStore((s) => s.drawings)
  const setView = useAppStore((s) => s.setView)

  const [state, setStateRaw] = useState<OnboardingWizardState>(() => loadWizardState())

  const setState = useCallback((updater: (s: OnboardingWizardState) => OnboardingWizardState) => {
    setStateRaw((prev) => {
      const next = updater(prev)
      saveWizardState(next)
      return next
    })
  }, [])

  const setStep = useCallback((step: WizardStep) => setState((s) => ({ ...s, step })), [setState])
  const setMeta = useCallback(
    (patch: Partial<ProjectMeta>) => setState((s) => ({ ...s, meta: mergeMeta(s.meta, patch) })),
    [setState],
  )

  useEffect(() => {
    if (state.step !== 'upload' || drawings.length === 0) return
    // Defer the state update one tick so we don't synchronously update React
    // state inside the effect body (eslint react-hooks/no-sync-in-effect).
    const handle = setTimeout(() => {
      const inference = inferProjectMeta(drawings)
      setState((s) => ({
        ...s,
        lastInference: inference,
        meta: mergeMeta(s.meta, inference.detected),
        step: 'confirm',
      }))
    }, 0)
    return () => clearTimeout(handle)
  }, [drawings, state.step, setState])

  const handleSkip = useCallback(() => {
    setState((s) => ({ ...s, skipped: true, step: 'done' }))
    if (drawings.length > 0) setView('drawings')
  }, [setState, setView, drawings.length])

  const handleStartOver = useCallback(() => {
    setState(() => ({ ...DEFAULT_WIZARD_STATE }))
    setView('upload')
  }, [setState, setView])

  const handleConfirmDetection = useCallback(() => setStep('framing'), [setStep])
  const handleConfirmFraming = useCallback(() => {
    setStep('done')
    setView('drawings')
  }, [setStep, setView])

  if (state.skipped || state.step === 'done') return null

  return (
    <div className={styles.wrap} data-testid="onboarding-wizard">
      <StepIndicator step={state.step} />

      {state.step === 'upload' && (
        <UploadStep onSkip={handleSkip} />
      )}

      {state.step === 'confirm' && state.lastInference && (
        <ConfirmStep
          inference={state.lastInference}
          meta={state.meta}
          onConfirm={handleConfirmDetection}
          onEditUnits={(u) => setMeta({ unitSystem: u })}
          onEditBuilding={(b) => setMeta({ buildingType: b })}
          onBack={() => setStep('upload')}
          onSkip={handleSkip}
        />
      )}

      {state.step === 'framing' && (
        <FramingStep
          meta={state.meta}
          onChange={setMeta}
          onContinue={handleConfirmFraming}
          onBack={() => setStep('confirm')}
          onSkip={handleSkip}
        />
      )}

      {state.skipped && (
        <button className={styles.startOver} data-testid="restart-wizard-btn" onClick={handleStartOver}>
          Start the setup wizard
        </button>
      )}
    </div>
  )
}

function StepIndicator({ step }: { step: WizardStep }) {
  const steps: { id: WizardStep; label: string }[] = [
    { id: 'upload', label: '1 · Drop prints' },
    { id: 'confirm', label: '2 · Confirm' },
    { id: 'framing', label: '3 · Framing' },
    { id: 'review', label: '4 · Review' },
  ]
  return (
    <div className={styles.indicator}>
      {steps.map((s) => (
        <div
          key={s.id}
          className={`${styles.indicatorItem} ${step === s.id ? styles.indicatorActive : ''}`}
          data-testid={`step-${s.id}`}
        >
          {s.label}
        </div>
      ))}
    </div>
  )
}

function UploadStep({ onSkip }: { onSkip: () => void }) {
  return (
    <div className={styles.step}>
      <DrawingUploader />
      <div className={styles.skipRow}>
        <button className={styles.skipLink} onClick={onSkip} data-testid="wizard-skip-btn">
          Skip wizard, I'll set things manually →
        </button>
      </div>
    </div>
  )
}

function ConfirmStep({
  inference, meta, onConfirm, onEditUnits, onEditBuilding, onBack, onSkip,
}: {
  inference: NonNullable<OnboardingWizardState['lastInference']>
  meta: ProjectMeta
  onConfirm: () => void
  onEditUnits: (u: ProjectMeta['unitSystem']) => void
  onEditBuilding: (b: BuildingType) => void
  onBack: () => void
  onSkip: () => void
}) {
  const pct = Math.round(inference.confidence * 100)
  const buildings: { id: BuildingType; label: string }[] = useMemo(() => [
    { id: 'residential-single', label: 'House' },
    { id: 'residential-multi', label: 'Multi-unit' },
    { id: 'commercial', label: 'Commercial' },
    { id: 'industrial', label: 'Industrial' },
    { id: 'institutional', label: 'Institutional' },
  ], [])
  return (
    <div className={styles.step}>
      <h2 className={styles.title}>Here's what we found</h2>
      <p className={styles.subtitle}>Confidence: <strong>{pct}%</strong></p>

      <div className={styles.summary} data-testid="sheet-summary">
        <div className={styles.summaryRow}>
          <span>📄 Sheets</span>
          <span>
            <strong>{inference.sheetSummary.total}</strong> total ·{' '}
            {inference.sheetSummary.architectural} architectural ·{' '}
            {inference.sheetSummary.structural} structural ·{' '}
            {inference.sheetSummary.skipped} skipped
          </span>
        </div>
        {inference.detected.floorCount !== null && inference.detected.floorCount !== undefined && (
          <div className={styles.summaryRow}>
            <span>🏢 Floors</span>
            <span><strong>{inference.detected.floorCount}</strong></span>
          </div>
        )}
      </div>

      <div className={styles.tapRow}>
        <label className={styles.tapLabel}>Units</label>
        <div className={styles.tapButtons}>
          {(['metric', 'imperial', 'mixed'] as const).map((u) => (
            <button
              key={u}
              type="button"
              data-testid={`units-${u}`}
              className={`${styles.tapBtn} ${meta.unitSystem === u ? styles.tapBtnActive : ''}`}
              onClick={() => onEditUnits(u)}
            >
              {u.charAt(0).toUpperCase() + u.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.tapRow}>
        <label className={styles.tapLabel}>Building type</label>
        <div className={styles.tapButtons}>
          {buildings.map((b) => (
            <button
              key={b.id}
              type="button"
              data-testid={`building-${b.id}`}
              className={`${styles.tapBtn} ${meta.buildingType === b.id ? styles.tapBtnActive : ''}`}
              onClick={() => onEditBuilding(b.id)}
            >
              {b.label}
            </button>
          ))}
        </div>
      </div>

      {inference.reasons.length > 0 && (
        <details className={styles.reasons}>
          <summary>Why we picked these defaults</summary>
          <ul>
            {inference.reasons.map((r, i) => <li key={i}>{r}</li>)}
          </ul>
        </details>
      )}

      <div className={styles.actions}>
        <button className={styles.secondaryBtn} onClick={onBack} data-testid="confirm-back-btn">← Back</button>
        <button className={styles.primaryBtn} onClick={onConfirm} data-testid="confirm-continue-btn">
          Looks right →
        </button>
      </div>
      <button className={styles.skipLink} onClick={onSkip} data-testid="wizard-skip-btn">
        Skip wizard, I'll set things manually →
      </button>
    </div>
  )
}

function FramingStep({
  meta, onChange, onContinue, onBack, onSkip,
}: {
  meta: ProjectMeta
  onChange: (patch: Partial<ProjectMeta>) => void
  onContinue: () => void
  onBack: () => void
  onSkip: () => void
}) {
  const framings: { id: FramingMaterial; label: string; sub: string }[] = [
    { id: 'wood', label: '🪵 Wood', sub: '2x4 / 2x6 / 2x8 studs' },
    { id: 'steel', label: '🔩 Steel', sub: '1½" / 3½" / 6" studs' },
    { id: 'mixed', label: 'Mixed', sub: "I'll tag per wall" },
  ]
  const drywalls: { id: DrywallConfig; label: string; sub: string }[] = [
    { id: 'single-layer', label: 'Single layer', sub: 'Standard 5/8" Type X both sides' },
    { id: 'double-layer', label: 'Double on demising', sub: 'Fire-rated party walls' },
    { id: 'no-drywall', label: 'None', sub: 'Show raw framing' },
    { id: 'mixed', label: 'Mixed', sub: "I'll tag per wall" },
  ]
  return (
    <div className={styles.step}>
      <h2 className={styles.title}>Two quick taps</h2>

      <div className={styles.tapRow}>
        <label className={styles.tapLabel}>Framing material</label>
        <div className={styles.cardRow}>
          {framings.map((f) => (
            <button
              key={f.id}
              type="button"
              data-testid={`framing-${f.id}`}
              className={`${styles.card} ${meta.framing === f.id ? styles.cardActive : ''}`}
              onClick={() => onChange({ framing: f.id })}
            >
              <div className={styles.cardTitle}>{f.label}</div>
              <div className={styles.cardSub}>{f.sub}</div>
            </button>
          ))}
        </div>
      </div>

      <div className={styles.tapRow}>
        <label className={styles.tapLabel}>Drywall</label>
        <div className={styles.cardRow}>
          {drywalls.map((d) => (
            <button
              key={d.id}
              type="button"
              data-testid={`drywall-${d.id}`}
              className={`${styles.card} ${meta.drywall === d.id ? styles.cardActive : ''}`}
              onClick={() => onChange({ drywall: d.id })}
            >
              <div className={styles.cardTitle}>{d.label}</div>
              <div className={styles.cardSub}>{d.sub}</div>
            </button>
          ))}
        </div>
      </div>

      <div className={styles.actions}>
        <button className={styles.secondaryBtn} onClick={onBack} data-testid="framing-back-btn">← Back</button>
        <button className={styles.primaryBtn} onClick={onContinue} data-testid="framing-continue-btn">
          See my drawings →
        </button>
      </div>
      <button className={styles.skipLink} onClick={onSkip} data-testid="wizard-skip-btn">
        Skip wizard, I'll set things manually →
      </button>
    </div>
  )
}
