// Ambient inference — "did you mean to land on this line?" When a traced wall
// runs alongside an existing parallel wall but sits a few px off its line, offer
// to align it exactly onto that line. Pure axis-aligned geometry (walls square to
// the axes on commit) so it's unit-testable. Third producer on the inference
// channel, alongside flushInference and cornerInference. See ambient-inference-prompts.

export interface Seg {
  x1: number
  y1: number
  x2: number
  y2: number
}

export interface LineSnapSuggestion {
  /** The wall shifted perpendicular onto the neighbouring line. */
  rect: Seg
  /** Perpendicular offset (px) that would be closed. */
  offsetPx: number
  message: string
}

const isHoriz = (s: Seg): boolean => Math.abs(s.y2 - s.y1) < Math.abs(s.x2 - s.x1)
const span = (a: number, b: number): [number, number] => [Math.min(a, b), Math.max(a, b)]
const overlap = (a0: number, a1: number, b0: number, b1: number): number =>
  Math.max(0, Math.min(a1, b1) - Math.max(a0, b0))

/**
 * Suggest aligning `wall` onto a parallel neighbour it runs alongside but sits a
 * small perpendicular offset from. Returns the NEAREST such line within tolPx (a
 * few px is a slip worth offering to fix; 0 means already aligned; far means
 * intentional), or null. Requires real along-axis overlap so it only fires when
 * the wall genuinely runs beside the other line.
 */
export function suggestLineSnap(wall: Seg, others: Seg[], tolPx = 18): LineSnapSuggestion | null {
  const h = isHoriz(wall)
  const wc = h ? (wall.y1 + wall.y2) / 2 : (wall.x1 + wall.x2) / 2
  const [lo, hi] = h ? span(wall.x1, wall.x2) : span(wall.y1, wall.y2)
  let best: LineSnapSuggestion | null = null

  for (const o of others) {
    if (isHoriz(o) !== h) continue // must be parallel
    const oc = h ? (o.y1 + o.y2) / 2 : (o.x1 + o.x2) / 2
    const [oLo, oHi] = h ? span(o.x1, o.x2) : span(o.y1, o.y2)
    const off = Math.abs(oc - wc)
    if (off <= 2 || off > tolPx) continue // already aligned, or too far to be a slip
    if (overlap(lo, hi, oLo, oHi) < 20) continue // must run alongside it
    if (best && off >= best.offsetPx) continue
    const rect: Seg = h
      ? { x1: wall.x1, y1: oc, x2: wall.x2, y2: oc }
      : { x1: oc, y1: wall.y1, x2: oc, y2: wall.y2 }
    best = { rect, offsetPx: Math.round(off), message: 'Align onto this wall line?' }
  }
  return best
}
