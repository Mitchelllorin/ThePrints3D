/**
 * Which walls the 3D model is actually built from.
 *
 * There are two kinds in a drawing and only one of them was ever built:
 *
 *   source 'user'  you traced it
 *   source 'auto'  detection found it — on upload, or from "Find the rest"
 *
 * Every render layer filtered to 'user', so detected walls were found, typed,
 * stored, and then silently dropped on the floor. Run "Find the rest", watch it
 * report seventeen walls, and watch the model not change by a single stud. The
 * feature worked; nothing showed it. That is also why a preset with detected
 * walls looked no different from an empty one.
 *
 * USER WALLS COME FIRST, ALWAYS. Selection, editing and undo all address a wall
 * by its index in the user-filtered list — `selectedWallIndex`, updateUserWall,
 * deleteUserWall. Appending detected walls after them keeps every one of those
 * indices pointing at the same wall it did before, so nothing that already works
 * has to change. Prepending or interleaving would silently re-target every edit.
 *
 * Noise is filtered by LENGTH rather than by confidence. Detection on a real
 * sheet will happily report the title block's rule lines as walls; they are
 * short, and a wall you would frame is not. Confidence is a detector's opinion
 * of itself and is not comparable between the heuristic and the seed-guided
 * passes, whereas length means the same thing in both.
 */
import type { ParsedWall, Drawing } from '../types'

/** Shorter than this (in print pixels) it is annotation, not a wall. */
export const MIN_AUTO_WALL_PX = 24

export interface ModelWall {
  wall: ParsedWall
  scaleMmPerPx: number | null
}

/** Is this a detected wall worth building? */
export function autoWallIsReal(w: ParsedWall): boolean {
  return Math.hypot(w.x2 - w.x1, w.y2 - w.y1) >= MIN_AUTO_WALL_PX
}

/**
 * The walls to build, across every drawing: traced ones first (index-stable),
 * then the detected ones worth showing.
 */
export function modelWalls(drawings: Drawing[]): ModelWall[] {
  const traced: ModelWall[] = []
  const detected: ModelWall[] = []
  for (const d of drawings) {
    for (const w of d.parsedWalls) {
      if (w.source === 'user') traced.push({ wall: w, scaleMmPerPx: d.scaleMmPerPx })
      else if (autoWallIsReal(w)) detected.push({ wall: w, scaleMmPerPx: d.scaleMmPerPx })
    }
  }
  return [...traced, ...detected]
}

/** How many of those are traced — i.e. the index range that is still editable. */
export function tracedWallCount(drawings: Drawing[]): number {
  let n = 0
  for (const d of drawings) for (const w of d.parsedWalls) if (w.source === 'user') n++
  return n
}
