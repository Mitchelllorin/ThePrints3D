/**
 * Wall type classifier
 * --------------------
 * Buckets a measured wall thickness into a structural wall type.
 *
 * Why this matters
 * ----------------
 * Architectural drawings show *finished* wall thickness (framing + drywall),
 * not raw framing dimension. To know what stud is inside the wall, we must:
 *
 *   1. Convert pixel thickness → mm (using calibrated scale)
 *   2. Subtract the expected drywall thickness on both faces
 *   3. Bucket the remaining "framing" thickness into a stud type
 *
 * Defaults: 1 layer of 5/8" Type X drywall both sides = +1¼" finished
 * total (32 mm). Override to "double-layer" for fire-rated demising /
 * shaft walls common in multi-unit residential & commercial work.
 *
 * Buckets cover both wood and steel studs (same nominal sizes):
 *   • partition-thin    : ≤  60mm framing (1½" steel partition)
 *   • stud-2x4 / SS-3.5 : ~ 89mm framing (3½" — 2x4 wood, 3⅝" steel)
 *   • stud-2x6 / SS-6   : ~140mm framing (5½" — 2x6 wood, 6" steel)
 *   • stud-2x8          : ~190mm framing (7¼" — 2x8 wood)
 *   • stud-2x10         : ~235mm framing (9¼" — 2x10 wood)
 *   • stud-2x12         : ~286mm framing (11¼" — 2x12 wood)
 *   • masonry-thick     : > 200mm framing AFTER drywall subtraction with
 *                          no nearby stud bucket — CMU / poured concrete /
 *                          double-stud shaft wall.
 */

/** Drywall configurations a user can pick. */
export type DrywallConfig =
  | 'single-layer'   // 5/8" type X both sides → +32 mm finished
  | 'double-layer'   // 5/8" × 2 both sides   → +64 mm finished
  | 'no-drywall'     //                       → +0 mm  (raw framing already shown)

const DRYWALL_MM: Record<DrywallConfig, number> = {
  'single-layer': 32,   // 5/8" × 2 sides   = 1¼"  ≈ 32 mm
  'double-layer': 64,   // 5/8" × 2 × 2     = 2½"  ≈ 64 mm
  'no-drywall':    0,
}

/** Structural wall types returned by the classifier. */
export type WallType =
  | 'partition-thin'
  | 'stud-2x4'
  | 'stud-2x6'
  | 'stud-2x8'
  | 'stud-2x10'
  | 'stud-2x12'
  | 'masonry-thick'
  | 'unknown'

/** Per-bucket nominal framing thickness in mm (canonical center of bucket). */
export const FRAMING_MM: Record<WallType, number> = {
  'partition-thin': 41,    // 1⅝" steel partition
  'stud-2x4':       89,    // 3½"
  'stud-2x6':      140,    // 5½"
  'stud-2x8':      184,    // 7¼"
  'stud-2x10':     235,    // 9¼"
  'stud-2x12':     286,    // 11¼"
  'masonry-thick': 305,    // ≥ 12" (200mm CMU + finishes, etc.)
  'unknown':         0,
}

/** Human-readable label + colour for legend/overlay. */
export const WALL_TYPE_META: Record<WallType, { label: string; color: string }> = {
  'partition-thin': { label: '1½" partition',   color: '#a3a3a3' }, // grey
  'stud-2x4':       { label: '2x4 / 3½" steel', color: '#3b82f6' }, // blue
  'stud-2x6':       { label: '2x6 / 6" steel',  color: '#10b981' }, // green
  'stud-2x8':       { label: '2x8',             color: '#f59e0b' }, // amber
  'stud-2x10':      { label: '2x10',            color: '#ef4444' }, // red
  'stud-2x12':      { label: '2x12',            color: '#a855f7' }, // purple
  'masonry-thick':  { label: 'Masonry / CMU',   color: '#78350f' }, // brown
  'unknown':        { label: 'Unknown',         color: '#71717a' }, // zinc
}

/** Tolerance (in mm) when matching a measured framing thickness to a bucket. */
const BUCKET_TOLERANCE_MM = 18

/** Pixel→mm helper. Returns null if scale isn't calibrated. */
export function pxToMm(pixels: number, scaleMmPerPx: number | null): number | null {
  if (!scaleMmPerPx || !Number.isFinite(scaleMmPerPx) || scaleMmPerPx <= 0) return null
  return pixels * scaleMmPerPx
}

export interface WallTypeResult {
  type: WallType
  /** Estimated structural framing thickness (mm). */
  framingMm: number
  /** Finished thickness measured on the drawing (mm). */
  finishedMm: number
  /** 0..1 — how cleanly the measured value sits inside its bucket. */
  confidence: number
}

/**
 * Classify a wall's finished thickness into a structural wall type.
 *
 * @param finishedMm    Finished wall thickness in millimetres (from print).
 * @param drywall       Drywall configuration (single/double/none).
 */
export function classifyWallType(
  finishedMm: number,
  drywall: DrywallConfig = 'single-layer',
): WallTypeResult {
  const framing = finishedMm - DRYWALL_MM[drywall]

  if (!Number.isFinite(framing) || framing <= 20) {
    // Too thin to be anything structural — leader/dimension line probably
    return { type: 'unknown', framingMm: framing, finishedMm, confidence: 0 }
  }

  // Find closest bucket
  let best: WallType = 'unknown'
  let bestDist = Number.POSITIVE_INFINITY
  const buckets: WallType[] = [
    'partition-thin', 'stud-2x4', 'stud-2x6', 'stud-2x8', 'stud-2x10', 'stud-2x12',
  ]
  for (const b of buckets) {
    const d = Math.abs(framing - FRAMING_MM[b])
    if (d < bestDist) { bestDist = d; best = b }
  }

  // If the closest bucket is too far away, it's either masonry or unknown.
  if (bestDist > BUCKET_TOLERANCE_MM) {
    if (framing > FRAMING_MM['stud-2x12'] + BUCKET_TOLERANCE_MM) {
      return { type: 'masonry-thick', framingMm: framing, finishedMm, confidence: 0.6 }
    }
    return { type: 'unknown', framingMm: framing, finishedMm, confidence: 0.2 }
  }

  // confidence = 1 at exact match, → 0 at the tolerance edge.
  const confidence = Math.max(0, 1 - bestDist / BUCKET_TOLERANCE_MM)
  return { type: best, framingMm: framing, finishedMm, confidence }
}
