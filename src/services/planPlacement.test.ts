import { describe, it, expect } from 'vitest'
import {
  planPixelToWorld,
  worldToPlanPixel,
  placementPose,
  roomEdgeWalls,
  ORIENT_REACH_M,
  type PlanTransform,
  type PlanWall,
} from './planPlacement'

/** A 1000x1000 px print covering 10x10 m, centred on the origin, unrotated. */
const T: PlanTransform = {
  position: [0, 0],
  scale: [10, 10],
  rotationDeg: 0,
  imageWidth: 1000,
  imageHeight: 1000,
}

/** The same print, turned 30 degrees — the case pixel-space angles get wrong. */
const T30: PlanTransform = { ...T, rotationDeg: 30 }

const deg = (r: number) => (r * 180) / Math.PI

describe('plan <-> world transform', () => {
  it('maps the print centre to the overlay position', () => {
    expect(planPixelToWorld(T, 500, 500)).toEqual({ x: 0, z: 0 })
  })

  it('round-trips an arbitrary point', () => {
    const w = planPixelToWorld(T, 137, 861)
    const p = worldToPlanPixel(T, w.x, w.z)
    expect(p.px).toBeCloseTo(137, 6)
    expect(p.py).toBeCloseTo(861, 6)
  })

  it('round-trips through a rotated and offset plan', () => {
    const t: PlanTransform = { ...T, position: [4, -7], rotationDeg: 41.5, scale: [12, 9] }
    const w = planPixelToWorld(t, 620, 210)
    const p = worldToPlanPixel(t, w.x, w.z)
    expect(p.px).toBeCloseTo(620, 6)
    expect(p.py).toBeCloseTo(210, 6)
  })
})

describe('placementPose — orientation', () => {
  /** A horizontal wall across the middle of the print. */
  const horizontal: PlanWall[] = [{ x1: 200, y1: 500, x2: 800, y2: 500 }]
  /** A wall at 45 degrees. */
  const diagonal: PlanWall[] = [{ x1: 200, y1: 200, x2: 800, y2: 800 }]

  it('lines a door up with the wall it is dropped on', () => {
    const pose = placementPose({
      x: 0, z: 0, transform: T,
      tracedWalls: horizontal, detectedWalls: [], wallMounted: true,
    })
    expect(deg(pose.rotationY)).toBeCloseTo(0, 6)
    expect(pose.oriented).toBe(true)
    expect(pose.snapped).toBe(true)
  })

  it('lines a door up with a DIAGONAL wall — not the nearest axis', () => {
    // The bug this guards: an angle collapsed to horizontal/vertical leaves the
    // leaf lying across a correctly-cut hole.
    const pose = placementPose({
      x: 0, z: 0, transform: T,
      tracedWalls: diagonal, detectedWalls: [], wallMounted: true,
    })
    expect(deg(pose.rotationY)).toBeCloseTo(-45, 6)
  })

  it('takes the plan rotation into account', () => {
    // A wall that is horizontal on the PRINT is 30 degrees off in the WORLD once
    // the print is turned, and the door has to follow the world.
    const pose = placementPose({
      x: 0, z: 0, transform: T30,
      tracedWalls: horizontal, detectedWalls: [], wallMounted: true,
    })
    expect(deg(pose.rotationY)).toBeCloseTo(30, 6)
  })

  it('keeps the fallback yaw when nothing is within reach', () => {
    const far: PlanWall[] = [{ x1: 0, y1: 0, x2: 10, y2: 0 }]
    const pose = placementPose({
      x: 40, z: 40, transform: T,
      tracedWalls: far, detectedWalls: [], wallMounted: true,
      fallbackYaw: 1.234,
    })
    expect(pose.rotationY).toBe(1.234)
    expect(pose.oriented).toBe(false)
    expect(pose.snapped).toBe(false)
  })
})

describe('placementPose — traced walls win, but per placement', () => {
  // THE REGRESSION THIS FILE EXISTS FOR.
  //
  // Placement used to take the traced SET the moment it was non-empty, which
  // dropped every detected wall from consideration. One traced wall in a corner
  // and a door dropped anywhere else landed unsnapped at yaw 0, while the hole
  // was still cut at the wall's real angle.
  const tracedFarAway: PlanWall[] = [{ x1: 0, y1: 950, x2: 100, y2: 950 }]
  const detectedVertical: PlanWall[] = [{ x1: 500, y1: 100, x2: 500, y2: 900 }]

  it('uses a detected wall where no traced wall is near', () => {
    const pose = placementPose({
      x: 0.3, z: 0, transform: T,
      tracedWalls: tracedFarAway, detectedWalls: detectedVertical, wallMounted: true,
    })
    expect(Math.abs(deg(pose.rotationY))).toBeCloseTo(90, 6)
    expect(pose.snapped).toBe(true)
    expect(pose.x).toBeCloseTo(0, 6)   // pulled onto the wall centreline
  })

  it('still prefers a traced wall when both are in reach', () => {
    // Traced diagonal and detected horizontal both near the drop point; the one
    // the user drew must win even though the detected one is marginally closer.
    const traced: PlanWall[] = [{ x1: 400, y1: 400, x2: 600, y2: 600 }]
    const detected: PlanWall[] = [{ x1: 400, y1: 505, x2: 600, y2: 505 }]
    const pose = placementPose({
      x: 0, z: 0, transform: T,
      tracedWalls: traced, detectedWalls: detected, wallMounted: true,
    })
    expect(deg(pose.rotationY)).toBeCloseTo(-45, 6)
  })

  it('orients from further away than it snaps', () => {
    // Between the two reaches: turn to face the wall, but do not get yanked onto it.
    const wall: PlanWall[] = [{ x1: 0, y1: 500, x2: 1000, y2: 500 }]
    const between = (ORIENT_REACH_M + 1.2) / 2
    const pose = placementPose({
      x: 0, z: between, transform: T,
      tracedWalls: wall, detectedWalls: [], wallMounted: true,
    })
    expect(pose.oriented).toBe(true)
    expect(pose.snapped).toBe(false)
    expect(pose.z).toBeCloseTo(between, 6)
  })
})

describe('roomEdgeWalls — the fallback for a plan with no wall data', () => {
  it('turns a room into its four edges', () => {
    const edges = roomEdgeWalls([{ x1: 100, y1: 200, x2: 400, y2: 600 }])
    expect(edges).toHaveLength(4)
    // Every edge is a real segment lying on the rectangle.
    for (const e of edges) {
      expect(Math.hypot(e.x2 - e.x1, e.y2 - e.y1)).toBeGreaterThan(0)
      expect([100, 400]).toContain(Math.min(e.x1, e.x2))
    }
  })

  it('tolerates reversed corners and skips degenerate rooms', () => {
    expect(roomEdgeWalls([{ x1: 400, y1: 600, x2: 100, y2: 200 }])).toHaveLength(4)
    expect(roomEdgeWalls([{ x1: 10, y1: 10, x2: 10, y2: 90 }])).toHaveLength(0)
  })

  it('lets a door line up on a plan that ships rooms but no walls', () => {
    // THE PRACTICE-PRESET CASE. With parsedWalls stripped to [], a door had
    // nothing to snap to and landed flat at 0 degrees wherever it was tapped.
    const rooms = [{ x1: 100, y1: 100, x2: 500, y2: 500 }]
    const T2: PlanTransform = { ...T, scale: [10, 10], imageWidth: 1000, imageHeight: 1000 }
    // Just inside the room's LEFT edge (x=100px → world -4.0m), and halfway
    // down it so the top and bottom edges are not the nearer answer.
    const pose = placementPose({
      x: -3.9, z: -2, transform: T2,
      tracedWalls: [], detectedWalls: roomEdgeWalls(rooms), wallMounted: true,
    })
    expect(pose.snapped).toBe(true)
    expect(pose.x).toBeCloseTo(-4, 6)                       // pulled onto the edge
    expect(Math.abs(deg(pose.rotationY))).toBeCloseTo(90, 6) // and turned to match it
  })
})

describe('placementPose — pixel coordinates follow the move', () => {
  // Stale pxX/pxY are silent: the door moves on screen and the hole, the drywall
  // cut and the envelope cut all stay where they were.
  const wall: PlanWall[] = [{ x1: 0, y1: 500, x2: 1000, y2: 500 }]

  it('reports the pixel position of the SNAPPED point, not the raw drop', () => {
    const pose = placementPose({
      x: 2, z: 0.4, transform: T,
      tracedWalls: wall, detectedWalls: [], wallMounted: true,
    })
    expect(pose.snapped).toBe(true)
    const round = worldToPlanPixel(T, pose.x, pose.z)
    expect(pose.pxX).toBeCloseTo(round.px, 6)
    expect(pose.pxY).toBeCloseTo(round.py, 6)
    expect(pose.pxY).toBeCloseTo(500, 6)   // on the wall's pixel row
  })

  it('furniture keeps its drop point but still reports pixels', () => {
    const pose = placementPose({
      x: 2, z: 0.4, transform: T,
      tracedWalls: wall, detectedWalls: [], wallMounted: false,
    })
    expect(pose.snapped).toBe(false)
    expect(pose.x).toBe(2)
    expect(pose.z).toBe(0.4)
    expect(pose.pxX).toBeCloseTo(700, 6)
    expect(pose.pxY).toBeCloseTo(540, 6)
  })
})
