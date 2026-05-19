import { useState, useRef, useCallback, useEffect } from 'react'
import { useAppStore } from '../../store/useAppStore'
import {
  wizardGroups,
  getStepsInGroup,
  getGroupProgress,
  getOverallProgress,
} from '../../wizard/wizardGroups'
import {
  createInitialWizardState,
  getCurrentStep,
  isLastStepInGroup,
  isFirstStep,
  isLastGroup,
  goNext,
  goBack,
} from '../../wizard/wizardState'
import type { WizardStep } from '../../services/wizardFlow'
import styles from './Wizard.module.css'

export default function Wizard() {
  const wizardOpen = useAppStore((s) => s.wizardOpen)
  const wizardAnswers = useAppStore((s) => s.wizardAnswers)
  const setWizardAnswer = useAppStore((s) => s.setWizardAnswer)
  const setWizardOpen = useAppStore((s) => s.setWizardOpen)
  const updateModelFromWizard = useAppStore((s) => s.updateModelFromWizard)

  const [nav, setNav] = useState(createInitialWizardState)
  const [validationErrors, setValidationErrors] = useState<string[]>([])

  const currentStep = getCurrentStep(nav)
  const group = wizardGroups[nav.currentGroupIndex]
  const groupSteps = getStepsInGroup(group)
  const overallProgress = getOverallProgress(wizardAnswers)

  // ─── Dragging ───
  const [position, setPosition] = useState(() => {
    const x = Math.max(20, window.innerWidth - 520)
    const y = 60
    return { x, y }
  })
  const dragRef = useRef<{ startX: number; startY: number; elX: number; elY: number; dragging: boolean }>({
    startX: 0, startY: 0, elX: 0, elY: 0, dragging: false,
  })
  const panelRef = useRef<HTMLDivElement>(null)

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const el = panelRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      elX: rect.left,
      elY: rect.top,
      dragging: true,
    }
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }, [])

  const onMouseMove = useCallback((e: MouseEvent) => {
    const d = dragRef.current
    if (!d.dragging) return
    const dx = e.clientX - d.startX
    const dy = e.clientY - d.startY
    const panel = panelRef.current
    if (!panel) return
    const pw = panel.offsetWidth
    const ph = panel.offsetHeight
    const mw = window.innerWidth
    const mh = window.innerHeight
    const nx = Math.max(0, Math.min(d.elX + dx, mw - pw))
    const ny = Math.max(0, Math.min(d.elY + dy, mh - ph))
    setPosition({ x: nx, y: ny })
  }, [])

  const onMouseUp = useCallback(() => {
    dragRef.current.dragging = false
    document.removeEventListener('mousemove', onMouseMove)
    document.removeEventListener('mouseup', onMouseUp)
  }, [onMouseMove])

  useEffect(() => {
    return () => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }
  }, [onMouseMove])

  // ─── Handlers ───
  const handleAnswer = (qId: string, value: string | boolean) => {
    setWizardAnswer(qId, value)
    setValidationErrors([])
  }

  const handleNext = () => {
    if (!currentStep) return
    const missing = currentStep.subQuestions
      .filter((sq) => wizardAnswers[sq.id] === undefined)
      .map((sq) => sq.label)
    if (missing.length > 0) {
      setValidationErrors(missing)
      return
    }
    setValidationErrors([])

    const wasLastInGroup = isLastStepInGroup(nav)
    setNav(goNext(nav))

    if (wasLastInGroup) {
      updateModelFromWizard()
    }
  }

  const handleBack = () => {
    setValidationErrors([])
    setNav(goBack(nav))
  }

  const handleFinish = () => {
    if (!currentStep) return
    const missing = currentStep.subQuestions
      .filter((sq) => wizardAnswers[sq.id] === undefined)
      .map((sq) => sq.label)
    if (missing.length > 0) {
      setValidationErrors(missing)
      return
    }
    updateModelFromWizard()
  }

  const handleJumpToStep = (stepIdx: number) => {
    setNav((prev) => ({ ...prev, currentStepIndexInGroup: stepIdx }))
    setValidationErrors([])
  }

  const handleJumpToGroup = (groupIdx: number) => {
    setNav({ currentGroupIndex: groupIdx, currentStepIndexInGroup: 0 })
    setValidationErrors([])
  }

  const getStepState = (step: WizardStep) => {
    const answered = step.subQuestions.filter((sq) => wizardAnswers[sq.id] !== undefined).length
    return {
      total: step.subQuestions.length,
      answered,
      done: answered === step.subQuestions.length && step.subQuestions.length > 0,
    }
  }

  if (!wizardOpen) return null

  return (
    <div
      ref={panelRef}
      className={styles.overlay}
      style={{ left: position.x, top: position.y }}
    >
      {/* Title bar */}
      <div className={styles.titleBar} onMouseDown={onMouseDown}>
        <span className={styles.titleText}>
          <span>{group.icon}</span>
          <span>{group.title}</span>
        </span>
        <div className={styles.titleActions}>
          <button className={styles.closeBtn} onClick={() => setWizardOpen(false)} title="Close wizard">✕</button>
        </div>
      </div>

      {/* Group tabs */}
      <div className={styles.groupNav}>
        {wizardGroups.map((g, i) => {
          const isActive = i === nav.currentGroupIndex
          const progress = getGroupProgress(wizardAnswers, g)
          return (
            <button
              key={g.id}
              className={`${styles.groupNavItem} ${isActive ? styles.groupNavActive : ''} ${progress.done ? styles.groupNavDone : ''}`}
              onClick={() => handleJumpToGroup(i)}
              title={g.description}
            >
              <span className={styles.groupNavIcon}>{g.icon}</span>
              <span className={styles.groupNavTitle}>{g.title}</span>
              {progress.done && <span className={styles.groupNavCheck}>✓</span>}
            </button>
          )
        })}
      </div>

      {/* Progress bar */}
      <div className={styles.progressRow}>
        <div className={styles.progressTrack}>
          <div className={styles.progressFill} style={{ width: `${overallProgress.pct}%` }} />
        </div>
        <span className={styles.progressLabel}>{overallProgress.pct}%</span>
      </div>

      {/* Step nav within current group */}
      <div className={styles.stepNav}>
        {groupSteps.map((step, i) => {
          const state = getStepState(step)
          const isActive = i === nav.currentStepIndexInGroup
          return (
            <button
              key={step.id}
              className={`${styles.stepNavItem} ${isActive ? styles.stepNavActive : ''} ${state.done ? styles.stepNavDone : ''}`}
              onClick={() => handleJumpToStep(i)}
              title={step.question}
            >
              <span className={styles.stepNavIcon}>{step.icon}</span>
              {state.done && <span className={styles.stepNavCheck}>✓</span>}
            </button>
          )
        })}
      </div>

      {/* Question area */}
      <div className={styles.body}>
        <div className={styles.qMeta}>
          Group {nav.currentGroupIndex + 1}/{wizardGroups.length}
          <span className={styles.qStepLabel}>
            {' '}· Step {nav.currentStepIndexInGroup + 1}/{groupSteps.length}
          </span>
        </div>

        {currentStep && currentStep.subQuestions.map((sq) => (
          <div key={sq.id} className={styles.questionCard}>
            <div className={styles.qHeader}>
              <label className={styles.qLabel}>{sq.label}</label>
              {sq.hint && <p className={styles.qHint}>{sq.hint}</p>}
            </div>
            <div className={styles.qControls}>
              {sq.type === 'boolean' && (
                <div className={styles.toggleGroup}>
                  <button
                    className={`${styles.toggleBtn} ${wizardAnswers[sq.id] === 'true' ? styles.toggleOn : ''}`}
                    onClick={() => handleAnswer(sq.id, 'true')}
                  >Yes</button>
                  <button
                    className={`${styles.toggleBtn} ${wizardAnswers[sq.id] === 'false' ? styles.toggleOff : ''}`}
                    onClick={() => handleAnswer(sq.id, 'false')}
                  >No</button>
                  {wizardAnswers[sq.id] !== undefined && (
                    <button className={styles.clearBtn} onClick={() => setWizardAnswer(sq.id, '')}>Clear</button>
                  )}
                </div>
              )}
              {sq.type === 'select' && sq.options && (
                <div className={styles.optionsGroup}>
                  {sq.options.map((opt) => {
                    const isActive = wizardAnswers[sq.id] === opt.value
                    return (
                      <button
                        key={opt.value}
                        className={`${styles.optionBtn} ${isActive ? styles.optionActive : ''}`}
                        onClick={() => handleAnswer(sq.id, opt.value)}
                      >
                        {opt.label}
                      </button>
                    )
                  })}
                </div>
              )}
              {sq.type === 'number' && (
                <div className={styles.numberRow}>
                  <input
                    className={styles.numberInput}
                    type="number"
                    min={0}
                    value={wizardAnswers[sq.id] !== undefined ? String(wizardAnswers[sq.id]) : ''}
                    placeholder={sq.defaultValue !== undefined ? String(sq.defaultValue) : ''}
                    onChange={(e) => handleAnswer(sq.id, e.target.value)}
                  />
                  <span className={styles.numberUnit}>inches</span>
                </div>
              )}
            </div>
          </div>
        ))}

        {validationErrors.length > 0 && (
          <div className={styles.validationError}>
            Please answer the following before continuing:
            <ul>
              {validationErrors.map((label) => (
                <li key={label}>{label}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className={styles.footer}>
        <button className={styles.footBtn} onClick={handleBack} disabled={isFirstStep(nav)}>
          ← Back
        </button>
        <div className={styles.footerRight}>
          {isLastGroup(nav) && isLastStepInGroup(nav) ? (
            <button className={styles.buildBtn} onClick={handleFinish}>
              Finish & Build 3D Model
            </button>
          ) : (
            <button className={styles.nextBtn} onClick={handleNext}>
              Next →
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
