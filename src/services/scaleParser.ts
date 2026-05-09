/**
 * Estimate mm-per-pixel from a scale notation like "1:100" or "1/50".
 */
export function deriveScaleFromNotation(notation: string): number | null {
  const match = notation.match(/(\d+)\s*[:/]\s*(\d+)/)
  if (!match) return null

  const left = parseInt(match[1], 10)
  const right = parseInt(match[2], 10)
  if (!Number.isFinite(left) || !Number.isFinite(right) || left <= 0 || right <= 0) return null

  // For notation a:b, real-world scale factor is b/a.
  const ratio = right / left
  const ptPerPx = 1 / 1.5  // inverse of RASTER_SCALE
  const mmPerPt = 25.4 / 72
  const mmPerPx = ratio * mmPerPt * ptPerPx

  // Guardrail: reject implausible calibration values.
  if (mmPerPx < 0.01 || mmPerPx > 200) return null
  return mmPerPx
}
