/**
 * detectionReview — what the detector is NOT sure about.
 *
 * The pipeline has always been happy to report "72 walls, 18 rooms" and offer to
 * build, with no hint that 72 walls across 18 rooms is four per room and almost
 * certainly a raster full of hatching, dimension strings and text mistaken for
 * framing. It was confidently wrong, and the user only found out by looking at a
 * pile of stubs standing where a house should be.
 *
 * Instant AND accurate is not on the table for a phone photo of a drawing. But
 * "answer one cheap question and I'll get it right" is a trade a tradesperson
 * takes every time — so long as the question BUYS something. That is what this
 * module ranks: not every doubt, only the ones worth a tap.
 *
 * Pure and side-effect free, like `assistant` — the UI feeds it a snapshot and
 * decides how loudly to say it.
 */

/** A corrective the user can actually run — maps onto an assistant action. */
export type DoubtFix = 'calibrate' | 'trace'

export interface DetectionDoubt {
  /** Stable per kind of doubt — drives the bubble's "don't nag me twice" memory. */
  id: string
  /** Said in the assistant's own voice: collaborative, never apologetic. */
  message: string
  actionLabel?: string
  actionFix?: DoubtFix
  /**
   * How much of the model this fixes, 0..100. Ordering only — the caller shows
   * the top one, because two questions at once is how you lose someone.
   */
  leverage: number
}

export interface ReviewWall {
  x1: number
  y1: number
  x2: number
  y2: number
  /** 0..1 from the detection/classification stage; absent on older results. */
  detectionConfidence?: number
  source?: 'auto' | 'user'
}

export interface DetectionReviewInput {
  scaleConfidence: 'parsed' | 'inferred' | 'fallback' | null
  scaleMmPerPx: number | null
  walls: ReviewWall[]
  roomCount: number
  openingCount: number
}

/**
 * A segment this much shorter than the typical wall is a scrap, not a wall —
 * a leader line, a dimension tick, a letter's stem. Generous on purpose: real
 * plans do contain genuinely short walls (a closet return, a pier), so this only
 * catches the clearly-not-a-wall tail.
 */
const STUB_RATIO = 0.25
/** Past this share of scraps the raster is noisy, not the building complicated. */
const STUB_SHARE_FLAG = 0.3
/** Below this the detector is guessing at the wall itself. */
const LOW_CONFIDENCE = 0.5
/** Tolerate a few guesses; past this the reading as a whole is shaky. */
const LOW_CONFIDENCE_SHARE_FLAG = 0.25

function lengthOf(w: ReviewWall): number {
  return Math.hypot(w.x2 - w.x1, w.y2 - w.y1)
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

/**
 * Everything worth flagging, highest leverage first.
 *
 * Only AUTO walls are judged — once the user has traced, those lines are ground
 * truth and second-guessing them is exactly the nagging we're trying to avoid.
 */
export function reviewDetection(input: DetectionReviewInput): DetectionDoubt[] {
  const auto = input.walls.filter((w) => w.source !== 'user')
  const doubts: DetectionDoubt[] = []

  // ── 1. No scale. One tap, and every dimension in the model becomes real. ──
  // Nothing else comes close: without this the walls may be the right SHAPE but
  // the house is an arbitrary size, so the framing, the takeoff and the material
  // list are all fiction.
  const noScale = input.scaleMmPerPx === null || input.scaleConfidence === 'fallback'
  if (noScale) {
    doubts.push({
      id: 'doubt-scale',
      message:
        "I couldn't find a scale on this sheet, so the sizes are my best guess. Tap two points you know the distance between and everything else lands right.",
      actionLabel: 'Set the scale',
      actionFix: 'calibrate',
      leverage: 100,
    })
  }

  // ── 2. A pile of scraps rather than a building. ──
  if (auto.length >= 8) {
    const lengths = auto.map(lengthOf)
    const med = median(lengths)
    const stubs = med > 0 ? lengths.filter((l) => l < med * STUB_RATIO).length : 0
    const stubShare = stubs / auto.length
    if (stubShare > STUB_SHARE_FLAG) {
      doubts.push({
        id: 'doubt-fragmented',
        message: `${auto.length} walls${
          input.roomCount > 0 ? ` across ${input.roomCount} rooms` : ''
        } — but ${stubs} are tiny offcuts, so I've likely read dimension lines and lettering as framing. Trace the outside wall and I'll take the rest from inside it.`,
        actionLabel: 'Trace the outline',
        actionFix: 'trace',
        leverage: 80,
      })
    }
  }

  // ── 3. The detector itself is unsure. ──
  const scored = auto.filter((w) => typeof w.detectionConfidence === 'number')
  if (scored.length >= 5) {
    const shaky = scored.filter((w) => (w.detectionConfidence as number) < LOW_CONFIDENCE).length
    if (shaky / scored.length > LOW_CONFIDENCE_SHARE_FLAG) {
      doubts.push({
        id: 'doubt-confidence',
        message: `I'm only half-sure about ${shaky} of these ${scored.length} walls. Worth a look before we frame on top of them — or trace those bits yourself and I'll trust your line over mine.`,
        actionLabel: 'Trace them',
        actionFix: 'trace',
        leverage: 60,
      })
    }
  }

  return doubts.sort((a, b) => b.leverage - a.leverage)
}

/** The single thing worth asking about right now, or null if the reading looks sound. */
export function topDoubt(input: DetectionReviewInput): DetectionDoubt | null {
  return reviewDetection(input)[0] ?? null
}
