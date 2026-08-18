/**
 * ROUTE THE RUN — the other half of "The General".
 *
 * Auto-placement already puts the devices where the trade says: outlets at
 * 12", switches at 48", spaced to the code maximum, off the windows where a
 * baseboard emitter goes. And then nothing connected them. A wall of floating
 * receptacles with no wire between them is not an electrical model, it is a
 * shopping list pinned to a drawing — which is why the MEP side has never felt
 * like a workflow.
 *
 * This is the wire.
 *
 * IT ROUTES ALONG WALLS, NOT ACROSS ROOMS. A cable does not fly diagonally
 * through a living room from one outlet to the next; it runs in the wall the
 * outlets are in, and crosses to the next wall at the corner. So devices are
 * assigned to the wall they sit on, ordered along it, chained, and then the
 * walls themselves are chained end to end. The result reads like something a
 * sparky would have pulled, because it follows the same path.
 *
 * Pure, and in the drawing's pixel space — the same space walls and devices
 * already live in. Nothing here touches the store or the scene; the caller
 * turns these into TracedLines. That keeps the routing testable on its own,
 * which matters because "does this look right" is a question about the PATH
 * and not about the rendering.
 */
import type { ParsedWall } from '../types'

/** A device to be wired, in the drawing's pixel space. */
export interface RouteDevice {
  type: string
  pxX: number
  pxY: number
}

/** One hop of the run, in pixel space. Straight, like a real pull. */
export interface RouteSegment {
  x1: number
  y1: number
  x2: number
  y2: number
  /** True when this hop crosses from one wall to the next at a corner. */
  corner: boolean
}

interface Anchored {
  d: RouteDevice
  wall: number
  /** Position along that wall, 0…1, so devices can be ordered along it. */
  t: number
  /** Where the device projects ONTO the wall — the run stays in the wall. */
  px: number
  py: number
}

/** Perpendicular projection of a point onto a segment, clamped to its ends. */
function project(w: ParsedWall, x: number, y: number) {
  const dx = w.x2 - w.x1
  const dy = w.y2 - w.y1
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return { t: 0, px: w.x1, py: w.y1, dist: Math.hypot(x - w.x1, y - w.y1) }
  const t = Math.max(0, Math.min(1, ((x - w.x1) * dx + (y - w.y1) * dy) / len2))
  const px = w.x1 + t * dx
  const py = w.y1 + t * dy
  return { t, px, py, dist: Math.hypot(x - px, y - py) }
}

/**
 * Chain the devices into a run.
 *
 * `startNear` is the service end — the panel, the stack, the air handler. The
 * run is ordered from there outward, because that is the direction it is
 * actually pulled and the direction anyone reading it expects: home run first,
 * then along.
 */
export function routeAlongWalls(
  devices: RouteDevice[],
  walls: ParsedWall[],
  opts: { startNear?: { pxX: number; pxY: number } } = {},
): RouteSegment[] {
  if (devices.length < 2 || walls.length === 0) return []

  // 1. Put every device on the wall it belongs to.
  const anchored: Anchored[] = []
  for (const d of devices) {
    let best = -1
    let bestDist = Infinity
    let bestT = 0
    let bx = d.pxX
    let by = d.pxY
    walls.forEach((w, i) => {
      const p = project(w, d.pxX, d.pxY)
      if (p.dist < bestDist) { bestDist = p.dist; best = i; bestT = p.t; bx = p.px; by = p.py }
    })
    if (best >= 0) anchored.push({ d, wall: best, t: bestT, px: bx, py: by })
  }
  if (anchored.length < 2) return []

  // 2. Group by wall and order along each one.
  const byWall = new Map<number, Anchored[]>()
  for (const a of anchored) {
    const list = byWall.get(a.wall)
    if (list) list.push(a)
    else byWall.set(a.wall, [a])
  }
  for (const list of byWall.values()) list.sort((p, q) => p.t - q.t)

  // 3. Order the WALLS into a path, starting nearest the service end and
  //    hopping to whichever wall begins closest to where the last one finished.
  //    Corner to corner, the way it is actually run.
  const groups = [...byWall.values()]
  const start = opts.startNear
  const remaining = groups.slice()
  const ordered: Anchored[][] = []

  let cursor = start
    ? { x: start.pxX, y: start.pxY }
    : { x: remaining[0][0].px, y: remaining[0][0].py }

  while (remaining.length > 0) {
    let bestIdx = 0
    let bestDist = Infinity
    let bestReversed = false
    remaining.forEach((g, i) => {
      const head = g[0]
      const tail = g[g.length - 1]
      const dHead = Math.hypot(head.px - cursor.x, head.py - cursor.y)
      const dTail = Math.hypot(tail.px - cursor.x, tail.py - cursor.y)
      // A wall can be entered from either end — take whichever is nearer, and
      // run it in that direction.
      if (dHead < bestDist) { bestDist = dHead; bestIdx = i; bestReversed = false }
      if (dTail < bestDist) { bestDist = dTail; bestIdx = i; bestReversed = true }
    })
    const [g] = remaining.splice(bestIdx, 1)
    const run = bestReversed ? g.slice().reverse() : g
    ordered.push(run)
    const last = run[run.length - 1]
    cursor = { x: last.px, y: last.py }
  }

  // 4. Emit the hops.
  const out: RouteSegment[] = []
  let prev: Anchored | null = null
  for (const group of ordered) {
    group.forEach((a, i) => {
      if (prev) {
        out.push({
          x1: Math.round(prev.px), y1: Math.round(prev.py),
          x2: Math.round(a.px), y2: Math.round(a.py),
          // The first hop onto a new wall is the corner crossing.
          corner: i === 0,
        })
      }
      prev = a
    })
  }
  // Zero-length hops help nobody — two devices at the same spot on a wall.
  return out.filter((s) => s.x1 !== s.x2 || s.y1 !== s.y2)
}
