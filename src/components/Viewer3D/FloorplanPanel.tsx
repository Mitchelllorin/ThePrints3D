/**
 * AmbientWorkspaceGuide — lives in the bottom-left of the 3D viewport.
 *
 * Shows exactly one contextual prompt at a time. No panels, no headers,
 * no dense button grids — just the next action the user needs to take.
 */
import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../../store/useAppStore'
import PanelBoard from './PanelBoard'
import { useConfigStore } from '../../store/useConfigStore'
import { useFloorplanLocalStore } from '../../store/useFloorplanLocalStore'
import { convertLength, formatLengthFromMm, formatMeasureMm } from '../../services/unitConverter'
import { getCatalogItem, trayItems, electricalTrayItems, SUBTYPES } from '../../data/objectCatalog'
import {
  TRACE_LAYER_ORDER, LAYER_COLORS, LAYER_LABELS,
  PLUMBING_PICKER, ELECTRICAL_PICKER, HVAC_PICKER, FLOORS_PICKER, ROOF_PICKER, LEVEL_OPTIONS,
} from '../../data/traceLayers'
import { INTERIOR_FINISHES, EXTERIOR_CLADDINGS } from '../../services/constructionCode'
import styles from './AmbientGuide.module.css'
import EdgeDrawer from '../Layout/EdgeDrawer'
import LayersPanel from '../Layout/LayersPanel'

// ── Discipline layer tabs (Framing/Plumbing/Electrical wired; HVAC placeholder)
const TRACE_LAYERS = TRACE_LAYER_ORDER.map((key) => ({ key, label: LAYER_LABELS[key], color: LAYER_COLORS[key] }))

// ── Metric ⇄ feet/inches helpers for the property card ────────────────────────
const M_PER_IN = 0.0254
function metresToFtIn(m: number): { ft: number; in: number } {
  const totalIn = m / M_PER_IN
  const ft = Math.floor(totalIn / 12)
  return { ft, in: Math.round(totalIn - ft * 12) }
}
function ftInToMetres(ft: number, inch: number): number {
  return (ft * 12 + inch) * M_PER_IN
}

// Scale assumed before the user has calibrated, so the live estimate has
// something to show. The user confirms or overrides it during calibration.
const DEFAULT_SCALE_MM_PER_PX = 23.5

function unitPrecision(unit: string): number {
  return unit === 'mm' ? 0 : 2
}

// ── Wall-type picker options (stamped on every wall in a trace session) ───────
const FRAMING_TYPES = [
  { key: 'wood-2x4',    label: 'Wood 2×4 (3.5")',  short: 'Wood 2×4' },
  { key: 'wood-2x6',    label: 'Wood 2×6 (5.5")',  short: 'Wood 2×6' },
  { key: 'wood-2x8',    label: 'Wood 2×8 (7.5")',  short: 'Wood 2×8' },
  { key: 'steel-3-5-8', label: 'Steel 3-5/8"',      short: 'Steel 3⅝"' },
  { key: 'steel-6',     label: 'Steel 6"',          short: 'Steel 6"' },
  { key: 'cmu',         label: 'CMU Block',         short: 'CMU' },
] as const

const WALL_ROLES = [
  { key: 'exterior-bearing',     label: 'Exterior bearing',     short: 'Exterior' },
  { key: 'interior-bearing',     label: 'Interior bearing',     short: 'Int. bearing' },
  { key: 'interior-non-bearing', label: 'Interior non-bearing', short: 'Int. non-bearing' },
  { key: 'partition',            label: 'Partition',            short: 'Partition' },
] as const

const framingShort = (key: string) => FRAMING_TYPES.find((t) => t.key === key)?.short ?? key
const roleShort = (key: string) => WALL_ROLES.find((r) => r.key === key)?.short ?? key

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
  const carryWallsUp    = useAppStore((s) => s.carryWallsUp)
  const assignDrawingToLevel = useAppStore((s) => s.assignDrawingToLevel)
  const undoAction      = useAppStore((s) => s.undo)
  const canUndo         = useAppStore((s) => s.historyPast.length > 0)
  const userTraces      = useAppStore((s) => s.userTraces)
  const processWithSeeds = useAppStore((s) => s.processWithSeeds)
  const deleteUserWall  = useAppStore((s) => s.deleteUserWall)
  const updateUserWall  = useAppStore((s) => s.updateUserWall)
  const placedObjects   = useAppStore((s) => s.placedObjects)
  const removePlacedObject = useAppStore((s) => s.removePlacedObject)
  const updatePlacedObject = useAppStore((s) => s.updatePlacedObject)
  const modelReady      = useAppStore((s) => s.model.status === 'ready')

  const traceMode      = useFloorplanLocalStore((s) => s.traceMode)
  const setTraceMode   = useFloorplanLocalStore((s) => s.setTraceMode)
  const tracePaused    = useFloorplanLocalStore((s) => s.tracePaused)
  const setTracePaused = useFloorplanLocalStore((s) => s.setTracePaused)
  const offPrintWarn   = useFloorplanLocalStore((s) => s.offPrintWarn)
  const setOffPrintWarn = useFloorplanLocalStore((s) => s.setOffPrintWarn)
  const traceStyle     = useFloorplanLocalStore((s) => s.traceStyle)
  const setTraceStyle  = useFloorplanLocalStore((s) => s.setTraceStyle)
  const traceStart     = useFloorplanLocalStore((s) => s.traceStart)
  const setTraceStart  = useFloorplanLocalStore((s) => s.setTraceStart)
  const hoverPixel     = useFloorplanLocalStore((s) => s.hoverPixel)
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
  const activeWallType = useFloorplanLocalStore((s) => s.activeWallType)
  const setActiveWallType = useFloorplanLocalStore((s) => s.setActiveWallType)
  const activeWallRole = useFloorplanLocalStore((s) => s.activeWallRole)
  const setActiveWallRole = useFloorplanLocalStore((s) => s.setActiveWallRole)
  const activeTraceLayer = useFloorplanLocalStore((s) => s.activeTraceLayer)
  const setActiveTraceLayer = useFloorplanLocalStore((s) => s.setActiveTraceLayer)
  const traceBand = useFloorplanLocalStore((s) => s.traceBand)
  const setTraceBand = useFloorplanLocalStore((s) => s.setTraceBand)
  const plumbElement = useFloorplanLocalStore((s) => s.plumbElement)
  const plumbSize = useFloorplanLocalStore((s) => s.plumbSize)
  const plumbMaterial = useFloorplanLocalStore((s) => s.plumbMaterial)
  const plumbTemp = useFloorplanLocalStore((s) => s.plumbTemp)
  const setPlumb = useFloorplanLocalStore((s) => s.setPlumb)
  const selectedLine = useFloorplanLocalStore((s) => s.selectedLine)
  const removePlumbingLine = useAppStore((s) => s.removePlumbingLine)
  const removeElectricalLine = useAppStore((s) => s.removeElectricalLine)
  const removeHvacLine = useAppStore((s) => s.removeHvacLine)
  const floorsAreas = useAppStore((s) => s.floorsAreas)
  const roofAreas = useAppStore((s) => s.roofAreas)
  const hvacElement = useFloorplanLocalStore((s) => s.hvacElement)
  const hvacSize = useFloorplanLocalStore((s) => s.hvacSize)
  const hvacMaterial = useFloorplanLocalStore((s) => s.hvacMaterial)
  const setHvac = useFloorplanLocalStore((s) => s.setHvac)
  const floorsElement = useFloorplanLocalStore((s) => s.floorsElement)
  const floorsSize = useFloorplanLocalStore((s) => s.floorsSize)
  const setFloors = useFloorplanLocalStore((s) => s.setFloors)
  const roofElement = useFloorplanLocalStore((s) => s.roofElement)
  const roofSize = useFloorplanLocalStore((s) => s.roofSize)
  const setRoof = useFloorplanLocalStore((s) => s.setRoof)
  const activeLevel = useFloorplanLocalStore((s) => s.activeLevel)
  const setActiveLevel = useFloorplanLocalStore((s) => s.setActiveLevel)
  const elecElement = useFloorplanLocalStore((s) => s.elecElement)
  const elecAmp = useFloorplanLocalStore((s) => s.elecAmp)
  const elecWire = useFloorplanLocalStore((s) => s.elecWire)
  const elecRole = useFloorplanLocalStore((s) => s.elecRole)
  const setElec = useFloorplanLocalStore((s) => s.setElec)

  // The ONE active unit — calibration estimate, input, and label all read it.
  const activeUnit     = useConfigStore((s) => s.activeUnit)
  const lengthFormat   = useConfigStore((s) => s.lengthFormat)
  // Nudge step for moving a selected wall, expressed in the active unit.
  const [nudgeStep, setNudgeStep] = useState(1)
  // Storeys where the user has already answered the "different plan?" prompt, so
  // it asks once per floor instead of nagging every time you switch up.
  const [planPromptHandled, setPlanPromptHandled] = useState<number[]>([])

  // Picking a framing type ONLY arms the next trace — it no longer flips the
  // global build config. The material/size/gauge are stamped per-wall (via
  // framingType + role) and resolved at build time by wallFramingSpec, so
  // choosing steel for an interior run never re-frames the walls already traced.
  const pickFraming = (key: string) => {
    setActiveWallType(key)
  }
  const setSeedProcessing = useFloorplanLocalStore((s) => s.setSeedProcessing)
  const setHoverPixel  = useFloorplanLocalStore((s) => s.setHoverPixel)
  const setTraceStroke = useFloorplanLocalStore((s) => s.setTraceStroke)

  const fileInputRef = useRef<HTMLInputElement>(null)
  // Edge drawers replace the old click-through guide: Build (left) holds the
  // tracing workflow; Place (bottom) holds the catalog + editors.
  const buildDrawerOpen = useFloorplanLocalStore((s) => s.buildDrawerOpen)
  const placeDrawerOpen = useFloorplanLocalStore((s) => s.placeDrawerOpen)
  const setDrawerOpen = useFloorplanLocalStore((s) => s.setDrawerOpen)
  // The wall-type picker shows before tracing begins, and can be reopened
  // mid-session via the indicator chip. In the store so a canvas tap can close it.
  const pickerOpen = useFloorplanLocalStore((s) => s.activePanel === 'picker')
  const panelBoardOpen = useFloorplanLocalStore((s) => s.activePanel === 'panelBoard')
  const openPicker = useFloorplanLocalStore((s) => s.openPicker)
  const openPanelBoard = useFloorplanLocalStore((s) => s.openPanelBoard)
  const armPlaceExclusive = useFloorplanLocalStore((s) => s.armPlaceExclusive)
  const closeAllPanels = useFloorplanLocalStore((s) => s.closeAllPanels)

  const drawing = drawings.find((d) => d.id === overlay.drawingId) ?? drawings[0] ?? null
  const userWallCount = drawing?.parsedWalls.filter((w) => w.source === 'user').length ?? 0
  const hasTrace = userTraces.some((t) => t.points.length >= 8)

  // Live running length of the wall segment being traced (anchor → cursor),
  // in real-world units via the drawing's scale. Drives the on-screen readout.
  const liveTraceMm = (traceMode && traceStart && hoverPixel && drawing)
    ? Math.hypot(hoverPixel[0] - traceStart[0], hoverPixel[1] - traceStart[1]) *
      (drawing.scaleMmPerPx ?? DEFAULT_SCALE_MM_PER_PX)
    : null

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

  // Confirm the wall-type picker. Pre-trace it enters trace mode; reopened
  // mid-session it just applies the new type and returns to tracing.
  const confirmWallType = () => {
    closeAllPanels()
    if (traceMode) return
    if (activeTraceLayer === 'framing') {
      startTracing()
    } else {
      // Trade layers trace lines directly — no scale calibration gate.
      setTraceStyle('line')
      setTraceMode(true)
    }
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

  // Keyboard: Enter keeps pending walls; Escape closes ANY open panel/card/
  // picker first (one-panel rule), and only then handles trace run/exit.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const local = useFloorplanLocalStore.getState()
      if (e.key === 'Enter' && local.traceMode && local.pendingWalls) {
        e.preventDefault()
        keepPendingWalls()
        return
      }
      if (e.key !== 'Escape') return
      if (local.activePanel || local.placeObjectType) {
        local.closeAllPanels()
        return
      }
      if (local.traceMode) {
        if (local.pendingWalls) local.setPendingWalls(null)
        else if (local.traceStart) local.setTraceStart(null)
        else cancelTracing()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingWalls, drawing?.id])

  const handleSmartRefine = async () => {
    if (!drawing) return
    setSeedProcessing(true)
    await processWithSeeds(drawing.id)
    setSeedProcessing(false)
  }

  // When non-null, the next file picked is imported AS the plan for this storey
  // (set by the per-floor "Import this floor's plan" prompt). Otherwise a normal
  // upload that just joins the drawing list.
  const importLevelRef = useRef<number | null>(null)
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    if (files.length) {
      const ids = addDrawings(files)
      const lvl = importLevelRef.current
      if (lvl != null && ids[0]) {
        assignDrawingToLevel(ids[0], lvl)
        setOverlayDrawing(ids[0])
      }
    }
    importLevelRef.current = null
    e.target.value = ''
  }
  const importPlanForLevel = (level: number) => {
    importLevelRef.current = level
    fileInputRef.current?.click()
  }

  // When you move to a storey that has its OWN imported plan, show it; floors
  // without their own plan keep whatever's up (the base plan). Only switches to
  // an explicit per-level plan, so it never fights the manual drawing picker.
  useEffect(() => {
    const own = drawings.find((d) => d.floorNumber === activeLevel && d.status !== 'error')
    if (own && overlay.drawingId !== own.id) setOverlayDrawing(own.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeLevel])

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

  // Exclusive menus: while an object is selected or placement is armed, the
  // picker is render-gated out (showSteps === false), so menus never overlap.

  // The Build drawer opens when the user needs to CHOOSE or READ — calibration,
  // the type picker, or a wall/run selection. Active tracing is deliberately
  // excluded here (see the retract effect below) so the menu never sits over the
  // workspace while you tap. Edge-triggered so a drawer you closed stays shut.
  // MUST sit above the early return below so hook order is stable across renders.
  const buildCtx = overlay.calibrationMode || pickerOpen || selectedWallIndex != null || !!selectedLine
  const prevBuildCtx = useRef(false)
  useEffect(() => {
    if (buildCtx && !prevBuildCtx.current) setDrawerOpen('build', true)
    prevBuildCtx.current = buildCtx
  }, [buildCtx, setDrawerOpen])

  // Workspace-clear rule: while you're actively tracing (tapping corners on the
  // print), the Build drawer RETRACTS so the workspace is fully clear — the slim
  // floating trace bar carries the live controls then. Leaving active tracing
  // (pause, a pending-walls confirm, reopening the picker, or finishing) brings
  // the drawer back so the next choice/step is visible.
  const tracingActive = traceMode && !tracePaused && !pickerOpen && !pendingWalls
  const prevTracingActive = useRef(false)
  useEffect(() => {
    if (tracingActive !== prevTracingActive.current) {
      setDrawerOpen('build', !tracingActive)
      prevTracingActive.current = tracingActive
    }
  }, [tracingActive, setDrawerOpen])

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

  // Nudge the selected wall by a precise step (in the active unit). dx/dy are in
  // STEP units (±1); converts to pixels via the calibrated scale and shifts both
  // endpoints. The live walls follow instantly — no rebuild needed.
  const nudgeWall = (dxSteps: number, dySteps: number) => {
    if (selectedWallIndex == null || !drawing) return
    const w = userWalls[selectedWallIndex]
    if (!w) return
    const stepMm = convertLength(nudgeStep, activeUnit, 'mm')
    const pxPerStep = stepMm / (drawing.scaleMmPerPx ?? 8)
    const dx = dxSteps * pxPerStep
    const dy = dySteps * pxPerStep
    updateUserWall(drawing.id, selectedWallIndex, { x1: w.x1 + dx, y1: w.y1 + dy, x2: w.x2 + dx, y2: w.y2 + dy })
  }

  const deleteSelectedObject = () => {
    if (!selectedObject) return
    removePlacedObject(selectedObject.id)
    setSelectedObjectId(null)
  }

  // Edit-on-the-fly: delete the selected traced run (pipe / wire / duct).
  const deleteSelectedLine = () => {
    if (!selectedLine) return
    if (selectedLine.trade === 'plumbing') removePlumbingLine(selectedLine.id)
    else if (selectedLine.trade === 'electrical') removeElectricalLine(selectedLine.id)
    else removeHvacLine(selectedLine.id)
    closeAllPanels()
  }

  // Arm/disarm placement from the tray. Re-tapping the active item cancels.
  // Entering place mode closes every other menu (no overlapping UI).
  const armPlace = (type: string) => {
    // Re-tapping the armed item cancels (and brings the catalog back); otherwise
    // arm it and retract the Place drawer so the workspace is clear for the ghost.
    if (placeObjectType === type) {
      setPlaceObjectType(null)
      setDrawerOpen('place', true)
    } else {
      armPlaceExclusive(type)
      setDrawerOpen('place', false)
    }
  }

  // Set one dimension of the selected object (metres) via its scale factor.
  const setObjectDim = (axis: 'W' | 'D' | 'H', metres: number) => {
    if (!selectedObject || !selectedObjItem || !(metres > 0)) return
    const def = axis === 'W' ? selectedObjItem.defaultW : axis === 'D' ? selectedObjItem.defaultD : selectedObjItem.defaultH
    const scale = Math.max(0.05, metres / def)
    updatePlacedObject(selectedObject.id, axis === 'W' ? { scaleX: scale } : axis === 'D' ? { scaleZ: scale } : { scaleY: scale })
  }

  // While placing or with an object selected, the side guide stays clear so the
  // workspace is fully visible — the tray and property card carry the UI.
  const showSteps = !placeObjectType && !selectedObject
  const framingActive = activeTraceLayer === 'framing'
  // Which storey the next trace lands on — shown wherever you trace so walls
  // never silently build on a level you forgot you were on.
  const activeLevelLabel = LEVEL_OPTIONS.find((l) => l.value === activeLevel)?.label ?? 'Ground'
  // The storey directly below + how many user walls stand on it — drives the
  // "carry walls up" action so an upper floor can stack plumb on the one below.
  const belowLevelLabel = LEVEL_OPTIONS.find((l) => l.value === activeLevel - 1)?.label ?? 'below'
  const wallsBelowCount = drawing.parsedWalls.filter(
    (w) => w.source === 'user' && (w.level ?? 0) === activeLevel - 1,
  ).length
  // Does this storey have its own imported plan? If not (and it's an upper
  // floor), the AI asks how to handle it — upper floors often differ from below.
  const levelHasOwnPrint = drawings.some((d) => d.floorNumber === activeLevel)
  const showLevelPlanPrompt = activeLevel > 0 && !levelHasOwnPrint
    && !planPromptHandled.includes(activeLevel)
    && !overlay.calibrationMode && drawing.status === 'ready'
  const floorsActive = activeTraceLayer === 'floors'
  const roofActive = activeTraceLayer === 'roof'
  // Floors & roofs are "area" layers: pull a rectangle instead of tracing a line.
  const areaActive = floorsActive || roofActive
  // Construction order in the guided flow: floor goes in before the walls.
  const hasFloor = floorsAreas.length > 0
  const hasRoof = roofAreas.length > 0
  // Floors/roofs reuse the same trace flow as the trades (start/pause/picker/done),
  // just committing rectangles instead of lines.
  const tradeActive = activeTraceLayer === 'plumbing' || activeTraceLayer === 'electrical' || activeTraceLayer === 'hvac' || areaActive
  const layerLabel = LAYER_LABELS[activeTraceLayer]
  // Devices-first nudge: how many electrical devices are already placed. The
  // gentle prompt shows only until the first one is placed, then steps aside.
  const elecTypes = electricalTrayItems().map((i) => i.type)
  const placedElecCount = placedObjects.filter((o) => elecTypes.includes(o.type)).length
  // Compact indicator of what a trade trace will stamp.
  const tradeIndicator = activeTraceLayer === 'plumbing'
    ? `${plumbElement}${plumbElement === 'Supply Line' ? ` (${plumbTemp})` : ''} · ${plumbSize} · ${plumbMaterial}`
    : activeTraceLayer === 'electrical'
      ? `${elecElement} · ${elecAmp} · ${elecElement === 'Low Voltage' ? 'LV' : elecRole}`
      : activeTraceLayer === 'hvac'
        ? `${hvacElement} · ${hvacSize} · ${hvacMaterial}`
        : activeTraceLayer === 'floors'
          ? `${activeLevelLabel} · ${floorsElement === 'Concrete Slab' ? floorsElement : `${floorsElement} · ${floorsSize} OC`}`
          : activeTraceLayer === 'roof'
            ? `${roofElement} · ${roofSize} pitch`
            : ''
  // Object placement is part of the edit-anytime flow: the catalog is available
  // whenever a plan is loaded and you're not mid-calibration/trace (those own
  // the workspace). Not gated to post-build anymore.
  const trayVisible = !!drawing && drawing.status === 'ready'
    && !overlay.calibrationMode && !traceMode && !pickerOpen
  const objDims = selectedObject && selectedObjItem
    ? {
        W: selectedObjItem.defaultW * selectedObject.scaleX,
        D: selectedObjItem.defaultD * selectedObject.scaleZ,
        H: selectedObjItem.defaultH * selectedObject.scaleY,
      }
    : null
  const objSubtypes = selectedObject ? SUBTYPES[selectedObject.type] : undefined

  return (
    <>
      <input ref={fileInputRef} type="file" accept=".pdf,.png,.jpg,.jpeg,.tif,.tiff,.webp" multiple style={{ display: 'none' }} onChange={handleFileChange} />

      {/* Live measurement readout — running length while tracing a wall. */}
      {liveTraceMm != null && (
        <div className={styles.measureHud}>
          <span className={styles.measureHudLabel}>Length</span>
          <span className={styles.measureHudValue}>{formatMeasureMm(liveTraceMm, activeUnit, lengthFormat)}</span>
        </div>
      )}

      {/* Slim floating trace controls — shown ONLY while actively tracing, when
          the Build drawer is retracted, so the workspace stays clear. The chip
          reopens the picker (type / level), Pause frees the camera, Build builds,
          Done finishes the run. */}
      {tracingActive && showSteps && (
        <div className={styles.traceBar}>
          <button className={styles.traceBarChip} onClick={openPicker} title="Change type / level">
            <span className={styles.traceBarDot} style={{ background: LAYER_COLORS[activeTraceLayer] }} />
            {framingActive ? `${activeLevel > 0 ? `${activeLevelLabel} · ` : ''}${framingShort(activeWallType)} · ${roleShort(activeWallRole)}` : tradeIndicator}
          </button>
          <button className={styles.traceBarBtn} onClick={() => setTracePaused(true)} title="Free the camera to orbit, then resume">⏸ Pause</button>
          {((framingActive && userWallCount > 0) || (floorsActive && hasFloor) || (roofActive && hasRoof)
            || activeTraceLayer === 'plumbing' || activeTraceLayer === 'electrical' || activeTraceLayer === 'hvac') && (
            <button className={`${styles.traceBarBtn} ${styles.traceBarBuild}`} onClick={() => { cancelTracing(); buildModel() }}>Build 3D →</button>
          )}
          <button className={styles.traceBarBtn} onClick={cancelTracing} title="Finish tracing">✓ Done</button>
        </div>
      )}

      {/* Off-print nudge — a wall landed outside the plan; offer a quick undo. */}
      {offPrintWarn && (
        <div className={styles.offPrintToast}>
          <span className={styles.stepText}>Traced off the plan</span>
          <span className={styles.stepHint}>That wall landed outside the floor plan. Keep it?</span>
          <div className={styles.btnRow}>
            <button className={styles.secondary} onClick={() => setOffPrintWarn(false)}>Keep it</button>
            <button className={styles.action} onClick={() => { undoAction(); setOffPrintWarn(false) }}>Undo</button>
          </div>
        </div>
      )}

      {/* LEFT drawer — the Build workflow: calibrate → lay floor → trace walls,
          discipline tabs, the type picker, level/band selectors, and the
          selected-wall / selected-run editors. Retracts to just its tab. */}
      <EdgeDrawer
        side="left"
        title="Build"
        tabLabel="Build"
        tabIcon="✏"
        open={buildDrawerOpen}
        onToggle={() => setDrawerOpen('build', !buildDrawerOpen)}
        /* Click-through is the NARROW FALLBACK, not the default. During active
           tracing the drawer already RETRACTS (see the tracingActive effect), so
           there's nothing overlapping to tap through — retract-on-action is the
           primary mobile model. The one context where the drawer must stay open
           OVER the plan while you tap it is calibration (the step card guides you
           while you place the two scale points), so click-through is limited to
           that. Avoids the tap-ambiguity that broad click-through caused. */
        clickThrough={overlay.calibrationMode}
      >

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

        {/* ── AI: present at the moment you move up a floor. Upper storeys
              usually have their own plan, so don't silently reuse the one below
              floating up — ask. Import a plan, carry the floor below up plumb,
              or just trace this floor fresh on the lifted plane. ── */}
        {showLevelPlanPrompt && (
          <div className={styles.step}>
            <span className={styles.stepLabel}>You're on {activeLevelLabel}</span>
            <span className={styles.stepText}>Different plan for this floor?</span>
            <span className={styles.stepHint}>
              Upper floors are often laid out differently from {belowLevelLabel}. How do you
              want to build {activeLevelLabel}?
            </span>
            <div className={styles.btnRow} style={{ flexWrap: 'wrap' }}>
              <button className={styles.action} onClick={() => importPlanForLevel(activeLevel)}>
                Import this floor's plan →
              </button>
              {wallsBelowCount > 0 && (
                <button
                  className={styles.secondary}
                  onClick={() => {
                    carryWallsUp(drawing.id, activeLevel - 1)
                    updateOverlay({ printAtGround: true }, false)
                    setPlanPromptHandled((prev) => [...prev, activeLevel])
                  }}
                  title={`Stack the ${belowLevelLabel} walls straight up, plumb`}
                >
                  ⤴ Reuse {belowLevelLabel} (plumb)
                </button>
              )}
              <button
                className={styles.secondary}
                onClick={() => {
                  updateOverlay({ printAtGround: true }, false)
                  setPlanPromptHandled((prev) => [...prev, activeLevel])
                }}
              >
                Trace fresh here
              </button>
            </div>
          </div>
        )}

        {/* Compact plan controls: dismiss the print, or pin it at ground while
            you work an upper floor. Hidden during calibration (it owns the plan). */}
        {drawing.status === 'ready' && !overlay.calibrationMode && (
          <div className={styles.btnRow} style={{ flexWrap: 'wrap' }}>
            <button
              className={overlay.visible ? styles.secondary : styles.action}
              style={{ fontSize: 11, padding: '2px 8px' }}
              onClick={() => updateOverlay({ visible: !overlay.visible }, false)}
              title="Show or hide the floor-plan image"
            >
              {overlay.visible ? '🙈 Hide plan' : '👁 Show plan'}
            </button>
            {activeLevel > 0 && (
              <button
                className={overlay.printAtGround ? styles.action : styles.secondary}
                style={{ fontSize: 11, padding: '2px 8px' }}
                onClick={() => updateOverlay({ printAtGround: !overlay.printAtGround }, false)}
                title="Keep the plan image at ground level while you trace an upper floor"
              >
                {overlay.printAtGround ? '⬇ Plan at ground' : '⬆ Plan follows floor'}
              </button>
            )}
          </div>
        )}

        {/* ── Discipline layer tabs (hidden while actively tracing, but shown
              again when paused so you can switch trades mid-flow). ── */}
        {showSteps && drawing.status === 'ready' && !overlay.calibrationMode && (!traceMode || tracePaused) && (
          <div className={styles.layerTabs}>
            {TRACE_LAYERS.map((l) => (
              <button
                key={l.key}
                className={activeTraceLayer === l.key ? styles.layerTabActive : styles.layerTab}
                style={activeTraceLayer === l.key ? { borderColor: l.color, color: l.color } : undefined}
                onClick={() => { setActiveTraceLayer(l.key); closeAllPanels() }}
              >
                {l.label}
              </button>
            ))}
          </div>
        )}


        {/* Trade layers (plumbing/electrical): trace runs as coloured lines. */}
        {showSteps && tradeActive && drawing.status === 'ready' && !pickerOpen && (
          traceMode ? (
            tracePaused ? (
              <div className={styles.step}>
                <span className={styles.stepLabel}>Paused</span>
                <span className={styles.stepHint}>Orbit/pan to line up the best route — or switch trades above — then resume. Your run is kept.</span>
                <div className={styles.btnRow}>
                  <button className={styles.action} onClick={() => setTracePaused(false)}>Resume</button>
                  <button className={styles.cancel} onClick={cancelTracing}>Done</button>
                </div>
              </div>
            ) : (
            <div className={styles.step}>
              <span className={styles.stepLabel}>Tracing {layerLabel}</span>
              <button
                className={styles.secondary}
                style={{ alignSelf: 'flex-start', fontSize: 11, padding: '2px 8px', display: 'flex', alignItems: 'center', gap: 6 }}
                onClick={openPicker}
                title="Change type"
              >
                <span style={{ width: 10, height: 10, borderRadius: 5, background: LAYER_COLORS[activeTraceLayer], border: '1px solid rgba(255,255,255,0.4)' }} />
                {tradeIndicator}
              </button>
              <span className={styles.stepHint}>
                {floorsActive
                  ? 'Tap one corner, then the opposite corner to lay the joist field. Esc cancels.'
                  : roofActive
                    ? 'Tap one corner, then the opposite corner to build the gable roof. Esc cancels.'
                    : 'Tap a start point, then tap to extend. Esc ends the run.'}
              </span>
              {floorsActive && (
                <>
                  <span className={styles.stepHint}>Level — which storey this floor sits on</span>
                  <div className={styles.btnRow} style={{ flexWrap: 'wrap' }}>
                    {LEVEL_OPTIONS.map((lv) => (
                      <button key={lv.value} className={activeLevel === lv.value ? styles.action : styles.secondary} onClick={() => setActiveLevel(lv.value)}>{lv.label}</button>
                    ))}
                  </div>
                </>
              )}
              {!areaActive && (
                <>
                  <span className={styles.stepHint}>Height</span>
                  <div className={styles.btnRow} style={{ flexWrap: 'wrap' }}>
                    {(['under-floor', 'in-wall', 'ceiling'] as const).map((band) => (
                      <button key={band} className={traceBand === band ? styles.action : styles.secondary} onClick={() => setTraceBand(band)}>
                        {band === 'under-floor' ? 'Under-floor' : band === 'in-wall' ? 'In-wall' : 'Ceiling'}
                      </button>
                    ))}
                  </div>
                </>
              )}
              <div className={styles.btnRow}>
                <button className={styles.secondary} onClick={() => setTracePaused(true)} title="Free the camera to orbit, then resume">Pause / move view</button>
                {traceStart && <button className={styles.secondary} onClick={() => setTraceStart(null)}>End run</button>}
                {activeTraceLayer === 'electrical' && <button className={styles.secondary} onClick={openPanelBoard}>Panel</button>}
                {/* Make this step real — e.g. the poured slab becomes the built floor. */}
                {floorsActive && hasFloor && (
                  <button className={styles.action} onClick={() => { cancelTracing(); buildModel() }}>Build 3D →</button>
                )}
                {roofActive && hasRoof && (
                  <button className={styles.action} onClick={() => { cancelTracing(); buildModel() }}>Build 3D →</button>
                )}
                {/* Trades render live, but give the same positive "it's in" commit. */}
                {(activeTraceLayer === 'plumbing' || activeTraceLayer === 'electrical' || activeTraceLayer === 'hvac') && (
                  <button className={styles.action} onClick={() => { cancelTracing(); buildModel() }}>Build 3D →</button>
                )}
                <button className={styles.cancel} onClick={cancelTracing}>Done</button>
              </div>
            </div>
            )
          ) : (
            <div className={styles.step}>
              <span className={styles.stepLabel}>{layerLabel}</span>
              {activeTraceLayer === 'electrical' && placedElecCount === 0 ? (
                <>
                  <span className={styles.stepText}>Start with the boxes</span>
                  <span className={styles.stepHint}>
                    Tap one to place it — boxes/outlets/switches mount to the studs.
                    Then wire them together. (Optional: you can wire first.)
                  </span>
                  <div className={styles.btnRow} style={{ flexWrap: 'wrap' }}>
                    {electricalTrayItems().map((item) => (
                      <button
                        key={item.type}
                        className={placeObjectType === item.type ? styles.action : styles.secondary}
                        onClick={() => armPlace(item.type)}
                        title={item.label}
                      >
                        {item.short}
                      </button>
                    ))}
                  </div>
                </>
              ) : floorsActive ? (
                <span className={styles.stepText}>Pull a floor — tap opposite corners to lay joists</span>
              ) : roofActive ? (
                <span className={styles.stepText}>Pull a roof — tap opposite corners for a gable</span>
              ) : (
                <span className={styles.stepText}>Trace {layerLabel.toLowerCase()} runs</span>
              )}
              <span className={styles.stepHint}>{tradeIndicator}</span>
              <div className={styles.btnRow}>
                <button className={styles.action} onClick={openPicker}>Choose type →</button>
                {activeTraceLayer === 'electrical' && <button className={styles.secondary} onClick={openPanelBoard}>Panel board</button>}
              </div>
            </div>
          )
        )}

        {showSteps && framingActive && (
        <>
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
            <span className={styles.stepLabel}>Step 1 of 3</span>
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

        {/* ── Step 2: lay the floor, then Step 3: walls (real construction order) ── */}
        {!isAnalysing && !isPending && calibrationCleared && !overlay.calibrationMode && !traceMode && !pickerOpen && (
          !hasFloor ? (
            <div className={styles.step}>
              <span className={styles.stepLabel}>Step 2 of 3</span>
              <span className={styles.stepText}>Lay the floor</span>
              <span className={styles.stepHint}>Concrete slab or wood-frame floor — pull the floor area, then the walls frame on top of it.</span>
              <div className={styles.btnRow}>
                <button className={styles.action} onClick={() => { setActiveTraceLayer('floors'); openPicker() }}>
                  Lay the floor →
                </button>
                <button className={styles.secondary} onClick={openPicker}>Skip to walls</button>
              </div>
            </div>
          ) : (
            <div className={styles.step}>
              {hasWalls ? (
                <>
                  <span className={styles.stepLabel}>{userWallCount > 0 ? 'Walls' : 'Step 3 of 3'}</span>
                  <span className={styles.stepText}>
                    {userWallCount > 0
                      ? `${userWallCount} wall${userWallCount === 1 ? '' : 's'} traced`
                      : `${drawing.parsedWalls.length} walls detected`}
                  </span>
                  <span className={styles.stepHint}>
                    {userWallCount > 0 ? 'Build, or trace more' : 'Trace manually to correct, or build now'}
                  </span>
                  <div className={styles.btnRow}>
                    <button className={styles.action} onClick={() => buildModel()}>
                      Build 3D →
                    </button>
                    <button className={styles.secondary} onClick={openPicker}>
                      {userWallCount > 0 ? 'Trace more' : 'Trace walls'}
                    </button>
                    <button className={styles.secondary} onClick={startCalibration}>
                      Re-calibrate
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <span className={styles.stepLabel}>Step 3 of 3</span>
                  <span className={styles.stepText}>Trace the walls</span>
                  <span className={styles.stepHint}>Draw over each wall — they frame on top of the floor</span>
                  <button className={styles.action} onClick={openPicker}>
                    Start tracing →
                  </button>
                </>
              )}
            </div>
          )
        )}

        {/* ── Active tracing ── */}
        {traceMode && !pickerOpen && (
          <div className={styles.step}>
            <span className={styles.stepLabel}>Tracing walls</span>
            {/* Persistent indicator — shows the active type, tap to change it. */}
            <button
              className={styles.secondary}
              style={{ alignSelf: 'flex-start', fontSize: 11, padding: '2px 8px', display: 'flex', alignItems: 'center', gap: 6 }}
              onClick={openPicker}
              title="Change wall type"
            >
              <span style={{ width: 10, height: 10, borderRadius: 5, background: LAYER_COLORS[activeTraceLayer], border: '1px solid rgba(255,255,255,0.4)' }} />
              {framingShort(activeWallType)} · {roleShort(activeWallRole)}
            </button>
            <span className={styles.stepHint}>Level — which storey these walls stand on</span>
            <div className={styles.btnRow} style={{ flexWrap: 'wrap' }}>
              {LEVEL_OPTIONS.map((lv) => (
                <button key={lv.value} className={activeLevel === lv.value ? styles.action : styles.secondary} onClick={() => setActiveLevel(lv.value)}>{lv.label}</button>
              ))}
            </div>
            {/* Carry the build up: clone the storey below onto this level so it
                stands plumb on top — real construction, not stacked boxes. */}
            {activeLevel > 0 && wallsBelowCount > 0 && (
              <button
                className={styles.secondary}
                style={{ alignSelf: 'flex-start' }}
                onClick={() => carryWallsUp(drawing.id, activeLevel - 1)}
                title={`Copy the ${belowLevelLabel} walls straight up onto ${activeLevelLabel}, plumb`}
              >
                ⤴ Carry {belowLevelLabel} walls up ({wallsBelowCount})
              </button>
            )}
            {pendingWalls ? (
              <>
                <span className={styles.stepText}>
                  Keep {pendingWalls.length} wall{pendingWalls.length !== 1 ? 's' : ''}?
                </span>
                <span className={styles.stepHint}>Enter to keep · Esc to discard</span>
                <div className={styles.btnRow}>
                  <button className={styles.action} onClick={keepPendingWalls}>
                    Keep
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
                    Line
                  </button>
                  <button
                    className={traceStyle === 'freehand' ? styles.action : styles.secondary}
                    onClick={() => setTraceStyle('freehand')}
                    title="Draw freehand along each wall"
                  >
                    Freehand
                  </button>
                  {canUndo && userWallCount > 0 && (
                    <button className={styles.secondary} onClick={undoAction} title="Undo last wall (Ctrl+Z)">
                      Undo
                    </button>
                  )}
                </div>
                <div className={styles.btnRow}>
                  {userWallCount > 0 && (
                    <button className={styles.action} onClick={() => { cancelTracing(); buildModel() }}>
                      Build 3D →
                    </button>
                  )}
                  <button className={tracePaused ? styles.action : styles.secondary} onClick={() => setTracePaused(!tracePaused)} title="Free the camera to orbit, then resume — your trace is kept">
                    {tracePaused ? 'Resume' : 'Pause / move view'}
                  </button>
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

        </>
        )}

        {/* ── Pre-trace type picker (layer-aware; before tracing or reopened) ── */}
        {showSteps && pickerOpen && !overlay.calibrationMode && (
          <div className={styles.step}>
            <div className={styles.propHeader}>
              <span className={styles.stepLabel}>{layerLabel} type</span>
              <button className={styles.cardClose} onClick={() => closeAllPanels()} aria-label="Close">✕</button>
            </div>
            {framingActive && (
              <>
                <span className={styles.stepHint}>Framing</span>
                <div className={styles.btnRow} style={{ flexWrap: 'wrap' }}>
                  {FRAMING_TYPES.map((ft) => (
                    <button key={ft.key} className={activeWallType === ft.key ? styles.action : styles.secondary} onClick={() => pickFraming(ft.key)}>{ft.label}</button>
                  ))}
                </div>
                <span className={styles.stepHint}>Role</span>
                <div className={styles.btnRow} style={{ flexWrap: 'wrap' }}>
                  {WALL_ROLES.map((r) => (
                    <button key={r.key} className={activeWallRole === r.key ? styles.action : styles.secondary} onClick={() => setActiveWallRole(r.key)}>{r.label}</button>
                  ))}
                </div>
              </>
            )}
            {activeTraceLayer === 'plumbing' && (
              <>
                <span className={styles.stepHint}>Element</span>
                <div className={styles.btnRow} style={{ flexWrap: 'wrap' }}>
                  {PLUMBING_PICKER.element.map((e) => (
                    <button key={e} className={plumbElement === e ? styles.action : styles.secondary} onClick={() => setPlumb({ plumbElement: e })}>{e}</button>
                  ))}
                </div>
                {plumbElement === 'Supply Line' && (
                  <>
                    <span className={styles.stepHint}>Temperature</span>
                    <div className={styles.btnRow}>
                      <button className={plumbTemp === 'cold' ? styles.action : styles.secondary} onClick={() => setPlumb({ plumbTemp: 'cold' })}>Cold</button>
                      <button className={plumbTemp === 'hot' ? styles.action : styles.secondary} onClick={() => setPlumb({ plumbTemp: 'hot' })}>Hot</button>
                    </div>
                  </>
                )}
                <span className={styles.stepHint}>Size</span>
                <div className={styles.btnRow} style={{ flexWrap: 'wrap' }}>
                  {PLUMBING_PICKER.size.map((s) => (
                    <button key={s} className={plumbSize === s ? styles.action : styles.secondary} onClick={() => setPlumb({ plumbSize: s })}>{s}</button>
                  ))}
                </div>
                <span className={styles.stepHint}>Material</span>
                <div className={styles.btnRow} style={{ flexWrap: 'wrap' }}>
                  {PLUMBING_PICKER.material.map((m) => (
                    <button key={m} className={plumbMaterial === m ? styles.action : styles.secondary} onClick={() => setPlumb({ plumbMaterial: m })}>{m}</button>
                  ))}
                </div>
              </>
            )}
            {activeTraceLayer === 'electrical' && (
              <>
                <span className={styles.stepHint}>Element</span>
                <div className={styles.btnRow} style={{ flexWrap: 'wrap' }}>
                  {ELECTRICAL_PICKER.element.map((e) => (
                    <button key={e} className={elecElement === e ? styles.action : styles.secondary} onClick={() => setElec({ elecElement: e })}>{e}</button>
                  ))}
                </div>
                <span className={styles.stepHint}>Amperage</span>
                <div className={styles.btnRow} style={{ flexWrap: 'wrap' }}>
                  {ELECTRICAL_PICKER.size.map((s) => (
                    <button key={s} className={elecAmp === s ? styles.action : styles.secondary} onClick={() => setElec({ elecAmp: s })}>{s}</button>
                  ))}
                </div>
                <span className={styles.stepHint}>Wire</span>
                <div className={styles.btnRow} style={{ flexWrap: 'wrap' }}>
                  {ELECTRICAL_PICKER.material.map((m) => (
                    <button key={m} className={elecWire === m ? styles.action : styles.secondary} onClick={() => setElec({ elecWire: m })}>{m}</button>
                  ))}
                </div>
                {elecElement !== 'Low Voltage' && (
                  <>
                    <span className={styles.stepHint}>Wire role</span>
                    <div className={styles.btnRow} style={{ flexWrap: 'wrap' }}>
                      {ELECTRICAL_PICKER.role.map((r) => (
                        <button key={r} className={elecRole === r ? styles.action : styles.secondary} onClick={() => setElec({ elecRole: r })}>{r}</button>
                      ))}
                    </div>
                  </>
                )}
              </>
            )}
            {activeTraceLayer === 'hvac' && (
              <>
                <span className={styles.stepHint}>Element</span>
                <div className={styles.btnRow} style={{ flexWrap: 'wrap' }}>
                  {HVAC_PICKER.element.map((e) => (
                    <button key={e} className={hvacElement === e ? styles.action : styles.secondary} onClick={() => setHvac({ hvacElement: e })}>{e}</button>
                  ))}
                </div>
                <span className={styles.stepHint}>Size</span>
                <div className={styles.btnRow} style={{ flexWrap: 'wrap' }}>
                  {HVAC_PICKER.size.map((s) => (
                    <button key={s} className={hvacSize === s ? styles.action : styles.secondary} onClick={() => setHvac({ hvacSize: s })}>{s}</button>
                  ))}
                </div>
                <span className={styles.stepHint}>Material</span>
                <div className={styles.btnRow} style={{ flexWrap: 'wrap' }}>
                  {HVAC_PICKER.material.map((m) => (
                    <button key={m} className={hvacMaterial === m ? styles.action : styles.secondary} onClick={() => setHvac({ hvacMaterial: m })}>{m}</button>
                  ))}
                </div>
              </>
            )}
            {activeTraceLayer === 'floors' && (
              <>
                <span className={styles.stepHint}>Level</span>
                <div className={styles.btnRow} style={{ flexWrap: 'wrap' }}>
                  {LEVEL_OPTIONS.map((lv) => (
                    <button key={lv.value} className={activeLevel === lv.value ? styles.action : styles.secondary} onClick={() => setActiveLevel(lv.value)}>{lv.label}</button>
                  ))}
                </div>
                <span className={styles.stepHint}>Floor type</span>
                <div className={styles.btnRow} style={{ flexWrap: 'wrap' }}>
                  {FLOORS_PICKER.element.map((e) => (
                    <button key={e} className={floorsElement === e ? styles.action : styles.secondary} onClick={() => setFloors({ floorsElement: e })}>{e}</button>
                  ))}
                </div>
                {floorsElement !== 'Concrete Slab' && (
                  <>
                    <span className={styles.stepHint}>On-centre spacing</span>
                    <div className={styles.btnRow} style={{ flexWrap: 'wrap' }}>
                      {FLOORS_PICKER.size.map((s) => (
                        <button key={s} className={floorsSize === s ? styles.action : styles.secondary} onClick={() => setFloors({ floorsSize: s })}>{s}</button>
                      ))}
                    </div>
                  </>
                )}
              </>
            )}
            {activeTraceLayer === 'roof' && (
              <>
                <span className={styles.stepHint}>Roof type</span>
                <div className={styles.btnRow} style={{ flexWrap: 'wrap' }}>
                  {ROOF_PICKER.element.map((e) => (
                    <button key={e} className={roofElement === e ? styles.action : styles.secondary} onClick={() => setRoof({ roofElement: e })}>{e}</button>
                  ))}
                </div>
                <span className={styles.stepHint}>Pitch</span>
                <div className={styles.btnRow} style={{ flexWrap: 'wrap' }}>
                  {ROOF_PICKER.size.map((s) => (
                    <button key={s} className={roofSize === s ? styles.action : styles.secondary} onClick={() => setRoof({ roofSize: s })}>{s}</button>
                  ))}
                </div>
              </>
            )}
            <div className={styles.btnRow}>
              <button className={styles.action} onClick={confirmWallType}>
                {traceMode ? 'Apply' : 'Start Tracing →'}
              </button>
              <button className={styles.secondary} onClick={() => closeAllPanels()}>Cancel</button>
            </div>
          </div>
        )}

        {/* ── Selected trade run (edit-on-the-fly delete) ── */}
        {selectedLine && (
          <div className={styles.step}>
            <span className={styles.stepLabel}>{LAYER_LABELS[selectedLine.trade]} run selected</span>
            <span className={styles.stepHint}>Remove this run, or tap another to select it.</span>
            <div className={styles.btnRow}>
              <button className={styles.cancel} onClick={deleteSelectedLine}>Delete run</button>
              <button className={styles.secondary} onClick={() => closeAllPanels()}>Deselect</button>
            </div>
          </div>
        )}

        {/* ── Selected wall (post-build edit) ── */}
        {showSteps && editMode && selectedWallIndex != null && userWalls[selectedWallIndex] && (
          <div className={styles.step}>
            <span className={styles.stepLabel}>Wall selected</span>
            <span className={styles.stepHint}>Wall {selectedWallIndex + 1} of {userWalls.length}</span>
            <label className={styles.row}>
              <span className={styles.propLabel}>Interior</span>
              <select
                className={styles.select}
                value={userWalls[selectedWallIndex].interiorMaterial ?? 'drywall'}
                onChange={(e) => { updateUserWall(drawing.id, selectedWallIndex, { interiorMaterial: e.target.value }); if (modelReady) buildModel() }}
              >
                {INTERIOR_FINISHES.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
              </select>
            </label>
            <label className={styles.row}>
              <span className={styles.propLabel}>Exterior</span>
              <select
                className={styles.select}
                value={userWalls[selectedWallIndex].exteriorMaterial ?? 'stucco'}
                onChange={(e) => { updateUserWall(drawing.id, selectedWallIndex, { exteriorMaterial: e.target.value }); if (modelReady) buildModel() }}
              >
                {EXTERIOR_CLADDINGS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
              </select>
            </label>
            <label className={styles.row}>
              <span className={styles.propLabel}>See-through</span>
              <button
                className={userWalls[selectedWallIndex].transparent ? styles.action : styles.secondary}
                onClick={() => updateUserWall(drawing.id, selectedWallIndex, { transparent: !userWalls[selectedWallIndex].transparent })}
              >
                {userWalls[selectedWallIndex].transparent ? 'X-ray: on' : 'X-ray: off'}
              </button>
            </label>

            {/* Precise move — nudge the wall by an exact step, or drag it / its
                endpoints right on the print (yellow handles). */}
            <span className={styles.stepHint}>Move · step {nudgeStep} {activeUnit}</span>
            <div className={styles.btnRow}>
              {[1, 6, 12].map((s) => (
                <button
                  key={s}
                  className={nudgeStep === s ? styles.action : styles.secondary}
                  onClick={() => setNudgeStep(s)}
                >{s} {activeUnit}</button>
              ))}
            </div>
            <div className={styles.nudgeGrid}>
              <button className={styles.secondary} style={{ gridArea: 'up' }} onClick={() => nudgeWall(0, -1)} aria-label="Move up">↑</button>
              <button className={styles.secondary} style={{ gridArea: 'left' }} onClick={() => nudgeWall(-1, 0)} aria-label="Move left">←</button>
              <button className={styles.secondary} style={{ gridArea: 'right' }} onClick={() => nudgeWall(1, 0)} aria-label="Move right">→</button>
              <button className={styles.secondary} style={{ gridArea: 'down' }} onClick={() => nudgeWall(0, 1)} aria-label="Move down">↓</button>
            </div>

            <div className={styles.btnRow}>
              <button className={styles.action} onClick={deleteSelectedWall}>Delete wall</button>
              <button className={styles.secondary} onClick={() => setSelectedWallIndex(null)}>Deselect</button>
            </div>
          </div>
        )}

      </EdgeDrawer>

      {/* ── Property card for the selected placed object (above the tray) ── */}
      {selectedObject && objDims && (
        <div className={styles.propCard} style={{ bottom: trayVisible ? 76 : 16 }}>
          <div className={styles.propHeader}>
            <span className={styles.propTitle}>{selectedObject.label}</span>
            <button className={styles.cardClose} onClick={() => setSelectedObjectId(null)} aria-label="Close">✕</button>
          </div>
          {(['W', 'D', 'H'] as const).map((axis) => {
            const { ft, in: inch } = metresToFtIn(objDims[axis])
            const labelMap = { W: 'Width', D: 'Depth', H: 'Height' }
            return (
              <div key={axis} className={styles.propRow}>
                <span className={styles.propLabel}>{labelMap[axis]}</span>
                <input type="number" min={0} className={styles.dimInput} value={ft}
                  onChange={(e) => setObjectDim(axis, ftInToMetres(Number(e.target.value) || 0, inch))} />
                <span className={styles.unit}>ft</span>
                <input type="number" min={0} max={11} className={styles.dimInput} value={inch}
                  onChange={(e) => setObjectDim(axis, ftInToMetres(ft, Number(e.target.value) || 0))} />
                <span className={styles.unit}>in</span>
              </div>
            )
          })}
          {selectedObject.type === 'window' && (() => {
            const { ft, in: inch } = metresToFtIn(selectedObject.sillM ?? 0.9)
            return (
              <div className={styles.propRow}>
                <span className={styles.propLabel}>Sill height</span>
                <input type="number" min={0} className={styles.dimInput} value={ft}
                  onChange={(e) => updatePlacedObject(selectedObject.id, { sillM: ftInToMetres(Number(e.target.value) || 0, inch) })} />
                <span className={styles.unit}>ft</span>
                <input type="number" min={0} max={11} className={styles.dimInput} value={inch}
                  onChange={(e) => updatePlacedObject(selectedObject.id, { sillM: ftInToMetres(ft, Number(e.target.value) || 0) })} />
                <span className={styles.unit}>in</span>
              </div>
            )
          })()}
          {selectedObject.type === 'door' && (
            <div className={styles.propRow}>
              <span className={styles.propLabel}>Swing</span>
              <div className={styles.btnRow}>
                <button className={(selectedObject.swing ?? 'left') === 'left' ? styles.action : styles.secondary}
                  onClick={() => updatePlacedObject(selectedObject.id, { swing: 'left' })}>LH</button>
                <button className={selectedObject.swing === 'right' ? styles.action : styles.secondary}
                  onClick={() => updatePlacedObject(selectedObject.id, { swing: 'right' })}>RH</button>
              </div>
            </div>
          )}
          <div className={styles.propRow}>
            <span className={styles.propLabel}>Type</span>
            {objSubtypes ? (
              <select
                className={styles.select}
                value={selectedObject.subtype ?? objSubtypes[0]}
                onChange={(e) => updatePlacedObject(selectedObject.id, { subtype: e.target.value })}
              >
                {objSubtypes.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            ) : (
              <span className={styles.propVal}>{selectedObject.label}</span>
            )}
          </div>
          <div className={styles.propRow}>
            <span className={styles.propLabel}>Brand</span>
            <input
              type="text"
              className={styles.brandInput}
              placeholder="—"
              value={selectedObject.brand ?? ''}
              onChange={(e) => updatePlacedObject(selectedObject.id, { brand: e.target.value })}
            />
          </div>
          <div className={styles.propRow}>
            <span className={styles.propLabel}>See-through</span>
            <button
              className={selectedObject.transparent ? styles.action : styles.secondary}
              onClick={() => updatePlacedObject(selectedObject.id, { transparent: !selectedObject.transparent })}
            >
              {selectedObject.transparent ? 'X-ray: on' : 'X-ray: off'}
            </button>
          </div>
          <div className={styles.btnRow}>
            <button className={styles.secondary} onClick={() => updatePlacedObject(selectedObject.id, { rotationY: selectedObject.rotationY + Math.PI / 2 })}>
              Rotate 90°
            </button>
            <button className={styles.secondary} onClick={deleteSelectedObject}>Delete</button>
          </div>
          {/* Positive confirm — the placement is already live, but there was no
              commit affordance (you had to ✕ out). Done closes the editor;
              Build 3D re-finalises the model so the opening is cut into framing. */}
          <div className={styles.btnRow}>
            {modelReady && (
              <button className={styles.action} onClick={() => { buildModel(); setSelectedObjectId(null) }}>
                Build 3D →
              </button>
            )}
            <button className={modelReady ? styles.secondary : styles.action} onClick={() => setSelectedObjectId(null)}>
              Done ✓
            </button>
          </div>
        </div>
      )}

      {/* ── Electrical panel board (bottom-right) ── */}
      {panelBoardOpen && activeTraceLayer === 'electrical' && (
        <PanelBoard onClose={closeAllPanels} />
      )}

      {/* ── Placement bar — tap the plan to drop it (camera is locked). ── */}
      {placeObjectType && (
        <div className={styles.placeBar}>
          <span className={styles.placeHint}>
            Tap the plan to place {getCatalogItem(placeObjectType)?.label ?? placeObjectType}
          </span>
          <button className={styles.secondary} onClick={() => setPlaceObjectType(null)}>
            Cancel
          </button>
        </div>
      )}

      {/* BOTTOM drawer — Place & Layers: trade-layer visibility toggles + the
          object catalog. Retracts to just its tab so it never covers the plan. */}
      {drawing && drawing.status === 'ready' && (
        <EdgeDrawer
          side="bottom"
          title="Place & Layers"
          tabLabel="Place"
          tabIcon="▦"
          open={placeDrawerOpen}
          onToggle={() => setDrawerOpen('place', !placeDrawerOpen)}
        >
          <span className={styles.stepLabel}>Layers</span>
          <LayersPanel />
          {trayVisible && (
            <>
              <span className={styles.stepLabel}>Catalog — tap an item, then tap the plan</span>
              <div className={styles.tray}>
                {(activeTraceLayer === 'electrical' ? electricalTrayItems() : trayItems()).map((item) => (
                  <button
                    key={item.type}
                    className={placeObjectType === item.type ? styles.trayCardActive : styles.trayCard}
                    onClick={() => armPlace(item.type)}
                    title={item.label}
                  >
                    {item.short}
                  </button>
                ))}
              </div>
            </>
          )}
        </EdgeDrawer>
      )}
    </>
  )
}
