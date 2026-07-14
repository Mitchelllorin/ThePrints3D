/**
 * The assistant — a deterministic, on-device "coach" that watches the workspace
 * and surfaces ONE friendly next-step suggestion at a time. Pure + side-effect
 * free so it's trivially testable; the UI (AssistantBubble) feeds it a context
 * snapshot and dispatches the chosen action. This is the substrate a future
 * LLM/vision layer plugs into — for now it's rules, instant and free.
 *
 * Tone: omnipresent but never pushy — helpful, friendly, professional. One CTA
 * at a time, and it goes quiet the moment the user is actually working.
 *
 * Build sequence (all systems):
 *   calibrate → floor → walls → build → exterior → insulation → drywall → done
 */

export type AssistantTone = 'idle' | 'progress' | 'success'

/** Maps 1:1 to a real action the bubble can run on the user's behalf. */
export type AssistantActionKind =
  | 'calibrate'
  | 'useDetectedScale'
  | 'layFloor'
  | 'autoBuild'
  | 'build'
  | 'trace'
  | 'finishExterior'
  | 'finishInsulation'
  | 'finishDrywall'

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
  /** True once the exterior assembly (sheathing + WRB + cladding) has been applied. */
  exteriorFinished: boolean
  /** True once insulation batts have been applied to wall cavities. */
  insulationFinished: boolean
  /** True once interior drywall boarding has been enabled / applied. */
  drywallFinished: boolean
}

/** Panels that mean "the user is mid-action" — stay silent so we're not pushy. */
const BUSY_PANELS = new Set(['picker', 'object', 'wall', 'line', 'panelBoard'])

/**
 * The next thing worth saying — or null to stay quiet. First match wins, so the
 * order encodes the full build sequence (calibrate → floor → walls → build →
 * exterior → insulation → drywall → done).
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

  if (!ctx.hasFloor) {
    return {
      id: 'floor',
      message: 'Next up: lay the floor — the walls frame on top of it. I can get you started.',
      actionLabel: 'Lay the floor',
      actionKind: 'layFloor',
      tone: 'idle',
    }
  }

  const hasRealWalls = ctx.userWallCount > 0 || ctx.hasWalls

  // Terminal success — all systems complete.
  if (ctx.built && hasRealWalls && ctx.exteriorFinished && ctx.insulationFinished && ctx.drywallFinished) {
    return {
      id: 'complete',
      message: "Building complete — structure, envelope, insulation and interior all done. Check the Takeoff for materials.",
      tone: 'success',
    }
  }

  // Exterior not yet done — wrap the shell before insulation goes in.
  if (ctx.built && hasRealWalls && !ctx.exteriorFinished) {
    return {
      id: 'exterior',
      message: "Frame's up. Want me to wrap the exterior — sheathing, weather barrier and cladding — in one shot?",
      actionLabel: 'Finish exterior',
      actionKind: 'finishExterior',
      tone: 'idle',
    }
  }

  // Insulation — goes in once the exterior is weather-tight.
  if (ctx.built && hasRealWalls && ctx.exteriorFinished && !ctx.insulationFinished) {
    return {
      id: 'insulation',
      message: "Exterior's wrapped. Ready to fill the wall cavities with insulation?",
      actionLabel: 'Install insulation',
      actionKind: 'finishInsulation',
      tone: 'idle',
    }
  }

  // Drywall — interior boarding goes on after insulation is inspected.
  if (ctx.built && hasRealWalls && ctx.insulationFinished && !ctx.drywallFinished) {
    return {
      id: 'drywall',
      message: "Insulation in. Time to board the interior — I'll apply your drywall layer.",
      actionLabel: 'Apply drywall',
      actionKind: 'finishDrywall',
      tone: 'idle',
    }
  }

  // Framing done (pre-envelope) — kept for backward-compat with the existing "built" step.
  if (ctx.built && hasRealWalls) {
    return {
      id: 'exterior',
      message: "Frame's up. Want me to wrap the exterior — sheathing, weather barrier and cladding — in one shot?",
      actionLabel: 'Finish exterior',
      actionKind: 'finishExterior',
      tone: 'idle',
    }
  }

  if (ctx.userWallCount > 0) {
    return {
      id: 'build',
      message: `Nice — ${ctx.userWallCount} wall${ctx.userWallCount === 1 ? '' : 's'} traced. Ready to see it in 3D?`,
      actionLabel: 'Build 3D',
      actionKind: 'build',
      tone: 'idle',
    }
  }
  if (ctx.hasWalls) {
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
