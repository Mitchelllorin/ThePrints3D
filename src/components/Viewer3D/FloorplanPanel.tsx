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
  TRACE_LAYER_ORDER, LAYER_COLORS, LAYER_LABELS, LAYER_TRACE_HINT,
  PLUMBING_PICKER, ELECTRICAL_PICKER, HVAC_PICKER, FLOORS_PICKER, ROOF_PICKER, LEVEL_OPTIONS,
} from '../../data/traceLayers'
import { INTERIOR_FINISHES, EXTERIOR_CLADDINGS } from '../../services/constructionCode'
import {
  solveStair, stairIssues, stairOpeningM, stairShapeFromSubtype,
  MIN_TREAD_M, MIN_WIDTH_M,
} from '../../services/stairs'
import { FLOOR_ASSEMBLY_H } from '../../services/framingGeometry'
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
  { key: 'steel-1-5-8', label: 'Steel 1-5/8" (furring)', short: 'Steel 1⅝"' },
  { key: 'steel-3-5-8', label: 'Steel 3-5/8"',      short: 'Steel 3⅝"' },
  { key: 'steel-6',     label: 'Steel 6"',          short: 'Steel 6"' },
  { key: 'steel-8',     label: 'Steel 8" (heavy)',  short: 'Steel 8"' },
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
  const carryFloorUp    = useAppStore((s) => s.carryFloorUp)
  const clearFloorLevel = useAppStore((s) => s.clearFloorLevel)
  const setRoofOverhang = useAppStore((s) => s.setRoofOverhang)
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
  const clonePlacedObject = useAppStore((s) => s.clonePlacedObject)
  const modelReady      = useAppStore((s) => s.model.status === 'ready')

  const traceMode      = useFloorplanLocalStore((s) => s.traceMode)
  const setTraceMode   = useFloorplanLocalStore((s) => s.setTraceMode)
  const tracePaused    = useFloorplanLocalStore((s) => s.tracePaused)
  const setTracePaused = useFloorplanLocalStore((s) => s.setTracePaused)
  const offPrintWarn   = useFloorplanLocalStore((s) => s.offPrintWarn)
  const setOffPrintWarn = useFloorplanLocalStore((s) => s.setOffPrintWarn)
  const plumbNudge     = useFloorplanLocalStore((s) => s.plumbNudge)
  const setPlumbNudge  = useFloorplanLocalStore((s) => s.setPlumbNudge)
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
  const keepPlacing = useFloorplanLocalStore((s) => s.keepPlacing)
  const setKeepPlacing = useFloorplanLocalStore((s) => s.setKeepPlacing)
  const placeStairCfg  = useFloorplanLocalStore((s) => s.placeStairCfg)
  const setPlaceStairCfg = useFloorplanLocalStore((s) => s.setPlaceStairCfg)
  const selectedObjectId = useFloorplanLocalStore((s) => s.selectedObjectId)
  const setSelectedObjectId = useFloorplanLocalStore((s) => s.setSelectedObjectId)
  const detailExplodeId = useFloorplanLocalStore((s) => s.detailExplodeId)
  const setDetailExplodeId = useFloorplanLocalStore((s) => s.setDetailExplodeId)
  const wallDetailExplode = useFloorplanLocalStore((s) => s.wallDetailExplode)
  const setWallDetailExplode = useFloorplanLocalStore((s) => s.setWallDetailExplode)
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
  const selectedArea = useFloorplanLocalStore((s) => s.selectedArea)
  const wallTrimArmed = useFloorplanLocalStore((s) => s.wallTrimArmed)
  const setWallTrimArmed = useFloorplanLocalStore((s) => s.setWallTrimArmed)
  const editModeActive = useFloorplanLocalStore((s) => s.editMode)
  const removeRoofArea = useAppStore((s) => s.removeRoofArea)
  const removeFloorsArea = useAppStore((s) => s.removeFloorsArea)
  const addRoofAreas = useAppStore((s) => s.addRoofAreas)
  const addFloorsAreas = useAppStore((s) => s.addFloorsAreas)
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
  const roofOverhangIn = useConfigStore((s) => s.roofOverhangIn)
  // Nudge step for moving a selected wall, expressed in the active unit.
  const [nudgeStep, setNudgeStep] = useState(1)
  // Storeys the user marked "Custom" (trace/import their own) instead of the
  // default "Typical" — the floor below stacked straight up. Drives the auto-
  // stack below so an upper floor defaults to a copy of the one under it.
  const [customLevels, setCustomLevels] = useState<number[]>([])

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

  // Upper floors default to "Typical": switch to an empty storey above one that
  // has walls and the floor below stacks straight up (plumb) on its own — a 2nd
  // floor is the 1st floor over again unless you mark it Custom. Idempotent
  // (carry* dedupe by footprint) and guarded on the storey being empty, so it
  // fires once on entry and never loops.
  useEffect(() => {
    if (!drawing || activeLevel <= 0 || customLevels.includes(activeLevel)) return
    const userWalls = drawing.parsedWalls.filter((w) => w.source === 'user')
    const below = userWalls.filter((w) => (w.level ?? 0) === activeLevel - 1).length
    const here = userWalls.filter((w) => (w.level ?? 0) === activeLevel).length
    if (below === 0 || here > 0) return
    carryWallsUp(drawing.id, activeLevel - 1)
    carryFloorUp(activeLevel - 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeLevel, drawing?.id, customLevels])
  // "Find the rest" can fire as soon as one wall is traced — in either Line
  // (2-point) or Freehand mode. (Was gated on an 8+ point freehand stroke,
  // which never matched line-mode tracing.)
  const hasTrace = userWallCount >= 1 || userTraces.length >= 1

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

  const cancelTracing = () => { setTraceMode(false); setTraceStroke([]); setTraceStart(null); setPendingWalls(null); setHoverPixel(null); setPlumbNudge(null) }

  const keepPendingWalls = () => {
    if (!drawing || !pendingWalls || pendingWalls.length === 0) return
    addUserTracedWalls(drawing.id, pendingWalls)
    setPendingWalls(null)
  }

  // Enter keeps the pending walls. Escape is NOT handled here — WorkspaceLayout
  // is the single Escape owner for the whole app (see the comment there); this
  // used to be one of three competing handlers.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const local = useFloorplanLocalStore.getState()
      if (e.key === 'Enter' && local.traceMode && local.pendingWalls) {
        e.preventDefault()
        keepPendingWalls()
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
    // Already has a real scale (presets carry scaleConfidence 'parsed'; PDFs can
    // too) → calibration is pointless AND its full-workspace pointer catcher
    // would steal taps from the Takeoff pill, trace, etc. Skip straight to work.
    if (drawing.scaleMmPerPx != null && drawing.scaleConfidence !== 'fallback') return
    if (calibrationHandledIds.includes(drawing.id)) return
    if (overlay.calibrationMode || traceMode) return
    startCalibration()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawing?.id, drawing?.status, drawing?.scaleMmPerPx, drawing?.scaleConfidence, calibrationHandledIds, overlay.calibrationMode, traceMode])

  // Exclusive menus: while an object is selected or placement is armed, the
  // picker is render-gated out (showSteps === false), so menus never overlap.

  // The Build drawer opens when the user needs to CHOOSE or READ — calibration,
  // the type picker, or a wall/run selection. Active tracing is deliberately
  // excluded here (see the retract effect below) so the menu never sits over the
  // workspace while you tap. Edge-triggered so a drawer you closed stays shut.
  // MUST sit above the early return below so hook order is stable across renders.
  // Workspace-clear rule: while you're actively tracing (tapping corners on the
  // print), NO drawer may sit over the workspace — the slim floating trace bar
  // carries the live controls. This is THE happy-place invariant: an action owns
  // the workspace; menus retract and cannot pop back until the action ends.
  const tracingActive = traceMode && !tracePaused && !pickerOpen && !pendingWalls

  // What genuinely REQUIRES the Build drawer: a choice you must make (the type
  // picker) or a guided flow (calibration).
  //
  // Selecting something is NOT on this list any more. It used to be — every
  // wall/area/line pick threw the drawer open across the workspace. That was
  // survivable when selecting was occasional, but selection is now the gate for
  // dragging (you must select a thing before you can move it), so you select
  // constantly and the drawer was flying out over the model every time. The
  // workspace stays clear; the selection's controls are the gizmo rail on the
  // right edge, and its card is still in Build whenever you choose to open it.
  const buildCtx = overlay.calibrationMode || pickerOpen
  const prevBuildCtx = useRef(false)
  const prevPlaceType = useRef<string | null>(null)
  useEffect(() => {
    // Open Build's edit panel on a NEW choose/read context (select a wall/area/
    // line, or open the picker). Guards:
    //  • not while actively tracing (would pop over the print),
    //  • not while an object is armed for placement,
    //  • and NOT on the frame a placement just disarmed — clearing placeObjectType
    //    and the selection happens across two stores, so for one frame buildCtx
    //    can read stale-true while placeObjectType is already null, which popped
    //    Build open the instant you dropped an object.
    const justPlaced = prevPlaceType.current !== null && placeObjectType === null
    prevPlaceType.current = placeObjectType
    if (buildCtx && !prevBuildCtx.current && !tracingActive && !placeObjectType && !justPlaced) {
      setDrawerOpen('build', true)
    }
    prevBuildCtx.current = buildCtx
  }, [buildCtx, tracingActive, placeObjectType, setDrawerOpen])

  const prevTracingActive = useRef(false)
  useEffect(() => {
    if (tracingActive !== prevTracingActive.current) {
      // Only CLOSE Build when an action starts (keep the workspace clear). Don't
      // auto-REOPEN it when the action ends — the rail owns opening menus now, so
      // auto-reopening popped Build over whatever menu (e.g. Place) was already out.
      if (tracingActive) setDrawerOpen('build', false)
      prevTracingActive.current = tracingActive
    }
  }, [tracingActive, setDrawerOpen])

  // ARMING AN OBJECT RETRACTS THE PLACE DRAWER. Same rule tracing follows: an
  // action owns the workspace, so the menu that started it gets out of the way.
  // Without this the tray stayed open down the left AND the placement bar stacked
  // on top of it — two surfaces fighting for the same edge while you were trying
  // to see where the thing would land.
  const prevPlacing = useRef(false)
  useEffect(() => {
    const placing = placeObjectType !== null
    if (placing && !prevPlacing.current) setDrawerOpen('place', false)
    prevPlacing.current = placing
  }, [placeObjectType, setDrawerOpen])

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

  // Edit-on-the-fly for floor/roof areas: delete or clone the selected area.
  const deleteSelectedArea = () => {
    if (!selectedArea) return
    if (selectedArea.kind === 'roof') removeRoofArea(selectedArea.id)
    else removeFloorsArea(selectedArea.id)
    closeAllPanels()
  }
  const cloneSelectedArea = () => {
    if (!selectedArea) return
    const src = (selectedArea.kind === 'roof' ? roofAreas : floorsAreas).find((a) => a.id === selectedArea.id)
    if (!src) return
    const copy = { ...src, id: `${src.id}-copy-${Date.now()}`, x1: src.x1 + 24, y1: src.y1 + 24, x2: src.x2 + 24, y2: src.y2 + 24 }
    if (selectedArea.kind === 'roof') addRoofAreas([copy])
    else addFloorsAreas([copy])
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
  const wallsAtActiveLevel = drawing.parsedWalls.filter(
    (w) => w.source === 'user' && (w.level ?? 0) === activeLevel,
  ).length
  const floorMode: 'typical' | 'custom' = customLevels.includes(activeLevel) ? 'custom' : 'typical'
  const chooseTypical = () => {
    setCustomLevels((prev) => prev.filter((l) => l !== activeLevel))
    if (wallsBelowCount > 0 && wallsAtActiveLevel === 0) {
      carryWallsUp(drawing.id, activeLevel - 1)
      carryFloorUp(activeLevel - 1)
    }
  }
  const chooseCustom = () => {
    setCustomLevels((prev) => (prev.includes(activeLevel) ? prev : [...prev, activeLevel]))
    clearFloorLevel(drawing.id, activeLevel)
  }
  // Typical (default) vs Custom choice for an upper storey — Typical stacks the
  // floor below straight up; Custom wipes it so you trace/import your own. Shown
  // wherever you pick a level, so it reads the same in the Floors and Walls steps.
  const upperFloorControl = activeLevel > 0 && wallsBelowCount > 0 ? (
    <>
      <span className={styles.stepHint}>{activeLevelLabel} — how it's laid out</span>
      <div className={styles.btnRow} style={{ flexWrap: 'wrap' }}>
        <button
          className={floorMode === 'typical' ? styles.action : styles.secondary}
          onClick={chooseTypical}
          title={`Stack ${belowLevelLabel} straight up onto ${activeLevelLabel}, plumb`}
        >
          Typical · same as {belowLevelLabel}
        </button>
        <button
          className={floorMode === 'custom' ? styles.action : styles.secondary}
          onClick={chooseCustom}
          title={`Start ${activeLevelLabel} blank — trace or import its own layout`}
        >
          Custom
        </button>
      </div>
      {floorMode === 'custom' && (
        <button
          className={styles.secondary}
          style={{ alignSelf: 'flex-start' }}
          onClick={() => importPlanForLevel(activeLevel)}
          title={`Load a separate floor plan for ${activeLevelLabel} (build-outs, balconies, a different layout)`}
        >
          📄 Different plan for {activeLevelLabel}
        </button>
      )}
    </>
  ) : null
  const floorsActive = activeTraceLayer === 'floors'
  const roofActive = activeTraceLayer === 'roof'
  // Floors & roofs are "area" layers: pull a rectangle instead of tracing a line.
  const areaActive = floorsActive || roofActive
  // Construction order in the guided flow: floor goes in before the walls.
  const hasFloor = floorsAreas.length > 0
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

  // Live stair solve for the configurator. The RISE is the object's own height —
  // a stair climbs a storey, so it comes from the building rather than a field
  // somebody can set to disagree with it.
  const stairRiseM = selectedObject && selectedObject.type === 'stairs'
    ? (selectedObjItem?.defaultH ?? 2.9) * selectedObject.scaleY
    : 0
  const stairSolution = selectedObject && selectedObject.type === 'stairs'
    ? solveStair({
        totalRiseM: stairRiseM,
        shape: stairShapeFromSubtype(selectedObject.subtype),
        treadM: selectedObject.treadM,
        widthM: selectedObject.stairWidthM,
        targetRiserM: selectedObject.targetRiserM,
        landingM: selectedObject.landingM,
      })
    : null
  const stairOpening = stairSolution ? stairOpeningM(stairSolution) : { lengthM: 0, widthM: 0 }
  // Headroom under the floor above, measured from the storey rise.
  const stairProblems = stairSolution
    ? stairIssues(stairSolution, Math.max(0, stairRiseM - FLOOR_ASSEMBLY_H))
    : []


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
          the Build drawer is retracted, so the workspace stays clear. The camera
          stays free (tap a corner, drag to orbit): the chip reopens the picker
          (type / level), Done finishes tracing. To end the current wall run,
          double-tap the workspace (stops the trailing rubber-band). */}
      {tracingActive && showSteps && (
        <div className={styles.traceBar}>
          <button className={styles.traceBarChip} onClick={openPicker} title="Change type / level">
            <span className={styles.traceBarDot} style={{ background: LAYER_COLORS[activeTraceLayer] }} />
            {framingActive ? `${activeLevel > 0 ? `L${activeLevel + 1} · ` : ''}${framingShort(activeWallType)} · ${roleShort(activeWallRole)}` : tradeIndicator}
          </button>
          {/* "Find the rest" — reachable straight from the slim trace bar (it used
              to live only in the Build panel, which retracts while you trace, so
              you couldn't reach it mid-run). Shows once a framing wall is traced. */}
          {framingActive && hasTrace && (
            <button data-tour="find-rest" className={`${styles.traceBarBtn} ${styles.traceBarBuild}`} onClick={handleSmartRefine} disabled={seedProcessing} title="Detect the matching walls across the plan">
              {seedProcessing ? 'Finding…' : '✨ Find the rest'}
            </button>
          )}
          {/* No "End run" button — double-tapping the workspace ends the current
              wall run (the natural "I'm done with this line" gesture). */}
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

      {/* Plumb nudge — an upper-floor wall landed near but not over the one
          below. The app flags the drift (floors stack); the user decides. */}
      {plumbNudge && !offPrintWarn && (
        <div className={styles.offPrintToast}>
          <span className={styles.stepText}>Off the floor below</span>
          <span className={styles.stepHint}>
            This wall's about {formatLengthFromMm(plumbNudge.offMm, activeUnit)} off the one under it. Line it up?
          </span>
          <div className={styles.btnRow}>
            <button
              className={styles.action}
              onClick={() => {
                updateUserWall(plumbNudge.drawingId, plumbNudge.userIndex, plumbNudge.target)
                if (modelReady) buildModel()
                setPlumbNudge(null)
              }}
            >
              Line it up
            </button>
            <button className={styles.secondary} onClick={() => setPlumbNudge(null)}>Keep it</button>
          </div>
        </div>
      )}

      {/* LEFT drawer — the Build workflow: calibrate → lay floor → trace walls,
          discipline tabs, the type picker, level/band selectors, and the
          selected-wall / selected-run editors. Retracts to just its tab. */}
      <EdgeDrawer
        side="left"
        inRail
        title="Build"
        tabLabel="Build"
        tabIcon="✏"
        /* Hard invariant: the drawer can NEVER be open while actively tracing —
           even if some state briefly sets buildDrawerOpen, the workspace stays
           clear and the slim trace bar is the interface. */
        open={buildDrawerOpen && !tracingActive}
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
            {/* Offered whenever the print is actually lifted off the ground —
                by an upper storey OR by a roof/ceiling trace, which raises it to
                the wall top even on the ground floor. Gating on `activeLevel > 0`
                alone meant that at ground the plan could float a wall-height up
                with no control on screen to bring it back. */}
            {(activeLevel > 0 || activeTraceLayer === 'roof') && (
              <button
                className={overlay.printAtGround ? styles.action : styles.secondary}
                style={{ fontSize: 11, padding: '2px 8px' }}
                onClick={() => updateOverlay({ printAtGround: !overlay.printAtGround }, false)}
                title="Keep the plan image at ground level while you trace above it"
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
              <span className={styles.stepHint}>{LAYER_TRACE_HINT[activeTraceLayer]}</span>
              {/* The standard click model, always explained while tracing. */}
              <span className={styles.stepHint} style={{ opacity: 0.85 }}>
                👆 <b>Tap</b> to place a point · <b>drag</b> to look around · <b>double-tap</b> to finish
              </span>
              {floorsActive && (
                <>
                  <span className={styles.stepHint}>Level — which storey this floor sits on</span>
                  <div className={styles.btnRow} style={{ flexWrap: 'wrap' }}>
                    {LEVEL_OPTIONS.map((lv) => (
                      <button key={lv.value} className={activeLevel === lv.value ? styles.action : styles.secondary} onClick={() => setActiveLevel(lv.value)}>{lv.label}</button>
                    ))}
                  </div>
                  {/* Upper floor defaults to Typical (the storey below stacked
                      straight up); Custom starts it blank. */}
                  {upperFloorControl}
                </>
              )}
              {!areaActive && (
                <>
                  <span className={styles.stepHint}>Run in</span>
                  <div className={styles.btnRow} style={{ flexWrap: 'wrap' }}>
                    {(['under-floor', 'in-wall', 'ceiling'] as const).map((band) => (
                      <button key={band} className={traceBand === band ? styles.action : styles.secondary} onClick={() => setTraceBand(band)}>
                        {band === 'under-floor' ? 'Under-floor' : band === 'in-wall' ? 'In-wall' : 'Overhead'}
                      </button>
                    ))}
                  </div>
                </>
              )}
              <div className={styles.btnRow}>
                {activeTraceLayer === 'electrical' && <button className={styles.secondary} onClick={openPanelBoard}>Panel</button>}
                {/* No "End run" (double-tap ends a run) and no "Build 3D": the 3D
                    shows the walls you trace as you trace them. */}
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
                    {userWallCount > 0 ? 'Trace more, or edit what’s there' : 'Trace manually to correct anything wrong'}
                  </span>
                  <div className={styles.btnRow}>
                    <button className={styles.action} onClick={openPicker}>
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
            {/* Upper floor defaults to Typical (storey below stacked straight up,
                plumb); Custom starts it blank to trace/import its own layout. */}
            {upperFloorControl}
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
                {hasTrace && (
                  <span className={styles.stepHint} style={{ color: LAYER_COLORS[activeTraceLayer] }}>
                    ✨ Traced one? Tap <strong>Find the rest</strong> and it’ll pick up the matching walls across the print.
                  </span>
                )}
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
                  {hasTrace && (
                    <button className={styles.action} onClick={handleSmartRefine} disabled={seedProcessing}>
                      {seedProcessing ? 'Finding…' : '✨ Find the rest'}
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
            {/* Primary action FIRST so it's always visible on a phone — the long
                options below can scroll, but "Start tracing" never hides. */}
            <div className={styles.btnRow}>
              <button className={styles.action} onClick={confirmWallType}>
                {traceMode ? 'Apply' : 'Start Tracing →'}
              </button>
              <button className={styles.secondary} onClick={() => closeAllPanels()}>Cancel</button>
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
            {/* Where the run sits — pick it UP FRONT (also adjustable mid-trace).
                Drives the run's 3D elevation + auto-risers between bands. */}
            {(activeTraceLayer === 'plumbing' || activeTraceLayer === 'electrical' || activeTraceLayer === 'hvac') && (
              <>
                <span className={styles.stepHint}>Run in</span>
                <div className={styles.btnRow} style={{ flexWrap: 'wrap' }}>
                  {(['under-floor', 'in-wall', 'ceiling'] as const).map((band) => (
                    <button key={band} className={traceBand === band ? styles.action : styles.secondary} onClick={() => setTraceBand(band)}>
                      {band === 'under-floor' ? 'Under-floor' : band === 'in-wall' ? 'In-wall' : 'Overhead'}
                    </button>
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

        {/* ── Selected floor/roof area (tap to select → delete or clone) ── */}
        {selectedArea && !editModeActive && (
          <div className={styles.step}>
            <span className={styles.stepLabel}>{selectedArea.kind === 'roof' ? 'Roof' : 'Floor'} area selected</span>
            <span className={styles.stepHint}>Drag it to move; or delete / clone. Tap another to select.</span>
            {selectedArea.kind === 'roof' && (() => {
              const roof = roofAreas.find((a) => a.id === selectedArea.id)
              const curIn = Math.round(((roof?.ridge?.overhangM ?? roofOverhangIn * 0.0254) / 0.0254))
              return (
                <>
                  <span className={styles.stepHint}>Eave overhang</span>
                  <div className={styles.btnRow} style={{ flexWrap: 'wrap' }}>
                    {[0, 8, 12, 16, 24, 36].map((inch) => (
                      <button
                        key={inch}
                        className={curIn === inch ? styles.action : styles.secondary}
                        onClick={() => setRoofOverhang(selectedArea.id, inch === roofOverhangIn ? null : inch * 0.0254)}
                      >{inch}&quot;</button>
                    ))}
                  </div>
                </>
              )
            })()}
            <div className={styles.btnRow}>
              <button className={styles.cancel} onClick={deleteSelectedArea}>Delete</button>
              <button className={styles.secondary} onClick={cloneSelectedArea}>Clone</button>
              <button className={styles.secondary} onClick={() => closeAllPanels()}>Deselect</button>
            </div>
          </div>
        )}

        {/* ── Selected wall (post-build edit) ── */}
        {showSteps && editMode && selectedWallIndex != null && userWalls[selectedWallIndex] && (
          <div className={styles.step}>
            <span className={styles.stepLabel}>Wall selected</span>
            <span className={styles.stepHint}>Wall {selectedWallIndex + 1} of {userWalls.length}</span>
            {/* SPAN — how many storeys this wall runs through.
                A stairwell wall, a two-storey foyer, a vaulted wall or a shaft
                does not stop at the next floor, because there is no floor there
                to stop on. Those are BALLOON framed: continuous studs the whole
                way, not two platform walls stacked with a top plate and a rim
                band through the middle of the opening. Setting the span gives
                exactly that, since the framing builder puts plates only at the
                true top and bottom.

                A control rather than a guess: a wall beside a stairwell MIGHT be
                full height, and guessing wrong frames the building wrong without
                saying so. */}
            <div className={styles.stairRow}>
              <span className={styles.propLabel}>Spans</span>
              {[1, 2, 3].map((n) => {
                const on = (userWalls[selectedWallIndex].spanLevels ?? 1) === n
                return (
                  <button
                    key={n}
                    className={on ? styles.action : styles.secondary}
                    onClick={() => { updateUserWall(drawing.id, selectedWallIndex, { spanLevels: n }); if (modelReady) buildModel() }}
                    title={n === 1 ? 'One storey (platform framed)' : `${n} storeys, continuous studs (balloon framed)`}
                  >
                    {n === 1 ? '1 storey' : `${n} storeys`}
                  </button>
                )
              })}
            </div>
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
            {/* TRIM — point at the bit you want gone. Arms one tap: the piece of
                wall between its nearest junctions (or between the tap and the
                nearer free end) is removed. The auto "runs past the corner"
                prompt only fires when the app notices; this is the manual one. */}
            <label className={styles.row}>
              <span className={styles.propLabel}>Trim</span>
              <button
                className={wallTrimArmed ? styles.action : styles.secondary}
                onClick={() => setWallTrimArmed(!wallTrimArmed)}
                title="Then tap the part of the wall you want removed"
              >
                {wallTrimArmed ? 'Tap the part to remove' : 'Trim a piece'}
              </button>
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
              <button
                className={wallDetailExplode ? styles.action : styles.secondary}
                onClick={() => setWallDetailExplode(!wallDetailExplode)}
                title="Spread this wall's framing apart to see studs, plates and layers"
              >
                {wallDetailExplode ? 'Collapse' : 'Explode framing'}
              </button>
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
          {/* ── Stair configurator ────────────────────────────────────────
              The shape lives in "Type" above; these are the numbers that make it
              a real stair. RISE is deliberately absent — a stair climbs a storey,
              so it comes from the building. Letting you type it would let the two
              disagree, and the stair would be the one that is wrong.

              Everything is solved live, so you see the riser count and height the
              moment you change a tread, and any code failure the moment you cause
              it — rather than finding out at inspection. */}
          {/* ── Stair configurator ────────────────────────────────────────
              Here AND on the edit rail, on purpose. The rail is the quick reach
              while you are working on the model; this is where you look when you
              have a stair selected and want to read what it actually is. The card
              is bottom-right, so it is not in the way.

              These rows use stairRow, not propRow: propRow is one non-wrapping
              line with a fixed label column, which is right for "Brand: [input]"
              and wrong for a row of size buttons or "2.76 m · 15 risers @ 7in" —
              that is what ran off the card and over everything beside it.

              RISE is deliberately not a field: a stair climbs a storey, so it
              comes from the building. A box for it would let the two disagree,
              and the stair would be the one that was wrong. */}
          {selectedObject.type === 'stairs' && stairSolution && (
            <>
              <div className={styles.stairRow}>
                <span className={styles.propLabel}>Rise</span>
                <span className={styles.stairVal}>
                  {formatLengthFromMm(stairRiseM * 1000, activeUnit)} · {stairSolution.riserCount} risers @ {formatLengthFromMm(stairSolution.riserM * 1000, activeUnit)}
                </span>
              </div>
              <div className={styles.stairRow}>
                <span className={styles.propLabel}>Tread</span>
                {[10, 11, 12].map((inches) => {
                  const m = inches * 0.0254
                  const on = Math.abs((selectedObject.treadM ?? MIN_TREAD_M) - m) < 0.002
                  return (
                    <button key={inches} className={on ? styles.action : styles.secondary}
                      onClick={() => updatePlacedObject(selectedObject.id, { treadM: m })}>{inches}"</button>
                  )
                })}
              </div>
              <div className={styles.stairRow}>
                <span className={styles.propLabel}>Width</span>
                {[36, 42, 48].map((inches) => {
                  const m = inches * 0.0254
                  const on = Math.abs((selectedObject.stairWidthM ?? MIN_WIDTH_M) - m) < 0.002
                  return (
                    <button key={inches} className={on ? styles.action : styles.secondary}
                      onClick={() => updatePlacedObject(selectedObject.id, { stairWidthM: m })}>{inches}"</button>
                  )
                })}
              </div>
              <div className={styles.stairRow}>
                <span className={styles.propLabel}>Landing</span>
                {/* A turn IS a landing, so "none" is only offered on a straight
                    run — hiding it beats offering a choice the geometry ignores. */}
                {stairSolution.shape === 'straight' && (
                  <button className={selectedObject.landingM === null ? styles.action : styles.secondary}
                    onClick={() => updatePlacedObject(selectedObject.id, { landingM: null })}>None</button>
                )}
                {[36, 48, 60].map((inches) => {
                  const m = inches * 0.0254
                  const on = selectedObject.landingM != null && Math.abs(selectedObject.landingM - m) < 0.002
                  return (
                    <button key={inches} className={on ? styles.action : styles.secondary}
                      onClick={() => updatePlacedObject(selectedObject.id, { landingM: m })}>{inches}"</button>
                  )
                })}
              </div>
              <div className={styles.stairRow}>
                <span className={styles.propLabel}>Run</span>
                <span className={styles.stairVal}>
                  {formatLengthFromMm(stairSolution.footprint.lengthM * 1000, activeUnit)} × {formatLengthFromMm(stairSolution.footprint.widthM * 1000, activeUnit)}
                  {' · opening '}{formatLengthFromMm(stairOpening.lengthM * 1000, activeUnit)}
                </span>
              </div>
              {stairProblems.length > 0 && (
                <div className={styles.stairIssues}>
                  {stairProblems.map((p) => (
                    <p key={p.code} className={styles.warnText} style={{ margin: '2px 0' }}>
                      ⚠ {p.message} <span style={{ opacity: 0.7 }}>({p.code})</span>
                    </p>
                  ))}
                </div>
              )}
            </>
          )}
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
            <button className={styles.secondary} onClick={() => { const nid = clonePlacedObject(selectedObject.id); if (nid) setSelectedObjectId(nid) }}>
              Clone
            </button>
            <button
              className={detailExplodeId === selectedObject.id ? styles.action : styles.secondary}
              onClick={() => setDetailExplodeId(detailExplodeId === selectedObject.id ? null : selectedObject.id)}
              title="Spread this item's parts apart to see its components"
            >
              {detailExplodeId === selectedObject.id ? 'Collapse' : 'Explode parts'}
            </button>
            <button className={styles.secondary} onClick={deleteSelectedObject}>Delete</button>
          </div>
          {/* No re-build step: moving a door or window re-frames the opening on
              its own (useAutoBuild tracks placed openings). Done just closes
              the editor. */}
          <div className={styles.btnRow}>
            <button className={styles.action} onClick={() => setSelectedObjectId(null)}>
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
          {/* PICK THE STOREY HERE. Placement stamps the ACTIVE level, and that
              level persists across layer switches — so after working upstairs,
              arming stairs meant for the ground floor silently lands them two
              storeys up. Naming the storey in the prompt was not enough: you
              still had to leave, go and change it, and come back. It is a control
              now, sitting on the one bar you are already looking at.

              Worst for stairs and lifts, which is where it kept being noticed —
              they span a storey, so landing one on the wrong floor is not a small
              nudge to correct. */}
          <span className={styles.placeHint}>
            Tap the plan to place {getCatalogItem(placeObjectType)?.label ?? placeObjectType}
            {keepPlacing && ' — keeps placing until you stop'}
          </span>
          {/* CONFIGURE BEFORE PLACING. A stair is sized to the hole it has to
              fit, so choosing its tread and width after dropping it is backwards
              — and the ghost shows the real footprint while you aim, so you can
              see whether it lands in the space you have. */}
          {placeObjectType === 'stairs' && (
            <>
              {/* SHAPE first — it changes the footprint more than anything else,
                  so it belongs before the sizes. Short labels because this bar
                  lives in the corner and must stay narrow. */}
              <span className={styles.placeLevels}>
                {([['Straight','—'],['L-shaped','L'],['U-shaped','U'],['Switchback','S']] as const).map(([full, short]) => {
                  const on = (placeStairCfg.subtype ?? 'Straight') === full
                  return (
                    <button key={full} className={on ? styles.action : styles.secondary}
                      title={full}
                      onClick={() => setPlaceStairCfg({ subtype: full })}>{short}</button>
                  )
                })}
              </span>
              <span className={styles.placeLevels}>
                {[10, 11, 12].map((inches) => {
                  const m = inches * 0.0254
                  const on = Math.abs((placeStairCfg.treadM ?? MIN_TREAD_M) - m) < 0.002
                  return (
                    <button key={`t${inches}`} className={on ? styles.action : styles.secondary}
                      title={`Tread ${inches}"`}
                      onClick={() => setPlaceStairCfg({ treadM: m })}>{inches}"</button>
                  )
                })}
              </span>
              <span className={styles.placeLevels}>
                {[36, 42, 48].map((inches) => {
                  const m = inches * 0.0254
                  const on = Math.abs((placeStairCfg.stairWidthM ?? MIN_WIDTH_M) - m) < 0.002
                  return (
                    <button key={`w${inches}`} className={on ? styles.action : styles.secondary}
                      title={`Width ${inches}"`}
                      onClick={() => setPlaceStairCfg({ stairWidthM: m })}>{inches}"</button>
                  )
                })}
              </span>
            </>
          )}
          <div className={styles.placeLevels}>
            {LEVEL_OPTIONS.map((lv) => (
              <button
                key={lv.value}
                className={activeLevel === lv.value ? styles.action : styles.secondary}
                onClick={() => setActiveLevel(lv.value)}
                title={`Place on ${lv.label}`}
              >
                {lv.label}
              </button>
            ))}
          </div>
          <button
            className={keepPlacing ? styles.action : styles.secondary}
            onClick={() => setKeepPlacing(!keepPlacing)}
            title="Stay armed after each drop so you can place several in a row"
          >
            {keepPlacing ? '✓ Place multiple' : 'Place multiple'}
          </button>
          <button className={styles.secondary} onClick={() => setPlaceObjectType(null)}>
            {keepPlacing ? 'Done' : 'Cancel'}
          </button>
        </div>
      )}

      {/* BOTTOM drawer — Place & Layers: trade-layer visibility toggles + the
          object catalog. Retracts to just its tab so it never covers the plan. */}
      {drawing && drawing.status === 'ready' && (
        <EdgeDrawer
          side="bottom"
          inRail
          title="Place & Layers"
          tabLabel="Place"
          tabIcon="▦"
          tourTab="place-tab"
          /* Same happy-place invariant as Build: no drawer over the workspace
             while actively tracing. */
          open={placeDrawerOpen && !tracingActive}
          onToggle={() => setDrawerOpen('place', !placeDrawerOpen)}
        >
          <span className={styles.stepLabel}>Layers</span>
          <LayersPanel />
          {trayVisible && (
            <>
              <span className={styles.stepLabel}>Catalog — tap an item, then tap the plan</span>
              <div className={styles.tray}>
                {/* Doors/windows/stairs (the general catalog) are ALWAYS present;
                    on the electrical layer the device boxes are ADDED in front,
                    not swapped in (which used to hide doors & stairs). */}
                {(activeTraceLayer === 'electrical' ? [...electricalTrayItems(), ...trayItems()] : trayItems()).map((item) => (
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
