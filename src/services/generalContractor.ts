/**
 * THE G.C. — the general contractor standing over your shoulder.
 *
 * This was called "the assistant", and before that "the coach", and neither
 * name said what it is. It is the G.C.: the one on site who knows the drawing,
 * the trade and the order of work, says the one thing worth saying, and then
 * gets out of the way. Everything it knows is on-device and free — rules and
 * arithmetic today, a vision layer later, plugged into this same substrate.
 *
 * Deterministic and side-effect free, so it is trivially testable: the UI
 * (GCBubble) hands it a snapshot of the workspace and dispatches whatever it
 * decides. It speaks in ONE suggestion at a time, and goes quiet the moment the
 * user is actually working.
 *
 * WHAT MAKES IT MORE THAN A CHECKLIST is `lesson` — what the user's own
 * corrections have taught the app about THIS sheet. See `correctionLedger`.
 */

import { reviewDetection, type DetectionReviewInput } from './detectionReview'
import type { Lesson } from './correctionLedger'

export type GCTone = 'idle' | 'progress' | 'success'

/** Maps 1:1 to a real action the bubble can run on the user's behalf. */
export type GCActionKind =
  | 'calibrate'
  | 'useDetectedScale'
  | 'layFloor'
  | 'layRoof'
  | 'autoBuild'
  | 'findRest'
  | 'trace'
  /** Open the Place drawer — doors, windows and fixtures live there. */
  | 'place'
  /** Put the top lesson from the correction ledger into force on this sheet. */
  | 'applyLesson'

export interface Suggestion {
  /** Stable per logical step — drives "don't nag the same step" dismiss memory. */
  id: string
  message: string
  actionLabel?: string
  actionKind?: GCActionKind
  tone: GCTone
}

/**
 * What is actually standing on one storey — the G.C.'s equivalent of walking up
 * and looking at it. Counts, not geometry: every question below is "is there any
 * X on this level", and hauling wall segments in here would be handing a pure
 * decision module a pile of coordinates it has no business reading.
 */
export interface GCStorey {
  /** 0 = ground. */
  level: number
  walls: number
  /** Floor/deck areas laid at this level. */
  floors: number
  /** Roof areas whose level is this one. */
  roofs: number
}

export interface GCContext {
  hasPlan: boolean
  status: 'pending' | 'processing' | 'ready' | 'error' | null
  calibrationCleared: boolean
  calibrationMode: boolean
  hasFloor: boolean
  hasWalls: boolean
  userWallCount: number
  detectedScaleAvailable: boolean
  detectedWallCount: number
  built: boolean
  traceMode: boolean
  tracePaused: boolean
  activePanel: string | null
  /**
   * What the detector produced, for `detectionReview` to second-guess. Optional
   * only so older callers keep compiling; without it the G.C. behaves exactly
   * as it did — confidently.
   */
  detection?: DetectionReviewInput | null
  /**
   * The systematic mistake the user's corrections add up to, if they add up to
   * one yet — see `correctionLedger`. Optional, and null on almost every render:
   * it takes three corrections pointing the same way before there is anything
   * here to say.
   */
  lesson?: Lesson | null
  /**
   * WHAT IS ACTUALLY STANDING, storey by storey — the half of the job the G.C.
   * was blind to. Everything above describes the DRAWING and the reading taken
   * off it; this describes the model the user is looking at.
   *
   * Optional, like the two fields above it, so a caller that has not been
   * updated still compiles and still gets exactly the old behaviour: with no
   * storeys the post-build walk finds nothing to say and falls straight through
   * to the terminal it always ended on.
   */
  storeys?: GCStorey[]
  /** Doors in the model — detected off the print plus placed by hand. */
  doorCount?: number
}

/** Panels that mean "the user is mid-action" — stay silent so we're not pushy. */
const BUSY_PANELS = new Set(['picker', 'object', 'wall', 'line', 'panelBoard'])

/**
 * ONCE IT IS STANDING, LOOK AT IT.
 *
 * Every branch above this one reads the DRAWING — the scale, the reading, what
 * the corrections taught us about the sheet. None of them had ever looked at the
 * model, which meant the moment a build existed the G.C. said one fixed sentence
 * ("your model's standing, tap a wall to tweak it") and had nothing further to
 * offer for the rest of the session, however wrong the thing on screen was. A
 * general contractor who stops talking the moment the walls go up is not a
 * general contractor.
 *
 * So: walk the job the way it gets built. `traceLayers.ts` already orders the
 * trades for exactly this reason — deck, then framing on top of it, then the
 * roof over that — and this walks the same order rather than inventing a second
 * one. First real gap wins, same as everywhere else in this module.
 *
 * WHAT IT WILL AND WILL NOT SAY
 * -----------------------------
 * It names things that are WRONG, never things that are merely absent. A model
 * with no roof is wrong — you can see the sky through it. A model with no wiring
 * drawn is a choice, and a G.C. that opens with "you haven't run any circuits"
 * on a shell nobody has framed yet is the nagging three-step wizard this app
 * deliberately deleted. So the MEP layers are not checked here at all, and the
 * door check waits until the shell is closed, because a doorway is a legitimate
 * thing to still be missing while you are mid-trace.
 *
 * And when nothing is wrong it says so and stops, which is the branch that was
 * here before and is still the one most sessions end on.
 */
function inspectBuild(ctx: GCContext): Suggestion {
  const storeys = (ctx.storeys ?? []).filter((s) => s.walls > 0 || s.floors > 0 || s.roofs > 0)

  /**
   * WALLS ON NOTHING.
   *
   * The ground storey is not checked: building lays a slab, so level 0 always
   * has something under it and flagging it would fire on every model ever made.
   * Upper storeys are the real case, and one the user has actually hit — walls
   * carried up to a second floor that has no deck under them, which reads in 3D
   * as a storey floating in mid-air.
   */
  const unfloored = storeys.find((s) => s.level > 0 && s.walls > 0 && s.floors === 0)
  if (unfloored) {
    return {
      id: `build-nofloor-${unfloored.level}`,
      message: `Level ${unfloored.level + 1} has walls with no deck under them — want to lay the floor?`,
      actionLabel: 'Lay the floor',
      actionKind: 'layFloor',
      tone: 'idle',
    }
  }

  /**
   * A DECK WITH NOTHING ON IT. The other half of the same mistake: the floor
   * went in, the walls never followed. Ground level counts here — an empty slab
   * is only ever a job half started.
   */
  const unframed = storeys.find((s) => s.floors > 0 && s.walls === 0)
  if (unframed) {
    return {
      id: `build-nowalls-${unframed.level}`,
      message:
        unframed.level > 0
          ? `Level ${unframed.level + 1}'s deck is down with nothing standing on it. Trace its walls?`
          : "The deck's down with nothing standing on it. Trace the walls?",
      actionLabel: 'Trace walls',
      actionKind: 'trace',
      tone: 'idle',
    }
  }

  /** OPEN TO THE SKY. Walls up anywhere and not one roof area in the model. */
  if (storeys.some((s) => s.walls > 0) && storeys.every((s) => s.roofs === 0)) {
    return {
      id: 'build-noroof',
      message: "Walls are up and it's still open to the sky. Want to pull a roof over it?",
      actionLabel: 'Pull a roof',
      actionKind: 'layRoof',
      tone: 'idle',
    }
  }

  /**
   * NO WAY IN.
   *
   * Last, and only once the shell is actually closed — deck, walls and roof all
   * present. Before that a missing doorway is just work not done yet, and saying
   * so would be the checklist behaviour this module exists to avoid. After it,
   * a building with no door is simply wrong, and worth one sentence.
   */
  const shellClosed =
    storeys.some((s) => s.walls > 0) &&
    storeys.some((s) => s.floors > 0) &&
    storeys.some((s) => s.roofs > 0)
  if (shellClosed && ctx.doorCount === 0) {
    return {
      id: 'build-nodoor',
      message: "It's closed in, but there's no door in it yet. Place one?",
      actionLabel: 'Place a door',
      actionKind: 'place',
      tone: 'idle',
    }
  }

  return {
    id: 'built',
    message: "Your model's standing. Tap a wall to tweak it, or add doors, windows and fixtures from Place.",
    tone: 'success',
  }
}

/**
 * The next thing worth saying — or null to stay quiet. First match wins, so the
 * order encodes the build sequence (calibrate → floor → walls → build).
 */
export function nextSuggestion(ctx: GCContext): Suggestion | null {
  // No plan yet — the onboarding card already guides this; don't double up.
  if (!ctx.hasPlan) return null

  // Quiet while the user is actively working (tracing, calibrating, editing).
  if (ctx.traceMode && !ctx.tracePaused) return null
  if (ctx.calibrationMode) return null
  if (ctx.activePanel && BUSY_PANELS.has(ctx.activePanel)) return null

  if (ctx.status === 'pending' || ctx.status === 'processing') {
    return {
      id: 'processing',
      message: 'Reading your drawing… pulling out the walls and rooms.',
      tone: 'progress',
    }
  }

  if (ctx.status !== 'ready') return null

  if (!ctx.calibrationCleared) {
    if (ctx.detectedScaleAvailable) {
      return {
        id: 'useDetected',
        message: 'I picked up a scale from the drawing — want me to use it and skip ahead?',
        actionLabel: 'Use detected scale',
        actionKind: 'useDetectedScale',
        tone: 'idle',
      }
    }
    return {
      id: 'calibrate',
      message: "Let's lock in the scale first so every measurement is right — tap two points you know the distance between.",
      actionLabel: 'Set the scale',
      actionKind: 'calibrate',
      tone: 'idle',
    }
  }

  /**
   * WHAT THEY HAVE ALREADY TAUGHT US OUTRANKS WHAT WE WERE GOING TO SAY NEXT.
   *
   * A lesson only exists once three corrections have pointed the same way, and
   * what it says is that the reading underneath everything below is out — the
   * scale, or the drywall allowance every thickness was measured against. Every
   * suggestion after this one is built on that reading: "your model's standing"
   * is standing at the wrong size, "stand them up" stands a house
   * from walls we have evidence are misread, and "find the rest" goes looking
   * for more of the same mistake.
   *
   * So it goes ahead of the terminal step, not after it. The user is being told
   * the most useful thing the app knows at that moment, and it is a thing only
   * they could have taught it.
   */
  if (ctx.lesson) {
    return {
      id: ctx.lesson.id,
      message: ctx.lesson.message,
      actionLabel: ctx.lesson.actionLabel,
      // A lesson with nothing to act on (the detector-bias note, which is about
      // the NEXT sheet) is still worth saying — it just gets no button.
      actionKind: ctx.lesson.actionLabel ? 'applyLesson' : undefined,
      tone: 'idle',
    }
  }

  /**
   * NO "NEXT UP: LAY THE FLOOR".
   *
   * This was the last surviving piece of the old three-step wizard: load a
   * preset and a card came across the top of the workspace telling you to lay a
   * floor, in the same voice, before you had looked at the plan. The wizard it
   * belonged to is gone from the Build drawer, and a G.C. that opens by handing
   * out the first chore is the thing this app is supposed to not be.
   *
   * The suggestions BELOW earn their place — they offer something the user could
   * not have done themselves in one tap (find the rest, use a scale we read off
   * the drawing, build from what we detected). "Lay the floor" is just the next
   * item on a list, and the rail already says it, in the section that does it.
   */

  // "Model's standing" is the TERMINAL step — only declare it once there are real
  // WALLS in the model. `ctx.built` is sticky (a fresh auto-build on load, or
  // building right after laying a floor, flips it true), so gating the terminal
  // on build status alone made the G.C. jump straight to "your model's ready"
  // out of sequence — right after a floor, before any walls. Requiring walls
  // keeps the G.C. in step: floor → walls → build → done.
  const hasRealWalls = ctx.userWallCount > 0 || ctx.hasWalls
  if (ctx.built && hasRealWalls) {
    return inspectBuild(ctx)
  }

  /**
   * ONCE THEY HAVE TRACED ONE, THE OFFER IS "FIND THE REST".
   *
   * This used to say "Ready to see it in 3D?" with a Build 3D button. There is
   * no such button any more, and there is nothing to build: the walls stand up
   * as they are traced. So the G.C. was offering a step that had already
   * happened, by way of a control that no longer exists.
   *
   * What is genuinely worth offering at that exact moment is the thing the app
   * does that nothing else does — you traced one, let it find the others.
   */
  if (ctx.userWallCount > 0) {
    return {
      id: 'findRest',
      message: `Nice — ${ctx.userWallCount} wall${ctx.userWallCount === 1 ? '' : 's'} traced. Want me to find the rest that match?`,
      actionLabel: '✨ Find the rest',
      actionKind: 'findRest',
      tone: 'idle',
    }
  }
  if (ctx.hasWalls) {
    /**
     * SAY WHAT WE ARE UNSURE OF BEFORE OFFERING TO BUILD ON IT.
     *
     * The line below is the one `detectionReview` was written against: happy to
     * report "72 walls" and offer to build the whole model from them, with no
     * hint that 72 walls across 18 rooms is four to a room and almost certainly
     * a raster full of hatching, dimension strings and lettering read as
     * framing. It was confidently wrong, and the user only found out by looking
     * at a pile of stubs standing where a house should be.
     *
     * That module has sat here finished and wired to nothing ever since. So when
     * the read looks shaky, raise the doubt INSTEAD of the offer — one question,
     * the highest-leverage one, in place of a confident claim we cannot support.
     * When it looks sound, nothing changes and the offer stands as before.
     *
     * The scale doubt is dropped on purpose: the calibrate step above owns
     * scale entirely and has already had its turn, so repeating it here would
     * only be nagging about a question the user has already answered or waved
     * off.
     */
    const doubt = ctx.detection
      ? reviewDetection(ctx.detection).find((d) => d.id !== 'doubt-scale')
      : undefined
    if (doubt) {
      return {
        id: doubt.id,
        message: doubt.message,
        actionLabel: doubt.actionLabel,
        actionKind: doubt.actionFix,
        tone: 'idle',
      }
    }
    return {
      id: 'autoBuild',
      // "Build the whole 3D from them" was the one line in here nobody says out
      // loud — "a 3D" isn't a noun on a site. Walls get STOOD UP, which is also
      // the word the finished state already uses ("Your model's standing").
      message: `I found ${ctx.detectedWallCount} wall${ctx.detectedWallCount === 1 ? '' : 's'} in the plan. Want me to stand them up?`,
      actionLabel: 'Stand them up',
      actionKind: 'autoBuild',
      tone: 'idle',
    }
  }
  return {
    id: 'trace',
    message: "Now trace the walls over the plan — or pick a type and I'll guide you.",
    actionLabel: 'Start tracing',
    actionKind: 'trace',
    tone: 'idle',
  }
}
