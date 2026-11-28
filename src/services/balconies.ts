/**
 * BALCONIES — a slab or a deck out from an outside wall, with a guard round it.
 *
 * Drawn as a stretch of an outside wall (two taps on it) and a depth. Which
 * side is out is read from the floor's outline, not stored, so it is right
 * however the wall was drawn. A tower's balcony is the floor slab carried out
 * through the wall on a thermal break; a low-rise's is joists cantilevered out
 * past the wall, a rim and decking. "Every floor above" repeats it on each
 * storey up to the top of the building — they usually stack.
 */
import type { Balcony, ParsedWall } from '../types'
import { footprintLoopPx } from './autoBuildAreas'

type PX = [number, number]

/** Guards: 42" (1067 mm) in multi-family; balusters under 4" apart. */
export const BALCONY_SPEC = {
  guardM: 1.067,
  balusterGapM: 0.1,
  postMaxM: 1.5,
  concreteM: 0.2,
  /** The balcony steps down this much from the floor inside — water stays out. */
  stepDownM: 0.05,
  defaultDepthM: 1.83,
  minDepthM: 0.6,
  maxDepthM: 4.0,
}

function inside(poly: PX[], x: number, y: number): boolean {
  let c = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j]
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c
  }
  return c
}

export interface BalconyShape {
  /** Along the outside face of the wall, then the front edge (print px). */
  a: PX; b: PX; c: PX; d: PX
  /** Unit vector out from the building. */
  out: PX
  /** Thickness of the wall it comes off, px. */
  wallT: number
}

/** The wall a balcony was put on: the wall on that floor its line lies along. */
export function balconyWall(b: Pick<Balcony, 'x1' | 'y1' | 'x2' | 'y2'>, walls: ParsedWall[]): ParsedWall | null {
  let best: ParsedWall | null = null
  let bd = Infinity
  for (const w of walls) {
    const dx = w.x2 - w.x1, dy = w.y2 - w.y1
    const L = Math.hypot(dx, dy)
    if (L < 1) continue
    const off = (x: number, y: number) => Math.abs((x - w.x1) * dy - (y - w.y1) * dx) / L
    const d = off(b.x1, b.y1) + off(b.x2, b.y2)
    if (d < bd) { bd = d; best = w }
  }
  return bd < 6 ? best : null
}

/**
 * The balcony on the plan, or null when its depth or scale is unknown. `walls`
 * are the walls on the balcony's own floor.
 */
export function balconyShape(b: Balcony, walls: ParsedWall[], mmPerPx: number | null): BalconyShape | null {
  if (!mmPerPx || mmPerPx <= 0) return null
  const dx = b.x2 - b.x1, dy = b.y2 - b.y1
  const L = Math.hypot(dx, dy)
  if (L < 1) return null
  const n1: PX = [-dy / L, dx / L]
  const wall = balconyWall(b, walls)
  const wallT = wall?.thickness || 10
  const mx = (b.x1 + b.x2) / 2, my = (b.y1 + b.y2) / 2
  // Out: the side that is outside the floor's outline.
  let out: PX = n1
  const loop = footprintLoopPx(walls)
  const probe = wallT * 1.5 + 2
  if (loop) {
    if (inside(loop, mx + n1[0] * probe, my + n1[1] * probe)) out = [-n1[0], -n1[1]]
  } else if (walls.length) {
    // No closed outline: away from the middle of the walls.
    const cx = walls.reduce((t, w) => t + w.x1 + w.x2, 0) / (walls.length * 2)
    const cy = walls.reduce((t, w) => t + w.y1 + w.y2, 0) / (walls.length * 2)
    if ((mx - cx) * n1[0] + (my - cy) * n1[1] < 0) out = [-n1[0], -n1[1]]
  }
  const face = wallT / 2
  const deep = (b.depthM * 1000) / mmPerPx
  const a: PX = [b.x1 + out[0] * face, b.y1 + out[1] * face]
  const bb: PX = [b.x2 + out[0] * face, b.y2 + out[1] * face]
  return {
    a, b: bb,
    c: [bb[0] + out[0] * deep, bb[1] + out[1] * deep],
    d: [a[0] + out[0] * deep, a[1] + out[1] * deep],
    out, wallT,
  }
}

/** Is `p` on the balcony? */
export function onBalcony(s: BalconyShape, p: { x: number; y: number }): boolean {
  return inside([s.a, s.b, s.c, s.d], p.x, p.y)
}

/** Where along a run the guard posts go: both ends and no gap over `max`. */
export function postsAlong(len: number, max = BALCONY_SPEC.postMaxM): number[] {
  if (len <= 0) return [0]
  const n = Math.max(1, Math.ceil(len / max))
  return Array.from({ length: n + 1 }, (_, i) => (len * i) / n)
}
