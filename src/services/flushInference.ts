// Ambient inference — flush-edge suggestion. When a new floor (or roof) area is
// placed beside an existing one, construction logic says the shared edge should
// sit FLUSH with the neighbour, not leave a sliver gap or overlap. This computes
// that suggestion purely (pixel-space rects) so the UI can offer a gentle
// "snap flush to the existing floor?" prompt with one-tap confirm — never a
// silent move. See ambient-inference-prompts memory.

export interface Rect {
  x1: number
  y1: number
  x2: number
  y2: number
}

type Edge = 'left' | 'right' | 'top' | 'bottom'

export interface FlushSuggestion {
  /** The candidate rect adjusted so its touching edge is flush with a neighbour. */
  rect: Rect
  /** Which candidate edge snapped. */
  edge: Edge
  /** How far (px) the edge moved — 0 would mean already flush (not suggested). */
  gapPx: number
  /** Gentle prompt copy. */
  message: string
}

interface Norm { left: number; right: number; top: number; bottom: number }
const norm = (r: Rect): Norm => ({
  left: Math.min(r.x1, r.x2),
  right: Math.max(r.x1, r.x2),
  top: Math.min(r.y1, r.y2),
  bottom: Math.max(r.y1, r.y2),
})

/** Overlap length of two 1-D spans (0 if they don't overlap). */
const overlap = (a0: number, a1: number, b0: number, b1: number): number =>
  Math.max(0, Math.min(a1, b1) - Math.max(a0, b0))

/**
 * Suggest snapping one edge of `candidate` flush to a neighbouring rect. Returns
 * the smallest non-zero adjustment within `tolPx`, or null if the candidate is
 * already flush / has no adjacent neighbour. Requires the perpendicular extents
 * to actually overlap (so genuinely side-by-side, not a diagonal near-miss).
 */
export function suggestFlushEdge(candidate: Rect, existing: Rect[], tolPx = 24): FlushSuggestion | null {
  const c = norm(candidate)
  const cw = c.right - c.left
  const ch = c.bottom - c.top
  let best: FlushSuggestion | null = null

  const consider = (edge: Edge, gap: number, rect: Rect, neighbourWord: string) => {
    const g = Math.abs(gap)
    if (g < 0.5 || g > tolPx) return // already flush, or too far to be intentional
    if (best && g >= best.gapPx) return
    best = { rect, edge, gapPx: g, message: `Snap flush to the ${neighbourWord}?` }
  }

  for (const e of existing) {
    const n = norm(e)
    const vOverlap = overlap(c.top, c.bottom, n.top, n.bottom)
    const hOverlap = overlap(c.left, c.right, n.left, n.right)

    // Horizontal adjacency (side by side) — needs vertical overlap.
    if (vOverlap > Math.min(ch, n.bottom - n.top) * 0.3) {
      // candidate is to the RIGHT of neighbour → its left edge meets neighbour's right
      consider('left', c.left - n.right, { x1: n.right, y1: c.top, x2: n.right + cw, y2: c.bottom }, 'floor beside it')
      // candidate is to the LEFT → its right edge meets neighbour's left
      consider('right', c.right - n.left, { x1: n.left - cw, y1: c.top, x2: n.left, y2: c.bottom }, 'floor beside it')
    }
    // Vertical adjacency (stacked in plan) — needs horizontal overlap.
    if (hOverlap > Math.min(cw, n.right - n.left) * 0.3) {
      consider('top', c.top - n.bottom, { x1: c.left, y1: n.bottom, x2: c.right, y2: n.bottom + ch }, 'floor above it')
      consider('bottom', c.bottom - n.top, { x1: c.left, y1: n.top - ch, x2: c.right, y2: n.top }, 'floor below it')
    }
  }
  return best
}
