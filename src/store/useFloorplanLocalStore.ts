/**
 * Lightweight Zustand store for FloorplanOverlay's local UI state.
 *
 * This state is shared between the 3D layer (inside <Canvas>) and the DOM
 * panel (outside <Canvas>).  Because R3F v9 uses a separate React reconciler,
 * React `useState` can't be shared across the boundary — but Zustand is
 * framework-agnostic and works in both reconcilers.
 */

import { create } from 'zustand'
import type { ParsedWall } from '../types'
import { PLUMBING_DEFAULTS, ELECTRICAL_DEFAULTS } from '../data/traceLayers'

type CalibrationUnit = 'mm' | 'm' | 'ft' | 'in'

/**
 * 'line'     — calibration-style rubber band: tap A, stretchy preview, tap B.
 *              Segments chain (B becomes the next A) so corners connect exactly.
 * 'freehand' — draw a stroke along the wall; it's reduced to a straight segment.
 */
type TraceStyle = 'line' | 'freehand'

type DragKind = 'move' | 'corner' | 'edge' | 'rotate'

interface DragState {
  kind: DragKind
  axis?: 'x' | 'z'
  signX?: 1 | -1
  signZ?: 1 | -1
}

interface FloorplanLocalState {
  // ─── tracing ─────────────────────────────────────────────────────
  traceMode: boolean
  traceStyle: TraceStyle
  /** Anchor of the active rubber-band segment (line style only) */
  traceStart: [number, number] | null
  traceStroke: [number, number][]
  /** Walls reduced from a finished freehand stroke, awaiting keep/discard */
  pendingWalls: ParsedWall[] | null
  hoverPixel: [number, number] | null

  // ─── calibration ─────────────────────────────────────────────────
  calibrationA: [number, number] | null
  calibrationB: [number, number] | null
  distanceInput: string
  /** Drawing ids whose calibration the user has completed or explicitly skipped. */
  calibrationHandledIds: string[]
  distanceUnit: CalibrationUnit
  /** When true, finishing calibration drops straight into trace mode */
  pendingTraceAfterCalibration: boolean

  // ─── drag ────────────────────────────────────────────────────────
  drag: DragState | null

  // ─── active wall type (stamped on every wall traced this session) ─
  /** Framing material/size key, e.g. 'wood-2x6'. */
  activeWallType: string
  /** Structural role key, e.g. 'exterior-bearing'. */
  activeWallRole: string
  /** Active discipline tab. */
  activeTraceLayer: 'framing' | 'plumbing' | 'electrical' | 'hvac'
  // Active plumbing selections (stamped on each plumbing line traced).
  plumbElement: string
  plumbSize: string
  plumbMaterial: string
  plumbTemp: 'hot' | 'cold'
  // Active electrical selections (size = amperage, material = wire gauge).
  elecElement: string
  elecAmp: string
  elecWire: string
  elecRole: string

  // ─── editing / selection ─────────────────────────────────────────
  /** Index (within a drawing's user walls) of the selected wall, or null. */
  selectedWallIndex: number | null
  /** Catalog type currently armed for placement (next canvas click drops it). */
  placeObjectType: string | null
  /** Id of the currently selected placed object, or null. */
  selectedObjectId: string | null
  /**
   * THE single global panel gate — only one overlay UI shows at a time. Every
   * panel/card/picker checks this. Selection data (selectedObjectId /
   * selectedWallIndex) is the content; `activePanel` controls visibility.
   */
  activePanel: 'picker' | 'panelBoard' | 'object' | 'wall' | null

  // ─── UI toggles ──────────────────────────────────────────────────
  presetOpen: boolean
  practiceMode: boolean
  seedProcessing: boolean

  // ─── actions ─────────────────────────────────────────────────────
  setTraceMode: (v: boolean) => void
  setTraceStyle: (v: TraceStyle) => void
  setTraceStart: (v: [number, number] | null) => void
  setTraceStroke: (v: [number, number][] | ((prev: [number, number][]) => [number, number][])) => void
  setPendingWalls: (v: ParsedWall[] | null) => void
  setHoverPixel: (v: [number, number] | null) => void
  setCalibrationA: (v: [number, number] | null) => void
  setCalibrationB: (v: [number, number] | null) => void
  setDistanceInput: (v: string) => void
  markCalibrationHandled: (id: string) => void
  setDistanceUnit: (v: CalibrationUnit) => void
  setPendingTraceAfterCalibration: (v: boolean) => void
  setActiveWallType: (v: string) => void
  setActiveWallRole: (v: string) => void
  setActiveTraceLayer: (v: 'framing' | 'plumbing' | 'electrical' | 'hvac') => void
  setPlumb: (patch: Partial<{ plumbElement: string; plumbSize: string; plumbMaterial: string; plumbTemp: 'hot' | 'cold' }>) => void
  setElec: (patch: Partial<{ elecElement: string; elecAmp: string; elecWire: string; elecRole: string }>) => void
  setDrag: (v: DragState | null) => void
  setSelectedWallIndex: (v: number | null) => void
  setPlaceObjectType: (v: string | null) => void
  setSelectedObjectId: (v: string | null) => void
  // Coordinated openers — one panel at a time (each sets activePanel + clears the rest).
  openPicker: () => void
  openPanelBoard: () => void
  selectObjectExclusive: (id: string) => void
  selectWallExclusive: (i: number) => void
  armPlaceExclusive: (type: string | null) => void
  closeAllPanels: () => void
  setPresetOpen: (v: boolean) => void
  setPracticeMode: (v: boolean) => void
  setSeedProcessing: (v: boolean) => void
}

export type { CalibrationUnit, DragKind, DragState, TraceStyle }

export const useFloorplanLocalStore = create<FloorplanLocalState>((set, get) => ({
  traceMode: false,
  traceStyle: 'line',
  traceStart: null,
  traceStroke: [],
  pendingWalls: null,
  hoverPixel: null,
  calibrationA: null,
  calibrationB: null,
  distanceInput: '',
  activeWallType: 'wood-2x6',
  activeWallRole: 'exterior-bearing',
  activeTraceLayer: 'framing',
  plumbElement: PLUMBING_DEFAULTS.element,
  plumbSize: PLUMBING_DEFAULTS.size,
  plumbMaterial: PLUMBING_DEFAULTS.material,
  plumbTemp: PLUMBING_DEFAULTS.temp,
  elecElement: ELECTRICAL_DEFAULTS.element,
  elecAmp: ELECTRICAL_DEFAULTS.size,
  elecWire: ELECTRICAL_DEFAULTS.material,
  elecRole: ELECTRICAL_DEFAULTS.role,
  selectedWallIndex: null,
  placeObjectType: null,
  selectedObjectId: null,
  activePanel: null,
  calibrationHandledIds: [],
  distanceUnit: 'mm',
  pendingTraceAfterCalibration: false,
  drag: null,
  presetOpen: false,
  practiceMode: true,
  seedProcessing: false,

  setTraceMode: (v) => set(v ? { traceMode: true } : { traceMode: false, traceStart: null, traceStroke: [], pendingWalls: null }),
  setTraceStyle: (v) => set({ traceStyle: v, traceStart: null, traceStroke: [], pendingWalls: null }),
  setTraceStart: (v) => set({ traceStart: v }),
  setPendingWalls: (v) => set({ pendingWalls: v }),
  setTraceStroke: (v) => {
    if (typeof v === 'function') {
      set({ traceStroke: v(get().traceStroke) })
    } else {
      set({ traceStroke: v })
    }
  },
  setHoverPixel: (v) => set({ hoverPixel: v }),
  setCalibrationA: (v) => set({ calibrationA: v }),
  setCalibrationB: (v) => set({ calibrationB: v }),
  setDistanceInput: (v) => set({ distanceInput: v }),
  markCalibrationHandled: (id) => set((s) =>
    s.calibrationHandledIds.includes(id)
      ? s
      : { calibrationHandledIds: [...s.calibrationHandledIds, id] },
  ),
  setDistanceUnit: (v) => set({ distanceUnit: v }),
  setPendingTraceAfterCalibration: (v) => set({ pendingTraceAfterCalibration: v }),
  setActiveWallType: (v) => set({ activeWallType: v }),
  setActiveWallRole: (v) => set({ activeWallRole: v }),
  setActiveTraceLayer: (v) => set({ activeTraceLayer: v }),
  setPlumb: (patch) => set(patch),
  setElec: (patch) => set(patch),
  setDrag: (v) => set({ drag: v }),
  setSelectedWallIndex: (v) => set({ selectedWallIndex: v, activePanel: v != null ? 'wall' : null }),
  setPlaceObjectType: (v) => set({ placeObjectType: v }),
  setSelectedObjectId: (v) => set({ selectedObjectId: v, activePanel: v ? 'object' : null }),
  // One panel at a time: every opener sets activePanel and clears the rest.
  openPicker: () => set({ activePanel: 'picker', selectedObjectId: null, selectedWallIndex: null, placeObjectType: null }),
  openPanelBoard: () => set({ activePanel: 'panelBoard', selectedObjectId: null, selectedWallIndex: null, placeObjectType: null }),
  selectObjectExclusive: (id) => set({ activePanel: 'object', selectedObjectId: id, selectedWallIndex: null, placeObjectType: null }),
  selectWallExclusive: (i) => set({ activePanel: 'wall', selectedWallIndex: i, selectedObjectId: null, placeObjectType: null }),
  armPlaceExclusive: (type) => set({ activePanel: null, placeObjectType: type, selectedObjectId: null, selectedWallIndex: null }),
  closeAllPanels: () => set({ activePanel: null, selectedObjectId: null, selectedWallIndex: null, placeObjectType: null }),
  setPresetOpen: (v) => set({ presetOpen: v }),
  setPracticeMode: (v) => set({ practiceMode: v }),
  setSeedProcessing: (v) => set({ seedProcessing: v }),
}))
