/**
 * The guided tutorial — a single ordered walkthrough that builds a whole house
 * (plan → scale → walls → floor → 3D → roof → doors → plumbing → electrical →
 * takeoff). Pure data + predicates so it's trivially testable and so the UI
 * (TutorialCoach) just reads a context snapshot and shows the current step.
 *
 * Each step has a `done(ctx)` goal. When it flips true the coach auto-advances
 * (and the user can always step Next/Back manually). The script doubles as the
 * canonical happy path — if a step can't be completed in the app, that's a bug.
 */

export interface TutorialContext {
  hasPlan: boolean
  /** Scale locked or detected/accepted (presets carry their own). */
  calibrationCleared: boolean
  /** Walls the user has traced. */
  userWallCount: number
  /** Every wall in the plan (traced + auto-detected). */
  totalWallCount: number
  hasFloor: boolean
  hasRoof: boolean
  /** The framed 3D model is standing. */
  built: boolean
  /** Doors + windows placed. */
  openingCount: number
  plumbingCount: number
  electricalCount: number
}

export interface TutorialStep {
  /** Stable id (progress + analytics). */
  id: string
  /** Short imperative title. */
  title: string
  /** One or two friendly sentences teaching the step. */
  body: string
  /** Where to look / what to tap. */
  hint: string
  /** Goal reached → the coach ticks it and auto-advances. */
  done: (c: TutorialContext) => boolean
}

export const TUTORIAL_STEPS: TutorialStep[] = [
  {
    id: 'plan',
    title: 'Start from a plan',
    body: "Every build starts from a floor plan. I've dropped one on the grid for you — this is the print we'll raise a real 3D house on.",
    hint: 'The grey floor plan in the workspace is your print.',
    done: (c) => c.hasPlan,
  },
  {
    id: 'scale',
    title: 'Lock the scale',
    body: 'Scale makes every measurement real. Presets already know theirs, so you’re set. On your own uploads you’d tap two points a known distance apart.',
    hint: 'Nothing to do here on a preset — the scale is already locked.',
    done: (c) => c.calibrationCleared,
  },
  {
    id: 'wall',
    title: 'Trace your first wall',
    body: 'Open Build → Framing, then tap one corner and the next to lay a wall over the print. It squares up automatically. Double-tap or "End run" to finish.',
    hint: 'Build drawer (left) → Framing → tap two corners on the plan.',
    done: (c) => c.userWallCount >= 1,
  },
  {
    id: 'findRest',
    title: 'Find the rest',
    body: 'Here’s the magic: trace one and let the detector find the matching walls across the whole plan. Tap “✨ Find the rest”.',
    hint: 'Tap "✨ Find the rest" after your first wall.',
    done: (c) => c.totalWallCount > c.userWallCount,
  },
  {
    id: 'floor',
    title: 'Lay the floor',
    body: 'The walls frame on top of the floor. Pick Floors, then pull a rectangle across the footprint — slab or wood-frame, your call.',
    hint: 'Build drawer → Floors → pull a rectangle over the footprint.',
    done: (c) => c.hasFloor,
  },
  {
    id: 'build',
    title: 'Build it in 3D',
    body: 'Now stand it up. “Build 3D” frames every wall — studs, plates, headers — and raises the model so you can orbit it.',
    hint: 'Tap "Build 3D →".',
    done: (c) => c.built,
  },
  {
    id: 'roof',
    title: 'Put a roof on',
    body: 'Pick Roof, choose a pitch, and pull the roof area over the footprint. Gable ends get a sloped rake automatically — no flat boxes.',
    hint: 'Build drawer → Roof → pull the roof over the footprint.',
    done: (c) => c.hasRoof,
  },
  {
    id: 'openings',
    title: 'Doors & windows',
    body: 'Drop doors and windows from Place — set them on a wall and they frame right in with king studs, jacks and a header.',
    hint: 'Place drawer (bottom) → a door or window → tap it onto a wall.',
    done: (c) => c.openingCount >= 1,
  },
  {
    id: 'plumbing',
    title: 'Run the plumbing',
    body: 'Pick Plumbing, choose supply or waste, and trace the runs. In-wall runs follow the studs so the pipe routes inside the wall.',
    hint: 'Build drawer → Plumbing → trace a run.',
    done: (c) => c.plumbingCount >= 1,
  },
  {
    id: 'electrical',
    title: 'Wire it up',
    body: 'Last system: pick Electrical and run a circuit. Same trace-and-go as plumbing.',
    hint: 'Build drawer → Electrical → trace a circuit.',
    done: (c) => c.electricalCount >= 1,
  },
  {
    id: 'takeoff',
    title: 'Read the takeoff',
    body: 'That’s a whole house. Open Settings → Material Takeoff for the bill of materials — wall feet, studs, board, pipe, wire and fixtures, counted live.',
    hint: 'Settings drawer (right) → Material takeoff.',
    // Terminal step — finishing is manual (there’s nothing left to "do").
    done: () => false,
  },
]

/** Clamp an index into the script. */
export function clampStep(index: number): number {
  return Math.max(0, Math.min(TUTORIAL_STEPS.length - 1, index))
}

/**
 * Given the current step and a live context, report whether its goal is met and
 * the next index to auto-advance to (or null to hold). The terminal step never
 * auto-advances. Pure so the coach stays a thin shell.
 */
export function tutorialAdvance(
  index: number,
  ctx: TutorialContext,
): { done: boolean; nextIndex: number | null } {
  const i = clampStep(index)
  const step = TUTORIAL_STEPS[i]
  const isDone = step.done(ctx)
  const isLast = i >= TUTORIAL_STEPS.length - 1
  return { done: isDone, nextIndex: isDone && !isLast ? i + 1 : null }
}
