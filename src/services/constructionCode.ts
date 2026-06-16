/**
 * Construction-code reference values — the single source of truth for things
 * like nominal wall thicknesses. Keyed by the framing-type keys the wall-type
 * picker stamps onto each wall (see FRAMING_TYPES in FloorplanPanel).
 */

/** Nominal finished wall thickness, in metres, by framing-type key. */
export const WALL_THICKNESS_M: Record<string, number> = {
  'wood-2x4': 0.0889,   // 3.5"
  'wood-2x6': 0.1397,   // 5.5"
  'wood-2x8': 0.1905,   // 7.5"
  'steel-3-5-8': 0.0921, // 3-5/8"
  'steel-6': 0.1524,    // 6"
  'cmu': 0.1905,        // 8" standard block
}

/** Fallback thickness when a wall has no (or an unknown) framing type. */
export const DEFAULT_WALL_THICKNESS_M = 0.0889  // 2×4

/** Look up a framing thickness, falling back to the 2×4 default. */
export function wallThicknessM(framingType?: string): number {
  return (framingType && WALL_THICKNESS_M[framingType]) || DEFAULT_WALL_THICKNESS_M
}
