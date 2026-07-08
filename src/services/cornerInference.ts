// Ambient inference — corner awareness. When a traced wall runs PAST where it
// meets a perpendicular wall (a small stub sticking out beyond the corner), the
// app should gently ask "this runs past the corner — trim it?" rather than leave
// a sloppy overhang. Pure axis-aligned geometry (the app squares walls to the
// axes on commit) so it's unit-testable. See ambient-inference-prompts memory.

export interface Seg {
  x1: number
  y1: number
  x2: number
  y2: number
}

export interface CornerSuggestion {
  /** The wall trimmed back to the corner. */
  rect: Seg
  /** How far (px) the overshoot was trimmed. */
  overshootPx: number
  message: string
}

const isHoriz = (s: Seg): boolean => Math.abs(s.y2 - s.y1) < Math.abs(s.x2 - s.x1)
const span = (a: number, b: number): [number, number] => [Math.min(a, b), Math.max(a, b)]

/**
 * Suggest trimming a wall that overshoots a perpendicular wall by a small end
 * STUB. Returns the trim with the SMALLEST overshoot in (tolPx, maxOvershootPx],
 * or null. Guards against genuine T-junctions/mid-span crossings by requiring
 * the KEPT portion to be at least 3× the trimmed stub — a mid-wall crossing has
 * a large remainder on both sides and is left alone.
 */
export function suggestWallCorner(wall: Seg, others: Seg[], tolPx = 6, maxOvershootPx = 90): CornerSuggestion | null {
  const h = isHoriz(wall)
  // Represent `wall` as: fixed axis coord `wc`, variable span [lo, hi].
  const wc = h ? (wall.y1 + wall.y2) / 2 : (wall.x1 + wall.x2) / 2
  const [lo, hi] = h ? span(wall.x1, wall.x2) : span(wall.y1, wall.y2)

  let best: CornerSuggestion | null = null
  const consider = (newLo: number, newHi: number, overshoot: number) => {
    if (overshoot <= tolPx || overshoot > maxOvershootPx) return
    if (newHi - newLo < overshoot * 3) return // kept part too short → a T-junction, not a stub
    if (best && overshoot >= best.overshootPx) return
    const rect: Seg = h
      ? { x1: newLo, y1: wc, x2: newHi, y2: wc }
      : { x1: wc, y1: newLo, x2: wc, y2: newHi }
    best = { rect, overshootPx: Math.round(overshoot), message: 'This runs past the corner — trim it?' }
  }

  for (const o of others) {
    if (isHoriz(o) === h) continue // need a PERPENDICULAR partner
    // Perpendicular wall's fixed coord = the potential corner along `wall`'s span.
    const oc = h ? (o.x1 + o.x2) / 2 : (o.y1 + o.y2) / 2
    const [oLo, oHi] = h ? span(o.y1, o.y2) : span(o.x1, o.x2)
    // The perpendicular wall must actually reach `wall`'s line (its span crosses wc).
    if (wc < oLo - tolPx || wc > oHi + tolPx) continue
    // The corner (oc) must sit within `wall`'s span.
    if (oc < lo - tolPx || oc > hi + tolPx) continue
    // High-side stub: wall ends past the corner → trim hi down to oc.
    if (hi > oc) consider(lo, oc, hi - oc)
    // Low-side stub: wall starts before the corner → trim lo up to oc.
    if (lo < oc) consider(oc, hi, oc - lo)
  }
  return best
}
