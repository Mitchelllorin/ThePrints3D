import { create } from 'zustand'
import { current, enableMapSet } from 'immer'
import { immer } from 'zustand/middleware/immer'

// Trade-layer visibility uses a Set in the immer store.
enableMapSet()
import type {
  AppView,
  Annotation,
  BuildResult,
  Decision,
  DetectedWallType,
  Drawing,
  DrawingType,
  FloorplanOverlayState,
  FloorLevel,
  Layer,
  LayerId,
  Measurement,
  Circuit,
  Model3D,
  PlacedObject,
  TracedLine,
  UserTrace,
  WallType,
  WorkspaceWizardInputs,
} from '../types'
import { type TraceLayer, TRACE_LAYER_ORDER } from '../data/traceLayers'
import type { ProductCatalogItem, ProductPlacement } from '../types/products'
import { processDrawing as runProcessor } from '../services/drawingProcessor'
import { buildFraming } from '../services/constructionEngine'
import {
  groupByFloorWithLog,
  floorToElevation,
  FLOOR_HEIGHT_M,
  type FloorGroupingLogEntry,
} from '../services/sheetParser'
import { logError, logEvent } from '../services/logger'
import type { ParsedWall } from '../types'
import { mergeAutoAndUserWalls, inferCorners } from '../services/wallTraceReducer'
import { defaultSmartProcessingState } from './smartProcessingSlice'
import { DEFAULT_WALL_DETECTION_CONFIG, type WallDetectionConfig } from './wallDetectionConfig'
import { createPresetDrawing, type PresetDifficulty } from '../services/presetDrawings'
import { useConfigStore } from './useConfigStore'
import { useFloorplanLocalStore } from './useFloorplanLocalStore'
import {
  DEFAULT_WIZARD_STATE,
  completeWizardGroup as completeWizardGroupState,
  loadWizardState,
  patchWizardData,
  saveWizardState,
  setWizardCurrentGroup,
  type ProjectContextWizardState,
} from '../components/ProjectContext/wizardState'
import { loadWizardState as loadOnboardingWizardState } from '../onboarding/storage'

// ─── Camera Presets ────────────────────────────────────────────────────────────
export interface CameraPreset {
  position: [number, number, number]
  target: [number, number, number]
}

// ─── Annotation persistence ────────────────────────────────────────────────────

const ANNOTATIONS_KEY = 'blueprint3d-annotations'

function loadPersistedAnnotations(): Annotation[] {
  try {
    const raw = localStorage.getItem(ANNOTATIONS_KEY)
    if (raw) return JSON.parse(raw) as Annotation[]
  } catch { /* ignore */ }
  return []
}

function saveAnnotations(annotations: Annotation[]) {
  try {
    localStorage.setItem(ANNOTATIONS_KEY, JSON.stringify(annotations))
  } catch { /* ignore */ }
}

// ─── Default Layers ────────────────────────────────────────────────────────────

const DEFAULT_LAYERS: Layer[] = [
  {
    id: 'structure',
    label: 'Structure',
    color: '#94a3b8',
    visible: true,
    opacity: 1,
    sourceTypes: ['structural', 'architectural'],
    icon: '🏗️',
  },
  {
    id: 'walls',
    // Off by default: show the stud framing, not the translucent solid wall
    // volumes over it. Toggle "Walls" on in the Layers panel for a solid view.
    label: 'Walls',
    color: '#e2e8f0',
    visible: false,
    opacity: 1,
    sourceTypes: ['floor-plan', 'architectural'],
    icon: '🧱',
  },
  {
    id: 'floors',
    label: 'Floors',
    color: '#d4a574',
    visible: true,
    opacity: 0.8,
    sourceTypes: ['floor-plan', 'architectural'],
    icon: '▭',
  },
  {
    id: 'ceiling',
    label: 'Ceiling / RCP',
    color: '#f1f5f9',
    visible: true,
    opacity: 0.6,
    sourceTypes: ['rcp'],
    icon: '⬜',
  },
  {
    id: 'doors-windows',
    label: 'Doors & Windows',
    color: '#7dd3fc',
    visible: true,
    opacity: 1,
    sourceTypes: ['floor-plan', 'architectural'],
    icon: '🚪',
  },
  {
    id: 'framing',
    label: 'Framing',
    color: '#d4a574',
    visible: false,
    opacity: 0.85,
    sourceTypes: ['floor-plan', 'architectural'],
    icon: '🪵',
  },
  {
    id: 'electrical',
    label: 'Electrical',
    color: '#fbbf24',
    visible: false,
    opacity: 1,
    sourceTypes: ['electrical'],
    icon: '⚡',
  },
  {
    id: 'plumbing',
    label: 'Plumbing',
    color: '#38bdf8',
    visible: false,
    opacity: 1,
    sourceTypes: ['plumbing'],
    icon: '💧',
  },
  {
    id: 'mechanical',
    label: 'Mechanical / HVAC',
    color: '#a78bfa',
    visible: false,
    opacity: 1,
    sourceTypes: ['mechanical'],
    icon: '🌀',
  },
  {
    id: 'furniture',
    label: 'Furniture',
    color: '#86efac',
    visible: false,
    opacity: 0.8,
    sourceTypes: ['floor-plan', 'architectural'],
    icon: '🪑',
  },
  {
    id: 'annotations',
    label: 'Annotations',
    color: '#f87171',
    visible: true,
    opacity: 1,
    sourceTypes: ['floor-plan', 'rcp', 'architectural', 'structural', 'electrical', 'plumbing', 'mechanical'],
    icon: '📐',
  },
]

const DEFAULT_MODEL: Model3D = {
  status: 'idle',
  floorLevels: [],
  boundingBox: null,
  scale: 1,
  generatedAt: null,
}

const DEFAULT_FLOORPLAN_OVERLAY: FloorplanOverlayState = {
  drawingId: null,
  visible: true,
  locked: false,
  snapToGrid: true,
  calibrationMode: false,
  traceModeActive: false,
  orbitLocked: false,
  guidedStep: 1,
  position: [0, 0],
  scale: [12, 8],
  rotationDeg: 0,
  opacity: 0.65,
}

const HISTORY_LIMIT = 80

// Drawings ever added this session, by id — kept OUTSIDE the store because
// Drawing holds a File and blob URLs that can't survive the JSON snapshot
// round-trip. Lets undo restore a removed drawing and redo re-add one.
const drawingPool = new Map<string, Drawing>()

interface WorkspaceHistorySnapshot {
  /** Which drawings existed, in order — add/remove drawing is undoable */
  drawingIds: string[]
  drawingStates: Array<{
    id: string
    parsedWalls: ParsedWall[]
    scaleMmPerPx: number | null
    scaleNotation: string | null
    scaleConfidence: Drawing['scaleConfidence']
  }>
  layers: Array<Pick<Layer, 'id' | 'visible' | 'opacity'>>
  productPlacements: ProductPlacement[]
  placedObjects: PlacedObject[]
  plumbingLines: TracedLine[]
  electricalLines: TracedLine[]
  circuits: Circuit[]
  annotations: Annotation[]
  measurements: Measurement[]
  userTraces: UserTrace[]
  floorplanOverlay: FloorplanOverlayState
  wizardState: ProjectContextWizardState
  wizardInputs: WorkspaceWizardInputs | null
  model: Model3D
  buildResult: BuildResult | null
  constructionDecisions: Decision[]
  detectedWallTypes: DetectedWallType[]
  correctionCount: number
}

function deepCopy<T>(value: T): T {
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value)
    } catch {
      return JSON.parse(JSON.stringify(value)) as T
    }
  }
  return JSON.parse(JSON.stringify(value)) as T
}

// ─── Store Interface ───────────────────────────────────────────────────────────

interface AppState {
  view: AppView
  drawings: Drawing[]
  layers: Layer[]
  model: Model3D
  floorGroupingLog: FloorGroupingLogEntry[]
  selectedDrawingId: string | null
  sidebarOpen: boolean
  measurements: Measurement[]
  measureMode: boolean
  annotations: Annotation[]
  selectedAnnotationId: string | null
  annotateMode: boolean
  cameraPreset: CameraPreset | null
  productCatalog: ProductCatalogItem[]
  productPlacements: ProductPlacement[]
  /** User-placed furniture/fixtures in the 3D scene */
  placedObjects: PlacedObject[]
  /** Traced trade lines by discipline */
  plumbingLines: TracedLine[]
  electricalLines: TracedLine[]
  /** Electrical branch circuits (auto-grouped by amperage + manual). */
  circuits: Circuit[]
  /** Which trade layers are currently shown in the 3D scene */
  visibleLayers: Set<TraceLayer>
  wizardInputs: WorkspaceWizardInputs | null
  wizardState: ProjectContextWizardState
  floorplanOverlay: FloorplanOverlayState
  historyPast: WorkspaceHistorySnapshot[]
  historyFuture: WorkspaceHistorySnapshot[]

  // Smart Processing
  smartProcessor: 'heuristic' | 'ai' | 'seed-guided'
  userTraces: UserTrace[]
  seedMode: boolean
  wallTypes: WallType[]
  projectWallTypes: WallType[]
  smartStageLabel: string
  correctionCount: number
  detectedWallTypes: DetectedWallType[]
  wallDetectionConfig: WallDetectionConfig

  // Construction Engine
  buildResult: BuildResult | null
  constructionDecisions: Decision[]

  // Preview: when true, the 3D scene may render the generic procedural sample
  // room (fallback) if no real walls/build exist. Suppressed by a real build.
  previewMode: boolean

  // Explode view: 0 = assembled, 1 = fully separated. Ephemeral viewport state.
  explodeAmount: number

  // Actions
  setView: (view: AppView) => void
  addDrawings: (files: File[]) => void
  removeDrawing: (id: string) => void
  updateDrawing: (id: string, patch: Partial<Drawing>) => void
  setDrawingType: (id: string, type: DrawingType) => void
  setDrawingScale: (id: string, mmPerPx: number, notation: string) => void
  addUserTracedWall: (id: string, wall: ParsedWall) => void
  addUserTracedWalls: (id: string, walls: ParsedWall[]) => void
  /** Delete a single user-traced wall by its index within the drawing's user walls. */
  deleteUserWall: (id: string, userIndex: number) => void
  /** Patch a single user-traced wall by its index within the drawing's user walls. */
  updateUserWall: (id: string, userIndex: number, patch: Partial<ParsedWall>) => void
  clearUserTracedWalls: (id: string) => void
  clearTracingForDrawing: (id: string) => void
  selectDrawing: (id: string | null) => void
  processDrawing: (id: string) => Promise<void>
  toggleLayer: (id: LayerId) => void
  setLayerOpacity: (id: LayerId, opacity: number) => void
  setSidebarOpen: (open: boolean) => void
  setModelStatus: (status: Model3D['status']) => void
  buildModel: () => void
  update3DModel: (finalInputs: WorkspaceWizardInputs) => void
  setFloorplanOverlayDrawing: (drawingId: string | null) => void
  updateFloorplanOverlay: (patch: Partial<FloorplanOverlayState>, recordHistory?: boolean) => void
  checkpointHistory: () => void
  undo: () => void
  redo: () => void
  updateWizardData: (partial: Partial<ProjectContextWizardState['data']>) => void
  jumpToWizardGroup: (groupId: ProjectContextWizardState['currentGroup']) => void
  completeWizardGroup: (groupId: ProjectContextWizardState['currentGroup']) => void
  resetWizard: () => void
  loadPresetDrawing: (difficulty: PresetDifficulty, practiceMode: boolean) => void
  // Measurements
  setMeasureMode: (active: boolean) => void
  addMeasurement: (m: Omit<Measurement, 'id' | 'createdAt'>) => void
  removeMeasurement: (id: string) => void
  clearMeasurements: () => void
  // Annotations
  setAnnotateMode: (active: boolean) => void
  addAnnotation: (annotation: Omit<Annotation, 'id' | 'createdAt'>) => void
  removeAnnotation: (id: string) => void
  clearAnnotations: () => void
  updateAnnotation: (id: string, patch: Partial<Pick<Annotation, 'text' | 'icon' | 'color'>>) => void
  setSelectedAnnotationId: (id: string | null) => void
  importAnnotations: (rawJson: string) => void
  // Camera
  setCameraPreset: (p: CameraPreset) => void
  consumeCameraPreset: () => void
  setProductCatalog: (items: ProductCatalogItem[]) => void
  addProductPlacement: (placement: Omit<ProductPlacement, 'id' | 'placedAt'>) => void
  removeProductPlacement: (id: string) => void
  clearProductPlacements: () => void
  // Smart processing actions
  startTraceMode: () => void
  addTrace: (trace: UserTrace) => void
  clearTraces: () => void
  processWithSeeds: (drawingId: string) => Promise<void>
  correctElement: (wallId: string, wallTypeId: string) => void
  setProjectWallTypes: (types: WallType[]) => void
  exportCorrectionDataset: () => string
  setWallDetectionConfig: (patch: Partial<WallDetectionConfig>) => void
  // Construction Engine
  buildForMe: () => void
  updateDecision: (decisionId: string, chosenValue: unknown) => void
  clearBuildResult: () => void
  setPreviewMode: (on: boolean) => void
  setExplodeAmount: (amount: number) => void
  // Placed objects (furniture/fixtures)
  addPlacedObject: (obj: PlacedObject) => void
  removePlacedObject: (id: string) => void
  updatePlacedObject: (id: string, patch: Partial<PlacedObject>) => void
  // Trade trace lines
  addPlumbingLines: (lines: TracedLine[]) => void
  addElectricalLines: (lines: TracedLine[]) => void
  toggleTradeLayerVisible: (layer: TraceLayer) => void
  // Electrical circuits
  addCircuit: (c: Circuit) => void
  updateCircuit: (id: string, patch: Partial<Circuit>) => void
}

// ─── Store ─────────────────────────────────────────────────────────────────────

let _nextId = 1
function genId() {
  return `drawing-${Date.now()}-${_nextId++}`
}

/** Infer drawing type from filename heuristics */
function inferDrawingType(name: string): DrawingType {
  const lower = name.toLowerCase()
  if (lower.includes('rcp') || lower.includes('ceiling')) return 'rcp'
  if (lower.includes('elec') || lower.includes('e-')) return 'electrical'
  if (lower.includes('plumb') || lower.includes('p-')) return 'plumbing'
  if (lower.includes('mech') || lower.includes('hvac') || lower.includes('m-')) return 'mechanical'
  if (lower.includes('struct') || lower.includes('s-')) return 'structural'
  if (lower.includes('civil') || lower.includes('c-')) return 'civil'
  if (lower.includes('arch') || lower.includes('a-') || lower.includes('floor')) return 'architectural'
  return 'floor-plan'
}

function computeFloorLevels(drawings: Drawing[]) {
  const { groups: floorGroups, floorGroupingLog } = groupByFloorWithLog(
    drawings.map((d) => ({
      id: d.id,
      name: d.name,
      floorNumber: d.floorNumber,
    })),
  )
  const levels: FloorLevel[] = []
  const numericEntries = Array.from(floorGroups.entries())
    .filter((entry): entry is [number, string[]] => entry[0] !== 'unknown')
    .sort(([a], [b]) => a - b)

  for (const [floorNum, ids] of numericEntries) {
    levels.push({
      id: `floor-${floorNum}`,
      label: floorNum === 0 ? 'Ground Floor' : floorNum < 0 ? 'Basement' : `Level ${floorNum}`,
      elevation: floorToElevation(floorNum),
      height: FLOOR_HEIGHT_M,
      drawingIds: ids,
    })
  }

  const unknownIds = floorGroups.get('unknown')
  if (unknownIds && unknownIds.length > 0) {
    const topKnownFloor = numericEntries[numericEntries.length - 1]?.[0] ?? 0
    levels.push({
      id: 'floor-unknown',
      label: 'Unknown',
      elevation: floorToElevation(topKnownFloor + 1),
      height: FLOOR_HEIGHT_M,
      drawingIds: unknownIds,
    })
  }

  return { levels, floorGroupingLog }
}

function captureSnapshot(state: AppState): WorkspaceHistorySnapshot {
  return deepCopy({
    drawingIds: state.drawings.map((d) => d.id),
    drawingStates: state.drawings.map((d) => ({
      id: d.id,
      parsedWalls: d.parsedWalls,
      scaleMmPerPx: d.scaleMmPerPx,
      scaleNotation: d.scaleNotation,
      scaleConfidence: d.scaleConfidence,
    })),
    layers: state.layers.map((l) => ({
      id: l.id,
      visible: l.visible,
      opacity: l.opacity,
    })),
    productPlacements: state.productPlacements,
    placedObjects: state.placedObjects,
    plumbingLines: state.plumbingLines,
    electricalLines: state.electricalLines,
    circuits: state.circuits,
    annotations: state.annotations,
    measurements: state.measurements,
    userTraces: state.userTraces,
    floorplanOverlay: state.floorplanOverlay,
    wizardState: state.wizardState,
    wizardInputs: state.wizardInputs,
    model: state.model,
    buildResult: state.buildResult,
    constructionDecisions: state.constructionDecisions,
    detectedWallTypes: state.detectedWallTypes,
    correctionCount: state.correctionCount,
  })
}

function applySnapshot(state: AppState, snapshot: WorkspaceHistorySnapshot) {
  // Rebuild the drawings array first — drawings may have been added or
  // removed since this snapshot. Removed ones come back from the pool.
  const existing = new Map(state.drawings.map((d) => [d.id, d]))
  state.drawings = snapshot.drawingIds
    .map((id) => existing.get(id) ?? drawingPool.get(id))
    .filter((d): d is Drawing => Boolean(d))

  for (const ds of snapshot.drawingStates) {
    const drawing = state.drawings.find((d) => d.id === ds.id)
    if (!drawing) continue
    drawing.parsedWalls = deepCopy(ds.parsedWalls)
    drawing.scaleMmPerPx = ds.scaleMmPerPx
    drawing.scaleNotation = ds.scaleNotation
    drawing.scaleConfidence = ds.scaleConfidence
  }
  for (const layerPatch of snapshot.layers) {
    const layer = state.layers.find((l) => l.id === layerPatch.id)
    if (!layer) continue
    layer.visible = layerPatch.visible
    layer.opacity = layerPatch.opacity
  }
  state.productPlacements = deepCopy(snapshot.productPlacements)
  state.placedObjects = deepCopy(snapshot.placedObjects ?? [])
  state.plumbingLines = deepCopy(snapshot.plumbingLines ?? [])
  state.electricalLines = deepCopy(snapshot.electricalLines ?? [])
  state.circuits = deepCopy(snapshot.circuits ?? [])
  state.annotations = deepCopy(snapshot.annotations)
  state.measurements = deepCopy(snapshot.measurements)
  state.userTraces = deepCopy(snapshot.userTraces)
  state.floorplanOverlay = deepCopy(snapshot.floorplanOverlay)
  state.wizardState = deepCopy(snapshot.wizardState)
  state.wizardInputs = deepCopy(snapshot.wizardInputs)
  state.model = deepCopy(snapshot.model)
  state.buildResult = deepCopy(snapshot.buildResult)
  state.constructionDecisions = deepCopy(snapshot.constructionDecisions)
  state.detectedWallTypes = deepCopy(snapshot.detectedWallTypes)
  state.correctionCount = snapshot.correctionCount
  saveAnnotations(state.annotations)
  saveWizardState(state.wizardState)
}

/**
 * Run the construction engine over the current drawings' walls/openings and
 * return the framing result (or null if there's nothing to frame). Shared by
 * buildModel (Build 3D) and buildForMe so BOTH always produce framing.
 */
function computeFramingResult(
  drawings: AppState['drawings'],
): ReturnType<typeof buildFraming> | null {
  const allParsed = drawings.filter((d) => d.parsedWalls.length > 0)
  if (allParsed.length === 0) return null
  const ref = allParsed.reduce((a, b) => (a.parsedWalls.length > b.parsedWalls.length ? a : b))
  const scaleMmPerPx = ref.scaleMmPerPx ?? 23.5
  const allWalls = allParsed.flatMap((d) => d.parsedWalls)
  const allOpenings = allParsed.flatMap((d) => d.parsedOpenings)
  const cfg = useConfigStore.getState()
  const onboardingMeta = loadOnboardingWizardState().meta
  return buildFraming(allWalls, allOpenings, {
    scaleMmPerPx,
    floorHeightM: onboardingMeta.floorHeightM,
    buildingType: onboardingMeta.buildingType === 'unknown' ? 'residential-single' : onboardingMeta.buildingType,
    spacingMm: cfg.studSpacingIn * 25.4,
    studSize: cfg.defaultStudSize,
    cornerType: cfg.cornerType,
    material: cfg.framingMaterial,
    steelWidth: cfg.steelWidth,
    steelGauge: cfg.steelGauge,
    steelTrackTop: cfg.steelTrackTop,
    steelTrackBottom: cfg.steelTrackBottom,
    steelDeflectionGapMm: cfg.steelDeflectionGapMm,
  })
}

export const useAppStore = create<AppState>()(
  immer((set, get) => {
    const pushHistory = () => {
      set((s) => {
        s.historyPast.push(captureSnapshot(s))
        if (s.historyPast.length > HISTORY_LIMIT) s.historyPast.shift()
        s.historyFuture = []
      })
    }

    return {
    view: 'model',
    drawings: [],
    layers: DEFAULT_LAYERS,
    model: DEFAULT_MODEL,
    floorGroupingLog: [],
    selectedDrawingId: null,
    sidebarOpen: true,
    measurements: [],
    measureMode: false,
    annotations: loadPersistedAnnotations(),
    selectedAnnotationId: null,
    annotateMode: false,
    cameraPreset: null,
    productCatalog: [],
    productPlacements: [],
    placedObjects: [],
    plumbingLines: [],
    electricalLines: [],
    circuits: [],
    visibleLayers: new Set<TraceLayer>(TRACE_LAYER_ORDER),
    wizardInputs: null,
    wizardState: loadWizardState(),
    floorplanOverlay: deepCopy(DEFAULT_FLOORPLAN_OVERLAY),
    historyPast: [],
    historyFuture: [],

    // Smart processing defaults
    smartProcessor: defaultSmartProcessingState.processor,
    userTraces: defaultSmartProcessingState.userTraces,
    seedMode: defaultSmartProcessingState.seedMode,
    wallTypes: defaultSmartProcessingState.wallTypes,
    projectWallTypes: defaultSmartProcessingState.projectWallTypes,
    smartStageLabel: defaultSmartProcessingState.stageLabel,
    correctionCount: defaultSmartProcessingState.correctionCount,
    detectedWallTypes: [],
    wallDetectionConfig: { ...DEFAULT_WALL_DETECTION_CONFIG },

    // Construction Engine
    buildResult: null,
    constructionDecisions: [],
    previewMode: true,
    explodeAmount: 0,

    setView: (view) =>
      set((s) => {
        s.view = view
      }),

    checkpointHistory: () => {
      pushHistory()
    },

    addDrawings: (files) => {
      pushHistory()
      const newIds: string[] = []
      set((s) => {
        for (const file of files) {
          const id = genId()
          newIds.push(id)
          const drawing: Drawing = {
            id,
            name: file.name,
            source: 'upload',
            type: inferDrawingType(file.name),
            file,
            pageCount: 1,
            currentPage: 1,
            previewUrl: URL.createObjectURL(file),
            rasterUrl: null,
            rasterWidth: null,
            rasterHeight: null,
            parsedWalls: [],
            parsedRooms: [],
            parsedOpenings: [],
            parsedText: [],
            parsedSymbols: [],
            parsedAnnotationCandidates: [],
            parseProgress: 0,
            floorNumber: null,
            status: 'pending',
            scaleMmPerPx: null,
            scaleNotation: null,
            scaleConfidence: null,
            uploadedAt: Date.now(),
          }
          drawingPool.set(id, drawing)
          s.drawings.push(drawing)
          if (!s.floorplanOverlay.drawingId) {
            s.floorplanOverlay.drawingId = drawing.id
          }
          logEvent('drawing.uploaded', {
            drawingId: drawing.id,
            name: drawing.name,
            type: drawing.type,
            fileType: drawing.file.type,
            size: drawing.file.size,
          })
        }
        // Stay on upload view — the wizard or uploader will navigate after
        // processing begins so the user sees progress rather than a blank list.
      })
      // Auto-analyse in the background; don't await so the UI stays responsive.
      for (const id of newIds) {
        get().processDrawing(id)
      }
    },

    removeDrawing: (id) => {
      pushHistory()
      set((s) => {
        const idx = s.drawings.findIndex((d) => d.id === id)
        if (idx !== -1) {
          // Keep the full current state (and its blob URLs alive) in the pool
          // so undo can bring the drawing back intact.
          drawingPool.set(id, current(s.drawings[idx]) as Drawing)
          s.drawings.splice(idx, 1)
        }
        if (s.selectedDrawingId === id) s.selectedDrawingId = null
        if (s.floorplanOverlay.drawingId === id) {
          s.floorplanOverlay.drawingId = s.drawings[0]?.id ?? null
        }
      })
    },

    updateDrawing: (id, patch) =>
      set((s) => {
        const d = s.drawings.find((d) => d.id === id)
        if (d) Object.assign(d, patch)
      }),

    setDrawingType: (id, type) =>
      set((s) => {
        const d = s.drawings.find((d) => d.id === id)
        if (d) d.type = type
      }),

    setDrawingScale: (id, mmPerPx, notation) => {
      pushHistory()
      set((s) => {
        const d = s.drawings.find((d) => d.id === id)
        if (d) {
          d.scaleMmPerPx = mmPerPx
          d.scaleNotation = notation
          d.scaleConfidence = 'parsed'
        }
      })
    },

    addUserTracedWall: (id, wall) => {
      pushHistory()
      const { cornerInferEnabled, cornerTolerancePx } = useConfigStore.getState()
      // Stamp the wall with the framing type/role chosen for this trace session.
      const { activeWallType, activeWallRole } = useFloorplanLocalStore.getState()
      set((s) => {
        const d = s.drawings.find((dr) => dr.id === id)
        if (!d) return
        const autoWalls = d.parsedWalls.filter((w) => (w.source ?? 'auto') !== 'user')
        const exteriorMaterial = activeWallRole === 'exterior-bearing' ? 'stucco' : 'drywall'
        const combined = [
          ...d.parsedWalls.filter((w) => w.source === 'user'),
          { ...wall, source: 'user' as const, detectionConfidence: 1, framingType: activeWallType, wallRole: activeWallRole, interiorMaterial: 'drywall', exteriorMaterial },
        ]
        const userWalls = cornerInferEnabled ? inferCorners(combined, cornerTolerancePx) : combined
        d.parsedWalls = mergeAutoAndUserWalls(autoWalls, userWalls)
      })
    },

    // Batch variant: one stroke may reduce to several connected walls — they
    // commit together as a single undo step.
    addUserTracedWalls: (id, walls) => {
      if (walls.length === 0) return
      pushHistory()
      // Stamp every wall in the batch with the active framing type/role.
      const { activeWallType, activeWallRole } = useFloorplanLocalStore.getState()
      set((s) => {
        const d = s.drawings.find((dr) => dr.id === id)
        if (!d) return
        const autoWalls = d.parsedWalls.filter((w) => (w.source ?? 'auto') !== 'user')
        const exteriorMaterial = activeWallRole === 'exterior-bearing' ? 'stucco' : 'drywall'
        const userWalls = inferCorners([
          ...d.parsedWalls.filter((w) => w.source === 'user'),
          ...walls.map((w) => ({ ...w, source: 'user' as const, detectionConfidence: 1, framingType: activeWallType, wallRole: activeWallRole, interiorMaterial: 'drywall', exteriorMaterial })),
        ])
        d.parsedWalls = mergeAutoAndUserWalls(autoWalls, userWalls)
      })
    },

    // Remove a single user-traced wall (identified by its index among the
    // drawing's user walls, matching the order the overlay/UI iterate them).
    deleteUserWall: (id, userIndex) => {
      pushHistory()
      set((s) => {
        const d = s.drawings.find((dr) => dr.id === id)
        if (!d) return
        const autoWalls = d.parsedWalls.filter((w) => (w.source ?? 'auto') !== 'user')
        const userWalls = d.parsedWalls.filter((w) => w.source === 'user')
        if (userIndex < 0 || userIndex >= userWalls.length) return
        userWalls.splice(userIndex, 1)
        d.parsedWalls = mergeAutoAndUserWalls(autoWalls, userWalls)
      })
    },

    // Patch a single user-traced wall (by index among user walls), e.g. to
    // change its interior/exterior finish materials.
    updateUserWall: (id, userIndex, patch) => {
      pushHistory()
      set((s) => {
        const d = s.drawings.find((dr) => dr.id === id)
        if (!d) return
        const userWalls = d.parsedWalls.filter((w) => w.source === 'user')
        const target = userWalls[userIndex]
        if (!target) return
        Object.assign(target, patch)
      })
    },

    clearUserTracedWalls: (id) => {
      pushHistory()
      set((s) => {
        const d = s.drawings.find((dr) => dr.id === id)
        if (!d) return
        d.parsedWalls = d.parsedWalls.filter((w) => (w.source ?? 'auto') !== 'user')
      })
    },

    clearTracingForDrawing: (id) => {
      pushHistory()
      set((s) => {
        const d = s.drawings.find((dr) => dr.id === id)
        if (!d) return
        d.parsedWalls = d.parsedWalls.filter((w) => (w.source ?? 'auto') !== 'user')
        s.userTraces = []
        s.seedMode = false
        s.smartStageLabel = 'Heuristic Detection'
      })
    },

    selectDrawing: (id) =>
      set((s) => {
        s.selectedDrawingId = id
      }),

    processDrawing: async (id) => {
      const drawing = get().drawings.find((d) => d.id === id)
      if (!drawing || drawing.status === 'processing') return

      logEvent('drawing.processing.started', { drawingId: id, name: drawing?.name })
      set((s) => {
        const d = s.drawings.find((d) => d.id === id)
        if (d) { d.status = 'processing'; d.parseProgress = 0 }
      })

      // Onboarding 'mixed' has no classifier equivalent — assume standard single-layer
      const onboardingDrywall = loadOnboardingWizardState().meta.drywall
      const drywallCfg = onboardingDrywall === 'mixed' ? 'single-layer' : onboardingDrywall
      const patch = await runProcessor(drawing, (pct) => {
        set((s) => {
          const d = s.drawings.find((d) => d.id === id)
          if (d) d.parseProgress = pct
        })
      }, drywallCfg)

      set((s) => {
        const d = s.drawings.find((d) => d.id === id)
        if (d) {
          if (patch.rasterUrl && d.rasterUrl && patch.rasterUrl !== d.rasterUrl) {
            URL.revokeObjectURL(d.rasterUrl)
          }
          if (patch.parsedWalls) {
            const preservedUser = d.parsedWalls.filter((w) => w.source === 'user')
            patch.parsedWalls = mergeAutoAndUserWalls(
              patch.parsedWalls.filter((w) => (w.source ?? 'auto') !== 'user'),
              preservedUser,
            )
          }
          Object.assign(d, patch)
        }
      })

      if (patch.status === 'ready') {
        logEvent('drawing.processing.completed', {
          drawingId: id,
          wallCount: patch.parsedWalls?.length ?? 0,
          roomCount: patch.parsedRooms?.length ?? 0,
          openingCount: patch.parsedOpenings?.length ?? 0,
          floorNumber: patch.floorNumber,
          scaleNotation: patch.scaleNotation,
        })
      } else if (patch.status === 'error') {
        logError('drawing.processing.failed', patch.errorMessage ?? 'Unknown processing error', {
          drawingId: id,
        })
      }
    },

    toggleLayer: (id) => {
      pushHistory()
      set((s) => {
        const layer = s.layers.find((l) => l.id === id)
        if (layer) layer.visible = !layer.visible
      })
    },

    setLayerOpacity: (id, opacity) => {
      pushHistory()
      set((s) => {
        const layer = s.layers.find((l) => l.id === id)
        if (layer) layer.opacity = opacity
      })
    },

    setSidebarOpen: (open) =>
      set((s) => {
        s.sidebarOpen = open
      }),

    setModelStatus: (status) =>
      set((s) => {
        s.model.status = status
      }),

    buildModel: () => {
      // Frame the walls as part of the 3D build — Build 3D and Build-for-me now
      // produce the same framed result; the Framing toggle controls visibility.
      const framing = computeFramingResult(get().drawings)
      const autoFraming = useConfigStore.getState().buildAutoEnableFraming
      set((s) => {
        s.model.status = s.drawings.length > 0 ? 'building' : 'idle'
        s.model.generatedAt = null
        s.view = 'model'

        // Build floor levels from sheet numbers
        const { levels, floorGroupingLog } = computeFloorLevels(s.drawings)
        s.floorGroupingLog = floorGroupingLog
        s.model.floorLevels = levels

        if (framing) {
          s.buildResult = framing
          s.constructionDecisions = framing.decisions
          const framingLayer = s.layers.find((l) => l.id === 'framing')
          if (framingLayer && autoFraming) framingLayer.visible = true
        }

        logEvent('model.build.started', {
          drawingCount: s.drawings.length,
          floorCount: levels.length,
          framed: framing !== null,
          uncalibratedCount: s.drawings.filter((d) => !d.scaleMmPerPx).length,
        })
      })
    },

    update3DModel: (finalInputs) => {
      pushHistory()
      set((s) => {
        const { levels, floorGroupingLog } = computeFloorLevels(s.drawings)
        s.wizardInputs = finalInputs
        s.floorGroupingLog = floorGroupingLog
        s.model.floorLevels = levels
        s.model.status = 'building'
        s.model.generatedAt = Date.now()
        s.view = 'model'
        logEvent('workspace.wizard.group.completed', {
          completedGroup: finalInputs.completedGroup,
          completedAt: finalInputs.completedAt,
          hasSet1Basics: finalInputs.set1BuildingBasics.length > 0,
          hasSet1Clarifications: finalInputs.set1Clarifications.length > 0,
          hasSet2Details: finalInputs.set2StructuralDetails.length > 0,
          hasSet2Clarifications: finalInputs.set2Clarifications.length > 0,
          hasSet3Finishing: finalInputs.set3FinishingDetails.length > 0,
          hasSet3Clarifications: finalInputs.set3Clarifications.length > 0,
        })
      })
    },

    updateWizardData: (partial) => {
      pushHistory()
      set((s) => {
        s.wizardState = patchWizardData(s.wizardState, partial)
        saveWizardState(s.wizardState)
      })
    },

    jumpToWizardGroup: (groupId) => {
      pushHistory()
      set((s) => {
        s.wizardState = setWizardCurrentGroup(s.wizardState, groupId)
        saveWizardState(s.wizardState)
      })
    },

    completeWizardGroup: (groupId) => {
      pushHistory()
      set((s) => {
        const nextWizardState = completeWizardGroupState(s.wizardState, groupId)
        s.wizardState = nextWizardState
        saveWizardState(s.wizardState)
        const finalInputs: WorkspaceWizardInputs = {
          ...nextWizardState.data,
          completedGroup: groupId,
          completedAt: Date.now(),
        }
        const { levels, floorGroupingLog } = computeFloorLevels(s.drawings)
        s.wizardInputs = finalInputs
        s.floorGroupingLog = floorGroupingLog
        s.model.floorLevels = levels
        s.model.status = 'building'
        s.model.generatedAt = Date.now()
        s.view = 'model'
      })
    },

    resetWizard: () => {
      pushHistory()
      set((s) => {
        s.wizardState = deepCopy(DEFAULT_WIZARD_STATE)
        s.wizardInputs = null
        saveWizardState(s.wizardState)
      })
    },

    loadPresetDrawing: (difficulty, practiceMode) => {
      pushHistory()
      const preset = createPresetDrawing(difficulty, practiceMode)
      set((s) => {
        const { wizardInputs, overlayScale, ...drawingSeed } = preset
        const drawing: Drawing = {
          id: genId(),
          source: 'preset',
          presetDifficulty: difficulty,
          ...drawingSeed,
        }
        drawingPool.set(drawing.id, drawing)
        s.drawings.push(drawing)
        s.selectedDrawingId = drawing.id
        s.floorplanOverlay = {
          ...deepCopy(DEFAULT_FLOORPLAN_OVERLAY),
          drawingId: drawing.id,
          scale: overlayScale,
          calibrationMode: false,
          locked: !practiceMode,
        }
        s.wizardState = {
          ...DEFAULT_WIZARD_STATE,
          currentGroup: 'group3',
          completedGroups: ['group1', 'group2', 'group3'],
          data: {
            set1BuildingBasics: wizardInputs.set1BuildingBasics,
            set1Clarifications: wizardInputs.set1Clarifications,
            set2StructuralDetails: wizardInputs.set2StructuralDetails,
            set2Clarifications: wizardInputs.set2Clarifications,
            set3FinishingDetails: wizardInputs.set3FinishingDetails,
            set3Clarifications: wizardInputs.set3Clarifications,
          },
          savedAt: Date.now(),
        }
        saveWizardState(s.wizardState)
        s.wizardInputs = wizardInputs
        const { floorGroupingLog } = computeFloorLevels(s.drawings)
        s.floorGroupingLog = floorGroupingLog
        s.model = deepCopy(DEFAULT_MODEL)
      })
    },

    setFloorplanOverlayDrawing: (drawingId) =>
      set((s) => {
        s.floorplanOverlay.drawingId = drawingId
      }),

    updateFloorplanOverlay: (patch, recordHistory = true) => {
      if (recordHistory) pushHistory()
      set((s) => {
        s.floorplanOverlay = {
          ...s.floorplanOverlay,
          ...patch,
        }
      })
    },

    undo: () =>
      set((s) => {
        if (s.historyPast.length === 0) return
        const previous = s.historyPast.pop()
        if (!previous) return
        s.historyFuture.push(captureSnapshot(s))
        applySnapshot(s, previous)
      }),

    redo: () =>
      set((s) => {
        if (s.historyFuture.length === 0) return
        const next = s.historyFuture.pop()
        if (!next) return
        s.historyPast.push(captureSnapshot(s))
        applySnapshot(s, next)
      }),

    setMeasureMode: (active) =>
      set((s) => {
        s.measureMode = active
        if (active) s.annotateMode = false  // mutually exclusive with annotate
      }),

    addMeasurement: (m) => {
      pushHistory()
      set((s) => {
        s.measurements.push({
          ...m,
          id: `meas-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          createdAt: Date.now(),
        })
      })
    },

    removeMeasurement: (id) => {
      pushHistory()
      set((s) => {
        const idx = s.measurements.findIndex((m) => m.id === id)
        if (idx !== -1) s.measurements.splice(idx, 1)
      })
    },

    clearMeasurements: () => {
      pushHistory()
      set((s) => {
        s.measurements = []
      })
    },

    setAnnotateMode: (active) =>
      set((s) => {
        s.annotateMode = active
        if (active) s.measureMode = false // mutually exclusive with measure
      }),

    addAnnotation: (annotation) => {
      pushHistory()
      set((s) => {
        const created: Annotation = {
          ...annotation,
          id: `ann-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          createdAt: Date.now(),
        }
        s.annotations.push(created)
        s.selectedAnnotationId = created.id
        saveAnnotations(s.annotations)
      })
    },

    removeAnnotation: (id) => {
      pushHistory()
      set((s) => {
        const idx = s.annotations.findIndex((a) => a.id === id)
        if (idx !== -1) s.annotations.splice(idx, 1)
        if (s.selectedAnnotationId === id) s.selectedAnnotationId = null
        saveAnnotations(s.annotations)
      })
    },

    clearAnnotations: () => {
      pushHistory()
      set((s) => {
        s.annotations = []
        s.selectedAnnotationId = null
        saveAnnotations(s.annotations)
      })
    },

    updateAnnotation: (id, patch) => {
      pushHistory()
      set((s) => {
        const ann = s.annotations.find((a) => a.id === id)
        if (!ann) return
        if (typeof patch.text === 'string') ann.text = patch.text
        if (typeof patch.icon === 'string') ann.icon = patch.icon
        if (typeof patch.color === 'string') ann.color = patch.color
        saveAnnotations(s.annotations)
      })
    },

    setSelectedAnnotationId: (id) =>
      set((s) => {
        s.selectedAnnotationId = id
      }),

    importAnnotations: (rawJson) => {
      pushHistory()
      set((s) => {
        try {
          const parsed = JSON.parse(rawJson)
          if (!Array.isArray(parsed)) throw new Error('Invalid annotation file')
          const normalized = parsed
            .filter((item): item is Annotation => {
              return (
                item &&
                typeof item.id === 'string' &&
                Array.isArray(item.position) &&
                item.position.length === 3 &&
                typeof item.position[0] === 'number' &&
                typeof item.position[1] === 'number' &&
                typeof item.position[2] === 'number' &&
                typeof item.text === 'string' &&
                typeof item.icon === 'string' &&
                typeof item.color === 'string' &&
                typeof item.createdAt === 'number'
              )
            })
            .map((item) => ({
              id: item.id,
              position: [item.position[0], item.position[1], item.position[2]] as [number, number, number],
              text: item.text,
              icon: item.icon,
              color: item.color,
              createdAt: item.createdAt,
            }))
          s.annotations = normalized
          s.selectedAnnotationId = null
          saveAnnotations(s.annotations)
        } catch {
          // Keep existing annotations unchanged on malformed JSON
        }
      })
    },

    setCameraPreset: (p) =>
      set((s) => {
        s.cameraPreset = p
      }),

    consumeCameraPreset: () =>
      set((s) => {
        s.cameraPreset = null
      }),

    setProductCatalog: (items) =>
      set((s) => {
        s.productCatalog = items
      }),

    addProductPlacement: (placement) => {
      pushHistory()
      set((s) => {
        s.productPlacements.push({
          ...placement,
          id: `placement-${Date.now()}-${Math.round(Math.random() * 10000)}`,
          placedAt: Date.now(),
        })
      })
    },

    removeProductPlacement: (id) => {
      pushHistory()
      set((s) => {
        const idx = s.productPlacements.findIndex((p) => p.id === id)
        if (idx !== -1) s.productPlacements.splice(idx, 1)
      })
    },

    clearProductPlacements: () => {
      pushHistory()
      set((s) => {
        s.productPlacements = []
      })
    },

    // ─── Smart Processing Actions ──────────────────────────────────────────────

    startTraceMode: () =>
      set((s) => {
        s.seedMode = true
        s.smartStageLabel = 'Trace Mode: Draw on walls'
      }),

    addTrace: (trace) => {
      set((s) => {
        s.userTraces.push(trace)
      })
    },

    clearTraces: () => {
      pushHistory()
      set((s) => {
        s.userTraces = []
        s.seedMode = false
        s.smartStageLabel = 'Heuristic Detection'
      })
    },

    processWithSeeds: async (drawingId) => {
      const drawing = get().drawings.find((d) => d.id === drawingId)
      if (!drawing) return
      const traces = get().userTraces
      const types = get().projectWallTypes

      set((s) => {
        s.smartProcessor = 'seed-guided'
        s.smartStageLabel = 'Seed-guided Detection'
      })

      const { rasterizeFile } = await import('../services/pdfRasterizer')
      const { detectWalls } = await import('../services/enhancedWallDetector')
      const { extractSeedFromTraces } = await import('../services/seedDetector')

      try {
        const raster = await rasterizeFile(drawing.file, () => {})
        const seeds = extractSeedFromTraces(traces)
        const result = detectWalls(raster.imageData, seeds, types, drawing.scaleMmPerPx, {
          edgeThreshold: 20,
          minWallLengthPx: 40,
          minWallThicknessPx: 2,
          maxWallThicknessPx: 120,
          mergeGapPx: 4,
        })

        set((s) => {
          const d = s.drawings.find((dr) => dr.id === drawingId)
          if (d) {
            const autoWalls = d.parsedWalls.filter((w) => (w.source ?? 'auto') !== 'user')
            const userWalls = d.parsedWalls.filter((w) => w.source === 'user')
            const merged = mergeAutoAndUserWalls(autoWalls, userWalls)
            d.parsedWalls = merged
          }
          s.detectedWallTypes = result
            .filter((w) => w.wallTypeId && w.wallTypeId !== 'unknown')
            .map((w) => ({
              wallId: `${w.x1},${w.y1}`,
              wallType: types.find((t) => t.id === w.wallTypeId)!,
              confidence: w.confidence,
              fromSeed: true,
            }))
            .filter((dwt) => dwt.wallType != null)
          s.smartStageLabel = 'Complete'
        })
      } catch {
        set((s) => { s.smartStageLabel = 'Error' })
      }
    },

    correctElement: (wallId, wallTypeId) => {
      pushHistory()
      set((s) => {
        s.correctionCount += 1
        const idx = s.detectedWallTypes.findIndex((d) => d.wallId === wallId)
        if (idx !== -1) {
          const newType = s.projectWallTypes.find((t) => t.id === wallTypeId)
          if (newType) s.detectedWallTypes[idx] = { ...s.detectedWallTypes[idx], wallType: newType }
        }
      })
    },

    setProjectWallTypes: (types) => {
      pushHistory()
      set((s) => {
        s.projectWallTypes = types
      })
    },

    setWallDetectionConfig: (patch) => {
      set((s) => {
        Object.assign(s.wallDetectionConfig, patch)
      })
    },

    exportCorrectionDataset: () => {
      const state = get()
      return JSON.stringify({
        corrections: state.detectedWallTypes.map((d) => ({
          wallId: d.wallId,
          typeId: d.wallType.id,
          confidence: d.confidence,
          fromSeed: d.fromSeed,
        })),
        correctionCount: state.correctionCount,
      }, null, 2)
    },

    // ─── Construction Engine ──────────────────────────────────────────
    buildForMe: () => {
      const result = computeFramingResult(get().drawings)
      if (!result) return
      const buildAutoEnableFraming = useConfigStore.getState().buildAutoEnableFraming

      pushHistory()
      set((s) => {
        s.buildResult = result
        s.constructionDecisions = result.decisions
        // Auto-enable the framing layer (configurable)
        const framingLayer = s.layers.find((l) => l.id === 'framing')
        if (framingLayer && buildAutoEnableFraming) framingLayer.visible = true
        s.model.status = 'ready'
        s.view = 'model'
      })

      logEvent('construction.build_for_me', {
        componentCount: result.components.length,
        decisionCount: result.decisions.length,
        suggestionCount: result.suggestions.length,
      })
    },

    updateDecision: (decisionId, chosenValue) => {
      pushHistory()
      set((s) => {
        const decision = s.constructionDecisions.find((d) => d.id === decisionId)
        if (decision) {
          decision.chosen = chosenValue
        }
        if (s.buildResult) {
          const bd = s.buildResult.decisions.find((d) => d.id === decisionId)
          if (bd) bd.chosen = chosenValue
        }
      })
    },

    clearBuildResult: () => {
      pushHistory()
      set((s) => {
        s.buildResult = null
        s.constructionDecisions = []
      })
    },

    setPreviewMode: (on) => {
      set((s) => {
        s.previewMode = on
      })
    },

    setExplodeAmount: (amount) => {
      set((s) => {
        s.explodeAmount = Math.max(0, Math.min(1, amount))
      })
    },

    // ─── Placed objects (furniture / fixtures) ────────────────────────
    addPlacedObject: (obj) => {
      pushHistory()
      set((s) => {
        s.placedObjects.push(obj)
      })
    },

    removePlacedObject: (id) => {
      pushHistory()
      set((s) => {
        s.placedObjects = s.placedObjects.filter((o) => o.id !== id)
      })
    },

    updatePlacedObject: (id, patch) => {
      pushHistory()
      set((s) => {
        const obj = s.placedObjects.find((o) => o.id === id)
        if (obj) Object.assign(obj, patch)
      })
    },

    // ─── Trade trace lines (plumbing / electrical) ────────────────────
    addPlumbingLines: (lines) => {
      if (lines.length === 0) return
      pushHistory()
      set((s) => { s.plumbingLines.push(...lines) })
    },

    addElectricalLines: (lines) => {
      if (lines.length === 0) return
      pushHistory()
      set((s) => {
        s.electricalLines.push(...lines)
        // Auto-group traced lines into a circuit by amperage. Append to the
        // most recent traced circuit of that amperage, else create one.
        const ampNum = Number.parseInt(lines[0].size, 10)
        const amperage = ([15, 20, 30, 50].includes(ampNum) ? ampNum : 15) as Circuit['amperage']
        const ids = lines.map((l) => l.id)
        let circuit = [...s.circuits].reverse().find((c) => !c.suggested && c.amperage === amperage)
        if (!circuit) {
          const nextSlot = s.circuits.reduce((m, c) => Math.max(m, c.breaker), 0) + 1
          const count = s.circuits.filter((c) => c.amperage === amperage && !c.suggested).length + 1
          circuit = {
            id: `circuit-${Date.now()}-${s.circuits.length}`,
            label: `${amperage}A Circuit #${count}`,
            amperage,
            breaker: nextSlot,
            lineIds: [],
            type: amperage >= 50 ? 'dedicated' : 'general',
          }
          s.circuits.push(circuit)
        }
        const live = s.circuits.find((c) => c.id === circuit!.id)!
        live.lineIds.push(...ids)
      })
    },

    toggleTradeLayerVisible: (layer) => {
      set((s) => {
        const next = new Set(s.visibleLayers)
        if (next.has(layer)) next.delete(layer)
        else next.add(layer)
        s.visibleLayers = next
      })
    },

    addCircuit: (c) => {
      pushHistory()
      set((s) => { s.circuits.push(c) })
    },

    updateCircuit: (id, patch) => {
      pushHistory()
      set((s) => {
        const c = s.circuits.find((x) => x.id === id)
        if (c) Object.assign(c, patch)
      })
    },
    }
  })
)
