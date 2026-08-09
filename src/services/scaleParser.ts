import { RASTER_SCALE } from './constants'

/**
 * Reading the scale off a drawing that STATES its scale.
 *
 * There are two ways a plan says it, and they look nothing alike:
 *
 *   metric    "1:50"            — a plain ratio
 *   imperial  `1/4" = 1'-0"`    — an equation between two lengths
 *
 * The imperial form is the one that caused trouble. A regex looking for a
 * ratio with `:` OR `/` as its separator finds "1/4" inside it and reads the
 * sheet as 1:4 — roughly twelve times too small. Measured on real municipal
 * drawing sets, three of five came back at 0.94 mm/px for exactly this reason,
 * every one of them a normally-labelled American plan. Worse, the result was
 * flagged `parsed` and so OUTRANKED the paper-anchored inference, which had
 * the right answer on the very sheets the parser was wrecking.
 *
 * So `/` between two numbers is treated as a FRACTION, never as a ratio, and
 * only `:` separates a metric ratio.
 */

/** Real-world millimetres per millimetre of paper, e.g. 48 for 1/4"=1'-0". */
export type ScaleRatio = number

/** Ratios outside this are not building drawings — a detail at 1:2, a key plan
 *  at 1:2000. Anything beyond is a false positive, not a scale. */
const MIN_RATIO = 4
const MAX_RATIO = 500
/** The band a floor plan actually lives in; preferred when several match. */
const TYPICAL_MIN = 10
const TYPICAL_MAX = 500

/** "1", "1/4", "1 1/2", "3/16" → inches as a number. */
function parseInchExpression(whole: string | undefined, num: string | undefined, den: string | undefined): number | null {
  const w = whole ? parseInt(whole, 10) : 0
  const n = num ? parseInt(num, 10) : 0
  const d = den ? parseInt(den, 10) : 0
  if (d > 0) {
    if (!Number.isFinite(n) || n <= 0) return null
    return w + n / d
  }
  if (!whole) return null
  return w > 0 ? w : null
}

/**
 * `1/4" = 1'-0"`, `3/16"=1'`, `1" = 20'`, `1 1/2" = 1'-0"`.
 *
 * The left side is paper inches, the right side is real feet (plus optional
 * inches). The ratio is simply how many real inches one paper inch represents.
 */
const IMPERIAL_RE =
  /(?:(\d+)\s+)?(?:(\d+)\s*\/\s*(\d+)|(\d+))\s*(?:"|''|in\b|inch(?:es)?\b)?\s*=\s*(\d+)\s*(?:'|ft\b|feet\b|foot\b)(?:\s*-?\s*(\d+)\s*(?:"|''|in\b)?)?/gi

/** `1:50` — a colon is always a ratio. */
const METRIC_RE = /\b1\s*:\s*(\d{1,4})\b/g

/**
 * `1/50` — a slash is a ratio ONLY when it cannot be an imperial fraction.
 *
 * Continental drawings really do write 1/50 for 1:50, so a blanket ban on the
 * slash would break them. Two things separate the two readings, and a real
 * notation satisfies both:
 *
 *   the denominator is 10 or more — imperial fractions are halves, quarters,
 *   eighths and sixteenths, never fiftieths;
 *
 *   and it is not followed by an inch mark or an `=`, because `1/16" = 1'-0"`
 *   is an equation about lengths no matter how big the denominator looks.
 */
const SLASH_RATIO_RE = /\b1\s*\/\s*(\d{2,4})\b/g
/** What would make a slash expression an imperial fraction after all. */
const IMPERIAL_TAIL_RE = /^\s*(?:"|''|in\b|inch|=)/i

/** Every scale ratio the text plausibly states, in the order found. */
export function findScaleRatios(text: string): ScaleRatio[] {
  const out: ScaleRatio[] = []

  for (const m of text.matchAll(IMPERIAL_RE)) {
    const paperInches = parseInchExpression(m[1], m[2], m[3]) ?? (m[4] ? parseInt(m[4], 10) : null)
    if (!paperInches || paperInches <= 0) continue
    const feet = parseInt(m[5], 10)
    const inches = m[6] ? parseInt(m[6], 10) : 0
    const realInches = feet * 12 + inches
    if (!Number.isFinite(realInches) || realInches <= 0) continue
    const ratio = realInches / paperInches
    if (ratio >= MIN_RATIO && ratio <= MAX_RATIO) out.push(ratio)
  }

  for (const m of text.matchAll(METRIC_RE)) {
    const ratio = parseInt(m[1], 10)
    if (Number.isFinite(ratio) && ratio >= MIN_RATIO && ratio <= MAX_RATIO) out.push(ratio)
  }

  for (const m of text.matchAll(SLASH_RATIO_RE)) {
    // Look at what follows before believing it: an inch mark or an `=` means
    // this is the left-hand side of `1/16" = 1'-0"`, not the ratio 1:16.
    const tail = text.slice((m.index ?? 0) + m[0].length)
    if (IMPERIAL_TAIL_RE.test(tail)) continue
    const ratio = parseInt(m[1], 10)
    if (Number.isFinite(ratio) && ratio >= MIN_RATIO && ratio <= MAX_RATIO) out.push(ratio)
  }

  return out
}

/**
 * The best scale the sheet states, as a normalised "1:N" string, or null.
 *
 * Null is a perfectly good answer — it hands the question to the
 * paper-anchored inference in scaleInference.ts, which on these drawings is
 * the more reliable of the two. Returning a bad number is far worse than
 * returning none, because `parsed` beats `inferred` downstream.
 */
export function pickScaleNotation(text: string): string | null {
  const ratios = findScaleRatios(text)
  if (ratios.length === 0) return null

  // A title block states the sheet's own scale; details elsewhere state theirs.
  // Prefer the band a floor plan lives in, and among those the most COMMON
  // value on the sheet rather than the first — a plan repeats its scale.
  const typical = ratios.filter((r) => r >= TYPICAL_MIN && r <= TYPICAL_MAX)
  const pool = typical.length > 0 ? typical : ratios

  const counts = new Map<number, number>()
  for (const r of pool) counts.set(r, (counts.get(r) ?? 0) + 1)
  let best = pool[0]
  let bestCount = 0
  for (const [ratio, count] of counts) {
    if (count > bestCount) { bestCount = count; best = ratio }
  }

  return `1:${Math.round(best)}`
}

/**
 * Estimate mm-per-pixel from a scale notation like "1:100", or from the
 * imperial form written out in full.
 */
export function deriveScaleFromNotation(notation: string): number | null {
  const ratios = findScaleRatios(notation)
  const ratio = ratios[0]
  if (!ratio) return null

  const ptPerPx = 1 / RASTER_SCALE
  const mmPerPt = 25.4 / 72
  const mmPerPx = ratio * mmPerPt * ptPerPx

  // Guardrail: reject implausible calibration values.
  if (mmPerPx < 0.01 || mmPerPx > 200) return null
  return mmPerPx
}
