import { create } from 'zustand'
import type { BuildingType } from '../onboarding/types'

/** Visual feedback shown while a wall is being traced. */
export type WallTraceStyle = 'dotted' | 'arrow' | 'both'

/**
 * The ONE active length unit for the whole app. This is the single source of
 * truth: calibration's estimate, the calibration input field (and its label),
 * and every measurement readout all read this exact value. Nothing derives a
 * unit separately, so the estimate and the input can never disagree.
 */
export type ActiveUnit = 'mm' | 'cm' | 'm' | 'in' | 'ft'

/**
 * useConfigStore — the central, typed home for *behavioural* configuration:
 * the knobs that change how processes and actions work (wall tracing, corner
 * inference, snapping, units, build output). Every system reads its tunables
 * from here instead of hard-coding them, and the Settings tab edits them.
 *
 * Pure appearance/display preferences live in useUISettingsStore; this store is
 * deliberately separate so "how the app behaves" and "how the app looks" don't
 * get tangled. Both follow the same load/save/set/reset shape.
 *
 * Defaults below mirror the values that used to be hard-coded at each call
 * site, so behaviour is unchanged until the user edits a setting.
 */
export interface AppConfig {
  // ── Wall tracing ──────────────────────────────────────────────────────────
  /** Thickness (px) assigned to a freehand-traced wall. */
  wallTraceThicknessPx: number
  /** Strokes shorter than this (px) are discarded rather than becoming a wall. */
  wallTraceMinLengthPx: number
  /** A traced endpoint within this distance (px) snaps to an existing wall end. */
  wallTraceSnapEndpointPx: number
  /** A traced endpoint within this distance (px) snaps onto a wall line (T-join). */
  wallTraceSnapLinePx: number
  /** Live visual while tracing: dotted stroke, rubber-band arrow, or both. */
  wallTraceStyle: WallTraceStyle

  // ── Corners ───────────────────────────────────────────────────────────────
  /** Auto-square perpendicular traced walls that meet near a shared point. */
  cornerInferEnabled: boolean
  /** How close (px) two wall ends must be to be treated as one corner. */
  cornerTolerancePx: number

  // ── Snapping ──────────────────────────────────────────────────────────────
  /** Grid increment (metres) used when moving/resizing the floor-plan overlay. */
  gridSnapM: number

  // ── Units ─────────────────────────────────────────────────────────────────
  /**
   * The single active length unit (see ActiveUnit). Drives calibration and
   * every measurement/readout. Defaults to millimetres — a precise, unambiguous
   * construction default — but is exposed in the Units & calibration settings.
   */
  activeUnit: ActiveUnit

  // ── Build output ──────────────────────────────────────────────────────────
  /** Storey height (metres) fed to the construction engine. */
  buildFloorHeightM: number
  /** Building type that drives stud size / spacing defaults. */
  buildType: BuildingType
  /** Automatically reveal the framing layer after "Build for me". */
  buildAutoEnableFraming: boolean

  // ── Framing ─────────────────────────────────────────────────────────────────
  /** Global stud spacing, on-centre (inches). */
  studSpacingIn: 16 | 24
  /** Default dimensional-lumber size (wall depth) for framed walls. */
  defaultStudSize: '2x4' | '2x6'
  /** Corner framing style: three-stud (standard) or California/two-stud. */
  cornerType: 'three-stud' | 'california'

  // ── Steel framing ───────────────────────────────────────────────────────────
  /** Framing material — wood dimensional lumber or cold-formed steel. */
  framingMaterial: 'wood' | 'steel'
  /** Steel stud/track web width (nominal). */
  steelWidth: '1-5/8' | '2-1/2' | '3-1/2' | '3-5/8' | '6' | '8'
  /** Steel gauge, thin → heavy. */
  steelGauge: '25' | '20' | '18' | '16' | '12'
  /** Top track type (slotted/deflection by default — allows vertical movement). */
  steelTrackTop: 'shallow' | 'deep' | 'slotted' | 'double'
  /** Bottom track type (shallow by default). */
  steelTrackBottom: 'shallow' | 'deep' | 'slotted' | 'double'
  /** Deflection gap left at the top of steel studs (mm). */
  steelDeflectionGapMm: number

  // ── Explode view ────────────────────────────────────────────────────────────
  /** How quickly the model eases toward the explode-slider target (per second). */
  explodeSpeed: number
  /** Global multiplier on how far components fan out from model centre. */
  explodeSpread: number
  /** Per-system fan-out multipliers, keyed by scene layer (e.g. framing, mep). */
  explodeSystemMultipliers: Record<string, number>
}

export const DEFAULT_APP_CONFIG: AppConfig = {
  wallTraceThicknessPx: 8,
  wallTraceMinLengthPx: 12,
  wallTraceSnapEndpointPx: 28,
  wallTraceSnapLinePx: 18,
  wallTraceStyle: 'both',
  cornerInferEnabled: true,
  cornerTolerancePx: 20,
  gridSnapM: 0.25,
  activeUnit: 'ft',
  buildFloorHeightM: 2.7,
  buildType: 'residential-single',
  buildAutoEnableFraming: true,
  studSpacingIn: 16,
  defaultStudSize: '2x4',
  cornerType: 'three-stud',
  framingMaterial: 'wood',
  steelWidth: '3-5/8',
  steelGauge: '25',
  steelTrackTop: 'slotted',
  steelTrackBottom: 'shallow',
  steelDeflectionGapMm: 19,
  explodeSpeed: 4,
  explodeSpread: 1,
  explodeSystemMultipliers: {
    framing: 1,
    walls: 1.2,
    floors: 0.5,
    'doors-windows': 1,
    structure: 0.8,
    mep: 1.6,
    ceiling: 1.4,
    foundation: 0.3,
  },
}

const STORAGE_KEY = 'bp3d-app-config'

function load(): AppConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return { ...DEFAULT_APP_CONFIG, ...JSON.parse(raw) }
  } catch { /* ignore */ }
  return { ...DEFAULT_APP_CONFIG }
}

function save(s: AppConfig) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)) } catch { /* ignore */ }
}

interface ConfigStore extends AppConfig {
  set: (patch: Partial<AppConfig>) => void
  reset: () => void
}

export const useConfigStore = create<ConfigStore>((setState) => ({
  ...load(),
  set: (patch) => setState((s) => {
    const next = { ...s, ...patch }
    save(next)
    return next
  }),
  reset: () => setState(() => {
    save(DEFAULT_APP_CONFIG)
    return { ...DEFAULT_APP_CONFIG }
  }),
}))
