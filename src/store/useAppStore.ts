import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import type {
  AppView,
  Drawing,
  DrawingType,
  FloorLevel,
  Layer,
  LayerId,
  Measurement,
  Model3D,
} from '../types'
import { processDrawing as runProcessor } from '../services/drawingProcessor'
import { groupByFloor, floorToElevation, FLOOR_HEIGHT_M, inferFloorNumber } from '../services/sheetParser'
import { logError, logEvent } from '../services/logger'
import type { ParsedWall } from '../types'
import { mergeAutoAndUserWalls } from '../services/wallTraceReducer'

// ─── Camera Presets ────────────────────────────────────────────────────────────
export interface CameraPreset {
  position: [number, number, number]
  target: [number, number, number]
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
  selectedDrawingId: string | null
  sidebarOpen: boolean
  measurements: Measurement[]
  measureMode: boolean
  cameraPreset: CameraPreset | null

  // Actions
  setView: (view: AppView) => void
  addDrawings: (files: File[]) => void
  removeDrawing: (id: string) => void
  updateDrawing: (id: string, patch: Partial<Drawing>) => void
  setDrawingType: (id: string, type: DrawingType) => void
  setDrawingScale: (id: string, mmPerPx: number, notation: string) => void
  addUserTracedWall: (id: string, wall: ParsedWall) => void
  clearUserTracedWalls: (id: string) => void
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
  // Camera
  setCameraPreset: (p: CameraPreset) => void
  consumeCameraPreset: () => void
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
    selectedDrawingId: null,
    sidebarOpen: true,
    measurements: [],
    measureMode: false,
    cameraPreset: null,

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
            parseProgress: 0,
            floorNumber: null,
            status: 'pending',
            scaleMmPerPx: null,
            scaleNotation: null,
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
          d.scaleMmPerPx = mmPerPx
          d.scaleNotation = notation
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
        const floorGroups = groupByFloor(
          s.drawings.map((d) => ({
            id: d.id,
            name: d.name,
            floorNumber: d.floorNumber ?? inferFloorNumber(d.name),
          }))
        )
        const levels: FloorLevel[] = []
        for (const [floorNum, ids] of Array.from(floorGroups.entries()).sort(([a], [b]) => a - b)) {
          levels.push({
            id: `floor-${floorNum}`,
            label: floorNum === 0 ? 'Ground Floor' : floorNum < 0 ? 'Basement' : `Level ${floorNum}`,
            elevation: floorToElevation(floorNum),
            height: FLOOR_HEIGHT_M,
            drawingIds: ids,
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

    setCameraPreset: (p) =>
      set((s) => {
        s.cameraPreset = p
      }),

    consumeCameraPreset: () =>
      set((s) => {
        s.cameraPreset = null
      }),
  }))
)
