/**
 * buildIntake — the few questions worth asking before the walls go up.
 *
 * The app used to guess. Not politely, either: a house with no stated ceiling
 * height framed at 3.2 m — ten foot six — out of concrete block, because those
 * are the defaults in `workspaceScene` and the only way to say otherwise was to
 * type "wall height 2.4m" into a free-text box and hope the regex caught it.
 *
 * A drawing cannot be read perfectly from a phone photo, and pretending
 * otherwise is what produced a pile of stubs standing eighteen feet tall. The
 * honest alternative is not a longer form — it is a SHORT one, asked at the
 * right moment, that earns its keep:
 *
 *   upload → detect → ask only what is still unknown → build → edit freely
 *
 * Three rules hold this together:
 *
 *   1. Ask only what detection could not work out. A clean PDF with a scale in
 *      the title block should get through this in one question or none; the
 *      phone photo gets four. Same framework, and good prints stay fast.
 *   2. Every question carries a SUGGESTED answer, so "Next" is always a valid
 *      answer and the flow is never a wall of empty fields.
 *   3. Every question says why it is being asked. "So the framing lands at the
 *      right height" is the difference between a form and a colleague.
 *
 * Pure and side-effect free, like `assistant` and `detectionReview` — the UI
 * feeds a snapshot and renders whatever comes back.
 */

/** How the answer is captured — the UI picks a control from this. */
export type IntakeKind = 'length' | 'area' | 'count' | 'choice'

export interface IntakeOption {
  value: string
  label: string
}

export interface IntakeQuestion {
  /** Stable — drives progress, "don't ask twice", and analytics. */
  id: string
  /** One line, in trade language. Asked, not demanded. */
  prompt: string
  /** Why we need it. Short; shown small under the prompt. */
  because: string
  kind: IntakeKind
  /** Presentation unit for numeric answers; the UI formats to the active unit. */
  unit?: 'ft' | 'sqft'
  options?: IntakeOption[]
  /**
   * Pre-filled, sensible, and correct often enough to just accept. Never a
   * blank field — a default the user can override is a question that takes one
   * tap instead of a keyboard.
   */
  suggested: string
  /** 0..100. Ordering only: the biggest correction gets asked first. */
  leverage: number
}

/** What the pipeline already worked out — everything absent becomes a question. */
export interface IntakeState {
  /** A trustworthy mm-per-pixel is in hand (parsed or calibrated, not fallback). */
  scaleKnown: boolean
  /** Stated ceiling height in metres, or null if nobody has ever said. */
  ceilingM: number | null
  /** Storeys, or null if the sheet did not say and nobody has. */
  storeys: number | null
  /** Detection produced a scrappy, over-segmented read (see `detectionReview`). */
  fragmented: boolean
  /** Openings found but not confidently typed as door vs window. */
  ambiguousOpenings: number
  /** Drives the suggested answers — a warehouse is not a bungalow. */
  buildType?: string
}

/** 8'-0" finished ceiling: the residential default anywhere in North America. */
const RESIDENTIAL_CEILING_FT = '8'
/** Commercial and industrial shells run taller; 10' is the honest starting point. */
const COMMERCIAL_CEILING_FT = '10'

function isResidential(buildType?: string): boolean {
  return !buildType || buildType.startsWith('residential')
}

/**
 * The questions this particular print still needs answered, biggest first.
 *
 * Returns an empty list when the drawing read cleanly — which is the point. The
 * flow is not a toll booth; it is what the app does INSTEAD of guessing.
 */
export function planIntake(state: IntakeState): IntakeQuestion[] {
  const questions: IntakeQuestion[] = []

  // ── Scale. Nothing else matters as much. ──
  //
  // Asked as SQUARE FOOTAGE rather than "tap two points you know": a
  // tradesperson knows the square footage of the job without measuring
  // anything, and it is one number typed rather than two taps landed accurately
  // on a phone screen. With the detected footprint in pixels it gives the same
  // answer — mm/px falls out of the ratio of the real area to the pixel area.
  if (!state.scaleKnown) {
    questions.push({
      id: 'intake-area',
      prompt: 'Roughly how many square feet is this floor?',
      because: "There's no scale on the sheet, so this is what makes every measurement real.",
      kind: 'area',
      unit: 'sqft',
      suggested: '',
      leverage: 100,
    })
  }

  // ── Ceiling height. One number, every wall in the model. ──
  if (state.ceilingM === null) {
    questions.push({
      id: 'intake-ceiling',
      prompt: 'How tall are the ceilings?',
      because: 'Sets the wall height, so the framing and the sheet counts come out right.',
      kind: 'length',
      unit: 'ft',
      suggested: isResidential(state.buildType) ? RESIDENTIAL_CEILING_FT : COMMERCIAL_CEILING_FT,
      leverage: 90,
    })
  }

  // ── The outline, when the read came back as scraps. ──
  //
  // Not a number — a gesture, and the highest-value one in the app. Everything
  // outside the perimeter is noise to be thrown away and everything inside it is
  // interior: one traced outline turns an unusable detection into a usable one.
  if (state.fragmented) {
    questions.push({
      id: 'intake-outline',
      prompt: 'Trace round the outside wall for me',
      because: "This print came back noisy. Your outline tells me what's building and what's dimension lines.",
      kind: 'choice',
      options: [
        { value: 'trace', label: "I'll trace it" },
        { value: 'skip', label: 'Use what you found' },
      ],
      suggested: 'trace',
      leverage: 80,
    })
  }

  // ── Storeys. Cheap, and it decides whether anything stacks. ──
  if (state.storeys === null) {
    questions.push({
      id: 'intake-storeys',
      prompt: 'How many floors?',
      because: 'Walls only carry up if I know there’s something above them.',
      kind: 'count',
      suggested: '1',
      leverage: 70,
    })
  }

  // ── Door or window. Cheap each, so only earn it in ONE batched pass. ──
  //
  // Deliberately last and deliberately singular: eight separate prompts is how
  // a helpful flow turns into an interrogation. The UI shows them as one
  // tap-through over the plan, not a question each.
  if (state.ambiguousOpenings > 0) {
    questions.push({
      id: 'intake-openings',
      prompt: `I found ${state.ambiguousOpenings} opening${
        state.ambiguousOpenings === 1 ? '' : 's'
      } I can't call — door or window?`,
      because: 'A window gets a sill and a header; a door gets a threshold. They frame differently.',
      kind: 'choice',
      options: [
        { value: 'review', label: 'Show me' },
        { value: 'guess', label: 'Your best guess' },
      ],
      suggested: 'review',
      leverage: 40,
    })
  }

  return questions.sort((a, b) => b.leverage - a.leverage)
}

/**
 * Scale from a stated floor area.
 *
 * The footprint the detector found is in pixels; the user says how many square
 * feet it really is. Area scales with the SQUARE of a length, so the millimetres
 * per pixel is the square root of the ratio — which is also why this is
 * forgiving: a 10% error in the stated area is only a 5% error in every length.
 *
 * Returns null rather than a wrong number when either side is unusable.
 */
export function scaleFromFloorArea(footprintPx2: number, statedSqFt: number): number | null {
  if (!(footprintPx2 > 0) || !(statedSqFt > 0)) return null
  const SQ_MM_PER_SQ_FT = 92903.04            // (304.8 mm)²
  const realSqMm = statedSqFt * SQ_MM_PER_SQ_FT
  const mmPerPx = Math.sqrt(realSqMm / footprintPx2)
  return Number.isFinite(mmPerPx) && mmPerPx > 0 ? mmPerPx : null
}
