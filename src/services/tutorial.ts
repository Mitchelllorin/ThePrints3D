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

/**
 * What the coach should DO when a step opens, so the user lands exactly on the
 * right tool instead of hunting. The UI maps each kind to real store actions
 * (open a drawer + select a trace layer, etc.).
 */
export type TutorialEnter =
  | 'floors'      // Build drawer → Floors layer
  | 'framing'     // Build drawer → Framing layer
  | 'roof'        // Build drawer → Roof layer
  | 'plumbing'    // Build drawer → Plumbing layer
  | 'electrical'  // Build drawer → Electrical layer
  | 'place'       // Place drawer
  | 'settings'    // Settings drawer
  | 'closeDrawers'

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
  /** Drive the UI to the right tool the moment the step opens (optional). */
  enter?: TutorialEnter
  /** `data-tour` value of the control to spotlight (optional). */
  target?: string
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
    id: 'floor',
    title: 'Lay the floor first',
    body: "Foundation before framing: the floor goes down first and the walls frame on top of it. I've opened Floors for you — pull a rectangle across the footprint.",
    hint: 'Pull a rectangle corner-to-corner across the footprint on the plan.',
    enter: 'floors',
    done: (c) => c.hasFloor,
  },
  {
    id: 'wall',
    title: 'Trace your first wall',
    body: "Now the walls. I've switched you to Framing — tap one corner, then the next, to lay a wall over the print. It squares up automatically; double-tap or \"End run\" to finish.",
    hint: 'Tap two corners on the plan to lay a wall.',
    enter: 'framing',
    done: (c) => c.userWallCount >= 1,
  },
  {
    id: 'findRest',
    title: 'Find the rest',
    body: 'Here’s the magic: you traced one, now let the detector find the matching walls across the whole plan.',
    hint: 'Tap the highlighted "✨ Find the rest" button.',
    target: 'find-rest',
    done: (c) => c.totalWallCount > c.userWallCount,
  },
  {
    id: 'build',
    title: 'Build it in 3D',
    body: 'Now stand it up. "Build 3D" frames every wall — studs, plates, headers — and raises the model so you can orbit it.',
    hint: 'Tap the highlighted "Build 3D →" button.',
    target: 'build-3d',
    done: (c) => c.built,
  },
  {
    id: 'roof',
    title: 'Put a roof on',
    body: "Roof's open. Choose a pitch and pull the roof area over the footprint — gable ends get a sloped rake automatically, no flat boxes.",
    hint: 'Pull the roof rectangle over the footprint on the plan.',
    enter: 'roof',
    done: (c) => c.hasRoof,
  },
  {
    id: 'openings',
    title: 'Doors & windows',
    body: "I've opened Place. Pick a door or window and tap it onto a wall — it frames right in with king studs, jacks and a header.",
    hint: 'Pick a door or window, then tap it onto a wall.',
    enter: 'place',
    target: 'place-tab',
    done: (c) => c.openingCount >= 1,
  },
  {
    id: 'plumbing',
    title: 'Run the plumbing',
    body: "Plumbing's open. Choose supply or waste and trace the runs — in-wall runs follow the studs so the pipe routes inside the wall.",
    hint: 'Trace a pipe run across the plan.',
    enter: 'plumbing',
    done: (c) => c.plumbingCount >= 1,
  },
  {
    id: 'electrical',
    title: 'Wire it up',
    body: "Last system — Electrical's open. Run a circuit the same trace-and-go way as plumbing.",
    hint: 'Trace a circuit across the plan.',
    enter: 'electrical',
    done: (c) => c.electricalCount >= 1,
  },
  {
    id: 'takeoff',
    title: 'Read the takeoff',
    body: "That's a whole house. I've opened Settings — scroll to Material Takeoff for the live bill of materials: wall feet, studs, board, pipe, wire and fixtures.",
    hint: 'Find "Material takeoff" in the Settings drawer.',
    enter: 'settings',
    target: 'settings-tab',
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
