/**
 * Seat a door or window into a GAP that is already in the wall.
 *
 * Walls get traced as separate runs with a space left for the opening — that gap
 * IS the doorway, and dropping a door into it should drop it into it.
 *
 * It did not. Placement snapped to the nearest wall CENTRELINE, and the
 * projection along a wall is clamped to its own length, so a point standing in
 * the gap is off the end of both flanking walls. The clamp pulled the door back
 * to whichever wall end was nearest and it slid out of the opening it was aimed
 * at. Aiming more carefully could not help: there is no wall in a gap to snap to.
 *
 * So a gap is treated as a thing you can place into. Two wall runs that are
 * roughly collinear and stop short of each other describe an opening, and it has
 * a centre, a direction, and a width — everything a door needs to seat.
 *
 * Pure and world-space (metres), so it can be tested without a scene.
 */

/** A wall run, in world metres on the ground plane. */
export interface Seg2 { ax: number; az: number; bx: number; bz: number }

export interface GapSeat {
  /** Centre of the gap — where the opening's centre belongs. */
  x: number
  z: number
  /** Yaw aligning with the wall run, so the door sits IN the wall, not across it. */
  yaw: number
  /** Clear width of the gap, so the opening can be sized to fill it. */
  widthM: number
}

/** How parallel two runs must be to read as the same wall (sin of the angle). */
const PARALLEL_TOL = 0.12
/** How far off each other's line they may sit and still be the same wall. */
const COLLINEAR_TOL_M = 0.25

/**
 * Find the opening nearest to (x, z).
 *
 * `maxDistM` is how close you have to drop to claim a gap; `minGapM`/`maxGapM`
 * bound what counts as an opening rather than a corner or a missing wall — a
 * doorway is roughly 0.6 m to 3.5 m, so a 50 mm sliver between two butted runs
 * is not an opening and neither is a 10 m hole where a wall was never traced.
 */
export function seatInGap(
  x: number,
  z: number,
  segs: Seg2[],
  maxDistM = 1.5,
  minGapM = 0.6,
  maxGapM = 3.6,
): GapSeat | null {
  let best: GapSeat | null = null
  let bestDist = Infinity

  const dirOf = (s: Seg2) => {
    const dx = s.bx - s.ax, dz = s.bz - s.az
    const len = Math.hypot(dx, dz)
    return len < 1e-6 ? null : { dx: dx / len, dz: dz / len, len }
  }

  for (let i = 0; i < segs.length; i++) {
    const a = segs[i], da = dirOf(a)
    if (!da) continue
    for (let j = i + 1; j < segs.length; j++) {
      const b = segs[j], db = dirOf(b)
      if (!db) continue

      // Same wall? Parallel, and b sitting on a's line rather than beside it.
      const cross = Math.abs(da.dx * db.dz - da.dz * db.dx)
      if (cross > PARALLEL_TOL) continue
      const bmx = (b.ax + b.bx) / 2, bmz = (b.az + b.bz) / 2
      const perp = Math.abs((bmx - a.ax) * da.dz - (bmz - a.az) * da.dx)
      if (perp > COLLINEAR_TOL_M) continue

      // The facing ends: the closest endpoint pair between the two runs.
      const ends: Array<[number, number, number, number]> = [
        [a.ax, a.az, b.ax, b.az], [a.ax, a.az, b.bx, b.bz],
        [a.bx, a.bz, b.ax, b.az], [a.bx, a.bz, b.bx, b.bz],
      ]
      let gap = Infinity, cx = 0, cz = 0
      for (const [px, pz, qx, qz] of ends) {
        const d = Math.hypot(qx - px, qz - pz)
        if (d < gap) { gap = d; cx = (px + qx) / 2; cz = (pz + qz) / 2 }
      }
      if (gap < minGapM || gap > maxGapM) continue

      const d = Math.hypot(x - cx, z - cz)
      if (d > maxDistM || d >= bestDist) continue
      bestDist = d
      // Yaw follows the wall run. Negated to match the scene's screen-yaw
      // convention, the same way autoOrientYaw does it.
      best = { x: cx, z: cz, yaw: -Math.atan2(da.dz, da.dx), widthM: gap }
    }
  }
  return best
}
