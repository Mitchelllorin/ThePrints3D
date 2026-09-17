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
 * A RETURN IS A SHORT WALL, AND THIS USED TO THROW ALL OF THEM AWAY.
 *
 * The length gate above exists for a real reason — detection on a real sheet
 * reports the title block's rule lines, dimension ticks and lettering as walls,
 * and those are short. But the assumption written next to it, that "a wall you
 * would frame is not" short, is wrong, and a tradesperson named the exact thing
 * it was deleting: a RETURN. The short leg where a wall turns back on itself —
 * the stub beside a window or an entry recess, the bit that comes back off a
 * bay or an offset. Those run 4 to 24 inches, which at the scale of a phone
 * screenshot is 10 to 40 pixels, so `MIN_AUTO_WALL_PX` of 24 was cutting
 * straight through the middle of the range. Returns live on the perimeter,
 * which is why it was the OUTSIDE walls that kept coming up missing.
 *
 * Lowering the threshold is the wrong fix: it lets the lettering back in, which
 * is the "72 walls across 18 rooms" failure this gate was added to stop.
 *
 * WHAT ACTUALLY SEPARATES THEM IS NOT LENGTH, IT IS ATTACHMENT. A return is
 * joined to the wall it returns from — that is what makes it a return rather
 * than a line. Lettering, hatching and dimension ticks float in the middle of a
 * room touching nothing. So a short segment is kept when one of its ends lands
 * on a wall we already believe in, and dropped when it does not.
 *
 * Strictly additive: every wall kept before is still kept, and this only ever
 * rescues ones that were being discarded.
 */

/**
 * Below this a segment cannot be a wall at any scale — it is a tick or a serif.
 * A return is also never shorter than the wall is thick: you cannot have a leg
 * of wall shorter than the wall's own depth, so the thickness is the better
 * ruler wherever it is known. Same "the wall itself is the ruler" reasoning as
 * `rejoinAcrossOpenings`, and scale-free for the same reason.
 */
const MIN_RETURN_PX = 6

/** Distance from a point to a segment — a return may tee in as well as corner. */
function pointToSegment(px: number, py: number, w: ParsedWall): number {
  const dx = w.x2 - w.x1, dy = w.y2 - w.y1
  const len2 = dx * dx + dy * dy
  if (len2 < 1e-9) return Math.hypot(px - w.x1, py - w.y1)
  const t = Math.max(0, Math.min(1, ((px - w.x1) * dx + (py - w.y1) * dy) / len2))
  return Math.hypot(px - (w.x1 + t * dx), py - (w.y1 + t * dy))
}

/**
 * Is this short segment a return off one of the walls we already trust?
 *
 * `anchors` are the walls that passed the length gate on their own. A return
 * cannot vouch for another return — otherwise a chain of lettering could walk
 * itself in one serif at a time.
 */
export function isAttachedReturn(w: ParsedWall, anchors: readonly ParsedWall[]): boolean {
  return attachedReturnAnchor(w, anchors) !== null
}

/**
 * The wall it returns from, or null if it does not return from one.
 *
 * Same test as `isAttachedReturn`, but handing back WHICH wall — the caller
 * that has the pixels needs it, to ask whether this segment is drawn with that
 * wall's weight of ink or with a chair's.
 */
export function attachedReturnAnchor(
  w: ParsedWall,
  anchors: readonly ParsedWall[],
): ParsedWall | null {
  const len = Math.hypot(w.x2 - w.x1, w.y2 - w.y1)
  if (len < Math.max(MIN_RETURN_PX, w.thickness || 0)) return null
  // Generous enough to survive raster skew and a corner drawn with its lines
  // crossing, tight enough that a word sitting near a wall does not qualify.
  const tol = Math.max(6, (w.thickness || 0) * 1.5)
  const dx = (w.x2 - w.x1) / len, dy = (w.y2 - w.y1) / len
  for (const a of anchors) {
    const touches =
      pointToSegment(w.x1, w.y1, a) <= tol || pointToSegment(w.x2, w.y2, a) <= tol
    if (!touches) continue
    /**
     * A RETURN TURNS. That is what the word means — the wall comes back on
     * itself — so a short segment lying ALONG the wall it touches is not one.
     * It is a fragment: detection breaking a single run into a long piece and a
     * stub, or the second edge line of a thick wall. Keeping those re-inflates
     * the wall count with pieces of walls already in the model, which is the
     * failure the length gate was protecting against in the first place.
     */
    const alen = Math.hypot(a.x2 - a.x1, a.y2 - a.y1)
    if (alen < 1e-9) continue
    const ax = (a.x2 - a.x1) / alen, ay = (a.y2 - a.y1) / alen
    // |sin| between the two directions. 0.34 is about 20 degrees — well clear of
    // raster skew on a line that is meant to be square, and far below the 90
    // that a real return makes.
    if (Math.abs(dx * ay - dy * ax) > 0.34) return a
  }
  return null
}

/**
 * IS THE SCALE KNOWN, OR GUESSED?
 *
 * 'parsed' means the number was READ — off the title block, off a stated total
 * area, or typed in by the user at calibration (which writes 'parsed'). Anything
 * else is inference from line weights and door widths, and on a phone photo or a
 * plain PNG it is regularly out by a factor of three or four.
 *
 * Nothing gets built from a guess. Upload a 32 ft bungalow, have the scale
 * inferred at 44.8 mm/px against a true 10, and the app used to stand up forty
 * nine detected walls at four and a half times life size before it got round to
 * admitting it could not read the scale. The walls are not wrong — the ruler is.
 */
export function scaleIsKnown(d: Pick<Drawing, 'scaleConfidence'>): boolean {
  return d.scaleConfidence === 'parsed'
}

/**
 * The walls to build, across every drawing: traced ones first (index-stable),
 * then the detected ones worth showing.
 *
 * A TRACED wall is always built: the user drew it, at a size they chose. A
 * DETECTED wall is only built once the scale is known — until then it stays a
 * suggestion on the print (FloorplanOverlay draws them faded; a tap adopts one
 * into the model), which is what detection was agreed to be. It is never the
 * source of truth for how big the building is.
 */
export function modelWalls(drawings: Drawing[]): ModelWall[] {
  const traced: ModelWall[] = []
  const detected: ModelWall[] = []
  /** Too short to stand on their own — candidates for the return rescue below. */
  const shortlisted: ModelWall[] = []
  for (const d of drawings) {
    const known = scaleIsKnown(d)
    for (const w of d.parsedWalls) {
      if (w.source === 'user') traced.push({ wall: w, scaleMmPerPx: d.scaleMmPerPx })
      else if (!known) continue                      // a suggestion, not a wall
      else if (autoWallIsReal(w)) detected.push({ wall: w, scaleMmPerPx: d.scaleMmPerPx })
      else shortlisted.push({ wall: w, scaleMmPerPx: d.scaleMmPerPx })
    }
  }
  /**
   * Now rescue the returns — see `isAttachedReturn`. Anchored against the walls
   * that earned their place on length, plus anything the user traced by hand,
   * which is the strongest evidence there is that a wall exists.
   *
   * APPENDED AT THE END, deliberately. This function's contract is that indices
   * stay pointing at the same wall they did before (see the note at the top of
   * the file); inserting rescued walls among the detected ones would re-target
   * every edit made against a higher index.
   */
  const anchors = [...traced, ...detected].map((m) => m.wall)
  const returns = anchors.length
    ? shortlisted.filter((m) => isAttachedReturn(m.wall, anchors))
    : []
  return [...traced, ...detected, ...returns]
}

/** How many of those are traced — i.e. the index range that is still editable. */
export function tracedWallCount(drawings: Drawing[]): number {
  let n = 0
  for (const d of drawings) for (const w of d.parsedWalls) if (w.source === 'user') n++
  return n
}
