/**
 * THE BENCH STATE — the one place the dashboard and the scene agree.
 *
 * The panel is DOM outside the Canvas; the beam, the camera sweep and the fade
 * are inside it. They are two reconcilers, so the only thing they can share is a
 * plain store: the panel pushes the ramp, the scene reads the break. Putting the
 * state in the panel and passing it down through the Canvas would need a prop
 * chain through ModelViewer, which is where this app keeps nothing.
 *
 * THE RAMP IS NOT IN HERE AS A TIMER, ON PURPOSE. The ramp's interval belongs to
 * the panel (`push()` at ~11 Hz — the rate the family's bench has always run
 * at). A timer inside a module-scope store would keep ticking after the panel
 * closed, keep re-rendering the scene, and keep recording breaks nobody is
 * watching. The store holds state; the screen that owns the control owns its
 * clock.
 *
 * A BREAK STOPS THE RAMP. `fail()` is the only way `break` becomes non-null, and
 * it parks the ramp at the step that broke so the card's reading is the reading
 * at failure, not the step after it.
 */

import { create } from 'zustand'
import { DEFAULT_SETUP, RAMP_MAX, type BenchSetup } from '../services/arena/stress'
import type { BenchBreak } from '../services/arena/bench'
import { defaultSpecimenId } from '../services/arena/bench'
import { fileBenchEnd } from '../services/arena/runEnd'
// Sends the spine to the family collector (no-op until a build carries the
// endpoint). Started here rather than in main.tsx only because main.tsx has
// Mitchell's local edits in progress; it can move there with them.
import { startFuseSync } from '../lib/fuseShare'

startFuseSync()

/** Round to the ramp's 0.05 grid so 0.1 accumulation cannot drift the reading. */
/** Load added per tick (~11 a second) at each speed. Fast is three times Slow. */
const RATE_STEP = { slow: 0.02, fast: 0.06 } as const

function snap(m: number): number {
  return Math.round(m * 100) / 100
}

interface BenchState {
  /** True while the arena is open. The scene draws the bench only then — a beam
   *  hovering over somebody's plan in every screenshot is not a feature. */
  open: boolean
  /** The specimen on the bench. Null only when nothing is rateable. */
  specimenId: string | null
  /** The job: span, tributary, live and dead load. */
  setup: BenchSetup
  /** The ramp, 1× → RAMP_MAX. */
  multiple: number
  running: boolean
  /** Hold parks the ramp and times how long the member has carried the load. */
  holding: boolean
  holdStartedAt: number | null
  /** How fast Run climbs: Slow, or Fast at three times Slow (the family strip). */
  rate: 'slow' | 'fast'
  /** The moment, once something has failed. Null while the bench is standing. */
  break: BenchBreak | null
  /** This run is already in the spine (it broke, or it held to the top). */
  runFiled: boolean

  setOpen: (open: boolean) => void
  setSpecimen: (id: string | null) => void
  setSetup: (patch: Partial<BenchSetup>) => void
  applyPreset: (specimenId: string, setup: BenchSetup) => void
  setMultiple: (m: number) => void
  setRate: (rate: 'slow' | 'fast') => void
  /** One tick of the ramp. Stops itself at the ceiling. */
  push: () => void
  start: () => void
  stop: () => void
  hold: () => void
  /** Something reached factored resistance: park the ramp and isolate it. */
  fail: (b: BenchBreak) => void
  /** Put the card away and hand the scene back, re-armed at 1×. */
  dismiss: () => void
  /** Bring the scene back and re-arm the bench at 1×. */
  reset: () => void
}

/** File a run that ended without a break, once, before the bench re-arms. */
function endRun(s: BenchState, held = false): void {
  if (!s.break && !s.runFiled && s.multiple > 1) fileBenchEnd(s.specimenId, s.setup, s.multiple, held)
}

export const useBenchStore = create<BenchState>((set) => ({
  open: false,
  specimenId: defaultSpecimenId(),
  setup: DEFAULT_SETUP,
  multiple: 1,
  running: false,
  holding: false,
  holdStartedAt: null,
  rate: 'slow',
  break: null,
  runFiled: false,

  setOpen: (open) => set({ open }),
  setSpecimen: (id) => set((s) => (endRun(s), { specimenId: id, multiple: 1, running: false, holding: false, holdStartedAt: null, break: null, runFiled: false })),
  setSetup: (patch) => set((s) => (endRun(s), { setup: { ...s.setup, ...patch }, multiple: 1, running: false, holding: false, holdStartedAt: null, break: null, runFiled: false })),
  applyPreset: (specimenId, setup) => set((s) => (endRun(s), { specimenId, setup, multiple: 1, running: false, holding: false, holdStartedAt: null, break: null, runFiled: false })),
  setRate: (rate) => set({ rate }),
  setMultiple: (m) => set({ multiple: Math.min(RAMP_MAX, Math.max(1, snap(m))), holding: false, holdStartedAt: null }),

  push: () => set((s) => {
    if (s.break) return {}
    const next = snap(s.multiple + RATE_STEP[s.rate])
    if (next >= RAMP_MAX) {
      // Carried the load to the top of the ramp: that is a result, filed now.
      endRun({ ...s, multiple: RAMP_MAX }, true)
      return { multiple: RAMP_MAX, running: false, runFiled: true }
    }
    return { multiple: next }
  }),

  start: () => set((s) => (s.break ? {} : { running: true, holding: false, holdStartedAt: null })),
  stop: () => set({ running: false }),

  hold: () => set((s) => {
    if (s.break) return {}
    if (s.holding) return { holding: false, holdStartedAt: null }
    return { holding: true, running: false, holdStartedAt: Date.now() }
  }),

  fail: (b) => set({ break: b, running: false, holding: false, holdStartedAt: null, runFiled: true }),
  // Dismissing re-arms the ramp as well as restoring the scene. Leaving it
  // parked at 3.55× would make the next tap of More an instant second break —
  // the same run filed twice, which is not a run.
  dismiss: () => set({ break: null, multiple: 1, running: false, holding: false, holdStartedAt: null, runFiled: false }),

  reset: () => set((s) => (endRun(s), { multiple: 1, running: false, holding: false, holdStartedAt: null, break: null, runFiled: false })),
}))
