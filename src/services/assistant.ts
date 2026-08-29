/**
 * The assistant — a deterministic, on-device "coach" that watches the workspace
 * and surfaces ONE friendly next-step suggestion at a time. Pure + side-effect
 * free so it's trivially testable; the UI (AssistantBubble) feeds it a context
 * snapshot and dispatches the chosen action. This is the substrate a future
 * LLM/vision layer plugs into — for now it's rules, instant and free.
 *
 * Tone: omnipresent but never pushy — helpful, friendly, professional. One CTA
 * at a time, and it goes quiet the moment the user is actually working.
 */

import { reviewDetection, type DetectionReviewInput } from './detectionReview'
import type { Lesson } from './correctionLedger'

export type AssistantTone = 'idle' | 'progress' | 'success'

/** Maps 1:1 to a real action the bubble can run on the user's behalf. */
export type AssistantActionKind =
  | 'calibrate'
  | 'useDetectedScale'
  | 'layFloor'
  | 'autoBuild'
  | 'findRest'
  | 'trace'
  /** Put the top lesson from the correction ledger into force on this sheet. */
  | 'applyLesson'

export interface Suggestion {
  /** Stable per logical step — drives "don't nag the same step" dismiss memory. */
  id: string
  message: string
  actionLabel?: string
  actionKind?: AssistantActionKind
  tone: AssistantTone
}

export interface AssistantContext {
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
   * only so older callers keep compiling; without it the coach behaves exactly
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
}

/** Panels that mean "the user is mid-action" — stay silent so we're not pushy. */
const BUSY_PANELS = new Set(['picker', 'object', 'wall', 'line', 'panelBoard'])

/**
 * The next thing worth saying — or null to stay quiet. First match wins, so the
 * order encodes the build sequence (calibrate → floor → walls → build).
 */
export function nextSuggestion(ctx: AssistantContext): Suggestion | null {
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
   * is standing at the wrong size, "build the whole 3D from them" builds a house
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
   * belonged to is gone from the Build drawer, and a coach that opens by handing
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
  // on build status alone made the coach jump straight to "your model's ready"
  // out of sequence — right after a floor, before any walls. Requiring walls
  // keeps the coach in step: floor → walls → build → done.
  const hasRealWalls = ctx.userWallCount > 0 || ctx.hasWalls
  if (ctx.built && hasRealWalls) {
    return {
      id: 'built',
      message: "Your model's standing. Tap a wall to tweak it, or add doors, windows and fixtures from Place.",
      tone: 'success',
    }
  }

  /**
   * ONCE THEY HAVE TRACED ONE, THE OFFER IS "FIND THE REST".
   *
   * This used to say "Ready to see it in 3D?" with a Build 3D button. There is
   * no such button any more, and there is nothing to build: the walls stand up
   * as they are traced. So the coach was offering a step that had already
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
      message: `I found ${ctx.detectedWallCount} wall${ctx.detectedWallCount === 1 ? '' : 's'} in the plan. Want me to build the whole 3D from them?`,
      actionLabel: 'Build it for me',
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
