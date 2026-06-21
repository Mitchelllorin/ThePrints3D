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
import { PLUMBING_DEFAULTS, ELECTRICAL_DEFAULTS, HVAC_DEFAULTS, FLOORS_DEFAULTS, ROOF_DEFAULTS } from '../data/traceLayers'
import type { TraceLayer } from '../data/traceLayers'

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
  /** Paused mid-run: the run/anchor is kept, but the camera unlocks so you can
   *  orbit to find the best route (and switch trades), then resume. */
  tracePaused: boolean
  /** Set true right after a wall is traced OFF the print (outside the plan) so a
   *  gentle "did you mean to?" prompt can offer to undo it. */
  offPrintWarn: boolean
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
  activeTraceLayer: TraceLayer
  /** Height band applied to new trade runs (under-floor / in-wall / ceiling). */
  traceBand: 'under-floor' | 'in-wall' | 'ceiling'
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
  // Active HVAC selections (size = round-duct diameter).
  hvacElement: string
  hvacSize: string
  hvacMaterial: string
  // Active floor selections (element = joist type, size = on-centre spacing).
  floorsElement: string
  floorsSize: string
  /** Storey the next floor/roof area is placed on (0 = ground, 1 = 2nd, …). */
  activeLevel: number
  // Active roof selections (element = roof type, size = pitch e.g. '6:12').
  roofElement: string
  roofSize: string

  // ─── editing / selection ─────────────────────────────────────────
  /** Index (within a drawing's user walls) of the selected wall, or null. */
  selectedWallIndex: number | null
  /** Catalog type currently armed for placement (positioned via the ghost). */
  placeObjectType: string | null
  /** Live ghost pose while placing: ground point + auto-oriented yaw. The
   *  "Place" button commits the object here (no precise tap needed). */
  placeGhost: { x: number; z: number; rotationY: number } | null
  /** Bumped by the "Place" button; FloorplanOverlay commits on the change. */
  placeCommitNonce: number
  /** Id of the currently selected placed object, or null. */
  selectedObjectId: string | null
  /** Currently selected traced trade run (for edit-on-the-fly delete), or null. */
  selectedLine: { trade: 'plumbing' | 'electrical' | 'hvac'; id: string } | null
  /**
   * THE single global panel gate — only one overlay UI shows at a time. Every
   * panel/card/picker checks this. Selection data (selectedObjectId /
   * selectedWallIndex) is the content; `activePanel` controls visibility.
   */
  activePanel: 'picker' | 'panelBoard' | 'object' | 'wall' | 'catalog' | 'line' | 'trace' | 'layers' | 'settings' | null

  // ─── UI toggles ──────────────────────────────────────────────────
  presetOpen: boolean
  practiceMode: boolean
  seedProcessing: boolean
  /** Construction wizard panel (re-run from Settings) — mounted by ModelViewer. */
  wizardOpen: boolean
  // ─── retractable edge drawers (left = build, right = settings, bottom = place) ──
  buildDrawerOpen: boolean
  settingsDrawerOpen: boolean
  placeDrawerOpen: boolean

  // ─── actions ─────────────────────────────────────────────────────
  setTraceMode: (v: boolean) => void
  setTracePaused: (v: boolean) => void
  setOffPrintWarn: (v: boolean) => void
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
  setActiveTraceLayer: (v: TraceLayer) => void
  setTraceBand: (v: 'under-floor' | 'in-wall' | 'ceiling') => void
  setPlumb: (patch: Partial<{ plumbElement: string; plumbSize: string; plumbMaterial: string; plumbTemp: 'hot' | 'cold' }>) => void
  setElec: (patch: Partial<{ elecElement: string; elecAmp: string; elecWire: string; elecRole: string }>) => void
  setHvac: (patch: Partial<{ hvacElement: string; hvacSize: string; hvacMaterial: string }>) => void
  setFloors: (patch: Partial<{ floorsElement: string; floorsSize: string }>) => void
  setRoof: (patch: Partial<{ roofElement: string; roofSize: string }>) => void
  setActiveLevel: (v: number) => void
  setDrag: (v: DragState | null) => void
  setSelectedWallIndex: (v: number | null) => void
  setPlaceObjectType: (v: string | null) => void
  setPlaceGhost: (v: { x: number; z: number; rotationY: number } | null) => void
  requestPlaceCommit: () => void
  setSelectedObjectId: (v: string | null) => void
  // Coordinated openers — one panel at a time (each sets activePanel + clears the rest).
  openPicker: () => void
  openPanelBoard: () => void
  toggleCatalog: () => void
  selectObjectExclusive: (id: string) => void
  selectWallExclusive: (i: number) => void
  selectLineExclusive: (trade: 'plumbing' | 'electrical' | 'hvac', id: string) => void
  armPlaceExclusive: (type: string | null) => void
  /** Opens one of the chrome panels (trace/layers/settings); clears any
   *  selection/floater so only one overlay UI shows at a time. */
  setActivePanel: (v: FloorplanLocalState['activePanel']) => void
  closeAllPanels: () => void
  setPresetOpen: (v: boolean) => void
  setPracticeMode: (v: boolean) => void
  setSeedProcessing: (v: boolean) => void
  setWizardOpen: (v: boolean) => void
  /** Open/close an edge drawer. On compact (phone / landscape-short) screens,
   *  opening one retracts the others so they never stack over the workspace. */
  setDrawerOpen: (which: 'build' | 'settings' | 'place', open: boolean) => void
}

export type { CalibrationUnit, DragKind, DragState, TraceStyle }

export const useFloorplanLocalStore = create<FloorplanLocalState>((set, get) => ({
  traceMode: false,
  tracePaused: false,
  offPrintWarn: false,
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
  traceBand: 'under-floor',
  plumbElement: PLUMBING_DEFAULTS.element,
  plumbSize: PLUMBING_DEFAULTS.size,
  plumbMaterial: PLUMBING_DEFAULTS.material,
  plumbTemp: PLUMBING_DEFAULTS.temp,
  elecElement: ELECTRICAL_DEFAULTS.element,
  elecAmp: ELECTRICAL_DEFAULTS.size,
  elecWire: ELECTRICAL_DEFAULTS.material,
  elecRole: ELECTRICAL_DEFAULTS.role,
  hvacElement: HVAC_DEFAULTS.element,
  hvacSize: HVAC_DEFAULTS.size,
  hvacMaterial: HVAC_DEFAULTS.material,
  floorsElement: FLOORS_DEFAULTS.element,
  floorsSize: FLOORS_DEFAULTS.size,
  roofElement: ROOF_DEFAULTS.element,
  roofSize: ROOF_DEFAULTS.size,
  activeLevel: 0,
  selectedWallIndex: null,
  placeObjectType: null,
  placeGhost: null,
  placeCommitNonce: 0,
  selectedObjectId: null,
  selectedLine: null,
  activePanel: null,
  calibrationHandledIds: [],
  distanceUnit: 'ft',
  pendingTraceAfterCalibration: false,
  drag: null,
  presetOpen: false,
  practiceMode: true,
  seedProcessing: false,
  wizardOpen: false,
  buildDrawerOpen: false,
  settingsDrawerOpen: false,
  placeDrawerOpen: false,

  setTraceMode: (v) => set(v ? { traceMode: true, tracePaused: false } : { traceMode: false, tracePaused: false, traceStart: null, traceStroke: [], pendingWalls: null }),
  setTracePaused: (v) => set({ tracePaused: v }),
  setOffPrintWarn: (v) => set({ offPrintWarn: v }),
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
  // Switching discipline drops any in-progress run anchor, so a resumed/new run
  // starts fresh in the newly selected trade instead of chaining from the old.
  // Switching tab also drops back to Ground level, so e.g. tracing walls after a
  // 2nd-floor floor doesn't silently place them up at level 2 (they "vanished").
  setActiveTraceLayer: (v) => set({ activeTraceLayer: v, traceStart: null, activeLevel: 0 }),
  setTraceBand: (v) => set({ traceBand: v }),
  setPlumb: (patch) => set(patch),
  setElec: (patch) => set(patch),
  setHvac: (patch) => set(patch),
  setFloors: (patch) => set(patch),
  setRoof: (patch) => set(patch),
  setActiveLevel: (v) => set({ activeLevel: v }),
  setDrag: (v) => set({ drag: v }),
  setSelectedWallIndex: (v) => set({ selectedWallIndex: v, activePanel: v != null ? 'wall' : null }),
  setPlaceObjectType: (v) => set({ placeObjectType: v, placeGhost: null }),
  setPlaceGhost: (v) => set({ placeGhost: v }),
  requestPlaceCommit: () => set((s) => ({ placeCommitNonce: s.placeCommitNonce + 1 })),
  setSelectedObjectId: (v) => set({ selectedObjectId: v, activePanel: v ? 'object' : null }),
  // One panel at a time: every opener sets activePanel and clears the rest.
  openPicker: () => set({ activePanel: 'picker', selectedObjectId: null, selectedWallIndex: null, selectedLine: null, placeObjectType: null }),
  openPanelBoard: () => set({ activePanel: 'panelBoard', selectedObjectId: null, selectedWallIndex: null, selectedLine: null, placeObjectType: null }),
  toggleCatalog: () => set((s) => s.activePanel === 'catalog'
    ? { activePanel: null }
    : { activePanel: 'catalog', selectedObjectId: null, selectedWallIndex: null, selectedLine: null, placeObjectType: null }),
  selectObjectExclusive: (id) => set({ activePanel: 'object', selectedObjectId: id, selectedWallIndex: null, selectedLine: null, placeObjectType: null }),
  selectWallExclusive: (i) => set({ activePanel: 'wall', selectedWallIndex: i, selectedObjectId: null, selectedLine: null, placeObjectType: null }),
  selectLineExclusive: (trade, id) => set({ activePanel: 'line', selectedLine: { trade, id }, selectedObjectId: null, selectedWallIndex: null, placeObjectType: null }),
  armPlaceExclusive: (type) => set({ activePanel: null, placeObjectType: type, placeGhost: null, selectedObjectId: null, selectedWallIndex: null, selectedLine: null }),
  // Toggling the same panel closes it; opening a different one clears every
  // selection/floater so the single-panel rule holds across both UI systems.
  setActivePanel: (v) => set((s) => v && s.activePanel === v
    ? { activePanel: null }
    : { activePanel: v, selectedObjectId: null, selectedWallIndex: null, selectedLine: null, placeObjectType: null }),
  closeAllPanels: () => set({ activePanel: null, selectedObjectId: null, selectedWallIndex: null, selectedLine: null, placeObjectType: null }),
  setPresetOpen: (v) => set({ presetOpen: v }),
  setPracticeMode: (v) => set({ practiceMode: v }),
  setSeedProcessing: (v) => set({ seedProcessing: v }),
  setWizardOpen: (v) => set({ wizardOpen: v }),
  setDrawerOpen: (which, open) => set(() => {
    const compact = typeof window !== 'undefined'
      && window.matchMedia('(max-width: 767px), (max-height: 600px)').matches
    const base = open && compact
      ? { buildDrawerOpen: false, settingsDrawerOpen: false, placeDrawerOpen: false }
      : {}
    const key = which === 'build' ? 'buildDrawerOpen' : which === 'settings' ? 'settingsDrawerOpen' : 'placeDrawerOpen'
    return { ...base, [key]: open } as Partial<FloorplanLocalState>
  }),
}))
