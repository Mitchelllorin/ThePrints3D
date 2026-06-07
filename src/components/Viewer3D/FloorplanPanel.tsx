/**
 * FloorplanPanel — DOM panel (renders OUTSIDE <Canvas>)
 *
 * All HTML form elements (inputs, buttons, selects) live here, safely in the
 * react-dom reconciler.  The Three.js scene content is in <FloorplanOverlay />.
 *
 * Shared state is read/written via useFloorplanLocalStore (Zustand) so both
 * the 3D and DOM parts stay in sync across the reconciler boundary.
 */

import { useRef } from 'react'
import { useAppStore } from '../../store/useAppStore'
import { useFloorplanLocalStore, type CalibrationUnit } from '../../store/useFloorplanLocalStore'
import { listPresetDefinitions } from '../../services/presetDrawings'
import styles from './ModelViewer.module.css'

const ACCEPTED_TYPES = '.pdf,.png,.jpg,.jpeg,.tif,.tiff,.webp,.svg'

function toMm(value: number, unit: CalibrationUnit): number {
  switch (unit) {
    case 'm': return value * 1000
    case 'ft': return value * 304.8
    case 'in': return value * 25.4
    default: return value
  }
}

export default function FloorplanPanel() {
  const drawings = useAppStore((s) => s.drawings)
  const overlay = useAppStore((s) => s.floorplanOverlay)
  const setOverlayDrawing = useAppStore((s) => s.setFloorplanOverlayDrawing)
  const updateOverlay = useAppStore((s) => s.updateFloorplanOverlay)
  const addDrawings = useAppStore((s) => s.addDrawings)
  const buildModel = useAppStore((s) => s.buildModel)
  const processDrawing = useAppStore((s) => s.processDrawing)
  const clearTracingForDrawing = useAppStore((s) => s.clearTracingForDrawing)
  const setDrawingScale = useAppStore((s) => s.setDrawingScale)
  const userTraces = useAppStore((s) => s.userTraces)
  const processWithSeeds = useAppStore((s) => s.processWithSeeds)
  const loadPresetDrawing = useAppStore((s) => s.loadPresetDrawing)

  const traceMode = useFloorplanLocalStore((s) => s.traceMode)
  const setTraceMode = useFloorplanLocalStore((s) => s.setTraceMode)
  const calibrationA = useFloorplanLocalStore((s) => s.calibrationA)
  const setCalibrationA = useFloorplanLocalStore((s) => s.setCalibrationA)
  const calibrationB = useFloorplanLocalStore((s) => s.calibrationB)
  const setCalibrationB = useFloorplanLocalStore((s) => s.setCalibrationB)
  const distanceInput = useFloorplanLocalStore((s) => s.distanceInput)
  const setDistanceInput = useFloorplanLocalStore((s) => s.setDistanceInput)
  const distanceUnit = useFloorplanLocalStore((s) => s.distanceUnit)
  const setDistanceUnit = useFloorplanLocalStore((s) => s.setDistanceUnit)
  const presetOpen = useFloorplanLocalStore((s) => s.presetOpen)
  const setPresetOpen = useFloorplanLocalStore((s) => s.setPresetOpen)
  const practiceMode = useFloorplanLocalStore((s) => s.practiceMode)
  const setPracticeMode = useFloorplanLocalStore((s) => s.setPracticeMode)
  const seedProcessing = useFloorplanLocalStore((s) => s.seedProcessing)
  const setSeedProcessing = useFloorplanLocalStore((s) => s.setSeedProcessing)
  const setHoverPixel = useFloorplanLocalStore((s) => s.setHoverPixel)
  const setTraceStroke = useFloorplanLocalStore((s) => s.setTraceStroke)

  const fileInputRef = useRef<HTMLInputElement>(null)

  const drawing = drawings.find((d) => d.id === overlay.drawingId) ?? drawings[0] ?? null
  const hasUsableSeedTrace = userTraces.some((trace) => trace.points.length >= 8)
  const userWallCount = drawing?.parsedWalls.filter((wall) => wall.source === 'user').length ?? 0

  const estimatedScale = (() => {
    if (!drawing) return overlay.scale
    const widthPx = drawing.rasterWidth ?? 1400
    const heightPx = drawing.rasterHeight ?? 900
    const ratio = Math.max(0.2, Math.min(5, widthPx / Math.max(1, heightPx)))
    const mmPerPx = drawing.scaleMmPerPx ?? 8
    const widthM = Math.max(2, Math.min(80, (widthPx * mmPerPx) / 1000))
    const depthM = Math.max(2, Math.min(80, widthM / ratio))
    return [widthM, depthM] as [number, number]
  })()

  const startCalibration = () => {
    setTraceMode(false)
    setTraceStroke([])
    setCalibrationA(null)
    setCalibrationB(null)
    setHoverPixel(null)
    setDistanceInput('')
    updateOverlay({ calibrationMode: true, guidedStep: 1, locked: false }, false)
  }

  const cancelCalibration = () => {
    setCalibrationA(null)
    setCalibrationB(null)
    setHoverPixel(null)
    setDistanceInput('')
    updateOverlay({ calibrationMode: false }, false)
  }

  const cancelTracing = () => {
    setTraceMode(false)
    setTraceStroke([])
    setHoverPixel(null)
  }

  const finalizeCalibration = () => {
    if (!drawing || !calibrationA || !calibrationB) return
    const realDistance = Number.parseFloat(distanceInput)
    if (!Number.isFinite(realDistance) || realDistance <= 0) return
    const realMm = toMm(realDistance, distanceUnit)
    const pxDistance = Math.hypot(calibrationB[0] - calibrationA[0], calibrationB[1] - calibrationA[1])
    if (pxDistance < 1) return
    const mmPerPx = realMm / pxDistance
    const notationRatio = Math.round((25.4 / 72) * (1 / mmPerPx))
    const notation = notationRatio > 0 ? `1:${notationRatio}` : 'custom'
    setDrawingScale(drawing.id, mmPerPx, notation)
    updateOverlay({ scale: estimatedScale, calibrationMode: false }, false)
    setCalibrationA(null)
    setCalibrationB(null)
    setHoverPixel(null)
    setDistanceInput('')
  }

  const handleUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    if (files.length > 0) addDrawings(files)
    event.target.value = ''
  }

  const handleSmartRefine = async () => {
    if (!drawing) return
    setSeedProcessing(true)
    await processWithSeeds(drawing.id)
    setSeedProcessing(false)
  }

  const clearTracingResults = () => {
    if (!drawing) return
    clearTracingForDrawing(drawing.id)
    cancelTracing()
  }

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED_TYPES}
        multiple
        style={{ display: 'none' }}
        onChange={handleUpload}
      />
      <div className={styles.floorplanPanel}>

        <div className={styles.floorplanPanelHeader}>
          <strong>3D Workspace Print Overlay</strong>
          <div className={styles.floorplanActionRow}>
            <button className={styles.floorplanBtn} onClick={() => fileInputRef.current?.click()}>
              Upload print
            </button>
            <button className={styles.floorplanBtn} onClick={() => setPresetOpen(true)}>
              Presets
            </button>
          </div>
        </div>

        {!drawing ? (
          <div className={styles.floorplanGuide}>
            <div>Start in 3D by uploading a print or loading an Easy / Medium / Hard preset directly onto the grid.</div>
            <div className={styles.floorplanGuideBtns}>
              <button className={styles.floorplanBtn} onClick={() => fileInputRef.current?.click()}>Upload</button>
              <button className={styles.floorplanBtn} onClick={() => setPresetOpen(true)}>Load preset</button>
            </div>
          </div>
        ) : (
          <>
            <div className={styles.floorplanRow}>
              <label>Print</label>
              <select
                className={styles.floorplanSelect}
                value={drawing.id}
                onChange={(e) => setOverlayDrawing(e.target.value)}
              >
                {drawings.map((item) => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
              </select>
            </div>

            <div className={styles.floorplanActionGrid}>
              <button className={styles.floorplanBtn} onClick={() => processDrawing(drawing.id)} disabled={drawing.status === 'processing'}>
                {drawing.status === 'processing' ? 'Analysing…' : 'Analyse'}
              </button>
              <button className={styles.floorplanBtn} onClick={buildModel}>
                Build 3D
              </button>
              {!traceMode ? (
                <button className={styles.floorplanBtn} onClick={() => { cancelCalibration(); setTraceMode(true) }}>
                  Start trace
                </button>
              ) : (
                <button className={styles.floorplanBtn} onClick={cancelTracing}>
                  Cancel trace
                </button>
              )}
              {!overlay.calibrationMode ? (
                <button className={styles.floorplanBtn} onClick={startCalibration}>
                  Calibrate in 3D
                </button>
              ) : (
                <button className={styles.floorplanBtn} onClick={cancelCalibration}>
                  Cancel calibration
                </button>
              )}
            </div>

            <div className={styles.floorplanRow}>
              <label>Opacity</label>
              <input
                type="range"
                min={0.1}
                max={1}
                step={0.05}
                value={overlay.opacity}
                onChange={(e) => updateOverlay({ opacity: Number(e.target.value) })}
              />
            </div>

            <div className={styles.floorplanChecks}>
              <label><input type="checkbox" checked={overlay.visible} onChange={(e) => updateOverlay({ visible: e.target.checked })} /> Visible</label>
              <label><input type="checkbox" checked={overlay.snapToGrid} onChange={(e) => updateOverlay({ snapToGrid: e.target.checked })} /> Snap to grid</label>
              <label><input type="checkbox" checked={overlay.locked} onChange={(e) => updateOverlay({ locked: e.target.checked })} /> Lock alignment</label>
            </div>

            <div className={styles.floorplanMeta}>
              <span>Position {overlay.position[0].toFixed(2)}, {overlay.position[1].toFixed(2)}</span>
              <span>Scale {overlay.scale[0].toFixed(1)}m × {overlay.scale[1].toFixed(1)}m</span>
              <span>Rotation {overlay.rotationDeg.toFixed(1)}°</span>
            </div>

            {traceMode && (
              <div className={styles.floorplanGuide}>
                <div>Trace directly on the 3D grid with your finger or mouse. Each stroke snaps to nearby wall endpoints and extrudes into a wall.</div>
                <div className={styles.floorplanGuideBtns}>
                  <button className={styles.floorplanBtn} onClick={cancelTracing}>Cancel trace</button>
                  <button className={styles.floorplanBtn} onClick={clearTracingResults} disabled={userWallCount === 0 && userTraces.length === 0}>Clear traced walls</button>
                  <button className={styles.floorplanBtn} onClick={handleSmartRefine} disabled={!hasUsableSeedTrace || seedProcessing}>
                    {seedProcessing ? 'Refining…' : 'Smart refine'}
                  </button>
                </div>
                <div>{userWallCount} traced wall{userWallCount !== 1 ? 's' : ''} · {userTraces.length} seed stroke{userTraces.length !== 1 ? 's' : ''}</div>
              </div>
            )}

            {overlay.calibrationMode && (
              <div className={styles.floorplanGuide}>
                <div>
                  Step {overlay.guidedStep}/4:{' '}
                  {overlay.guidedStep === 1 && 'Unlock and position the print over the grid.'}
                  {overlay.guidedStep === 2 && 'Tap the first and second calibration points on the print.'}
                  {overlay.guidedStep === 3 && 'Enter the real-world distance to solve scale.'}
                  {overlay.guidedStep === 4 && 'Lock the aligned print and start tracing.'}
                </div>
                <div className={styles.floorplanGuideBtns}>
                  <button className={styles.floorplanBtn} onClick={() => updateOverlay({ guidedStep: Math.max(1, overlay.guidedStep - 1) }, false)}>Back</button>
                  <button className={styles.floorplanBtn} onClick={() => updateOverlay({ guidedStep: Math.min(4, overlay.guidedStep + 1) }, false)}>Next</button>
                  <button className={styles.floorplanBtn} onClick={cancelCalibration}>Cancel</button>
                </div>
                <div className={styles.floorplanCalibrationRow}>
                  <input
                    className={styles.floorplanInput}
                    type="number"
                    min="0.001"
                    step="any"
                    placeholder="Known distance"
                    value={distanceInput}
                    onChange={(e) => setDistanceInput(e.target.value)}
                  />
                  <select
                    className={styles.floorplanSelect}
                    value={distanceUnit}
                    onChange={(e) => setDistanceUnit(e.target.value as CalibrationUnit)}
                  >
                    <option value="mm">mm</option>
                    <option value="m">m</option>
                    <option value="ft">ft</option>
                    <option value="in">in</option>
                  </select>
                  <button className={styles.floorplanBtn} onClick={finalizeCalibration} disabled={!calibrationA || !calibrationB || !distanceInput.trim()}>
                    Apply
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {presetOpen && (
        <div className={styles.floorplanModalBackdrop} onClick={() => setPresetOpen(false)}>
          <div className={styles.floorplanModal} onClick={(event) => event.stopPropagation()}>
            <div className={styles.floorplanPanelHeader}>
              <strong>Preset drawings</strong>
              <button className={styles.floorplanBtn} onClick={() => setPresetOpen(false)}>Cancel</button>
            </div>
            <div className={styles.floorplanGuide}>
              <div>Choose a preset difficulty. Practice mode loads the print ready for tracing; turning it off auto-builds the 3D walls immediately.</div>
              <label><input type="checkbox" checked={practiceMode} onChange={(e) => setPracticeMode(e.target.checked)} /> Practice mode (disable auto-build)</label>
            </div>
            <div className={styles.floorplanPresetGrid}>
              {listPresetDefinitions().map((preset) => (
                <button
                  key={preset.id}
                  className={styles.floorplanPresetCard}
                  onClick={() => {
                    loadPresetDrawing(preset.id, practiceMode)
                    setPresetOpen(false)
                  }}
                >
                  <strong>{preset.name}</strong>
                  <span>{preset.id.toUpperCase()}</span>
                  <span>{practiceMode ? 'Trace-ready overlay' : 'Auto-build 3D now'}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
