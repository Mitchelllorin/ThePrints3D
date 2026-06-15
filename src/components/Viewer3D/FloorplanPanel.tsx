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
import { OBJECT_CATALOG, getCatalogItem } from '../../data/objectCatalog'
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
  const addUserTracedWalls = useAppStore((s) => s.addUserTracedWalls)
  const undoAction      = useAppStore((s) => s.undo)
  const canUndo         = useAppStore((s) => s.historyPast.length > 0)
  const userTraces      = useAppStore((s) => s.userTraces)
  const processWithSeeds = useAppStore((s) => s.processWithSeeds)
  const deleteUserWall  = useAppStore((s) => s.deleteUserWall)
  const placedObjects   = useAppStore((s) => s.placedObjects)
  const removePlacedObject = useAppStore((s) => s.removePlacedObject)
  const updatePlacedObject = useAppStore((s) => s.updatePlacedObject)
  const modelReady      = useAppStore((s) => s.model.status === 'ready')

  const traceMode      = useFloorplanLocalStore((s) => s.traceMode)
  const setTraceMode   = useFloorplanLocalStore((s) => s.setTraceMode)
  const traceStyle     = useFloorplanLocalStore((s) => s.traceStyle)
  const setTraceStyle  = useFloorplanLocalStore((s) => s.setTraceStyle)
  const traceStart     = useFloorplanLocalStore((s) => s.traceStart)
  const setTraceStart  = useFloorplanLocalStore((s) => s.setTraceStart)
  const calibrationA   = useFloorplanLocalStore((s) => s.calibrationA)
  const setCalibrationA = useFloorplanLocalStore((s) => s.setCalibrationA)
  const calibrationB   = useFloorplanLocalStore((s) => s.calibrationB)
  const setCalibrationB = useFloorplanLocalStore((s) => s.setCalibrationB)
  const distanceInput  = useFloorplanLocalStore((s) => s.distanceInput)
  const setDistanceInput = useFloorplanLocalStore((s) => s.setDistanceInput)
  const calibrationHandledIds = useFloorplanLocalStore((s) => s.calibrationHandledIds)
  const markCalibrationHandled = useFloorplanLocalStore((s) => s.markCalibrationHandled)
  const pendingTrace   = useFloorplanLocalStore((s) => s.pendingTraceAfterCalibration)
  const setPendingTrace = useFloorplanLocalStore((s) => s.setPendingTraceAfterCalibration)
  const pendingWalls   = useFloorplanLocalStore((s) => s.pendingWalls)
  const setPendingWalls = useFloorplanLocalStore((s) => s.setPendingWalls)
  const seedProcessing = useFloorplanLocalStore((s) => s.seedProcessing)
  const selectedWallIndex = useFloorplanLocalStore((s) => s.selectedWallIndex)
  const setSelectedWallIndex = useFloorplanLocalStore((s) => s.setSelectedWallIndex)
  const placeObjectType = useFloorplanLocalStore((s) => s.placeObjectType)
  const setPlaceObjectType = useFloorplanLocalStore((s) => s.setPlaceObjectType)
  const selectedObjectId = useFloorplanLocalStore((s) => s.selectedObjectId)
  const setSelectedObjectId = useFloorplanLocalStore((s) => s.setSelectedObjectId)

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

  // Skip / cancel both count as "handled" so the wizard doesn't re-prompt.
  const cancelCalibration = () => {
    if (drawing) markCalibrationHandled(drawing.id)
    setCalibrationA(null); setCalibrationB(null); setHoverPixel(null)
    setDistanceInput(''); setPendingTrace(false)
    updateOverlay({ calibrationMode: false }, false)
  }

  const beginTracing = () => {
    setCalibrationA(null); setCalibrationB(null); setHoverPixel(null)
    setDistanceInput(''); setPendingTrace(false)
    updateOverlay({ calibrationMode: false }, false)
    setTraceMode(true)
  }

  // Tracing always confirms the scale first — a wrong scale poisons every
  // measurement and material estimate downstream. 'parsed' means the user
  // calibrated (or the title block was read); anything weaker asks first.
  const startTracing = () => {
    if (!drawing) return
    if (drawing.scaleMmPerPx !== null && drawing.scaleConfidence === 'parsed') {
      beginTracing()
      return
    }
    setPendingTrace(true)
    startCalibration()
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
    markCalibrationHandled(drawing.id)
    updateOverlay({ scale: estimatedScale, calibrationMode: false }, false)
    setCalibrationA(null); setCalibrationB(null); setHoverPixel(null); setDistanceInput('')
    if (pendingTrace) {
      setPendingTrace(false)
      setTraceMode(true)
    }
  }

  const cancelTracing = () => { setTraceMode(false); setTraceStroke([]); setTraceStart(null); setPendingWalls(null); setHoverPixel(null) }

  const keepPendingWalls = () => {
    if (!drawing || !pendingWalls || pendingWalls.length === 0) return
    addUserTracedWalls(drawing.id, pendingWalls)
    setPendingWalls(null)
  }

  // Escape: discard pending walls → end the active run → exit trace mode.
  // Enter keeps the pending walls.
  useEffect(() => {
    if (!traceMode) return
    const onKey = (e: KeyboardEvent) => {
      const local = useFloorplanLocalStore.getState()
      if (e.key === 'Enter' && local.pendingWalls) {
        e.preventDefault()
        keepPendingWalls()
        return
      }
      if (e.key !== 'Escape') return
      if (local.pendingWalls) local.setPendingWalls(null)
      else if (local.traceStart) local.setTraceStart(null)
      else cancelTracing()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [traceMode, pendingWalls, drawing?.id])

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

  // Calibration fires FIRST: the moment a ready drawing is shown and the user
  // hasn't yet calibrated or skipped it, drop straight into calibration mode —
  // tracing/building stay gated until then.
  useEffect(() => {
    if (!drawing || drawing.status !== 'ready') return
    if (calibrationHandledIds.includes(drawing.id)) return
    if (overlay.calibrationMode || traceMode) return
    startCalibration()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawing?.id, drawing?.status, calibrationHandledIds, overlay.calibrationMode, traceMode])

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
  const calibrationHandled = calibrationHandledIds.includes(drawing.id)
  // Tracing/building is reachable once calibration is set OR explicitly skipped.
  const calibrationCleared = isCalibrated || calibrationHandled
  const hasWalls     = drawing.parsedWalls.length > 0

  // ── editing (post-build): wall + object selection ───────────────────────
  const editMode = !overlay.calibrationMode && !traceMode
  const userWalls = drawing.parsedWalls.filter((w) => w.source === 'user')
  const selectedObject = placedObjects.find((o) => o.id === selectedObjectId) ?? null
  const selectedObjItem = selectedObject ? getCatalogItem(selectedObject.type) : null

  const deleteSelectedWall = () => {
    if (selectedWallIndex == null) return
    deleteUserWall(drawing.id, selectedWallIndex)
    setSelectedWallIndex(null)
    if (modelReady) buildModel()
  }

  const deleteSelectedObject = () => {
    if (!selectedObject) return
    removePlacedObject(selectedObject.id)
    setSelectedObjectId(null)
  }

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
        {!isAnalysing && !isPending && !calibrationCleared && !overlay.calibrationMode && !traceMode && (
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
                    onFocus={(e) => e.target.select()}
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
            {pendingTrace && drawing.scaleMmPerPx !== null && (
              <button className={styles.secondary} onClick={beginTracing}>
                Skip — keep detected scale
              </button>
            )}
            <button className={styles.cancel} onClick={cancelCalibration}>Cancel</button>
          </div>
        )}

        {/* ── Step 2: trace walls ── */}
        {!isAnalysing && !isPending && calibrationCleared && !overlay.calibrationMode && !traceMode && (
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
                  <button className={styles.secondary} onClick={startTracing}>
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
                <button className={styles.action} onClick={startTracing}>
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
            {pendingWalls ? (
              <>
                <span className={styles.stepText}>
                  Keep {pendingWalls.length} wall{pendingWalls.length !== 1 ? 's' : ''}?
                </span>
                <span className={styles.stepHint}>Enter to keep · Esc to discard</span>
                <div className={styles.btnRow}>
                  <button className={styles.action} onClick={keepPendingWalls}>
                    ✓ Keep
                  </button>
                  <button className={styles.secondary} onClick={() => setPendingWalls(null)}>
                    ✕ Discard
                  </button>
                </div>
              </>
            ) : (
              <>
                <span className={styles.stepText}>
                  {userWallCount > 0 ? `${userWallCount} wall${userWallCount !== 1 ? 's' : ''} traced` : 'Trace the walls on the print'}
                </span>
                <span className={styles.stepHint}>
                  {traceStyle === 'line'
                    ? traceStart
                      ? 'Tap the next corner — walls chain automatically. Esc ends the run.'
                      : 'Tap a wall corner to start, then tap the next corner'
                    : 'Draw a stroke along each wall — corners in the stroke become connected walls'}
                </span>
                <div className={styles.btnRow}>
                  <button
                    className={traceStyle === 'line' ? styles.action : styles.secondary}
                    onClick={() => setTraceStyle('line')}
                    title="Tap corner to corner with a stretchy guide line"
                  >
                    ⌖ Line
                  </button>
                  <button
                    className={traceStyle === 'freehand' ? styles.action : styles.secondary}
                    onClick={() => setTraceStyle('freehand')}
                    title="Draw freehand along each wall"
                  >
                    ✏ Freehand
                  </button>
                  {canUndo && userWallCount > 0 && (
                    <button className={styles.secondary} onClick={undoAction} title="Undo last wall (Ctrl+Z)">
                      ↶ Undo
                    </button>
                  )}
                </div>
                <div className={styles.btnRow}>
                  {userWallCount > 0 && (
                    <button className={styles.action} onClick={() => { cancelTracing(); buildModel() }}>
                      Build 3D →
                    </button>
                  )}
                  {traceStyle === 'line' && traceStart && (
                    <button className={styles.secondary} onClick={() => setTraceStart(null)}>
                      End run
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
              </>
            )}
          </div>
        )}

        {/* ── Selected wall (post-build edit) ── */}
        {editMode && selectedWallIndex != null && userWalls[selectedWallIndex] && (
          <div className={styles.step}>
            <span className={styles.stepLabel}>Wall selected</span>
            <span className={styles.stepHint}>Wall {selectedWallIndex + 1} of {userWalls.length}</span>
            <div className={styles.btnRow}>
              <button className={styles.action} onClick={deleteSelectedWall}>🗑 Delete wall</button>
              <button className={styles.secondary} onClick={() => setSelectedWallIndex(null)}>Deselect</button>
            </div>
          </div>
        )}

        {/* ── Selected object (info card + transform) ── */}
        {editMode && selectedObject && (
          <div className={styles.step}>
            <span className={styles.stepLabel}>{selectedObject.label}</span>
            {selectedObjItem && (
              <span className={styles.stepHint}>
                {(selectedObjItem.defaultW * selectedObject.scaleX).toFixed(2)} × {(selectedObjItem.defaultD * selectedObject.scaleZ).toFixed(2)} × {(selectedObjItem.defaultH * selectedObject.scaleY).toFixed(2)} m · drag to move, knob to rotate
              </span>
            )}
            <div className={styles.btnRow}>
              <button className={styles.secondary} onClick={() => updatePlacedObject(selectedObject.id, { rotationY: selectedObject.rotationY + Math.PI / 2 })}>
                ⟳ Rotate 90°
              </button>
              <button className={styles.action} onClick={deleteSelectedObject}>🗑 Delete</button>
              <button className={styles.secondary} onClick={() => setSelectedObjectId(null)}>Deselect</button>
            </div>
          </div>
        )}

        {/* ── Objects palette (place furniture/fixtures) ── */}
        {editMode && drawing.status === 'ready' && (
          <details className={styles.details}>
            <summary className={styles.detailsSummary}>Objects</summary>
            <div className={styles.detailsBody}>
              {placeObjectType ? (
                <>
                  <span className={styles.stepHint}>
                    Click on the plan to place “{getCatalogItem(placeObjectType)?.label ?? placeObjectType}”.
                  </span>
                  <button className={styles.secondary} onClick={() => setPlaceObjectType(null)}>
                    Cancel placement
                  </button>
                </>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6, maxHeight: 180, overflowY: 'auto' }}>
                  {OBJECT_CATALOG.map((item) => (
                    <button
                      key={item.type}
                      className={styles.secondary}
                      onClick={() => { setPlaceObjectType(item.type); setSelectedObjectId(null); setSelectedWallIndex(null) }}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </details>
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
