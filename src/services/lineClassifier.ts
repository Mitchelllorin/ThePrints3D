/**
 * Line classifier
 * ---------------
 * Given a candidate line segment (from edge detection) AND the original
 * rasterized drawing pixels, decide what KIND of line it is:
 *  - wall      — solid, continuous, thick enough
 *  - dimension — solid but very thin (callout lines)
 *  - dashed    — alternating dark/light at low frequency (grid, hidden)
 *  - dotted    — many tiny dark spots with gaps (overhead/phantom)
 *  - leader    — too short to be a wall
 *  - unknown
 *
 * Algorithm: sample N points along the centerline of the candidate. At
 * each, average a small neighborhood (so we hit the *line* even if the
 * candidate is offset by 1px from edge-detector quantization). Threshold
 * to get a dark/light boolean stream. Count transitions and the fraction
 * of "dark" samples. Combine with thickness / length to score.
 *
 * This is a coarse classifier — it intentionally only filters obvious
 * non-walls. The detection layer can then offer "I'm not sure" lines to
 * the user for one-click correction.
 */

import type { ClassifiedLine, LineClass, LineClassificationStats } from '../symbols/types'

const SAMPLE_COUNT = 60
const NEIGHBORHOOD = 1   // sample a (2*N+1) x (2*N+1) neighborhood around each centerline pixel
const DARK_THRESHOLD = 128

interface LineClassifierContext {
  darkThreshold: number
  brightnessSpan: number
}

/** Sample brightness at a pixel with a tiny neighborhood average. */
function sampleBrightness(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
): number {
  let sum = 0
  let count = 0
  for (let dy = -NEIGHBORHOOD; dy <= NEIGHBORHOOD; dy++) {
    for (let dx = -NEIGHBORHOOD; dx <= NEIGHBORHOOD; dx++) {
      const px = x + dx
      const py = y + dy
      if (px < 0 || px >= width || py < 0 || py >= height) continue
      const i = (py * width + px) * 4
      const r = data[i]
      const g = data[i + 1]
      const b = data[i + 2]
      sum += 0.299 * r + 0.587 * g + 0.114 * b
      count++
    }
  }
  return count > 0 ? sum / count : 255
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return DARK_THRESHOLD
  if (sorted.length === 1) return sorted[0]
  const idx = clamp(Math.round((sorted.length - 1) * p), 0, sorted.length - 1)
  return sorted[idx]
}

function sampleLineBrightness(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  line: { x1: number; y1: number; x2: number; y2: number },
  sampleCount = 16,
): number[] {
  const dx = line.x2 - line.x1
  const dy = line.y2 - line.y1
  const samples: number[] = []
  for (let i = 0; i < sampleCount; i++) {
    const t = sampleCount === 1 ? 0.5 : i / (sampleCount - 1)
    const x = Math.round(line.x1 + t * dx)
    const y = Math.round(line.y1 + t * dy)
    samples.push(sampleBrightness(data, width, height, x, y))
  }
  return samples
}

function buildClassifierContext(
  imageData: ImageData,
  lines: Array<{ x1: number; y1: number; x2: number; y2: number }>,
): LineClassifierContext {
  const { data, width, height } = imageData
  const imageSamples: number[] = []
  const totalPixels = width * height
  const stride = Math.max(4, Math.round(Math.sqrt(totalPixels / 2048)))
  for (let y = 0; y < height; y += stride) {
    for (let x = 0; x < width; x += stride) {
      imageSamples.push(sampleBrightness(data, width, height, x, y))
    }
  }

  const lineSamples = lines.flatMap((line) =>
    sampleLineBrightness(data, width, height, line),
  )

  imageSamples.sort((a, b) => a - b)
  lineSamples.sort((a, b) => a - b)

  const backgroundBrightness = percentile(imageSamples, 0.9)
  const candidateDark = percentile(lineSamples, 0.2)
  const span = Math.max(24, backgroundBrightness - candidateDark)
  const darkThreshold = clamp(candidateDark + span * 0.45, 72, 208)

  return {
    darkThreshold,
    brightnessSpan: span,
  }
}

export function classifyLine(
  imageData: ImageData,
  line: { x1: number; y1: number; x2: number; y2: number; thickness: number },
  options: {
    minWallLengthPx?: number
    minWallThicknessPx?: number
    leaderMaxLengthPx?: number
    classifierContext?: LineClassifierContext
  } = {},
): ClassifiedLine {
  const { data, width, height } = imageData
  const {
    minWallLengthPx = 60,
    minWallThicknessPx = 3,
    leaderMaxLengthPx = 40,
    classifierContext,
  } = options

  const dx = line.x2 - line.x1
  const dy = line.y2 - line.y1
  const length = Math.sqrt(dx * dx + dy * dy)

  // ── Sample N points along the centerline ──
  const darkThreshold = classifierContext?.darkThreshold ?? DARK_THRESHOLD
  const brightnessSamples: number[] = []
  const isDark: boolean[] = []
  for (let i = 0; i < SAMPLE_COUNT; i++) {
    const t = i / (SAMPLE_COUNT - 1)
    const x = Math.round(line.x1 + t * dx)
    const y = Math.round(line.y1 + t * dy)
    const b = sampleBrightness(data, width, height, x, y)
    brightnessSamples.push(b)
    isDark.push(b < darkThreshold)
  }
  const averageBrightness = brightnessSamples.reduce((sum, value) => sum + value, 0) / brightnessSamples.length

  // Count dark→light transitions
  let transitions = 0
  for (let i = 1; i < SAMPLE_COUNT; i++) {
    if (isDark[i] !== isDark[i - 1]) transitions++
  }
  const dark_ratio = isDark.filter(Boolean).length / SAMPLE_COUNT
  const brightnessSpan = classifierContext?.brightnessSpan ?? 64
  const darknessMargin = clamp(
    (darkThreshold - averageBrightness) / Math.max(24, brightnessSpan),
    -0.25,
    0.25,
  )

  // Every branch in the decision tree below assigns both classification and confidence.
  let classification: LineClass
  let confidence: number

  if (length < leaderMaxLengthPx) {
    classification = 'leader'
    confidence = 0.85
  } else if (transitions >= 16 && dark_ratio < 0.5) {
    // Many gaps + low dark coverage = dotted (small dots) or dashed
    classification = dark_ratio < 0.35 ? 'dotted' : 'dashed'
    confidence = 0.8
  } else if (transitions >= 4 && transitions < 16 && dark_ratio < 0.75) {
    // Some gaps = dashed
    classification = 'dashed'
    confidence = 0.75
  } else if (transitions <= 4 && dark_ratio > 0.55) {
    // Mostly continuous dark = solid line. Use thickness to split wall vs dim.
    // Lowered dark_ratio threshold from 0.7 → 0.55 to capture faded/lightly
    // scanned blueprint lines that are still clearly walls.
    if (line.thickness < minWallThicknessPx) {
      classification = 'dimension'
      confidence = clamp((dark_ratio > 0.7 ? 0.7 : 0.5) + darknessMargin * 0.4, 0.45, 0.8)
    } else if (length < minWallLengthPx) {
      classification = 'leader'
      confidence = 0.65
    } else {
      classification = 'wall'
      confidence = clamp((dark_ratio > 0.7 ? 0.9 : 0.65) + darknessMargin * 0.5, 0.55, 0.95)
    }
  } else if (
    transitions <= 6 &&
    dark_ratio > 0.40 &&
    line.thickness >= minWallThicknessPx &&
    length >= minWallLengthPx
  ) {
    // Borderline: slightly discontinuous but long and thick enough to be a wall.
    // Captures walls with minor scanning gaps, staircase artefacts, or light ink.
    classification = 'wall'
    confidence = 0.5
  } else {
    classification = 'unknown'
    confidence = 0.4
  }

  return {
    x1: line.x1,
    y1: line.y1,
    x2: line.x2,
    y2: line.y2,
    thickness: line.thickness,
    classification,
    confidence,
    transitions,
    dark_ratio,
  }
}

export function classifyLines(
  imageData: ImageData,
  lines: Array<{ x1: number; y1: number; x2: number; y2: number; thickness: number }>,
  options?: Parameters<typeof classifyLine>[2],
): { classified: ClassifiedLine[]; stats: LineClassificationStats } {
  const classifierContext = buildClassifierContext(imageData, lines)
  const classified = lines.map((l) =>
    classifyLine(imageData, l, { ...options, classifierContext }),
  )
  const stats: LineClassificationStats = {
    total: classified.length,
    wall: 0,
    dimension: 0,
    dashed: 0,
    dotted: 0,
    leader: 0,
    unknown: 0,
  }
  for (const c of classified) stats[c.classification]++
  return { classified, stats }
}
