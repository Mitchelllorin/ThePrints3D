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
  /** Where to look / what to tap. OPTIONAL: when the spotlight already says it,
   *  a line of prose repeating "that's the thing that's glowing" is noise. */
  hint?: string
  /** Goal reached → the coach ticks it and auto-advances. */
  done: (c: TutorialContext) => boolean
  /** Drive the UI to the right tool the moment the step opens (optional). */
  enter?: TutorialEnter
  /** `data-tour` value of the control to spotlight (optional). */
  target?: string
  /** Run a looping demonstration of the gesture over the plan. Words alone do
   *  not teach a gesture — "tap two opposite corners" only means something once
   *  you have watched it happen. Stops the moment the user starts. */
  demo?: 'twoCorners' | 'wallRun'
  /** Move on by itself after this long, for a step with nothing to detect.
   *  Every other step advances when the user DOES the thing; a step that only
   *  says something has no such signal, and sits there until Next is found —
   *  which is a dead end for anyone who doesn't realise Next is the way out.
   *  It reads out loud in about four seconds, so seven is unhurried. */
  autoAdvanceMs?: number
}

export const TUTORIAL_STEPS: TutorialStep[] = [
  // ── ONE step of talking, then straight to work ─────────────────────────────
  // This opened with four: what the app does, here is your plan, here is the
  // rail, here is how tracing works — four screens of prose before the user
  // touched anything, which is three too many. Nobody learns a gesture by
  // reading four descriptions of it. So: one line to say what we are doing,
  // with the rail lit up behind it, and then we lay a floor — where the ghost
  // demonstrates the move on the real print while the step is live.
  //
  // Scale went too. It was a step that said "nothing to do here", which is not
  // a step. Presets already carry their scale, and calibration is taught the
  // moment it matters — on a real upload.
  {
    id: 'welcome',
    title: 'Let’s build a house.',
    body: 'You trace over the plan; it stands up in 3D, framed. Everything you need is down the left edge.',
    // NO spotlight here. Ringing BUILD on the opening line left a pulsing
    // highlight sitting on the rail with nothing being asked of it — and once
    // the eye has been told that glow means "tap this", a glow that means
    // nothing is worse than no glow at all.
    autoAdvanceMs: 7000,
    done: () => false,
  },
  {
    id: 'floor',
    title: 'Lay the floor first',
    body: 'A floor is a deck on joists, and it goes down before the walls. Tap two opposite corners of the building.',
    enter: 'floors',
    demo: 'twoCorners',
    done: (c) => c.hasFloor,
  },
  {
    id: 'wall',
    title: 'Trace your first wall',
    body: 'Now a wall: tap one corner, then the next. It squares up on its own.',
    enter: 'framing',
    demo: 'wallRun',
    done: (c) => c.userWallCount >= 1,
  },
  {
    id: 'findRest',
    title: 'Find the rest',
    body: 'You traced one — now let it find the rest of them.',
    target: 'find-rest',
    done: (c) => c.totalWallCount > c.userWallCount,
  },
  {
    id: 'build',
    title: 'Build it in 3D',
    body: 'Stand it up. Every wall gets studs, plates and headers.',
    target: 'build-3d',
    done: (c) => c.built,
  },
  {
    id: 'roof',
    title: 'Put a roof on',
    body: 'Same two corners again, over the footprint. Gable ends get their rake automatically.',
    enter: 'roof',
    done: (c) => c.hasRoof,
  },
  {
    id: 'openings',
    title: 'Doors & windows',
    body: 'Pick a door or window, then tap it onto a wall. It frames itself in.',
    enter: 'place',
    target: 'place-tab',
    done: (c) => c.openingCount >= 1,
  },
  {
    id: 'plumbing',
    title: 'Run the plumbing',
    body: 'Trace a pipe run. In-wall runs route inside the studs.',
    enter: 'plumbing',
    done: (c) => c.plumbingCount >= 1,
  },
  {
    id: 'electrical',
    title: 'Wire it up',
    body: 'Same again for a circuit.',
    enter: 'electrical',
    done: (c) => c.electricalCount >= 1,
  },
  {
    id: 'takeoff',
    title: 'Read the takeoff',
    body: "That's a whole house. Material takeoff has your bill of materials.",
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
