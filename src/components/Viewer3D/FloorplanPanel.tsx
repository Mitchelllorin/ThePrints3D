/**
 * AmbientWorkspaceGuide — lives in the bottom-left of the 3D viewport.
 *
 * Shows exactly one contextual prompt at a time. No panels, no headers,
 * no dense button grids — just the next action the user needs to take.
 */
import { useEffect, useRef } from 'react'
import { useAppStore } from '../../store/useAppStore'
import { useConfigStore } from '../../store/useConfigStore'
import { useFloorplanLocalStore } from '../../store/useFloorplanLocalStore'
import { convertLength, formatLengthFromMm } from '../../services/unitConverter'
import styles from './AmbientGuide.module.css'

// Scale assumed before the user has calibrated, so the live estimate has
// something to show. The user confirms or overrides it during calibration.
const DEFAULT_SCALE_MM_PER_PX = 23.5

function unitPrecision(unit: string): number {
  return unit === 'mm' ? 0 : 2
}

export default function FloorplanPanel() {
  const drawings        = useAppStore((s) => s.drawings)
  const overlay         = useAppStore((s) => s.floorplanOverlay)
  const addDrawings     = useAppStore((s) => s.addDrawings)
  const buildModel      = useAppStore((s) => s.buildModel)
  const processDrawing  = useAppStore((s) => s.processDrawing)
  const setOverlayDrawing   = useAppStore((s) => s.setFloorplanOverlayDrawing)
  const updateOverlay   = useAppStore((s) => s.updateFloorplanOverlay)
  const setDrawingScale = useAppStore((s) => s.setDrawingScale)
  const clearTracingForDrawing = useAppStore((s) => s.clearTracingForDrawing)
  const userTraces      = useAppStore((s) => s.userTraces)
  const processWithSeeds = useAppStore((s) => s.processWithSeeds)

  const traceMode      = useFloorplanLocalStore((s) => s.traceMode)
  const setTraceMode   = useFloorplanLocalStore((s) => s.setTraceMode)
  const calibrationA   = useFloorplanLocalStore((s) => s.calibrationA)
  const setCalibrationA = useFloorplanLocalStore((s) => s.setCalibrationA)
  const calibrationB   = useFloorplanLocalStore((s) => s.calibrationB)
  const setCalibrationB = useFloorplanLocalStore((s) => s.setCalibrationB)
  const distanceInput  = useFloorplanLocalStore((s) => s.distanceInput)
  const setDistanceInput = useFloorplanLocalStore((s) => s.setDistanceInput)
  const seedProcessing = useFloorplanLocalStore((s) => s.seedProcessing)

  // The ONE active unit — calibration estimate, input, and label all read it.
  const activeUnit     = useConfigStore((s) => s.activeUnit)
  const setSeedProcessing = useFloorplanLocalStore((s) => s.setSeedProcessing)
  const setHoverPixel  = useFloorplanLocalStore((s) => s.setHoverPixel)
  const setTraceStroke = useFloorplanLocalStore((s) => s.setTraceStroke)

  const fileInputRef = useRef<HTMLInputElement>(null)

  const drawing = drawings.find((d) => d.id === overlay.drawingId) ?? drawings[0] ?? null
  const userWallCount = drawing?.parsedWalls.filter((w) => w.source === 'user').length ?? 0
  const hasTrace = userTraces.some((t) => t.points.length >= 8)

  // ── derived scale estimate for finalizeCalibration ───────────────────────
  const estimatedScale = (() => {
    if (!drawing) return overlay.scale
    const widthPx  = drawing.rasterWidth  ?? 1400
    const heightPx = drawing.rasterHeight ?? 900
    const ratio    = Math.max(0.2, Math.min(5, widthPx / Math.max(1, heightPx)))
    const mmPerPx  = drawing.scaleMmPerPx ?? 8
    const widthM   = Math.max(2, Math.min(80, (widthPx * mmPerPx) / 1000))
    const depthM   = Math.max(2, Math.min(80, widthM / ratio))
    return [widthM, depthM] as [number, number]
  })()

  // ── live calibration estimate (in the active unit) ───────────────────────
  // Pixel span of the picked segment × the current scale → the app's own
  // estimated real distance, shown and pre-filled in the SAME active unit the
  // input expects. The estimate and the input can never disagree on units.
  const calibPxDist = (calibrationA && calibrationB)
    ? Math.hypot(calibrationB[0] - calibrationA[0], calibrationB[1] - calibrationA[1])
    : 0
  const currentScaleMmPerPx = drawing?.scaleMmPerPx ?? DEFAULT_SCALE_MM_PER_PX
  const estimateMm = calibPxDist * currentScaleMmPerPx
  const estimateInUnit = convertLength(estimateMm, 'mm', activeUnit)

  // Pre-fill the input with the estimate when both points are set (or the unit
  // changes), so the user can confirm with one tap or type over it to override.
  useEffect(() => {
    if (calibrationA && calibrationB) {
      setDistanceInput(estimateInUnit > 0 ? estimateInUnit.toFixed(unitPrecision(activeUnit)) : '')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calibrationA, calibrationB, activeUnit])

  // ── actions ──────────────────────────────────────────────────────────────
  const startCalibration = () => {
    setTraceMode(false); setTraceStroke([]); setCalibrationA(null)
    setCalibrationB(null); setHoverPixel(null); setDistanceInput('')
    updateOverlay({ calibrationMode: true, guidedStep: 1, locked: false }, false)
  }

  const cancelCalibration = () => {
    setCalibrationA(null); setCalibrationB(null); setHoverPixel(null)
    setDistanceInput('')
    updateOverlay({ calibrationMode: false }, false)
  }

  const finalizeCalibration = () => {
    if (!drawing || !calibrationA || !calibrationB) return
    const realDist = Number.parseFloat(distanceInput)
    if (!Number.isFinite(realDist) || realDist <= 0) return
    // Real distance is interpreted in the active unit — the same unit shown in
    // the estimate and printed on the input label. One source of truth.
    const realMm = convertLength(realDist, activeUnit, 'mm')
    const pxDist = Math.hypot(calibrationB[0] - calibrationA[0], calibrationB[1] - calibrationA[1])
    if (pxDist < 1) return
    const mmPerPx = realMm / pxDist
    const ratio   = Math.round((25.4 / 72) * (1 / mmPerPx))
    setDrawingScale(drawing.id, mmPerPx, ratio > 0 ? `1:${ratio}` : 'custom')
    updateOverlay({ scale: estimatedScale, calibrationMode: false }, false)
    setCalibrationA(null); setCalibrationB(null); setHoverPixel(null); setDistanceInput('')
  }

  const cancelTracing = () => { setTraceMode(false); setTraceStroke([]); setHoverPixel(null) }

  const handleSmartRefine = async () => {
    if (!drawing) return
    setSeedProcessing(true)
    await processWithSeeds(drawing.id)
    setSeedProcessing(false)
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    if (files.length) addDrawings(files)
    e.target.value = ''
  }

  // ── state machine ─────────────────────────────────────────────────────────
  // No drawing at all — render nothing (the drop zone in ModelViewer handles it)
  if (!drawing) return (
    <>
      <input ref={fileInputRef} type="file" accept=".pdf,.png,.jpg,.jpeg,.tif,.tiff,.webp" multiple style={{ display: 'none' }} onChange={handleFileChange} />
    </>
  )

  const isAnalysing  = drawing.status === 'processing'
  const isPending    = drawing.status === 'pending'
  const isCalibrated = drawing.scaleMmPerPx !== null && drawing.scaleConfidence !== 'fallback'
  const hasWalls     = drawing.parsedWalls.length > 0

  return (
    <>
      <input ref={fileInputRef} type="file" accept=".pdf,.png,.jpg,.jpeg,.tif,.tiff,.webp" multiple style={{ display: 'none' }} onChange={handleFileChange} />

      <div className={styles.guide}>

        {/* Drawing switcher — only shown when multiple drawings */}
        {drawings.length > 1 && !overlay.calibrationMode && !traceMode && (
          <div className={styles.row}>
            <select
              className={styles.select}
              value={drawing.id}
              onChange={(e) => setOverlayDrawing(e.target.value)}
            >
              {drawings.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>
        )}

        {/* ── Step 0: analysing ── */}
        {isAnalysing && (
          <div className={styles.hint}>
            <span className={styles.spin}>⟳</span> Reading your drawing…
          </div>
        )}

        {/* ── Step 0b: pending (shouldn't linger — auto-analyse on upload) ── */}
        {isPending && !isAnalysing && (
          <div className={styles.hint}>
            <button className={styles.action} onClick={() => processDrawing(drawing.id)}>
              Analyse drawing
            </button>
          </div>
        )}

        {/* ── Step 1: calibrate ── */}
        {!isAnalysing && !isPending && !isCalibrated && !overlay.calibrationMode && !traceMode && (
          <div className={styles.step}>
            <span className={styles.stepLabel}>Step 1 of 2</span>
            <span className={styles.stepText}>Set the scale</span>
            <span className={styles.stepHint}>Tap two points on a dimension you know the length of</span>
            <button className={styles.action} onClick={startCalibration}>
              Set scale →
            </button>
          </div>
        )}

        {/* ── Active calibration ── */}
        {overlay.calibrationMode && (
          <div className={styles.step}>
            <span className={styles.stepLabel}>Setting scale</span>
            {!calibrationA && (
              <span className={styles.stepText}>Tap point A on the print</span>
            )}
            {calibrationA && !calibrationB && (
              <span className={styles.stepText}>Now tap point B</span>
            )}
            {calibrationA && calibrationB && (
              <>
                <span className={styles.stepText}>Confirm the distance</span>
                <span className={styles.stepHint}>
                  We estimate ~{formatLengthFromMm(estimateMm, activeUnit)}. Confirm, or type the real distance.
                </span>
                <div className={styles.calibRow}>
                  <input
                    className={styles.numInput}
                    type="number"
                    min="0.001"
                    step="any"
                    placeholder={`distance in ${activeUnit}`}
                    value={distanceInput}
                    autoFocus
                    onChange={(e) => setDistanceInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') finalizeCalibration() }}
                  />
                  <span className={styles.unitLabel}>{activeUnit}</span>
                  <button className={styles.action} onClick={finalizeCalibration} disabled={!distanceInput.trim()}>
                    Apply
                  </button>
                </div>
                <span className={styles.stepHint}>Change units in Settings → Units &amp; calibration</span>
              </>
            )}
            <button className={styles.cancel} onClick={cancelCalibration}>Cancel</button>
          </div>
        )}

        {/* ── Step 2: trace walls ── */}
        {!isAnalysing && !isPending && isCalibrated && !overlay.calibrationMode && !traceMode && (
          <div className={styles.step}>
            {hasWalls ? (
              <>
                <span className={styles.stepLabel}>Step 2 of 2</span>
                <span className={styles.stepText}>{drawing.parsedWalls.length} walls detected</span>
                <span className={styles.stepHint}>Trace manually to correct, or build now</span>
                <div className={styles.btnRow}>
                  <button className={styles.action} onClick={() => buildModel()}>
                    Build 3D →
                  </button>
                  <button className={styles.secondary} onClick={() => { cancelCalibration(); setTraceMode(true) }}>
                    Trace walls
                  </button>
                  <button className={styles.secondary} onClick={startCalibration}>
                    Re-calibrate
                  </button>
                </div>
              </>
            ) : (
              <>
                <span className={styles.stepLabel}>Step 2 of 2</span>
                <span className={styles.stepText}>Trace the walls</span>
                <span className={styles.stepHint}>Draw over each wall on the floor plan</span>
                <button className={styles.action} onClick={() => { cancelCalibration(); setTraceMode(true) }}>
                  Start tracing →
                </button>
              </>
            )}
          </div>
        )}

        {/* ── Active tracing ── */}
        {traceMode && (
          <div className={styles.step}>
            <span className={styles.stepLabel}>Tracing walls</span>
            <span className={styles.stepText}>
              {userWallCount > 0 ? `${userWallCount} wall${userWallCount !== 1 ? 's' : ''} traced` : 'Draw along each wall'}
            </span>
            <div className={styles.btnRow}>
              {userWallCount > 0 && (
                <button className={styles.action} onClick={() => { cancelTracing(); buildModel() }}>
                  Build 3D →
                </button>
              )}
              {hasTrace && (
                <button className={styles.secondary} onClick={handleSmartRefine} disabled={seedProcessing}>
                  {seedProcessing ? 'Refining…' : 'Smart refine'}
                </button>
              )}
              <button className={styles.secondary} onClick={() => { clearTracingForDrawing(drawing.id); cancelTracing() }}>
                Clear
              </button>
              <button className={styles.cancel} onClick={cancelTracing}>Done</button>
            </div>
          </div>
        )}

        {/* ── Overlay fine-tuning (always accessible, collapsed by default) ── */}
        {!overlay.calibrationMode && !traceMode && drawing.status === 'ready' && (
          <details className={styles.details}>
            <summary className={styles.detailsSummary}>Overlay settings</summary>
            <div className={styles.detailsBody}>
              <label className={styles.sliderRow}>
                <span>Opacity</span>
                <input type="range" min={0.1} max={1} step={0.05} value={overlay.opacity}
                  onChange={(e) => updateOverlay({ opacity: Number(e.target.value) })} />
              </label>
              <label className={styles.checkRow}>
                <input type="checkbox" checked={overlay.visible} onChange={(e) => updateOverlay({ visible: e.target.checked })} />
                Visible
              </label>
              <label className={styles.checkRow}>
                <input type="checkbox" checked={overlay.snapToGrid} onChange={(e) => updateOverlay({ snapToGrid: e.target.checked })} />
                Snap to grid
              </label>
              <label className={styles.checkRow}>
                <input type="checkbox" checked={overlay.locked} onChange={(e) => updateOverlay({ locked: e.target.checked })} />
                Lock position
              </label>
              <button className={styles.secondary} onClick={() => fileInputRef.current?.click()}>
                Upload another print
              </button>
            </div>
          </details>
        )}
      </div>
    </>
  )
}
