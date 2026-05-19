import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import type {
  AppView,
  Annotation,
  DetectedWallType,
  Drawing,
  DrawingType,
  FloorLevel,
  Layer,
  LayerId,
  Measurement,
  Model3D,
  UserTrace,
  WallType,
} from '../types'
import { processDrawing as runProcessor } from '../services/drawingProcessor'
import {
  groupByFloorWithLog,
  floorToElevation,
  FLOOR_HEIGHT_M,
  type FloorGroupingLogEntry,
} from '../services/sheetParser'
import { logError, logEvent } from '../services/logger'
import type { ParsedWall } from '../types'
import { mergeAutoAndUserWalls } from '../services/wallTraceReducer'
import { generateModelFromWizardAnswers } from '../services/modelGenerator'
import { defaultSmartProcessingState } from './smartProcessingSlice'

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
    label: 'Walls',
    color: '#e2e8f0',
    visible: true,
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
  {
    id: 'framing',
    label: 'Framing',
    color: '#d97706',
    visible: false,
    opacity: 1,
    sourceTypes: ['floor-plan', 'architectural'],
    icon: '🪵',
  },
  {
    id: 'drywall',
    label: 'Drywall',
    color: '#e2e8f0',
    visible: false,
    opacity: 0.9,
    sourceTypes: ['floor-plan', 'architectural'],
    icon: '🧱',
  },
  {
    id: 'insulation',
    label: 'Insulation',
    color: '#fde68a',
    visible: false,
    opacity: 0.8,
    sourceTypes: ['floor-plan', 'architectural'],
    icon: '🛡️',
  },
  {
    id: 'finishes',
    label: 'Finishes',
    color: '#f9a8d4',
    visible: false,
    opacity: 0.8,
    sourceTypes: ['floor-plan', 'architectural'],
    icon: '🎨',
  },
]

const DEFAULT_MODEL: Model3D = {
  status: 'idle',
  floorLevels: [],
  boundingBox: null,
  scale: 1,
  generatedAt: null,
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
  annotateMode: boolean
  annotations: Annotation[]
  selectedAnnotationId: string | null
  cameraPreset: CameraPreset | null
  productCatalog: ProductCatalogItem[]
  productPlacements: ProductPlacement[]

  // Smart Processing
  smartProcessor: 'heuristic' | 'ai' | 'seed-guided'
  userTraces: UserTrace[]
  seedMode: boolean
  wallTypes: WallType[]
  projectWallTypes: WallType[]
  smartStageLabel: string
  correctionCount: number
  detectedWallTypes: DetectedWallType[]

  // Wizard
  wizardOpen: boolean
  wizardAnswers: Record<string, string | boolean>

  // Actions
  setView: (view: AppView) => void
  addDrawings: (files: File[]) => void
  removeDrawing: (id: string) => void
  updateDrawing: (id: string, patch: Partial<Drawing>) => void
  setDrawingType: (id: string, type: DrawingType) => void
  setDrawingScale: (id: string, mmPerPx: number, notation: string) => void
  addUserTracedWall: (id: string, wall: ParsedWall) => void
  removeLastUserTracedWall: (id: string) => void
  clearUserTracedWalls: (id: string) => void
  undoScaleCalibration: (id: string) => void
  selectDrawing: (id: string | null) => void
  processDrawing: (id: string) => Promise<void>
  toggleLayer: (id: LayerId) => void
  setLayerOpacity: (id: LayerId, opacity: number) => void
  setSidebarOpen: (open: boolean) => void
  setModelStatus: (status: Model3D['status']) => void
  buildModel: () => void
  // Measurements
  setMeasureMode: (active: boolean) => void
  addMeasurement: (m: Omit<Measurement, 'id' | 'createdAt'>) => void
  removeMeasurement: (id: string) => void
  clearMeasurements: () => void
  // Annotations
  setAnnotateMode: (active: boolean) => void
  setSelectedAnnotationId: (id: string | null) => void
  addAnnotation: (ann: Omit<Annotation, 'id' | 'createdAt'>) => void
  removeAnnotation: (id: string) => void
  clearAnnotations: () => void
  updateAnnotation: (id: string, patch: Partial<Pick<Annotation, 'text' | 'icon' | 'color'>>) => void
  importAnnotations: (json: string) => void
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
  // Wizard
  setWizardOpen: (open: boolean) => void
  setWizardAnswer: (questionId: string, value: string | boolean) => void
  clearWizardAnswers: () => void
  updateModelFromWizard: () => void
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

export const useAppStore = create<AppState>()(
  immer((set, get) => ({
    view: 'upload',
    drawings: [],
    layers: DEFAULT_LAYERS,
    model: DEFAULT_MODEL,
    floorGroupingLog: [],
    selectedDrawingId: null,
    sidebarOpen: true,
    measurements: [],
    measureMode: false,
    annotateMode: false,
    annotations: [],
    selectedAnnotationId: null,
    cameraPreset: null,
    productCatalog: [],
    productPlacements: [],

    // Smart processing defaults
    smartProcessor: defaultSmartProcessingState.processor,
    userTraces: defaultSmartProcessingState.userTraces,
    seedMode: defaultSmartProcessingState.seedMode,
    wallTypes: defaultSmartProcessingState.wallTypes,
    projectWallTypes: defaultSmartProcessingState.projectWallTypes,
    smartStageLabel: defaultSmartProcessingState.stageLabel,
    correctionCount: defaultSmartProcessingState.correctionCount,
    detectedWallTypes: [],

    // Wizard defaults
    wizardOpen: false,
    wizardAnswers: {},

    setView: (view) =>
      set((s) => {
        s.view = view
      }),

    addDrawings: (files) =>
      set((s) => {
        for (const file of files) {
          const drawing: Drawing = {
            id: genId(),
            name: file.name,
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
          s.drawings.push(drawing)
          logEvent('drawing.uploaded', {
            drawingId: drawing.id,
            name: drawing.name,
            type: drawing.type,
            fileType: drawing.file.type,
            size: drawing.file.size,
          })
        }
        if (s.view === 'upload') s.view = 'drawings'
      }),

    removeDrawing: (id) =>
      set((s) => {
        const idx = s.drawings.findIndex((d) => d.id === id)
        if (idx !== -1) {
          const previewUrl = s.drawings[idx].previewUrl
          const rasterUrl = s.drawings[idx].rasterUrl
          if (previewUrl) URL.revokeObjectURL(previewUrl)
          if (rasterUrl && rasterUrl !== previewUrl) URL.revokeObjectURL(rasterUrl)
          s.drawings.splice(idx, 1)
        }
        if (s.selectedDrawingId === id) s.selectedDrawingId = null
      }),

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

    setDrawingScale: (id, mmPerPx, notation) =>
      set((s) => {
        const d = s.drawings.find((d) => d.id === id)
        if (d) {
          d._prevScaleMmPerPx = d.scaleMmPerPx
          d._prevScaleNotation = d.scaleNotation
          d._prevScaleConfidence = d.scaleConfidence
          d.scaleMmPerPx = mmPerPx
          d.scaleNotation = notation
          d.scaleConfidence = 'parsed'
        }
      }),

    undoScaleCalibration: (id) =>
      set((s) => {
        const d = s.drawings.find((d) => d.id === id)
        if (d && d._prevScaleMmPerPx !== undefined) {
          d.scaleMmPerPx = d._prevScaleMmPerPx
          d.scaleNotation = d._prevScaleNotation ?? null
          d.scaleConfidence = d._prevScaleConfidence ?? 'fallback'
          d._prevScaleMmPerPx = undefined
          d._prevScaleNotation = undefined
          d._prevScaleConfidence = undefined
        }
      }),

    addUserTracedWall: (id, wall) =>
      set((s) => {
        const d = s.drawings.find((dr) => dr.id === id)
        if (!d) return
        const autoWalls = d.parsedWalls.filter((w) => (w.source ?? 'auto') !== 'user')
        const userWalls = [
          ...d.parsedWalls.filter((w) => w.source === 'user'),
          { ...wall, source: 'user' as const, detectionConfidence: 1 },
        ]
        d.parsedWalls = mergeAutoAndUserWalls(autoWalls, userWalls)
      }),

    removeLastUserTracedWall: (id) =>
      set((s) => {
        const d = s.drawings.find((dr) => dr.id === id)
        if (!d) return
        const userWalls = d.parsedWalls.filter((w) => w.source === 'user')
        if (userWalls.length === 0) return
        userWalls.pop()
        const autoWalls = d.parsedWalls.filter((w) => (w.source ?? 'auto') !== 'user')
        d.parsedWalls = mergeAutoAndUserWalls(autoWalls, userWalls)
      }),

    clearUserTracedWalls: (id) =>
      set((s) => {
        const d = s.drawings.find((dr) => dr.id === id)
        if (!d) return
        d.parsedWalls = d.parsedWalls.filter((w) => (w.source ?? 'auto') !== 'user')
      }),

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

      const patch = await runProcessor(drawing, (pct) => {
        set((s) => {
          const d = s.drawings.find((d) => d.id === id)
          if (d) d.parseProgress = pct
        })
      })

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

    toggleLayer: (id) =>
      set((s) => {
        const layer = s.layers.find((l) => l.id === id)
        if (layer) layer.visible = !layer.visible
      }),

    setLayerOpacity: (id, opacity) =>
      set((s) => {
        const layer = s.layers.find((l) => l.id === id)
        if (layer) layer.opacity = opacity
      }),

    setSidebarOpen: (open) =>
      set((s) => {
        s.sidebarOpen = open
      }),

    setModelStatus: (status) =>
      set((s) => {
        s.model.status = status
      }),

    buildModel: () =>
      set((s) => {
        s.model.status = 'building'
        s.model.generatedAt = null
        s.view = 'model'

        // Build floor levels from sheet numbers
        const { groups: floorGroups, floorGroupingLog } = groupByFloorWithLog(
          s.drawings.map((d) => ({
            id: d.id,
            name: d.name,
            floorNumber: d.floorNumber,
          }))
        )
        s.floorGroupingLog = floorGroupingLog
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
        s.model.floorLevels = levels
        logEvent('model.build.started', {
          drawingCount: s.drawings.length,
          floorCount: levels.length,
          uncalibratedCount: s.drawings.filter((d) => !d.scaleMmPerPx).length,
        })
      }),

    setMeasureMode: (active) =>
      set((s) => {
        s.measureMode = active
        if (active) s.annotateMode = false  // mutually exclusive with annotate
      }),

    addMeasurement: (m) =>
      set((s) => {
        s.measurements.push({
          ...m,
          id: `meas-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          createdAt: Date.now(),
        })
      }),

    removeMeasurement: (id) =>
      set((s) => {
        const idx = s.measurements.findIndex((m) => m.id === id)
        if (idx !== -1) s.measurements.splice(idx, 1)
      }),

    clearMeasurements: () =>
      set((s) => {
        s.measurements = []
      }),

    // ─── Annotations ────────────────────────────────────────────────────────────

    setAnnotateMode: (active) =>
      set((s) => {
        s.annotateMode = active
        if (active) s.measureMode = false
      }),

    setSelectedAnnotationId: (id) =>
      set((s) => { s.selectedAnnotationId = id }),

    addAnnotation: (ann) =>
      set((s) => {
        s.annotations.push({
          ...ann,
          id: `ann-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          createdAt: Date.now(),
        })
      }),

    removeAnnotation: (id) =>
      set((s) => {
        const idx = s.annotations.findIndex((a) => a.id === id)
        if (idx !== -1) s.annotations.splice(idx, 1)
      }),

    clearAnnotations: () =>
      set((s) => { s.annotations = []; s.selectedAnnotationId = null }),

    updateAnnotation: (id, patch) =>
      set((s) => {
        const ann = s.annotations.find((a) => a.id === id)
        if (ann) Object.assign(ann, patch)
      }),

    importAnnotations: (json) =>
      set((s) => {
        try {
          const parsed = JSON.parse(json)
          if (Array.isArray(parsed)) s.annotations = parsed
        } catch { /* ignore */ }
      }),

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

    addProductPlacement: (placement) =>
      set((s) => {
        s.productPlacements.push({
          ...placement,
          id: `placement-${Date.now()}-${Math.round(Math.random() * 10000)}`,
          placedAt: Date.now(),
        })
      }),

    removeProductPlacement: (id) =>
      set((s) => {
        const idx = s.productPlacements.findIndex((p) => p.id === id)
        if (idx !== -1) s.productPlacements.splice(idx, 1)
      }),

    clearProductPlacements: () =>
      set((s) => {
        s.productPlacements = []
      }),

    // ─── Smart Processing Actions ──────────────────────────────────────────────

    startTraceMode: () =>
      set((s) => {
        s.seedMode = true
        s.smartStageLabel = 'Trace Mode: Draw on walls'
      }),

    addTrace: (trace) =>
      set((s) => {
        s.userTraces.push(trace)
      }),

    clearTraces: () =>
      set((s) => {
        s.userTraces = []
        s.seedMode = false
        s.smartStageLabel = 'Heuristic Detection'
      }),

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

    correctElement: (wallId, wallTypeId) =>
      set((s) => {
        s.correctionCount += 1
        const idx = s.detectedWallTypes.findIndex((d) => d.wallId === wallId)
        if (idx !== -1) {
          const newType = s.projectWallTypes.find((t) => t.id === wallTypeId)
          if (newType) s.detectedWallTypes[idx] = { ...s.detectedWallTypes[idx], wallType: newType }
        }
      }),

    setProjectWallTypes: (types) =>
      set((s) => {
        s.projectWallTypes = types
      }),

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

    // ─── Wizard Actions ──────────────────────────────────────────────────────

    setWizardOpen: (open) =>
      set((s) => {
        s.wizardOpen = open
      }),

    setWizardAnswer: (questionId, value) =>
      set((s) => {
        if (value === '' || value === undefined || value === null) {
          delete s.wizardAnswers[questionId]
        } else {
          s.wizardAnswers[questionId] = value
        }
      }),

    clearWizardAnswers: () =>
      set((s) => {
        s.wizardAnswers = {}
      }),

    updateModelFromWizard: () =>
      set((s) => {
        s.model.status = 'building'
        s.model.generatedAt = null

        // Remove previous synthetic drawing
        const synIdx = s.drawings.findIndex((d) => d.id === '_synthetic')
        if (synIdx !== -1) {
          const prev = s.drawings[synIdx]
          if (prev.previewUrl) URL.revokeObjectURL(prev.previewUrl)
          if (prev.rasterUrl) URL.revokeObjectURL(prev.rasterUrl)
          s.drawings.splice(synIdx, 1)
        }

        // Generate new model from current wizard answers
        const hasAnswers = Object.keys(s.wizardAnswers).length > 0
        if (hasAnswers) {
          const synth = generateModelFromWizardAnswers(s.wizardAnswers)
          synth.walls.forEach((w) => {
            ;(w as any)._synth = true
          })
          const syntheticDrawing: Drawing = {
            id: '_synthetic',
            name: 'Generated Model',
            type: 'floor-plan',
            file: new File([], '_synthetic'),
            pageCount: 1,
            currentPage: 1,
            previewUrl: null,
            rasterUrl: null,
            rasterWidth: null,
            rasterHeight: null,
            parsedWalls: synth.walls,
            parsedRooms: synth.rooms,
            parsedOpenings: synth.openings,
            parsedSymbols: synth.symbols,
            parsedText: [],
            parsedAnnotationCandidates: [],
            parseProgress: 100,
            floorNumber: 0,
            status: 'ready',
            scaleMmPerPx: synth.scaleMmPerPx,
            scaleNotation: null,
            scaleConfidence: 'fallback',
            uploadedAt: Date.now(),
          }
          s.drawings.push(syntheticDrawing)
        }

        // Build floor levels
        const { groups: floorGroups, floorGroupingLog } = groupByFloorWithLog(
          s.drawings.map((d) => ({
            id: d.id,
            name: d.name,
            floorNumber: d.floorNumber,
          }))
        )
        s.floorGroupingLog = floorGroupingLog
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
        s.model.floorLevels = levels
        s.view = 'model'
      }),
  }))
)
