/**
 * reviewFocus — turning "which thing is wrong" into a camera pose.
 *
 * The tests are about the two things that make a jump useful rather than
 * disorienting: it must land ON the element (not near it, not on the building's
 * centre instead of the wall), and it must be the SAME move every time, so the
 * second finding does not require re-orienting after the first.
 *
 * The vertical case is the one that actually breaks in practice — a finding on
 * storey 2 that flies the camera to the ground under it is worse than no jump at
 * all — so elevation is asserted directly.
 */

import { describe, it, expect } from 'vitest'
import { cameraForFinding, type FocusScene } from './reviewFocus'
import type { FindingTarget } from './buildReview'

const scene = (over: Partial<FocusScene> = {}): FocusScene => ({
  walls: [
    { x: 5, z: -3, level: 0 },
    { x: -2, z: 8, level: 1 },
  ],
  openings: [{ x: 1, z: 1, level: 0 }],
  center: { x: 0, z: 0, radius: 10 },
  storeyHeight: 2.8,
  ...over,
})

const away = (t: FindingTarget | undefined, s = scene()) => {
  const p = cameraForFinding(t, s)
  return Math.hypot(p.position[0] - p.target[0], p.position[1] - p.target[1], p.position[2] - p.target[2])
}

describe('aiming', () => {
  it('lands on the wall it was given, at chest height', () => {
    const p = cameraForFinding({ focus: 'wall', wallIndex: 0 }, scene())
    expect(p.target[0]).toBeCloseTo(5, 6)
    expect(p.target[2]).toBeCloseTo(-3, 6)
    expect(p.target[1]).toBeCloseTo(1.2, 6)
  })

  it('lands on the opening it was given', () => {
    const p = cameraForFinding({ focus: 'opening', openingIndex: 0 }, scene())
    expect([p.target[0], p.target[2]]).toEqual([1, 1])
  })

  it('stands above and off to one side, never underneath or overhead', () => {
    const p = cameraForFinding({ focus: 'wall', wallIndex: 0 }, scene())
    expect(p.position[1]).toBeGreaterThan(p.target[1])
    expect(p.position[1]).toBeLessThan(p.target[1] + away({ focus: 'wall', wallIndex: 0 }))
    // Both horizontal axes move, so the shot is a corner view rather than an
    // elevation — a header or a wall-face is unreadable edge-on.
    expect(p.position[0]).toBeGreaterThan(p.target[0])
    expect(p.position[2]).toBeGreaterThan(p.target[2])
  })
})

describe('which storey', () => {
  it('raises an upper-storey wall by the storey rise, not the ground', () => {
    const p = cameraForFinding({ focus: 'wall', wallIndex: 1 }, scene())
    expect(p.target[1]).toBeCloseTo(2.8 + 1.2, 6)
    // and the camera still stands off the SAME distance: the jump is uniform.
    expect(away({ focus: 'wall', wallIndex: 1 })).toBeCloseTo(away({ focus: 'wall', wallIndex: 0 }), 6)
  })

  it('aims a storey finding at that storey of the building', () => {
    const p = cameraForFinding({ focus: 'storey', level: 1 }, scene())
    expect([p.target[0], p.target[2]]).toEqual([0, 0])
    expect(p.target[1]).toBeCloseTo(4, 6)
  })

  it('falls back to the ground storey when no level is given', () => {
    const p = cameraForFinding({ focus: 'building' }, scene())
    expect(p.target[1]).toBeCloseTo(1.2, 6)
  })
})

describe('how far back', () => {
  it('frames one wall close and the whole building from further out', () => {
    expect(away({ focus: 'building' }, scene())).toBeGreaterThan(away({ focus: 'wall', wallIndex: 0 }))
  })

  it('sizes the building shot to the footprint', () => {
    expect(away({ focus: 'building' }, scene({ center: { x: 0, z: 0, radius: 40 } })))
      .toBeGreaterThan(away({ focus: 'building' }, scene({ center: { x: 0, z: 0, radius: 12 } })))
  })

  it('still steps back from a building with no measurable radius', () => {
    const p = cameraForFinding({ focus: 'building' }, scene({ center: { x: 0, z: 0, radius: 0 } }))
    expect(Math.hypot(p.position[0] - p.target[0], p.position[2] - p.target[2])).toBeGreaterThan(4)
  })
})

describe('targets that cannot be followed', () => {
  it('aims at the building rather than nowhere when the element is gone', () => {
    // A finding that outlives the wall that raised it: the index no longer
    // exists. Shooting at the build's centre is the only truthful answer.
    const p = cameraForFinding({ focus: 'wall', wallIndex: 7 }, scene())
    expect([p.target[0], p.target[2]]).toEqual([0, 0])
  })

  it('aims at the building when a rule gave no target at all', () => {
    expect(cameraForFinding(undefined, scene()).target).toEqual([0, 1.2, 0])
  })
})
