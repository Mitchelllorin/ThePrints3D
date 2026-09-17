/**
 * THE FIT IS THE ONE PIECE OF CINEMA MATHS NOTHING ELSE CATCHES.
 *
 * Every other mistake in a shot is visible in the first still: a caption that
 * never fires, a layer that stays dark, a camera pointed at the floor. A fit
 * that is quietly 1.5x too far back looks *fine* — it looks like a shot
 * composed a bit wide — and it shipped exactly that way, eight shots of a
 * building sitting small in the middle of a lot of empty grid, because framing
 * the enclosing SPHERE of a flat oblong house frames mostly air.
 *
 * So it gets checked against an independent projection rather than by eye:
 * pose the camera where fitFor says, build a real lookAt basis and a real
 * perspective divide from scratch, and confirm the corners land exactly on the
 * frame edge. Exactly — under 1 is a shot composed looser than it claims, over
 * 1 is a building with its corner cut off.
 */
import { describe, expect, it, afterEach } from 'vitest'
import { AIR, fitFor, toPose, boxCenter, boxRadius, lerpBox, type Frame, type Box } from './moves'

const DEG = Math.PI / 180

/** Stand in for the live camera the fit reads its lens off. */
function setLens(fov: number, aspect: number) {
  ;(globalThis as unknown as Record<string, unknown>).__camera = { fov, aspect }
}
afterEach(() => {
  delete (globalThis as unknown as Record<string, unknown>).__camera
})

/**
 * Worst corner of `box` in normalised device coordinates, computed the long
 * way round — nothing here is shared with the code under test.
 *
 * 1 means the corner is exactly on the frame edge, above 1 is off-frame.
 */
function worstCorner(box: Box, camPos: number[], target: number[], fov: number, aspect: number) {
  const sub = (a: number[], b: number[]) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
  const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
  const cross = (a: number[], b: number[]) => [
    a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0],
  ]
  const norm = (a: number[]) => {
    const l = Math.hypot(a[0], a[1], a[2]) || 1
    return [a[0] / l, a[1] / l, a[2] / l]
  }

  const forward = norm(sub(target, camPos))
  const right = norm(cross(forward, [0, 1, 0]))
  const up = cross(right, forward)
  const tanV = Math.tan((fov * Math.PI) / 180 / 2)
  const tanH = tanV * aspect

  let worst = 0
  let behind = false
  for (let i = 0; i < 8; i++) {
    const p = [
      i & 1 ? box.max[0] : box.min[0],
      i & 2 ? box.max[1] : box.min[1],
      i & 4 ? box.max[2] : box.min[2],
    ]
    const v = sub(p, camPos)
    const depth = dot(v, forward)
    if (depth <= 0) behind = true
    worst = Math.max(
      worst,
      Math.abs(dot(v, right) / (tanH * depth)),
      Math.abs(dot(v, up) / (tanV * depth)),
    )
  }
  return { worst, behind }
}

/** A three-bed ranch: 13.4m x 9.1m on the ground, 4.2m to the ridge, off the origin. */
function ranch(): Frame {
  const box: Box = { min: [-4.2, 0, -6.1], max: [9.2, 4.2, 3.0] }
  return { center: boxCenter(box), radius: boxRadius(box), box }
}

describe('fitFor', () => {
  /**
   * The whole sweep, not one pose. A fit that is right at one azimuth and
   * wrong at the next is the specific failure a turntable makes obvious and a
   * single unit test misses — a house is wide across the front and narrow off
   * the end, and the distance has to follow that all the way round.
   */
  it.each([
    ['wide 16:9', 50, 16 / 9],
    ['vertical 9:16', 50, 9 / 16],
    ['square', 50, 1],
  ])('fills the frame exactly at every pose — %s', (_label, fov, aspect) => {
    setLens(fov, aspect)
    const frame = ranch()

    for (let az = 0; az < 360; az += 11) {
      for (const elev of [0, 6, 14, 24, 42, 60, 88]) {
        for (const look of [[0, 0, 0], [0, 0.15, 0], [0.1, -0.1, 0.05]] as Array<[number, number, number]>) {
          const pose = toPose(az, elev, 1, look, frame)
          const { worst, behind } = worstCorner(frame.box, pose.position, pose.target, fov, aspect)
          expect(behind, `corner behind the camera at az ${az} elev ${elev}`).toBe(false)
          // Exactly on the edge: dist 1 means the model fills the frame, which
          // is what every storyboard's AIR multiplier is written against.
          expect(worst, `az ${az} elev ${elev} look ${look.join(',')}`).toBeCloseTo(1, 3)
        }
      }
    }
  })

  /**
   * THE MARGIN IS THE SAME MARGIN AT EVERY ANGLE, or it is not a margin.
   *
   * This is the one that caught the first attempt. Multiplying the fit
   * distance by 1.34 reads as 34% more air only at the elevation it was tuned
   * at: perspective foreshortens the near and far corners differently, so at a
   * low angle the same number measured 0.63 of the frame where 0.75 was asked
   * for, and every shot in the library was composed against a margin that
   * quietly drifted as the camera craned.
   */
  it.each([
    ['tight', AIR.tight],
    ['normal', AIR.normal],
    ['wide', AIR.wide],
  ])('leaves exactly the air it asks for, at every angle — AIR.%s', (_label, air) => {
    setLens(50, 16 / 9)
    const frame = ranch()
    for (let az = 0; az < 360; az += 23) {
      for (const elev of [0, 6, 14, 24, 42, 60, 88]) {
        const pose = toPose(az, elev, air, [0, 0, 0], frame)
        const { worst } = worstCorner(frame.box, pose.position, pose.target, 50, 16 / 9)
        expect(worst, `az ${az} elev ${elev}`).toBeCloseTo(1 / air, 3)
      }
    }
  })

  it('stands further back for a taller model, not the same distance', () => {
    setLens(50, 16 / 9)
    const one = ranch()
    const two: Box = { min: [-4.2, 0, -6.1], max: [9.2, 8.4, 3.0] } // a storey more
    const twoFrame: Frame = { center: boxCenter(two), radius: boxRadius(two), box: two }
    const a = fitFor(one, 35 * DEG, 22 * DEG, one.center)
    const b = fitFor(twoFrame, 35 * DEG, 22 * DEG, twoFrame.center)
    expect(b).toBeGreaterThan(a)
  })

  /**
   * The bug this replaced, stated as a test so it cannot come back: framing
   * the enclosing sphere of a flat house puts the camera half again too far
   * away, and the building crosses about a third of the frame.
   */
  it('frames the model, not the sphere around it', () => {
    setLens(50, 16 / 9)
    const frame = ranch()
    const tanV = Math.tan((50 * Math.PI) / 180 / 2)
    const sphereFit = frame.radius / Math.sin(Math.atan(tanV))
    const boxFit = fitFor(frame, 18 * DEG, 14 * DEG, frame.center)
    expect(boxFit).toBeLessThan(sphereFit * 0.8)
  })
})

describe('lerpBox', () => {
  it('walks the bounds from assembled to apart', () => {
    const a: Box = { min: [0, 0, 0], max: [2, 2, 2] }
    const b: Box = { min: [-4, 0, -4], max: [6, 5, 6] }
    expect(lerpBox(a, b, 0)).toEqual(a)
    expect(lerpBox(a, b, 1)).toEqual(b)
    const mid = lerpBox(a, b, 0.5)
    expect(mid.min).toEqual([-2, 0, -2])
    expect(mid.max).toEqual([4, 3.5, 4])
  })

  it('clamps, so an explode past its peak cannot overshoot the framing', () => {
    const a: Box = { min: [0, 0, 0], max: [2, 2, 2] }
    const b: Box = { min: [-4, 0, -4], max: [6, 5, 6] }
    expect(lerpBox(a, b, 2)).toEqual(b)
    expect(lerpBox(a, b, -1)).toEqual(a)
  })
})
