/**
 * AssistantBubble — the omnipresent coach, surfaced as one small top-centre
 * bubble. Reads a context snapshot from the stores, asks the pure `assistant`
 * module what to say, and (optionally) does the next step for the user. Friendly,
 * alive, never pushy: one suggestion at a time, dismissible, and silent while the
 * user is actually working (the busy gate lives in the assistant module).
 */
import { useState } from 'react'
import { useAppStore } from '../../store/useAppStore'
import { useFloorplanLocalStore } from '../../store/useFloorplanLocalStore'
import { nextSuggestion, type AssistantActionKind, type AssistantContext } from '../../services/assistant'
import styles from './AssistantBubble.module.css'

function runAction(kind: AssistantActionKind) {
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
    case 'trace':
      fp.setActiveTraceLayer('framing'); fp.openPicker()
      break
    case 'autoBuild':
      app.buildForMe()
      break
    case 'build':
      app.buildModel()
      break
  }
}

export default function AssistantBubble() {
  const drawings = useAppStore((s) => s.drawings)
  const overlay = useAppStore((s) => s.floorplanOverlay)
  const floorsAreas = useAppStore((s) => s.floorsAreas)
  const buildResult = useAppStore((s) => s.buildResult)
  const modelStatus = useAppStore((s) => s.model.status)
  const traceMode = useFloorplanLocalStore((s) => s.traceMode)
  const tracePaused = useFloorplanLocalStore((s) => s.tracePaused)
  const activePanel = useFloorplanLocalStore((s) => s.activePanel)
  const calibrationHandledIds = useFloorplanLocalStore((s) => s.calibrationHandledIds)

  const [dismissedId, setDismissedId] = useState<string | null>(null)

  const drawing = drawings.find((d) => d.id === overlay.drawingId) ?? drawings[0] ?? null
  const isCalibrated = !!drawing && drawing.scaleMmPerPx !== null && drawing.scaleConfidence !== 'fallback'
  const calibrationHandled = !!drawing && calibrationHandledIds.includes(drawing.id)

  const ctx: AssistantContext = {
    hasPlan: !!drawing,
    status: drawing?.status ?? null,
    calibrationCleared: isCalibrated || calibrationHandled,
    calibrationMode: overlay.calibrationMode,
    hasFloor: floorsAreas.length > 0,
    hasWalls: !!drawing && drawing.parsedWalls.length > 0,
    userWallCount: drawing ? drawing.parsedWalls.filter((w) => w.source === 'user').length : 0,
    detectedScaleAvailable: !!drawing && drawing.scaleMmPerPx !== null,
    detectedWallCount: drawing ? drawing.parsedWalls.length : 0,
    built: buildResult !== null || modelStatus === 'ready',
    traceMode,
    tracePaused,
    activePanel,
  }

  const suggestion = nextSuggestion(ctx)
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
            onClick={() => runAction(suggestion.actionKind as AssistantActionKind)}
          >
            {suggestion.actionLabel}
          </button>
        )}
        <button className={styles.dismiss} onClick={() => setDismissedId(suggestion.id)} aria-label="Dismiss">✕</button>
      </div>
    </div>
  )
}
