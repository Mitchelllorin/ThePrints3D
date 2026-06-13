import { create } from 'zustand'
import type { BuildingType } from '../onboarding/types'

/** Visual feedback shown while a wall is being traced. */
export type WallTraceStyle = 'dotted' | 'arrow' | 'both'

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
  /** Display unit system for measurements and readouts. */
  unitSystem: 'metric' | 'imperial'

  // ── Build output ──────────────────────────────────────────────────────────
  /** Storey height (metres) fed to the construction engine. */
  buildFloorHeightM: number
  /** Building type that drives stud size / spacing defaults. */
  buildType: BuildingType
  /** Automatically reveal the framing layer after "Build for me". */
  buildAutoEnableFraming: boolean
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
  unitSystem: 'metric',
  buildFloorHeightM: 2.7,
  buildType: 'residential-single',
  buildAutoEnableFraming: true,
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
