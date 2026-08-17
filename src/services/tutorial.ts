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
    body: 'We build *3D models from 2D prints*, floorplans and drawings. This is a simple floor plan we will turn into an interactive model.',
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
    body: 'There are a few ways ThePrints3D creates 3D walls. They all begin with *calibration*: we need a *known, measured distance* marked, so we know how big or small things are.',
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
    body: 'One way is to trace on the print with your finger: pick a wall, drop a dot, and pull along the wall line. Lift when you’re done and a 3D wall, studs and board (if you want, it’s a setting) and all, stands, auto squared (a setting, should you want an angled wall) and on the line you traced. Once that one’s up it will chain as many as you like, or you can use the G.C. to *find the rest*.',
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
    body: 'One wall traced is enough to go on. *Find the rest* reads the print for everything that matches it, and stands them all up.',
    // The control is lit while it is named, then the tour presses it — you see
    // WHERE it lives and WHAT it does in one beat.
    //
    // `enter: 'framing'` is what makes the highlight possible at all: the Find
    // the rest button only renders on the trace bar while you are tracing
    // framing (`framingActive && hasTrace`), so with trace mode off there was
    // no button on screen and the spotlight had nothing to ring. It is also
    // how you reach it for real — you press it mid-run, having just traced.
    enter: 'framing',
    target: 'find-rest',
    perform: 'findRest',
    autoAdvanceMs: 16000,
    done: () => false,
  },
  // THE TOUR ENDS HERE, ON PURPOSE.
  //
  // It used to carry on through roof, doors and windows, plumbing, electrical
  // and the takeoff — steps written before any of this was rewritten, teaching
  // features in a voice and an order that no longer match. Worse, the trades
  // are the next thing being BUILT, so a tour explaining them would be teaching
  // a version of the app that is about to change underneath it.
  //
  // What ships is the part that is finished and that people are actually stuck
  // on: this is a plan, this is calibration, here is a floor, here is a wall,
  // and here is the trick that does the other nineteen. That is enough to stop
  // someone staring at a blank workspace, which is the whole job of a tutorial.
  {
    id: 'done',
    title: 'That’s the basics',
    body: 'Trace what you need and let it *find the rest* — the model builds as you go. Have a pull at the floor and the walls.',
    // Terminal: the coach shows Finish rather than Next.
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
