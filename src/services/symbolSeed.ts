// Bridge between a placed/traced symbol and the template matcher: turn one
// example into a seed box, then keep only the matches that are genuinely NEW
// (not sitting on a symbol the user already placed). Pure so it's unit-testable;
// the store action feeds it the ink raster + existing placements and drops a
// clone at each returned match. See symbolMatcher for the matching engine.

import type { SeedBox, SymbolMatch } from './symbolMatcher'

/** Build a seed box of side `sizePx` centred on (cx, cy), clamped to the image. */
export function seedBoxAround(cx: number, cy: number, sizePx: number, imgW: number, imgH: number): SeedBox {
  const s = Math.max(3, Math.round(sizePx))
  const half = s / 2
  const x = Math.max(0, Math.min(imgW - s, Math.round(cx - half)))
  const y = Math.max(0, Math.min(imgH - s, Math.round(cy - half)))
  return { x, y, w: Math.min(s, imgW), h: Math.min(s, imgH) }
}

/**
 * Drop matches that coincide with a symbol the user has already placed (within
 * `minGapPx`), so "find the rest" only adds instances that aren't there yet.
 * Existing points are compared once each; the nearest match to each is removed.
 */
export function dedupeMatches(
  matches: SymbolMatch[],
  existing: Array<{ x: number; y: number }>,
  minGapPx: number,
): SymbolMatch[] {
  return matches.filter((m) =>
    !existing.some((e) => Math.hypot(e.x - m.x, e.y - m.y) < minGapPx),
  )
}

/**
 * The matches worth placing: the non-seed hits that aren't already covered by an
 * existing placement. `existing` should include the seed's own location so it's
 * never re-placed even if `isSeed` flagging missed it.
 */
export function newPlacements(
  matches: SymbolMatch[],
  existing: Array<{ x: number; y: number }>,
  minGapPx: number,
): SymbolMatch[] {
  return dedupeMatches(matches.filter((m) => !m.isSeed), existing, minGapPx)
}
