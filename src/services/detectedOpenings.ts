/**
 * WHICH DETECTED OPENINGS COUNT — only the ones in a wall the app read itself.
 *
 * The plan reader finds openings all over a print: door swings, gaps in the
 * linework, dimension breaks. On walls it also read, they belong together, so
 * they frame and hang. On walls you drew yourself they don't: a print traced
 * over came out of Frame it with doors and windows you never put there. A wall
 * you drew gets the doors and windows you place in it, and nothing else.
 */
import type { Drawing, ParsedOpening, ParsedWall } from '../types'
import { modelWalls } from './modelWalls'

/** Is the opening's centre on one of these walls (within its thickness)? */
export function onAnyWall(op: { x: number; y: number }, walls: ParsedWall[]): boolean {
  return walls.some((w) => {
    const dx = w.x2 - w.x1, dy = w.y2 - w.y1
    const l2 = dx * dx + dy * dy
    const t = l2 < 1e-9 ? 0 : Math.max(0, Math.min(1, ((op.x - w.x1) * dx + (op.y - w.y1) * dy) / l2))
    const reach = Math.max(6, (w.thickness ?? 8) * 1.5)
    return Math.hypot(op.x - (w.x1 + t * dx), op.y - (w.y1 + t * dy)) <= reach
  })
}

/**
 * The drawing's detected openings that sit in a wall the app read AND built —
 * not one you drew, and not a detected line left on the print as a suggestion
 * (scale not set, or Trace my own walls on).
 */
export function detectedOpeningsToFrame(d: Drawing, opts: { tracedOnly?: boolean } = {}): ParsedOpening[] {
  if (d.parsedOpenings.length === 0) return d.parsedOpenings
  const read = modelWalls([d], { tracedOnly: opts.tracedOnly }).map((m) => m.wall).filter((w) => w.source !== 'user')
  if (read.length === 0) return []
  return d.parsedOpenings.filter((op) => onAnyWall(op, read))
}
