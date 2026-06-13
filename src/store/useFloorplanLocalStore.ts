/**
 * Lightweight Zustand store for FloorplanOverlay's local UI state.
 *
 * This state is shared between the 3D layer (inside <Canvas>) and the DOM
 * panel (outside <Canvas>).  Because R3F v9 uses a separate React reconciler,
 * React `useState` can't be shared across the boundary — but Zustand is
 * framework-agnostic and works in both reconcilers.
 */

import { create } from 'zustand'

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
  traceStroke: [number, number][]
  hoverPixel: [number, number] | null

  // ─── calibration ─────────────────────────────────────────────────
  calibrationA: [number, number] | null
  calibrationB: [number, number] | null
  distanceInput: string
  /** Drawing ids whose calibration the user has completed or explicitly skipped. */
  calibrationHandledIds: string[]

  // ─── drag ────────────────────────────────────────────────────────
  drag: DragState | null

  // ─── UI toggles ──────────────────────────────────────────────────
  presetOpen: boolean
  practiceMode: boolean
  seedProcessing: boolean

  // ─── actions ─────────────────────────────────────────────────────
  setTraceMode: (v: boolean) => void
  setTraceStroke: (v: [number, number][] | ((prev: [number, number][]) => [number, number][])) => void
  setHoverPixel: (v: [number, number] | null) => void
  setCalibrationA: (v: [number, number] | null) => void
  setCalibrationB: (v: [number, number] | null) => void
  setDistanceInput: (v: string) => void
  markCalibrationHandled: (id: string) => void
  setDrag: (v: DragState | null) => void
  setPresetOpen: (v: boolean) => void
  setPracticeMode: (v: boolean) => void
  setSeedProcessing: (v: boolean) => void
}

export type { DragKind, DragState }

export const useFloorplanLocalStore = create<FloorplanLocalState>((set, get) => ({
  traceMode: false,
  traceStroke: [],
  hoverPixel: null,
  calibrationA: null,
  calibrationB: null,
  distanceInput: '',
  calibrationHandledIds: [],
  drag: null,
  presetOpen: false,
  practiceMode: true,
  seedProcessing: false,

  setTraceMode: (v) => set({ traceMode: v }),
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
  setDrag: (v) => set({ drag: v }),
  setPresetOpen: (v) => set({ presetOpen: v }),
  setPracticeMode: (v) => set({ practiceMode: v }),
  setSeedProcessing: (v) => set({ seedProcessing: v }),
}))
