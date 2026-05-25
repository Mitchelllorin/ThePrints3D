import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import type {
  Annotation, Wall3D, WallOpening, Tool3D, FloorplanProjection, TradeLayer, CameraPreset,
  Drawing, Layer, Model3D, Measurement, AppView, WallType, UserTrace, PlacedComponent,
} from '../types'
import type { ProductCatalogItem, ProductPlacement } from '../types/products'
import { buildModelFromWizard, applyDefaultsForMissing } from '../services/wizardModelBuilder'

// ─── Default Trade Layers ──────────────────────────────────────────────────

const DEFAULT_TRADE_LAYERS: TradeLayer[] = [
  { id: 'drywall', label: 'Drywall', visible: true, locked: false, opacity: 1, color: '#e2e8f0', icon: '🧱' },
  { id: 'studs', label: 'Studs', visible: false, locked: false, opacity: 1, color: '#d97706', icon: '🪵' },
  { id: 'electrical', label: 'Electrical', visible: false, locked: false, opacity: 1, color: '#fbbf24', icon: '⚡' },
  { id: 'plumbing', label: 'Plumbing', visible: false, locked: false, opacity: 1, color: '#38bdf8', icon: '💧' },
  { id: 'hvac', label: 'HVAC', visible: false, locked: false, opacity: 1, color: '#a78bfa', icon: '🌀' },
  { id: 'insulation', label: 'Insulation', visible: false, locked: false, opacity: 1, color: '#fde68a', icon: '🛡️' },
  { id: 'flooring', label: 'Flooring', visible: false, locked: false, opacity: 1, color: '#d4a574', icon: '▭' },
  { id: 'ceiling', label: 'Ceiling', visible: false, locked: false, opacity: 1, color: '#f1f5f9', icon: '⬜' },
  { id: 'furniture', label: 'Furniture', visible: false, locked: false, opacity: 1, color: '#86efac', icon: '🪑' },
]

const DEFAULT_FLOORPLAN: FloorplanProjection = {
  imageUrl: null,
  visible: true,
  scale: 1,
  rotation: 0,
  position: [0, 0, 0],
  offsetX: 0,
  offsetZ: 0,
  opacity: 0.6,
}

const DEFAULT_MODEL: Model3D = {
  status: 'idle',
  floorLevels: [],
  boundingBox: null,
  scale: 1,
  generatedAt: null,
}

// ─── Interface ─────────────────────────────────────────────────────────────

interface AppState {
  // UI state
  view: AppView
  activeTool: Tool3D
  currentMode: string
  previousMode: string | null
  modalOpen: string | null
  activePanel: string | null
  sidebarOpen: boolean
  settingsOpen: boolean
  watermarkOpacity: number
  wizardOpen: boolean
  wizardAnswers: Record<string, string>

  // 3D data
  walls: Wall3D[]
  selectedWallId: string | null
  wallTypePromptWallId: string | null
  undoStack: Wall3D[][]
  redoStack: Wall3D[][]
  tradeLayers: TradeLayer[]
  model: Model3D
  layers: Layer[]
  measurements: Measurement[]
  measureMode: boolean
  annotateMode: boolean

  // Floorplan
  floorplan: FloorplanProjection

  // Annotations
  annotations: Annotation[]
  selectedAnnotationId: string | null

  // Camera
  cameraPreset: CameraPreset | null

  // Drawing state
  drawStart: [number, number, number] | null
  drawings: Drawing[]
  selectedDrawingId: string | null
  calibrationPendingDrawingId: string | null
  calibrationPtA: [number, number, number] | null
  calibrationPtB: [number, number, number] | null

  // Smart processing
  userTraces: UserTrace[]
  traceMode: boolean

  // Wall types
  projectWallTypes: WallType[]
  detectedWallTypes: { wallId: string; wallType: WallType; confidence: number }[]

  // Components (doors, windows, furniture, fixtures)
  components: PlacedComponent[]

  // Product catalog
  productCatalog: ProductCatalogItem[]
  productPlacements: ProductPlacement[]

  // Actions
  setView: (v: AppView) => void
  setActiveTool: (tool: Tool3D) => void
  setCurrentMode: (mode: string) => void
  setPreviousMode: (mode: string | null) => void
  setModalOpen: (modal: string | null) => void
  setActivePanel: (panel: string | null) => void
  setSidebarOpen: (open: boolean) => void
  setSettingsOpen: (open: boolean) => void
  setWatermarkOpacity: (opacity: number) => void

  // Wizard
  setWizardOpen: (open: boolean) => void
  setWizardAnswer: (key: string, value: string) => void
  setWizardAnswers: (answers: Record<string, string>) => void
  updateModelFromWizard: () => void

  // Wall actions
  addWall: (wall: Omit<Wall3D, 'id'>) => void
  updateWall: (id: string, patch: Partial<Wall3D>) => void
  removeWall: (id: string) => void
  setSelectedWallId: (id: string | null) => void
  setWallTypePromptWallId: (id: string | null) => void
  clearWalls: () => void
  setDrawStart: (p: [number, number, number] | null) => void

  // Undo / Redo
  pushUndo: () => void
  undo: () => void
  redo: () => void

  // Trade layers
  toggleTradeLayer: (id: string) => void

  // Layers
  toggleLayer: (id: string) => void
  setLayerOpacity: (id: string, opacity: number) => void
  setLayerLock: (id: string, locked: boolean) => void
  toggleTradeLayerLock: (id: string) => void
  setTradeLayerOpacity: (id: string, opacity: number) => void

  // Floorplan
  setFloorplanImage: (url: string | null) => void
  setFloorplanVisible: (v: boolean) => void
  setFloorplanScale: (s: number) => void
  setFloorplanRotation: (r: number) => void
  setFloorplanOffset: (x: number, z: number) => void
  setFloorplanOpacity: (opacity: number) => void

  // Annotations
  addAnnotation: (ann: Omit<Annotation, 'id' | 'createdAt'>) => void
  removeAnnotation: (id: string) => void
  setSelectedAnnotationId: (id: string | null) => void
  clearAnnotations: () => void
  updateAnnotation: (id: string, patch: Partial<Annotation>) => void
  importAnnotations: (anns: Annotation[]) => void

  // Camera
  setCameraPreset: (p: CameraPreset) => void
  consumeCameraPreset: () => CameraPreset | null

  // Drawings
  addDrawings: (files: File[]) => void
  removeDrawing: (id: string) => void
  updateDrawing: (id: string, patch: Partial<Drawing>) => void
  setDrawingType: (id: string, type: Drawing['type']) => void
  selectDrawing: (id: string | null) => void
  processDrawing: (id: string) => void
  buildModel: () => void
  setCalibrationPendingDrawingId: (id: string | null) => void
  setCalibrationPtA: (pt: [number, number, number] | null) => void
  setCalibrationPtB: (pt: [number, number, number] | null) => void
  clearCalibrationPoints: () => void
  setDrawingScale: (id: string, scaleMmPerPx: number, notation: string | null, confidence: Drawing['scaleConfidence']) => void
  undoScaleCalibration: (id: string) => void
  addUserTracedWall: (drawingId: string, wall: { x1: number; y1: number; x2: number; y2: number; thickness: number; framingMm?: number; finishedMm?: number; wallType?: unknown; isLoadBearing?: boolean; isInternal?: boolean }) => void
  removeLastUserTracedWall: (drawingId: string) => void
  clearUserTracedWalls: (drawingId: string) => void

  // Measurements
  setMeasureMode: (on: boolean) => void
  addMeasurement: (m: Omit<Measurement, 'id' | 'createdAt'>) => void
  removeMeasurement: (id: string) => void
  clearMeasurements: () => void

  // Annotate mode
  setAnnotateMode: (on: boolean) => void

  // Model
  setModelStatus: (status: Model3D['status']) => void

  // Smart processing / seed-guided detection
  startTraceMode: () => void
  addTrace: (trace: UserTrace) => void
  clearTraces: () => void
  processWithSeeds: (drawingId: string) => void

  // Wall types
  setProjectWallTypes: (types: WallType[]) => void

  // Components
  addComponent: (c: Omit<PlacedComponent, 'id'>) => void
  removeComponent: (id: string) => void
  updateComponent: (id: string, patch: Partial<PlacedComponent>) => void
  clearComponents: () => void

  // Wall openings
  addOpening: (wallId: string, opening: Omit<WallOpening, 'id' | 'wallId'>) => void
  removeOpening: (wallId: string, openingId: string) => void

  // Product catalog
  setProductCatalog: (catalog: ProductCatalogItem[]) => void
  addProductPlacement: (placement: Omit<ProductPlacement, 'id' | 'placedAt'>) => void
  removeProductPlacement: (id: string) => void
  clearProductPlacements: () => void
}

// ─── Store ─────────────────────────────────────────────────────────────────

export const useAppStore = create<AppState>()(
  immer((set, get) => ({
    view: 'workspace',
    activeTool: 'select',
    currentMode: 'idle',
    previousMode: null,
    modalOpen: null,
    activePanel: null,
    sidebarOpen: true,
    settingsOpen: false,
    watermarkOpacity: 0.08,
    wizardOpen: false,
    wizardAnswers: {},

  walls: [],
  selectedWallId: null,
  wallTypePromptWallId: null,
  undoStack: [],
  redoStack: [],
  tradeLayers: DEFAULT_TRADE_LAYERS,
    model: DEFAULT_MODEL,
    layers: [],
    measurements: [],
    measureMode: false,
    annotateMode: false,

    floorplan: DEFAULT_FLOORPLAN,

    annotations: [],
    selectedAnnotationId: null,
    cameraPreset: null,
    drawStart: null,
    drawings: [],
    selectedDrawingId: null,
    calibrationPendingDrawingId: null,
    calibrationPtA: null,
    calibrationPtB: null,

    userTraces: [],
    traceMode: false,

    projectWallTypes: [],
    detectedWallTypes: [],

    components: [],
    productCatalog: [],
    productPlacements: [],

    // ─── UI Actions ───────────────────────────────────────────

    setView: (v) => set((s) => { s.view = v }),
    setActiveTool: (tool) => set((s) => {
      s.previousMode = s.currentMode
      s.activeTool = tool
      s.currentMode = tool !== 'select' ? `tool-${tool}` : 'idle'
    }),
    setCurrentMode: (mode) => set((s) => { s.currentMode = mode }),
    setPreviousMode: (mode) => set((s) => { s.previousMode = mode }),
    setModalOpen: (modal) => set((s) => {
      s.previousMode = s.currentMode
      s.modalOpen = modal
      s.currentMode = modal ? 'modal' : (s.previousMode || 'idle')
    }),
    setActivePanel: (panel) => set((s) => {
      s.activePanel = panel
      s.sidebarOpen = !!panel
    }),
    setSidebarOpen: (open) => set((s) => { s.sidebarOpen = open }),
    setSettingsOpen: (open) => set((s) => { s.settingsOpen = open }),
    setWatermarkOpacity: (opacity) => set((s) => { s.watermarkOpacity = opacity }),

    // ─── Wizard ───────────────────────────────────────────────

    setWizardOpen: (open) => set((s) => { s.wizardOpen = open }),
    setWizardAnswer: (key, value) => set((s) => { s.wizardAnswers[key] = value }),
    setWizardAnswers: (answers) => set((s) => {
      for (const [k, v] of Object.entries(answers)) {
        s.wizardAnswers[k] = v
      }
    }),
    updateModelFromWizard: () => set((s) => {
      const filled = applyDefaultsForMissing(s.wizardAnswers)
      s.wizardAnswers = filled
      const result = buildModelFromWizard(filled)
      s.undoStack.push(JSON.parse(JSON.stringify(s.walls)))
      s.redoStack = []
      s.walls = result.walls.map((w) => ({
        ...w,
        id: `wiz-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        openings: (w.openings || []).map((o) => ({
          ...o,
          id: `wiz-open-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        })),
      }))
      s.components = result.components.map((c) => ({
        ...c,
        id: `wiz-comp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      }))
      for (const upd of result.tradeLayerUpdates) {
        const tl = s.tradeLayers.find((l) => l.id === upd.id)
        if (tl) {
          tl.visible = upd.visible
          tl.opacity = upd.opacity
        }
      }
      s.model.status = 'ready'
      s.model.boundingBox = result.boundingBox
      s.model.generatedAt = Date.now()
    }),

    // ─── Wall Actions ─────────────────────────────────────────

    addWall: (wall) => set((s) => {
      s.undoStack.push(JSON.parse(JSON.stringify(s.walls)))
      s.redoStack = []
      const id = `wall-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      s.walls.push({ ...wall, id, type: wall.type ?? 'stud' })
      s.wallTypePromptWallId = id
    }),
    updateWall: (id, patch) => set((s) => {
      s.undoStack.push(JSON.parse(JSON.stringify(s.walls)))
      s.redoStack = []
      const w = s.walls.find((w) => w.id === id)
      if (w) Object.assign(w, patch)
    }),
    removeWall: (id) => set((s) => {
      s.undoStack.push(JSON.parse(JSON.stringify(s.walls)))
      s.redoStack = []
      s.walls = s.walls.filter((w) => w.id !== id)
      if (s.selectedWallId === id) s.selectedWallId = null
    }),
    setSelectedWallId: (id) => set((s) => { s.selectedWallId = id }),
    setWallTypePromptWallId: (id) => set((s) => { s.wallTypePromptWallId = id }),
    clearWalls: () => set((s) => {
      s.undoStack.push(JSON.parse(JSON.stringify(s.walls)))
      s.redoStack = []
      s.walls = []; s.selectedWallId = null
    }),
    setDrawStart: (p) => set((s) => { s.drawStart = p }),
    pushUndo: () => set((s) => {
      s.undoStack.push(JSON.parse(JSON.stringify(s.walls)))
      s.redoStack = []
    }),
    undo: () => set((s) => {
      const prev = s.undoStack.pop()
      if (prev) {
        s.redoStack.push(JSON.parse(JSON.stringify(s.walls)))
        s.walls = prev
      }
    }),
    redo: () => set((s) => {
      const next = s.redoStack.pop()
      if (next) {
        s.undoStack.push(JSON.parse(JSON.stringify(s.walls)))
        s.walls = next
      }
    }),

    // ─── Trade Layers ─────────────────────────────────────────

    toggleTradeLayer: (id) => set((s) => {
      const layer = s.tradeLayers.find((l) => l.id === id)
      if (layer && !layer.locked) layer.visible = !layer.visible
    }),
    toggleTradeLayerLock: (id) => set((s) => {
      const layer = s.tradeLayers.find((l) => l.id === id)
      if (layer) layer.locked = !layer.locked
    }),
    setTradeLayerOpacity: (id, opacity) => set((s) => {
      const layer = s.tradeLayers.find((l) => l.id === id)
      if (layer) layer.opacity = Math.max(0, Math.min(1, opacity))
    }),

    // ─── Layers ───────────────────────────────────────────────

    toggleLayer: (id) => set((s) => {
      const layer = s.layers.find((l) => l.id === id)
      if (layer) layer.visible = !layer.visible
    }),
    setLayerOpacity: (id, opacity) => set((s) => {
      const layer = s.layers.find((l) => l.id === id)
      if (layer) layer.opacity = opacity
    }),
    setLayerLock: (id, locked) => set((s) => {
      const layer = s.layers.find((l) => l.id === id)
      if (layer) layer.locked = locked
    }),

    // ─── Floorplan ────────────────────────────────────────────

    setFloorplanImage: (url) => set((s) => { s.floorplan.imageUrl = url }),
    setFloorplanVisible: (v) => set((s) => { s.floorplan.visible = v }),
    setFloorplanScale: (scl) => set((s) => { s.floorplan.scale = scl }),
    setFloorplanRotation: (r) => set((s) => { s.floorplan.rotation = r }),
    setFloorplanOffset: (x, z) => set((s) => {
      s.floorplan.offsetX = x
      s.floorplan.offsetZ = z
    }),
    setFloorplanOpacity: (opacity) => set((s) => { s.floorplan.opacity = opacity }),

    // ─── Annotations ──────────────────────────────────────────

    addAnnotation: (ann) => set((s) => {
      s.annotations.push({
        ...ann,
        id: `ann-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        createdAt: Date.now(),
      })
    }),
    removeAnnotation: (id) => set((s) => {
      s.annotations = s.annotations.filter((a) => a.id !== id)
      if (s.selectedAnnotationId === id) s.selectedAnnotationId = null
    }),
    setSelectedAnnotationId: (id) => set((s) => { s.selectedAnnotationId = id }),
    clearAnnotations: () => set((s) => { s.annotations = []; s.selectedAnnotationId = null }),
    updateAnnotation: (id, patch) => set((s) => {
      const a = s.annotations.find((a) => a.id === id)
      if (a) Object.assign(a, patch)
    }),
    importAnnotations: (anns) => set((s) => {
      s.annotations = anns
    }),

    // ─── Camera ───────────────────────────────────────────────

    setCameraPreset: (p) => set((s) => { s.cameraPreset = p }),
    consumeCameraPreset: () => {
      const preset = get().cameraPreset
      if (preset) set((s) => { s.cameraPreset = null })
      return preset
    },

    // ─── Drawings ─────────────────────────────────────────────

    addDrawings: (files) => set((s) => {
      for (const file of files) {
        s.drawings.push({
          id: `drawing-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          name: file.name,
          type: 'floor-plan',
          file,
          pageCount: 1,
          currentPage: 1,
          previewUrl: null,
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
          status: 'pending',
          floorNumber: null,
          scaleMmPerPx: null,
          scaleNotation: null,
          scaleConfidence: null,
          uploadedAt: Date.now(),
        })
      }
    }),
    removeDrawing: (id) => set((s) => {
      s.drawings = s.drawings.filter((d) => d.id !== id)
      if (s.selectedDrawingId === id) s.selectedDrawingId = null
    }),
    updateDrawing: (id, patch) => set((s) => {
      const d = s.drawings.find((d) => d.id === id)
      if (d) Object.assign(d, patch)
    }),
    setDrawingType: (id, type) => set((s) => {
      const d = s.drawings.find((d) => d.id === id)
      if (d) d.type = type
    }),
    selectDrawing: (id) => set((s) => { s.selectedDrawingId = id }),
    setCalibrationPendingDrawingId: (id) => set((s) => { s.calibrationPendingDrawingId = id; if (!id) { s.calibrationPtA = null; s.calibrationPtB = null } }),
    setCalibrationPtA: (pt) => set((s) => { s.calibrationPtA = pt }),
    setCalibrationPtB: (pt) => set((s) => { s.calibrationPtB = pt }),
    clearCalibrationPoints: () => set((s) => { s.calibrationPtA = null; s.calibrationPtB = null }),
    processDrawing: (id) => {
      set((s) => {
        const d = s.drawings.find((d) => d.id === id)
        if (d) d.status = 'processing'
      })
      const drawing = get().drawings.find((d) => d.id === id)
      if (!drawing) return
      import('../services/drawingProcessor').then(({ processDrawing }) => {
        processDrawing(drawing, (pct) => {
          set((s) => {
            const d = s.drawings.find((d) => d.id === id)
            if (d) d.parseProgress = pct
          })
        }).then((patch) => {
          set((s) => {
            const d = s.drawings.find((d) => d.id === id)
            if (d) Object.assign(d, patch)
          })
        }).catch(() => {
          set((s) => {
            const d = s.drawings.find((d) => d.id === id)
            if (d) { d.status = 'error'; d.errorMessage = 'Processing failed' }
          })
        })
      })
    },
    buildModel: () => set((s) => { s.model.status = 'building' }),
    setDrawingScale: (id, scaleMmPerPx, notation, confidence) => set((s) => {
      const d = s.drawings.find((d) => d.id === id)
      if (d) {
        d._prevScaleMmPerPx = d.scaleMmPerPx
        d._prevScaleNotation = d.scaleNotation
        d._prevScaleConfidence = d.scaleConfidence
        d.scaleMmPerPx = scaleMmPerPx
        d.scaleNotation = notation
        d.scaleConfidence = confidence
      }
    }),
    undoScaleCalibration: (id) => set((s) => {
      const d = s.drawings.find((d) => d.id === id)
      if (d && d._prevScaleMmPerPx !== undefined) {
        d.scaleMmPerPx = d._prevScaleMmPerPx
        d.scaleNotation = d._prevScaleNotation ?? null
        d.scaleConfidence = d._prevScaleConfidence ?? null
        d._prevScaleMmPerPx = undefined
        d._prevScaleNotation = undefined
        d._prevScaleConfidence = undefined
      }
    }),
    addUserTracedWall: (drawingId, wall) => set((s) => {
      const d = s.drawings.find((d) => d.id === drawingId)
      if (d) {
        const { framingMm, finishedMm, wallType: wt, isLoadBearing, isInternal, ...rest } = wall
        d.parsedWalls.push({
          ...rest,
          framingMm, finishedMm, wallType: wt as any, isLoadBearing, isInternal,
          source: 'user', detectionConfidence: 1,
        })
      }
    }),
    removeLastUserTracedWall: (drawingId) => set((s) => {
      const d = s.drawings.find((d) => d.id === drawingId)
      if (d) {
        const lastUserIdx = [...d.parsedWalls].reverse().findIndex((w) => w.source === 'user')
        if (lastUserIdx !== -1) {
          d.parsedWalls.splice(d.parsedWalls.length - 1 - lastUserIdx, 1)
        }
      }
    }),
    clearUserTracedWalls: (drawingId) => set((s) => {
      const d = s.drawings.find((d) => d.id === drawingId)
      if (d) {
        d.parsedWalls = d.parsedWalls.filter((w) => w.source !== 'user')
      }
    }),

    // ─── Measurements ─────────────────────────────────────────

    setMeasureMode: (on) => set((s) => { s.measureMode = on }),
    addMeasurement: (m) => set((s) => {
      s.measurements.push({
        ...m,
        id: `meas-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        createdAt: Date.now(),
      })
    }),
    removeMeasurement: (id) => set((s) => {
      s.measurements = s.measurements.filter((m) => m.id !== id)
    }),
    clearMeasurements: () => set((s) => { s.measurements = [] }),

    // ─── Annotate Mode ────────────────────────────────────────

    setAnnotateMode: (on) => set((s) => { s.annotateMode = on }),

    // ─── Model ────────────────────────────────────────────────

    setModelStatus: (status) => set((s) => { s.model.status = status }),

    // ─── Smart Processing ─────────────────────────────────────

    startTraceMode: () => set((s) => { s.traceMode = true }),
    addTrace: (trace) => set((s) => { s.userTraces.push(trace) }),
    clearTraces: () => set((s) => { s.userTraces = []; s.traceMode = false }),
    processWithSeeds: (drawingId) => set((s) => {
      const d = s.drawings.find((d) => d.id === drawingId)
      if (d) d.status = 'processing'
    }),

    // ─── Wall Types ───────────────────────────────────────────

    setProjectWallTypes: (types) => set((s) => { s.projectWallTypes = types }),

    // ─── Components ───────────────────────────────────────────

    addComponent: (c) => set((s) => {
      s.components.push({
        ...c,
        id: `comp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      })
    }),
    removeComponent: (id) => set((s) => {
      s.components = s.components.filter((c) => c.id !== id)
    }),
    updateComponent: (id, patch) => set((s) => {
      const c = s.components.find((c) => c.id === id)
      if (c) Object.assign(c, patch)
    }),
    clearComponents: () => set((s) => { s.components = [] }),

    // ─── Wall Openings ────────────────────────────────────────

    addOpening: (wallId, opening) => set((s) => {
      const w = s.walls.find((w) => w.id === wallId)
      if (w) {
        if (!w.openings) w.openings = []
        w.openings.push({
          ...opening,
          id: `open-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          wallId,
        })
      }
    }),
    removeOpening: (wallId, openingId) => set((s) => {
      const w = s.walls.find((w) => w.id === wallId)
      if (w && w.openings) {
        w.openings = w.openings.filter((o) => o.id !== openingId)
      }
    }),

    // ─── Product Catalog ──────────────────────────────────────

    setProductCatalog: (catalog) => set((s) => { s.productCatalog = catalog }),
    addProductPlacement: (placement) => set((s) => {
      s.productPlacements.push({
        ...placement,
        id: `prod-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        placedAt: Date.now(),
      })
    }),
    removeProductPlacement: (id) => set((s) => {
      s.productPlacements = s.productPlacements.filter((p) => p.id !== id)
    }),
    clearProductPlacements: () => set((s) => { s.productPlacements = [] }),
  }))
)
