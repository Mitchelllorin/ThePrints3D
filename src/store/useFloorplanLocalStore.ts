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

type DragKind = 'move' | 'corner' | 'edge' | 'rotate' | 'wall' | 'wall-end'

/** What kind of model element an edit-mode hover/select points at. */
export type EditKind = 'floor' | 'roof' | 'wall' | 'object' | 'line' | 'member'

/**
 * HOW BIG A THING A TAP PICKS.
 *
 * Everything used to select as an ASSEMBLY: you tapped a stud and got the whole
 * wall. That is right most of the time — you usually mean "this wall" — and
 * useless the rest of it, because a wall is made of sticks and sometimes the
 * stick is the thing you care about.
 *
 * So it is a stated mode rather than a guess. Guessing from tap duration or
 * zoom level makes an already-sensitive editor unpredictable; a switch you can
 * see means you always know what the next tap will do.
 *
 * It is deliberately ONE setting for the whole model rather than per-layer,
 * because the distinction is identical everywhere: wall/stud, deck/joist,
 * roof/rafter. Every one of those members already renders as its own mesh
 * carrying its own id and label, so 'member' costs nothing extra to support.
 */
export type SelectionGranularity =
  /** The wall, the deck, the roof plane — the thing as a whole. */
  | 'assembly'
  /** The individual stud, plate, header, joist or rafter that was tapped. */
  | 'member'

/**
 * Default stud size for a wall's structural ROLE.
 *
 * Exterior walls carry the roof and the insulation; interior walls mostly divide
 * space. They are not the same stick of wood, so one global default cannot serve
 * both — and 2x6 everywhere framed every interior wall too thick, which throws
 * the whole model out of scale. Exterior defaults to 2x8, interior to 2x4.
 *
 * A default only, in both directions: pick a size by hand and it sticks (see
 * `wallTypeChosen`).
 */
export function defaultWallTypeForRole(role: string): string {
  return role === 'exterior-bearing' ? 'wood-2x8' : 'wood-2x4'
}
/** A hovered/selected element in edit-everything mode. */
export interface EditTarget { kind: EditKind; id: string }

/**
 * An upper-floor wall that landed close to — but not lined up with — a wall on
 * the storey below. Surfaced as a gentle "line it up?" prompt so the app flags
 * the deviation (floors normally stack) without forcing it: the user decides.
 */
export interface PlumbNudge {
  drawingId: string
  /** Index of the offending wall among the drawing's user walls. */
  userIndex: number
  /** How far off the wall below it is, in mm (for the prompt copy). */
  offMm: number
  /** Where the wall would sit if lined up over the one below. */
  target: { x1: number; y1: number; x2: number; y2: number }
}

interface DragState {
  kind: DragKind
  axis?: 'x' | 'z'
  signX?: 1 | -1
  signZ?: 1 | -1
  /** For 'wall' / 'wall-end' drags: which user wall is being moved. */
  wallIndex?: number
  /** For 'wall-end' drags: which endpoint slides. */
  end?: 'start' | 'end'
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
  /** Set when an upper-floor wall lands near-but-not-aligned with the one below,
   *  so a "line it up?" prompt can surface. Null when there's nothing to flag. */
  plumbNudge: PlumbNudge | null
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
  /** Framing material/size key, e.g. 'wood-2x8'. */
  activeWallType: string
  /** Structural role key, e.g. 'exterior-bearing'. */
  activeWallRole: string
  /** True once the user has picked a wall ROLE by hand. Until then the role is
   *  inferred from where the wall is drawn (see inferWallRole); after it, their
   *  choice is stamped on every wall until they change it again. */
  wallRoleChosen: boolean
  /** True once the user has picked a stud size by hand. Until then the size
   *  follows the wall's role (see `defaultWallTypeForRole`); after it, their
   *  choice wins and the role stops overriding it. */
  wallTypeChosen: boolean
  /** Walls snap SQUARE (to the nearest axis) unless this is off. On by default:
   *  buildings are square, so a diagonal is the exception you ask for. */
  squareWalls: boolean
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

  // ─── floor isolation / ghost ─────────────────────────────────────
  /** When non-null, only this floor level is fully visible; others are hidden.
   *  Toggling the same floor again returns to show-all (null). */
  isolatedFloor: number | null
  /** Set of floor levels that are semi-transparent ("ghosted") via double-tap.
   *  Lets the user see through a level to inspect the one below it. */
  ghostedLevels: number[]

  // ─── editing / selection ─────────────────────────────────────────
  /** Index (within a drawing's user walls) of the selected wall, or null. */
  selectedWallIndex: number | null
  /** Catalog type currently armed for placement (positioned via the ghost). */
  placeObjectType: string | null
  /** Stair settings chosen BEFORE placing, stamped onto the stair when it lands.
   *  You size a stair to the hole it has to fit, so deciding after you have
   *  dropped it is backwards — and the ghost can show the real footprint while
   *  you aim. Cleared when the placement is disarmed. */
  placeStairCfg: { subtype?: string; treadM?: number; stairWidthM?: number; landingM?: number | null }
  /** When on, placement stays armed after each drop so you can place several
   *  (e.g. a row of electrical boxes) without re-selecting from the tray. */
  keepPlacing: boolean
  /** Live ghost pose while placing: ground point + auto-oriented yaw. The
   *  "Place" button commits the object here (no precise tap needed). */
  placeGhost: { x: number; z: number; rotationY: number } | null
  /** Bumped by the "Place" button; FloorplanOverlay commits on the change. */
  placeCommitNonce: number
  /** Id of the currently selected placed object, or null. */
  selectedObjectId: string | null
  /** Object whose parts are detail-exploded (spread to show components), or null. */
  detailExplodeId: string | null
  /** When true, the selected wall's framing spreads apart to show its members. */
  wallDetailExplode: boolean
  /** Currently selected traced trade run (for edit-on-the-fly delete), or null. */
  selectedLine: { trade: 'plumbing' | 'electrical' | 'hvac'; id: string } | null
  /** Currently selected floor/roof area (tap to select → delete/clone), or null. */
  selectedArea: { kind: 'floor' | 'roof'; id: string } | null

  // ─── edit-everything mode (post-build direct manipulation) ───────
  /** Post-build "Edit Everything": hover-highlight + select + drag any element.
   *  ON → the whole model is grabbable; OFF → locked back to normal viewing. */
  /** True while ANY layer owns the pointer for a drag — roof ridge, roof body,
   *  floor deck, placed object. The camera must not orbit underneath a gesture
   *  or you fight the workspace the whole time you are editing. Layers raise it
   *  on drag start and clear it on end. Print-overlay/wall drags already lock via
   *  floorplanOverlay.orbitLocked; this covers every other layer. */
  gestureLock: boolean
  /** Trim mode: the next tap on a wall removes the PIECE you tapped, instead of
   *  selecting the wall. Armed from the selected wall's card, disarms after one
   *  trim (or on Escape) so a stray tap can never eat a wall. */
  wallTrimArmed: boolean
  editMode: boolean
  /** Whether a tap picks a whole assembly or the single member under it. */
  selectionGranularity: SelectionGranularity
  /** Element currently hovered while in edit mode (drives the hover highlight). */
  editHover: EditTarget | null
  /** Element selected in edit mode (persistent highlight + modify chip). Kept
   *  separate from `selectedArea` so it never opens the drawer "area" card. */
  editSelected: EditTarget | null
  /**
   * THE single global panel gate — only one overlay UI shows at a time. Every
   * panel/card/picker checks this. Selection data (selectedObjectId /
   * selectedWallIndex) is the content; `activePanel` controls visibility.
   */
  activePanel: 'picker' | 'panelBoard' | 'object' | 'wall' | 'catalog' | 'line' | 'area' | 'trace' | 'layers' | 'settings' | null

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
  askDrawerOpen: boolean

  // ─── guided tutorial (the "build a whole house" walkthrough) ──────
  /** Tutorial running — the coach card is shown and tracks the current step. */
  tutorialActive: boolean
  /** Index into TUTORIAL_STEPS. */
  tutorialStep: number

  // ─── actions ─────────────────────────────────────────────────────
  setTraceMode: (v: boolean) => void
  setTracePaused: (v: boolean) => void
  setOffPrintWarn: (v: boolean) => void
  setPlumbNudge: (v: PlumbNudge | null) => void
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
  setSquareWalls: (v: boolean) => void
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
  /** Set (or clear) the isolated floor. Passing the currently isolated floor
   *  clears isolation so all floors are visible again. */
  setIsolatedFloor: (v: number | null) => void
  /** Toggle ghost transparency on a floor level (double-tap gesture). */
  toggleGhostedLevel: (level: number) => void
  setDrag: (v: DragState | null) => void
  setSelectedWallIndex: (v: number | null) => void
  setPlaceObjectType: (v: string | null) => void
  setKeepPlacing: (v: boolean) => void
  setPlaceStairCfg: (v: FloorplanLocalState['placeStairCfg']) => void
  setPlaceGhost: (v: { x: number; z: number; rotationY: number } | null) => void
  requestPlaceCommit: () => void
  setSelectedObjectId: (v: string | null) => void
  setDetailExplodeId: (v: string | null) => void
  setWallDetailExplode: (v: boolean) => void
  selectAreaExclusive: (kind: 'floor' | 'roof', id: string) => void
  /** Open (or close) the property card for the current selection. In edit mode
   *  selecting no longer opens it on its own, so this is how you ask for it. */
  openSelectionPanel: () => void
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
  setDrawerOpen: (which: 'build' | 'settings' | 'place' | 'ask', open: boolean) => void
  startTutorial: () => void
  exitTutorial: () => void
  setTutorialStep: (n: number) => void
  /** Toggle edit-everything mode. Leaving it clears the hover + any selection so
   *  the workspace returns to a clean, locked viewing state. */
  setGestureLock: (v: boolean) => void
  setWallTrimArmed: (v: boolean) => void
  setEditMode: (v: boolean) => void
  setSelectionGranularity: (g: SelectionGranularity) => void
  /** Pick one framing member (stud/plate/header/joist/rafter) by its id. */
  selectMember: (id: string, label: string) => void
  /** Isolate a member (or null to bring the model back). */
  setIsolatedMember: (id: string | null) => void
  /** Human label of the selected member, for the rail to name it. */
  selectedMemberLabel: string | null
  /**
   * ISOLATE — show this one member and nothing else.
   *
   * Explode alone cannot do this job. Push the model far enough apart to see a
   * single stud clear of everything and the parts are off the screen; keep it
   * close enough to stay in frame and the stud is still buried in the crowd.
   * The two demands genuinely conflict, so seeing one component properly is not
   * an explode setting — it is its own act: hide the crowd instead of moving it.
   */
  isolatedMemberId: string | null
  setEditHover: (h: EditTarget | null) => void
  setEditSelected: (h: EditTarget | null) => void
}

export type { CalibrationUnit, DragKind, DragState, TraceStyle }

export const useFloorplanLocalStore = create<FloorplanLocalState>((set, get) => ({
  traceMode: false,
  tracePaused: false,
  offPrintWarn: false,
  plumbNudge: null,
  traceStyle: 'line',
  traceStart: null,
  traceStroke: [],
  pendingWalls: null,
  hoverPixel: null,
  calibrationA: null,
  calibrationB: null,
  distanceInput: '',
  activeWallType: defaultWallTypeForRole('exterior-bearing'),
  activeWallRole: 'exterior-bearing',
  wallTypeChosen: false,
  wallRoleChosen: false,
  squareWalls: true,
  // Floors-first: the foundation/floor goes down before walls frame on top, so
  // the Build drawer opens on Floors (not Framing) and guides the right order.
  activeTraceLayer: 'floors',
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
  isolatedFloor: null,
  ghostedLevels: [],
  selectedWallIndex: null,
  placeObjectType: null,
  keepPlacing: false,
  placeStairCfg: {},
  placeGhost: null,
  placeCommitNonce: 0,
  selectedObjectId: null,
  detailExplodeId: null,
  wallDetailExplode: false,
  selectedArea: null,
  selectedLine: null,
  gestureLock: false,
  wallTrimArmed: false,
  editMode: false,
  selectionGranularity: 'assembly',
  selectedMemberLabel: null,
  isolatedMemberId: null,
  editHover: null,
  editSelected: null,
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
  tutorialActive: false,
  tutorialStep: 0,
  placeDrawerOpen: false,
  askDrawerOpen: false,

  setTraceMode: (v) => set(v ? { traceMode: true, tracePaused: false } : { traceMode: false, tracePaused: false, traceStart: null, traceStroke: [], pendingWalls: null }),
  setTracePaused: (v) => set({ tracePaused: v }),
  setOffPrintWarn: (v) => set({ offPrintWarn: v }),
  setPlumbNudge: (v) => set({ plumbNudge: v }),
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
  // Picking a size is an explicit choice and sticks — from here on the role no
  // longer moves it.
  setSquareWalls: (v) => set({ squareWalls: v }),
  setActiveWallType: (v) => set({ activeWallType: v, wallTypeChosen: true }),
  // Changing the ROLE re-defaults the stud size, UNLESS you have already picked
  // one yourself. Exterior carries the load and the insulation, interior mostly
  // divides space, so they are simply not the same stick of wood — and defaulting
  // both to one size meant every interior wall rendered too thick, which throws
  // the model out of scale.
  setActiveWallRole: (v) => set((s) => ({
    activeWallRole: v,
    // Picking a role is an explicit choice: from here on it is stamped as-is
    // rather than inferred from where the wall lands.
    wallRoleChosen: true,
    ...(s.wallTypeChosen ? {} : { activeWallType: defaultWallTypeForRole(v) }),
  })),
  // Switching discipline drops any in-progress run anchor, so a resumed/new run
  // starts fresh in the newly selected trade instead of chaining from the old.
  // Switching tab KEEPS the active level, so you can lay a 2nd-floor floor and
  // then switch to framing to build that storey's walls right on it. (It used to
  // reset to Ground here, which made building on an upper storey impossible — the
  // walls always dropped to level 0.) The level stays visible in the trace bar +
  // the Build drawer's Level selector, so walls never silently land on a level
  // you forgot (the original "they vanished up at level 2" concern).
  setActiveTraceLayer: (v) => set({ activeTraceLayer: v, traceStart: null }),
  setTraceBand: (v) => set({ traceBand: v }),
  setPlumb: (patch) => set(patch),
  setElec: (patch) => set(patch),
  setHvac: (patch) => set(patch),
  setFloors: (patch) => set(patch),
  setRoof: (patch) => set(patch),
  setActiveLevel: (v) => set({ activeLevel: v }),
  setIsolatedFloor: (v) => set((s) => ({ isolatedFloor: s.isolatedFloor === v ? null : v })),
  toggleGhostedLevel: (level) => set((s) => ({
    ghostedLevels: s.ghostedLevels.includes(level)
      ? s.ghostedLevels.filter((l) => l !== level)
      : [...s.ghostedLevels, level],
  })),
  setDrag: (v) => set({ drag: v }),
  setSelectedWallIndex: (v) => set({ selectedWallIndex: v, activePanel: v != null ? 'wall' : null }),
  setPlaceObjectType: (v) => set({ placeObjectType: v, placeGhost: null }),
  setKeepPlacing: (v) => set({ keepPlacing: v }),
  setPlaceStairCfg: (v) => set((s) => ({ placeStairCfg: { ...s.placeStairCfg, ...v } })),
  setPlaceGhost: (v) => set({ placeGhost: v }),
  requestPlaceCommit: () => set((s) => ({ placeCommitNonce: s.placeCommitNonce + 1 })),
  setSelectedObjectId: (v) => set({ selectedObjectId: v, activePanel: v ? 'object' : null }),
  setDetailExplodeId: (v) => set({ detailExplodeId: v }),
  setWallDetailExplode: (v) => set({ wallDetailExplode: v }),
  // One panel at a time: every opener sets activePanel and clears the rest.
  openPicker: () => set({ activePanel: 'picker', selectedObjectId: null, selectedWallIndex: null, selectedLine: null, selectedArea: null, placeObjectType: null }),
  openPanelBoard: () => set({ activePanel: 'panelBoard', selectedObjectId: null, selectedWallIndex: null, selectedLine: null, selectedArea: null, placeObjectType: null }),
  toggleCatalog: () => set((s) => s.activePanel === 'catalog'
    ? { activePanel: null }
    : { activePanel: 'catalog', selectedObjectId: null, selectedWallIndex: null, selectedLine: null, selectedArea: null, placeObjectType: null }),
  // ONE SELECTION. `editSelected` used to be a second, independent channel: edit
  // mode recorded floor/roof picks there while objects and walls went through
  // these setters, so you could have a roof edit-selected AND an object selected
  // at the same time, both highlighted, and the gizmo (which reads
  // selectedObjectId) could never attach to a floor or roof. Every selector now
  // writes editSelected too, so whatever is picked is THE selection whichever
  // path picked it. See docs/INTERACTIONS.md.
  // SELECTING SOMETHING DOES NOT OPEN A PANEL WHILE YOU ARE EDITING.
  //
  // Every one of these used to raise `activePanel` as well, so in edit mode a
  // single tap put a property card on the workspace whether or not you wanted
  // one. Most of the time you do not: you tapped the thing to NUDGE it, and the
  // rail already carries move, rotate, stretch, X-ray and delete. The card just
  // stood in front of the model you were trying to watch, and there was no way
  // to select anything without summoning it.
  //
  // Edit mode → the rail, and nothing else. The card is one deliberate tap away
  // (openSelectionPanel, on the rail) for the things the rail cannot express:
  // a door's swing, a board type, a stair's landing.
  //
  // Outside edit mode the card is still how you inspect what you tapped, which
  // is the whole point of tapping when you are not editing.
  selectObjectExclusive: (id) => set((s) => ({ activePanel: s.editMode ? null : 'object', selectedObjectId: id, selectedWallIndex: null, selectedLine: null, selectedArea: null, placeObjectType: null, editSelected: { kind: 'object', id } })),
  selectWallExclusive: (i) => set((s) => ({ activePanel: s.editMode ? null : 'wall', selectedWallIndex: i, selectedObjectId: null, selectedLine: null, selectedArea: null, placeObjectType: null, editSelected: { kind: 'wall', id: String(i) } })),
  selectLineExclusive: (trade, id) => set((s) => ({ activePanel: s.editMode ? null : 'line', selectedLine: { trade, id }, selectedObjectId: null, selectedWallIndex: null, selectedArea: null, placeObjectType: null, editSelected: { kind: 'line', id } })),
  selectAreaExclusive: (kind, id) => set((s) => ({ activePanel: s.editMode ? null : 'area', selectedArea: { kind, id }, selectedObjectId: null, selectedWallIndex: null, selectedLine: null, placeObjectType: null, editSelected: { kind, id } })),
  /** Open the property card for whatever is currently selected — the deliberate
   *  tap that replaces the card appearing on its own. Toggles, so the same mark
   *  puts it away again. */
  openSelectionPanel: () => set((s) => {
    if (s.activePanel) return { activePanel: null }
    const k = s.editSelected?.kind
    return {
      activePanel: k === 'object' ? 'object'
        : k === 'wall' ? 'wall'
        : k === 'line' ? 'line'
        : k === 'floor' || k === 'roof' ? 'area'
        : null,
    }
  }),
  armPlaceExclusive: (type) => set({ activePanel: null, placeObjectType: type, placeGhost: null, selectedObjectId: null, selectedWallIndex: null, selectedLine: null, selectedArea: null, editSelected: null }),
  // Toggling the same panel closes it; opening a different one clears every
  // selection/floater so the single-panel rule holds across both UI systems.
  setActivePanel: (v) => set((s) => v && s.activePanel === v
    ? { activePanel: null }
    : { activePanel: v, selectedObjectId: null, selectedWallIndex: null, selectedLine: null, selectedArea: null, placeObjectType: null }),
  closeAllPanels: () => set({ activePanel: null, selectedObjectId: null, selectedWallIndex: null, selectedLine: null, selectedArea: null, placeObjectType: null, editSelected: null }),
  setPresetOpen: (v) => set({ presetOpen: v }),
  setPracticeMode: (v) => set({ practiceMode: v }),
  setSeedProcessing: (v) => set({ seedProcessing: v }),
  setWizardOpen: (v) => set({ wizardOpen: v }),
  setDrawerOpen: (which, open) => set(() => {
    // Globally exclusive: opening any drawer closes the other two, so only one
    // menu is ever over the workspace (was small-screen-only; now always).
    const base = open
      ? { buildDrawerOpen: false, settingsDrawerOpen: false, placeDrawerOpen: false, askDrawerOpen: false }
      : {}
    const key =
      which === 'build' ? 'buildDrawerOpen'
      : which === 'settings' ? 'settingsDrawerOpen'
      : which === 'place' ? 'placeDrawerOpen'
      : 'askDrawerOpen'
    return { ...base, [key]: open } as Partial<FloorplanLocalState>
  }),
  startTutorial: () => set({ tutorialActive: true, tutorialStep: 0 }),
  exitTutorial: () => set({ tutorialActive: false }),
  setTutorialStep: (n) => set({ tutorialStep: Math.max(0, n) }),
  setGestureLock: (v) => set({ gestureLock: v }),
  setWallTrimArmed: (v) => set({ wallTrimArmed: v }),
  setEditMode: (v) => set(v
    // Entering: start clean — drop any open card/selection so edit mode owns it.
    ? { editMode: true, editHover: null, editSelected: null, activePanel: null, selectedArea: null, selectedObjectId: null, selectedWallIndex: null, selectedLine: null }
    // Leaving edit mode: drop the hover + every selection so nothing stays
    // "grabbed" and the workspace returns to clean, locked viewing.
    : {
        editMode: false, editHover: null, editSelected: null, activePanel: null,
        selectedArea: null, selectedObjectId: null, selectedWallIndex: null, selectedLine: null,
      }),
  setSelectionGranularity: (g) => set({
    selectionGranularity: g,
    // Never strand the user in an isolated view they can no longer get out of:
    // the button that restores the model lives on the member selection, and
    // changing grain drops that selection.
    isolatedMemberId: null,
    // Drop the current pick when the granularity changes. A wall selected as an
    // assembly is not the same thing as a stud selected as a member, and
    // carrying one over into the other mode leaves a selection whose verbs no
    // longer match what is highlighted.
    editHover: null,
    editSelected: null,
  }),
  setIsolatedMember: (id) => set({ isolatedMemberId: id }),
  selectMember: (id, label) => {
    // Exclusive like every other pick: a member selection must clear the
    // assembly ones or two things end up highlighted with two different sets
    // of verbs offered for them.
    get().closeAllPanels()
    set({ editSelected: { kind: 'member', id }, selectedMemberLabel: label })
  },
  setEditHover: (h) => set({ editHover: h }),
  // Routed through the exclusive setters so the canonical fields and
  // editSelected can never disagree. Callers in the layers still just say
  // "this is now selected" and get one consistent selection.
  setEditSelected: (h) => {
    if (!h) { get().closeAllPanels(); return }
    if (h.kind === 'object') { get().selectObjectExclusive(h.id); return }
    if (h.kind === 'wall') { get().selectWallExclusive(Number(h.id)); return }
    if (h.kind === 'floor' || h.kind === 'roof') { get().selectAreaExclusive(h.kind, h.id); return }
    set({ editSelected: h })
  },
}))
