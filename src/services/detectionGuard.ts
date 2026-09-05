/**
 * NO STEP IN THE PIPELINE MAY MAKE THE DRAWING WORSE.
 *
 * Detection is a cascade — the model, then the heuristic ladder, then the
 * returns pass, then corner inference, then rejoining across doorways, then
 * the rooms themselves. Every rung of it advances on the same test: did the
 * step before produce NOTHING? `detectOffThread` moves to the next pass only
 * while `walls.length === 0`, and drawingProcessor drops to the ladder only
 * when the AI hands back null or empty.
 *
 * "Nothing at all" is a poor test, and it has already cost us. Wiring stroke
 * normalisation in took screenshot-adu-71sqm from 27 walls to 14 — a 48% loss
 * — and not one guard in the pipeline noticed, because 14 is not zero. It was
 * caught by hand, afterwards, by someone who happened to re-run the numbers.
 * That is not a safety net; that is luck.
 *
 * So every step that TRANSFORMS an existing set of walls runs through here,
 * and if the transform left the plan enclosing less than it did before, the
 * step is rolled back and says so out loud. A step that cannot help is allowed
 * to do nothing; it is not allowed to do harm.
 *
 * This is deliberately not a threshold to tune. It compares a result against
 * the result it replaced, on the same drawing, in the same run — so it needs no
 * constant that could be right for a rendered sheet and wrong for a phone
 * screenshot, which is the bug class that produced most of the others.
 *
 * Pure and canvas-free so it runs in a worker, in node, and in a test.
 */

import type { ParsedWall } from '../types'
import { enclosedRegions } from './wallEnclosure'

export interface GuardVerdict {
  /** The walls to carry forward — `after` if it helped, `before` if it hurt. */
  walls: ParsedWall[]
  /** Did the step survive? */
  kept: boolean
  enclosedBefore: number
  enclosedAfter: number
  /** Plain-language why, for the log and for the user-facing explanation. */
  reason: string
}

/**
 * How good is this set of walls, as one number?
 *
 * Enclosure is the measure — see wallEnclosure for why wall COUNT is not — but
 * it is not simply "more is better". A plan shattered into slivers by noise
 * encloses a great many regions and is worse, not better. So when the room
 * extractor has independently read the raster and found rooms, its count is
 * the target and the score is nearness to it. Only when there is no such
 * second opinion does more enclosure win, and even then a step cannot be
 * rewarded for exploding the plan, because a transform that only moves
 * endpoints cannot legitimately multiply the rooms.
 */
function scoreAgainst(enclosed: number, targetRooms: number | null): number {
  return targetRooms && targetRooms > 0 ? -Math.abs(enclosed - targetRooms) : enclosed
}

/**
 * Keep a transform only if it did not reduce what the walls enclose.
 *
 * `targetRooms` is the room extractor's own count when it has one — a genuine
 * second reading of the same image, not our opinion of it.
 */
export function keepUnlessWorse(
  before: ParsedWall[],
  after: ParsedWall[],
  imageWidth: number,
  imageHeight: number,
  targetRooms: number | null = null,
): GuardVerdict {
  const enclosedBefore = enclosedRegions(before, imageWidth, imageHeight)
  const enclosedAfter = enclosedRegions(after, imageWidth, imageHeight)

  const scoreBefore = scoreAgainst(enclosedBefore, targetRooms)
  const scoreAfter = scoreAgainst(enclosedAfter, targetRooms)

  if (scoreAfter < scoreBefore) {
    return {
      walls: before,
      kept: false,
      enclosedBefore,
      enclosedAfter,
      reason: targetRooms
        ? `rolled back: ${enclosedAfter} enclosed is further from the ${targetRooms} rooms read off the drawing than ${enclosedBefore}`
        : `rolled back: enclosed ${enclosedBefore} → ${enclosedAfter}`,
    }
  }

  /**
   * A tie keeps the step. Equal enclosure after a join still means endpoints
   * that used to float now land on the walls they belong to, and everything
   * downstream — framing a corner, routing inside a wall, seating a door —
   * reads those endpoints. The metric cannot see that; it is a shape test, and
   * two walls meeting exactly enclose the same area as two walls meeting
   * almost. Rolling back on a tie would discard real structure to satisfy a
   * number that was never measuring it.
   */
  return {
    walls: after,
    kept: true,
    enclosedBefore,
    enclosedAfter,
    reason:
      enclosedAfter === enclosedBefore
        ? `kept: enclosure unchanged at ${enclosedBefore}`
        : `kept: enclosed ${enclosedBefore} → ${enclosedAfter}`,
  }
}
