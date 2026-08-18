/**
 * Where a placed thing lands, and which way it faces.
 *
 * This is the arithmetic that decides whether a door sits IN a wall or half a
 * metre off it, pointing north. It used to live as three closures inside
 * FloorplanOverlay, which had two consequences and both of them bit:
 *
 *   1. NOTHING ELSE COULD USE IT. Placement snapped and oriented; dragging did
 *      not, because the drag lives in PlacedObjectsLayer and could not reach
 *      into another component's closures. So a door placed correctly could be
 *      dragged into a wall and simply stay at whatever angle it already had.
 *   2. NOTHING COULD TEST IT. Component-body helpers are not exported and not
 *      callable from a test, so the whole question of "does a door line up with
 *      its wall" was only ever answered by looking at the screen.
 *
 * So it is a module: pure functions over plain numbers, no React and no THREE.
 *
 * ── Two coordinate systems ──────────────────────────────────────────────────
 *
 * PLAN PIXELS  the print's own coordinates. Walls are stored in these, and so
 *              is an opening's cached `pxX`/`pxY`. Y grows DOWNWARD, as in any
 *              image.
 * WORLD METRES the 3D scene. The plan plane can be moved, scaled and rotated
 *              inside it, so the two are related by a similarity transform.
 *
 * Angles are computed in WORLD, never in pixels. A plan scaled differently on
 * its two axes does not preserve angle, so a yaw derived from pixel deltas
 * would be subtly wrong on exactly the plans that are hardest to eyeball.
 */

/** How the print plane sits in the world. Mirrors the overlay store fields. */
export interface PlanTransform {
  /** Overlay centre in world XZ. */
  position: [number, number]
  /** Plane size in metres: [width, depth]. */
  scale: [number, number]
  rotationDeg: number
  /** Raster size in pixels. */
  imageWidth: number
  imageHeight: number
}

/** A wall as stored on the drawing — plan pixels. */
export interface PlanWall { x1: number; y1: number; x2: number; y2: number }

/** A point in the world, on the ground plane. */
export interface WorldPoint { x: number; z: number }

const deg2rad = (d: number) => (d * Math.PI) / 180

/** Plan pixel → world XZ. */
export function planPixelToWorld(t: PlanTransform, px: number, py: number): WorldPoint {
  const localX = (px / t.imageWidth - 0.5) * t.scale[0]
  const localZ = (py / t.imageHeight - 0.5) * t.scale[1]
  const r = deg2rad(t.rotationDeg)
  const cos = Math.cos(r), sin = Math.sin(r)
  // Rotation about +Y. Matches THREE's applyAxisAngle(Vector3(0,1,0), r) for a
  // vector in the XZ plane, which is what the overlay uses to place the print.
  return {
    x: t.position[0] + localX * cos + localZ * sin,
    z: t.position[1] - localX * sin + localZ * cos,
  }
}

/** World XZ → plan pixel. The inverse of planPixelToWorld, unclamped. */
export function worldToPlanPixel(t: PlanTransform, x: number, z: number): { px: number; py: number } {
  const dx = x - t.position[0]
  const dz = z - t.position[1]
  const r = deg2rad(t.rotationDeg)
  const cos = Math.cos(-r), sin = Math.sin(-r)
  const localX = dx * cos + dz * sin
  const localZ = -dx * sin + dz * cos
  return {
    px: (localX / t.scale[0] + 0.5) * t.imageWidth,
    py: (localZ / t.scale[1] + 0.5) * t.imageHeight,
  }
}

/**
 * The four edges of a room, as walls you can snap to.
 *
 * A PRACTICE PRESET SHIPS NO WALLS. `parsedWalls` is stripped to [] on purpose
 * — tracing them is the exercise — so the walls exist only as ink on the
 * image. Everything that reasons about walls then has nothing: a door dropped
 * on a preset has nothing to seat into and nothing to line up with, so it
 * lands flat at zero degrees in the middle of a room, which is exactly what
 * "doors don't line up" looks like from the outside.
 *
 * Rooms deliberately SURVIVE practice mode, and a room rectangle's edges are
 * the wall lines — the same preset definition drew both. So this invents
 * nothing: it reads geometry the plan already carries. Used only as the last
 * tier, behind anything traced or detected, so on a real drawing it never
 * competes with a wall that actually exists.
 */
export function roomEdgeWalls(
  rooms: { x1: number; y1: number; x2: number; y2: number }[],
): PlanWall[] {
  const out: PlanWall[] = []
  for (const r of rooms) {
    const x1 = Math.min(r.x1, r.x2), x2 = Math.max(r.x1, r.x2)
    const y1 = Math.min(r.y1, r.y2), y2 = Math.max(r.y1, r.y2)
    if (x2 - x1 < 1e-6 || y2 - y1 < 1e-6) continue
    out.push(
      { x1, y1, x2, y2: y1 },   // top
      { x1, y1: y2, x2, y2 },   // bottom
      { x1, y1, x2: x1, y2 },   // left
      { x1: x2, y1, x2, y2 },   // right
    )
  }
  return out
}

/** Distance from a point to a segment, and the closest point on it. */
function nearestOnSeg(
  x: number, z: number, ax: number, az: number, bx: number, bz: number,
): { d: number; x: number; z: number } {
  const dx = bx - ax, dz = bz - az
  const len2 = dx * dx + dz * dz
  if (len2 < 1e-9) return { d: Math.hypot(x - ax, z - az), x: ax, z: az }
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len2))
  const px = ax + t * dx, pz = az + t * dz
  return { d: Math.hypot(x - px, z - pz), x: px, z: pz }
}

/** A wall in world space, plus the yaw that lies along it. */
interface WorldWall { ax: number; az: number; bx: number; bz: number; yaw: number }

export function toWorldWalls(t: PlanTransform, walls: PlanWall[]): WorldWall[] {
  return walls.map((w) => {
    const a = planPixelToWorld(t, w.x1, w.y1)
    const b = planPixelToWorld(t, w.x2, w.y2)
    // Yaw convention, shared with placement and rendering: local +X runs along
    // the wall, local +Z is the facing direction. Hence the negation.
    return { ax: a.x, az: a.z, bx: b.x, bz: b.z, yaw: -Math.atan2(b.z - a.z, b.x - a.x) }
  })
}

function nearestWall(walls: WorldWall[], x: number, z: number) {
  let best = Infinity, hit: (WorldWall & { cx: number; cz: number }) | null = null
  for (const w of walls) {
    const n = nearestOnSeg(x, z, w.ax, w.az, w.bx, w.bz)
    if (n.d < best) { best = n.d; hit = { ...w, cx: n.x, cz: n.z } }
  }
  return { dist: best, wall: hit }
}

/**
 * ORIENTING REACHES FURTHER THAN SNAPPING, deliberately.
 *
 * They shared a 1.2 m cutoff once — about four feet. Drop a window a hand's
 * width past that and it came down at 0 degrees, square to the world instead of
 * square to the wall it was obviously meant for. Turning is free and
 * reversible: nothing moves, the thing just faces the right way, and facing a
 * wall 2 m off is right far more often than facing due north is. MOVING is the
 * part that has to stay tight, because a snap that reaches too far teleports
 * what you are placing out from under your hand.
 */
export const SNAP_REACH_M = 1.2
export const ORIENT_REACH_M = 3.0

export interface PoseInput {
  /** Where the pointer let go, in world XZ. */
  x: number
  z: number
  transform: PlanTransform
  /** Walls the user drew. Consulted first. */
  tracedWalls: PlanWall[]
  /** Walls the detector found. Consulted where no traced wall is in reach. */
  detectedWalls: PlanWall[]
  /** Doors, windows and wall devices snap onto the wall; furniture does not. */
  wallMounted: boolean
  /** Kept when nothing is near enough to have an opinion. */
  fallbackYaw?: number
}

export interface Pose {
  x: number
  z: number
  rotationY: number
  /** Cached plan-pixel position. Kept in step with x/z — see the note below. */
  pxX: number
  pxY: number
  snapped: boolean
  oriented: boolean
}

/**
 * The pose for a thing dropped (or dragged) to a world point.
 *
 * TRACED WALLS WIN, BUT PER PLACEMENT — not per storey. Preferring the whole
 * traced SET the moment one exists deletes every detected wall from placement's
 * view, so a door dropped anywhere else on the plan has nothing in reach and
 * lands unsnapped at yaw 0 while the hole is still cut at the wall's real
 * angle. Reach decides instead: your line first, the detector's only where you
 * have not drawn one.
 *
 * `pxX`/`pxY` come back with every pose because they are not decoration — the
 * framing, drywall and envelope layers all locate an opening by its pixel
 * position, so a pose that updated x/z alone would move the door on screen and
 * leave the hole behind.
 */
export function placementPose(input: PoseInput): Pose {
  const { x, z, transform, wallMounted, fallbackYaw = 0 } = input
  const traced = toWorldWalls(transform, input.tracedWalls)
  const detected = toWorldWalls(transform, input.detectedWalls)

  const pick = (reach: number) => {
    const t = nearestWall(traced, x, z)
    if (t.wall && t.dist < reach) return t
    const d = nearestWall(detected, x, z)
    return d.wall && d.dist < reach ? d : null
  }

  const orient = pick(ORIENT_REACH_M)
  const rotationY = orient?.wall ? orient.wall.yaw : fallbackYaw

  let px = x, pz = z, snapped = false
  if (wallMounted) {
    const snap = pick(SNAP_REACH_M)
    if (snap?.wall) { px = snap.wall.cx; pz = snap.wall.cz; snapped = true }
  }

  const pixel = worldToPlanPixel(transform, px, pz)
  return {
    x: px, z: pz, rotationY,
    pxX: pixel.px, pxY: pixel.py,
    snapped, oriented: orient != null,
  }
}
