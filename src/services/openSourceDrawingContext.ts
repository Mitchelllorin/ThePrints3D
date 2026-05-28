function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export interface OpenSourceDrawingContextProfile {
  id: 'open-vector' | 'open-hybrid' | 'open-scan'
  /**
   * Minimum line support (orthogonal joins / parallel neighbors) expected in
   * open architectural plan sets before accepting a wall candidate.
   */
  minSupportCount: number
  /** Base confidence threshold before noise-aware adjustments. */
  baseConfidenceFloor: number
  /** Border band used to suppress title blocks / print frames. */
  borderSuppressionMarginPct: number
  /** Penalty for isolated border lines in noisy sheets. */
  borderSuppressionPenalty: number
  /** Bonus from orthogonal junction support. */
  orthogonalBonus: number
  /** Bonus from parallel overlap support. */
  parallelBonus: number
  /** Max relative thickness deviation before confidence penalty. */
  thicknessOutlierTolerance: number
  /** Minimum retained candidate ratio before fail-safe fallback. */
  minRetentionRatio: number
}

const OPEN_SOURCE_CONTEXT_PROFILES: OpenSourceDrawingContextProfile[] = [
  {
    id: 'open-vector',
    minSupportCount: 1,
    baseConfidenceFloor: 0.46,
    borderSuppressionMarginPct: 0.024,
    borderSuppressionPenalty: 0.2,
    orthogonalBonus: 0.08,
    parallelBonus: 0.06,
    thicknessOutlierTolerance: 0.6,
    minRetentionRatio: 0.36,
  },
  {
    id: 'open-hybrid',
    minSupportCount: 1,
    baseConfidenceFloor: 0.52,
    borderSuppressionMarginPct: 0.03,
    borderSuppressionPenalty: 0.24,
    orthogonalBonus: 0.1,
    parallelBonus: 0.07,
    thicknessOutlierTolerance: 0.52,
    minRetentionRatio: 0.42,
  },
  {
    id: 'open-scan',
    minSupportCount: 2,
    baseConfidenceFloor: 0.56,
    borderSuppressionMarginPct: 0.038,
    borderSuppressionPenalty: 0.28,
    orthogonalBonus: 0.12,
    parallelBonus: 0.08,
    thicknessOutlierTolerance: 0.44,
    minRetentionRatio: 0.5,
  },
]

/**
 * Pick a context profile calibrated against open architectural drawings.
 * Inputs:
 * - noiseRatio: non-wall candidate share (0..1)
 * - lineDensity: candidate-lines per pixel ratio
 */
export function selectOpenSourceContextProfile(
  noiseRatio: number,
  lineDensity: number,
): OpenSourceDrawingContextProfile {
  const normalizedNoise = clamp(noiseRatio, 0, 1)
  const normalizedDensity = clamp(lineDensity / 0.0012, 0, 1)
  const severity = normalizedNoise * 0.75 + normalizedDensity * 0.25
  if (severity < 0.35) return OPEN_SOURCE_CONTEXT_PROFILES[0]
  if (severity < 0.68) return OPEN_SOURCE_CONTEXT_PROFILES[1]
  return OPEN_SOURCE_CONTEXT_PROFILES[2]
}
