/**
 * reviewFocus — where a finding IS, as a camera pose.
 *
 * buildReview can say what is wrong and which element it is (see
 * FindingTarget). Turning that into "take me there" is this file, and it is
 * separate for the usual reason: it is arithmetic over plain numbers, so it can
 * be tested without a scene, and the panel that renders the list has no geometry
 * of its own.
 *
 * The camera rule is deliberately boring and always the same shot: stand off,
 * look at the thing from above and to one side. A finding is a thing you have to
 * LOOK at — you cannot judge a header, a stair opening or a wall running past a
 * floor from directly underneath or from a thousand metres away. So every jump
 * lands the same way, and the second finding looks like the first one did, which
 * is the whole point of a jump: you should never have to re-orient after it.
 *
 * What it does NOT do yet: change the active storey, put the storey the finding
 * is on into isolation, or select the wall. Those are store actions rather than
 * camera maths, and a review that silently switches which floor you are looking
 * at would be worse than one that just shows you the problem.
 */

import type { FindingTarget } from './buildReview'

/** A thing in the world to aim at. `level` is its storey, 0 = ground. */
export interface FocusPlace {
  x: number
  z: number
  level: number
}

/**
 * Everything the camera needs about the current build, already in world metres.
 *
 * The arrays are in the SAME order as the arrays the review was given, because
 * the target's indices point into those. Whoever assembles the review knows how
 * to resolve them, and that resolution is not this file's business.
 */
export interface FocusScene {
  /** World midpoint of every wall the review checked. */
  walls: FocusPlace[]
  /** World position of every opening the review checked. */
  openings: FocusPlace[]
  /** The whole build: centre in world XZ, and a radius that encloses it. */
  center: { x: number; z: number; radius: number }
  /** Storey-to-storey rise (ceiling + floor assembly) — the vertical repeat. */
  storeyHeight: number
}

export interface CameraPose {
  position: [number, number, number]
  target: [number, number, number]
}

/**
 * How far back to stand, in metres.
 *
 * One wall is close work — you are reading studs, a header and a plate, so six
 * metres fills the screen with the wall. A whole-building finding is the
 * opposite: no roof means look at the building, so the stand-off is sized to
 * hold the footprint, with a floor under it because a small shed is still a
 * building and 2 m away is not a view of one.
 */
const WALL_STANDOFF_M = 6
const BUILDING_STANDOFF_K = 1.35
const BUILDING_STANDOFF_MIN_M = 9

/** Aim point height above the storey's own floor — chest height, mid-wall. */
const LOOK_HEIGHT_M = 1.2

/** Degrees above the horizon. Enough to see over a wall, not enough to be a plan view. */
const ELEVATION_DEG = 32

/** The place a target refers to, with the building as the honest fallback. */
function placeFor(target: FindingTarget | undefined, scene: FocusScene): FocusPlace {
  if (target?.focus === 'wall') {
    const wall = scene.walls[target.wallIndex ?? -1]
    if (wall) return wall
  }
  if (target?.focus === 'opening') {
    const opening = scene.openings[target.openingIndex ?? -1]
    if (opening) return opening
  }
  // 'storey' and 'building' — and anything whose element has gone, which happens
  // when a finding outlives the wall that raised it. The build's centre is then
  // the only truthful answer, and a wrong-but-close shot beats no shot.
  return { x: scene.center.x, z: scene.center.z, level: target?.level ?? 0 }
}

/**
 * The pose that shows a finding.
 *
 * Uniform scale, so a jump is always the same move: the target is the thing,
 * raised to chest height on ITS OWN storey, and the camera stands off along a
 * fixed diagonal. `target.level` is what makes an upper-storey finding land
 * upstairs instead of pointing at the ground under it.
 */
export function cameraForFinding(
  target: FindingTarget | undefined,
  scene: FocusScene,
): CameraPose {
  const place = placeFor(target, scene)
  const baseY = place.level * scene.storeyHeight
  const aim: [number, number, number] = [place.x, baseY + LOOK_HEIGHT_M, place.z]

  const standoff = target?.focus === 'wall' || target?.focus === 'opening'
    ? WALL_STANDOFF_M
    : Math.max(scene.center.radius * BUILDING_STANDOFF_K, BUILDING_STANDOFF_MIN_M)

  const el = (ELEVATION_DEG * Math.PI) / 180
  const horizontal = Math.cos(el) * standoff
  // Split the horizontal run evenly between +X and +Z, so the shot comes from
  // one corner at a constant apparent size whatever the distance is.
  const run = horizontal / Math.SQRT2

  return {
    target: aim,
    position: [aim[0] + run, aim[1] + Math.sin(el) * standoff, aim[2] + run],
  }
}
