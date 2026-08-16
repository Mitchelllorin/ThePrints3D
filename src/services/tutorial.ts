/**
 * The guided tutorial — a single ordered walkthrough that builds a whole house
 * (floor → walls → find the rest → 3D → roof → doors → plumbing → electrical →
 * takeoff), in build order: the floor platform goes down and the walls are
 * framed on top of it. Pure data + predicates so it's trivially testable and so
 * the UI (TutorialCoach) just reads a context snapshot and shows the step.
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
  demo?: 'twoCorners' | 'wallRun' | 'calibrate'
  /** The tour DOES this step itself, for real, while narrating it — the result
   *  stays on the model and the tour carries on with it. Used where watching is
   *  the lesson and there is nothing to be gained by making someone repeat a
   *  gesture they have just been shown. */
  perform?: 'floor' | 'wall' | 'findRest'
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
    // The user's words, verbatim. He wrote this one himself — see the note in
    // the memory: the copy is his, and it is spoken over a slowly turning print
    // (IdleSpin.force in ModelViewer), because the first thing the sentence has
    // to prove is that this is a model and not a picture.
    title: 'Welcome to ThePrints3D',
    body: 'We build 3D models from 2D prints, floorplans and drawings. This is a simple floor plan we will turn into an interactive model.',
    // NO spotlight here. Ringing BUILD on the opening line left a pulsing
    // highlight sitting on the rail with nothing being asked of it — and once
    // the eye has been told that glow means "tap this", a glow that means
    // nothing is worse than no glow at all.
    // Paced to the copy: this line takes about eight seconds to read at the
    // speed someone reads a screen they have never seen before.
    autoAdvanceMs: 9500,
    done: () => false,
  },
  {
    id: 'calibrate',
    // The user's words. Deliberately has NO `enter`: nothing opens, nothing is
    // selected, the camera is not touched and the print keeps turning — the
    // hand does the whole job while the sentence is read. A preset already
    // carries its scale, so this pull is purely a demonstration; it is the only
    // chance to show the mechanic before a real upload demands it.
    title: 'It starts with calibration',
    body: 'There are a few ways ThePrints3D creates 3D walls. They all begin with calibration: we need a known, measured distance marked, so we know how big or small things are.',
    demo: 'calibrate',
    autoAdvanceMs: 12000,
    done: () => false,
  },
  {
    id: 'floor',
    // The user's words. Note what is NOT explained: what a floor is. He was
    // explicit — everybody knows what a floor is, and a tutorial that defines
    // the obvious insults the person reading it. Foundations and excavation
    // come later, when the app can actually build them.
    title: 'We start with a floor',
    body: 'Starting at one corner of the print we tap to place a mark, then pull the floor diagonally across the plan to the opposite corner. Joists and sheeting, screws and nails, all together — and when we drop that second mark, a floor has been created, as you can see.',
    // Performed, not asked for. No `enter`: nothing opens, trace mode stays off,
    // so the print keeps turning through the whole demonstration and the floor
    // it just built turns with it.
    demo: 'twoCorners',
    perform: 'floor',
    // Timed to the whole performance, at the speed a person can actually watch
    // it: the pull lands around 8s, then eleven seconds of camera work — under,
    // in on a hanger, held, drawn back, rolled home — and a beat before we move
    // on. Rushing any of it defeats the point of showing it at all.
    autoAdvanceMs: 25000,
    // Deliberately NOT `hasFloor` — the tour lays this floor itself, so a goal
    // watching for one would fire the instant the demo committed it and cut the
    // step off mid-sentence, reveal and all.
    done: () => false,
  },
  {
    id: 'wall',
    // The user's words. Unlike the floor, this one is DONE BY THE USER — the
    // copy is addressed to them ("your finger", "when you're done, lift"), and
    // a tutorial that only ever performs is a demo reel. The ghost shows the
    // move; their hand makes the wall. It ends when they lay one, with no
    // timer, because a timer would move the tour on with a finger still down.
    title: 'Now let’s get some walls up',
    body: 'One way is to trace on the print with your finger: pick a wall, drop a dot, and pull along the wall line. Lift when you’re done — and a 3D wall stands up, studs and board and all, auto-squared — that’s a setting, turn it off for an angled wall — on the line you traced. Once that one’s up it will chain as many as you like, or you can use the G.C. to “find the rest”.',
    // Performed, like the floor. No `enter`: nothing opens and trace mode stays
    // off, so the print keeps turning while the hand works.
    demo: 'wallRun',
    perform: 'wall',
    autoAdvanceMs: 22000,
    done: () => false,
  },
  {
    id: 'findRest',
    title: 'Or let it find the rest',
    body: 'One wall traced is enough to go on. Find the rest reads the print for everything that matches it, and stands them all up.',
    // The control is lit while it is named, then the tour presses it — you see
    // WHERE it lives and WHAT it does in one beat.
    target: 'find-rest',
    perform: 'findRest',
    autoAdvanceMs: 16000,
    done: () => false,
  },
  // THE "BUILD 3D" STEP IS GONE, with the button it pointed at. Walls stand up
  // as they are traced now; there is no separate one-way build to press, and a
  // spotlight aimed at a control that no longer exists is a tour pointing at a
  // hole in the screen. (services/assistant.ts still offers a "Build 3D"
  // action — same removal, not done here.)
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
    body: 'Trace a pipe run. In-wall runs route through the stud bays, inside the wall.',
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
