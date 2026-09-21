/**
 * STUD PACKS THE BUILDING ASKS FOR — put in automatically, left editable.
 *
 * Mitchell's rule of thumb: in a wall, and an exterior wall above all, if
 * there is load to be carried there has to be a stud pack somewhere. The code
 * behind it (IRC R602.7) puts girders in the same table as headers and gives
 * each end a number of jack studs, NJ, by span. So a pack under a bearing point
 * is sized exactly like the jacks under a header of that span, from the same
 * `jacksPerEnd` the openings already use — one rule, not two that drift apart.
 *
 * Trusses and joists spaced along a wall are NOT point loads: each gets a stud
 * lined up under it, and a plain rectangle under a truss roof has no packs
 * beyond its corners, tees and the jacks at its openings. That is correct, not
 * missing. Packs come from something CONCENTRATING load, and the one this app
 * can see is this:
 *
 * WHERE A SECTION OPENS INTO THE MAIN HOUSE. The join between a house and its
 * own wing is left open — the outline has no wall there — so whatever was
 * bearing on that stretch of wall (trusses, joists, the gable) now needs a beam
 * or a girder across the gap, and that beam comes down at both ends of it. A
 * pack goes at each end.
 *
 * These are written into the walls as ordinary `studPacks`, so they show in the
 * wall sheet and can be moved, resized or removed like one you placed by hand.
 * The app proposes the framing; the framer has the last word.
 */
import type { ParsedWall } from '../types'
import type { Rect } from './footprint'
import { jacksPerEnd } from './framingGeometry'

export interface BearingPoint {
  /** Where the load comes down, in the same space as the walls. */
  x: number
  y: number
  /** How many studs to put under it. */
  studs: number
  /** Which way the beam runs — the wall it lies along is preferred. */
  along: 'x' | 'y'
}

const EPS = 1e-6

/**
 * The two ends of every opening between the main box and a section, in the
 * footprint's millimetres. `rects` is `placeBoxes` output: main first.
 */
export function sectionBearingPoints(rects: readonly Rect[]): Array<{ x: number; y: number; spanMm: number; along: 'x' | 'y' }> {
  if (rects.length < 2) return []
  const m = rects[0]
  const out: Array<{ x: number; y: number; spanMm: number; along: 'x' | 'y' }> = []
  for (let i = 1; i < rects.length; i++) {
    const r = rects[i]
    // Which side of the main box this section shares. A section sits flush
    // against exactly one of them; find it by the coordinate they share.
    let edge: { x1: number; y1: number; x2: number; y2: number } | null = null
    if (Math.abs(r.x1 - m.x2) < EPS || Math.abs(r.x2 - m.x1) < EPS) {
      const x = Math.abs(r.x1 - m.x2) < EPS ? m.x2 : m.x1
      const y1 = Math.max(m.y1, r.y1), y2 = Math.min(m.y2, r.y2)
      if (y2 - y1 > EPS) edge = { x1: x, y1, x2: x, y2 }
    } else if (Math.abs(r.y1 - m.y2) < EPS || Math.abs(r.y2 - m.y1) < EPS) {
      const y = Math.abs(r.y1 - m.y2) < EPS ? m.y2 : m.y1
      const x1 = Math.max(m.x1, r.x1), x2 = Math.min(m.x2, r.x2)
      if (x2 - x1 > EPS) edge = { x1, y1: y, x2, y2: y }
    }
    if (!edge) continue
    const spanMm = Math.hypot(edge.x2 - edge.x1, edge.y2 - edge.y1)
    const along = edge.x1 === edge.x2 ? 'y' : 'x'
    out.push({ x: edge.x1, y: edge.y1, spanMm, along }, { x: edge.x2, y: edge.y2, spanMm, along })
  }
  return out
}

/** Studs under one end of a beam of this span: the header table's NJ, never fewer than two. */
export function studsUnderBearing(spanMm: number): number {
  return Math.max(2, jacksPerEnd(spanMm / 1000))
}

/**
 * Put each bearing point's pack into the wall it lands on.
 *
 * The point is on the OUTSIDE FACE; walls are centrelines half a thickness in,
 * so the reach is a little over a half-thickness. Where the point sits at an
 * inside corner it is equally close to two walls — the one running the same way
 * as the beam wins, because that is the wall the beam's end rests on. Where a
 * section is flush with a corner there is no such wall, and the beam comes down
 * on the side wall that runs straight through: a pack mid-span, which is right.
 *
 * Returns new walls; the ones given are not touched.
 */
export function withBearingPacks(walls: readonly ParsedWall[], points: readonly BearingPoint[], reachPx: number): ParsedWall[] {
  const out = walls.map((w) => ({ ...w, studPacks: w.studPacks ? [...w.studPacks] : undefined }))
  for (const p of points) {
    let best = -1
    let bestScore = Infinity
    let bestT = 0
    out.forEach((w, i) => {
      const dx = w.x2 - w.x1, dy = w.y2 - w.y1
      const len2 = dx * dx + dy * dy
      if (len2 < EPS) return
      const tRaw = ((p.x - w.x1) * dx + (p.y - w.y1) * dy) / len2
      const t = Math.max(0, Math.min(1, tRaw))
      const d = Math.hypot(p.x - (w.x1 + t * dx), p.y - (w.y1 + t * dy))
      if (d > reachPx) return
      const runsX = Math.abs(dx) >= Math.abs(dy)
      const parallel = (p.along === 'x') === runsX
      // Distance decides; running the same way as the beam breaks a tie.
      const score = d - (parallel ? reachPx * 0.25 : 0)
      if (score < bestScore) { bestScore = score; best = i; bestT = t }
    })
    if (best < 0) continue
    const w = out[best]
    const packs = w.studPacks ?? []
    // Two sections can share a bearing point; one pack, not two stacked.
    if (packs.some((k) => Math.abs(k.atFrac - bestT) < 0.02)) continue
    w.studPacks = [...packs, { atFrac: bestT, studs: p.studs }]
  }
  return out
}
