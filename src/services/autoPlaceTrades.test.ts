import { describe, it, expect } from 'vitest'
import { autoPlaceOutlets, outletPositionsAlong, nudgeClear } from './autoPlaceTrades'
import { OUTLET_MAX_SPACING_M, electricalMountM } from './tradeRules'
import type { ParsedWall } from '../types'

/** 10 mm per pixel keeps the arithmetic easy to read: 100px = 1m. */
const MM_PER_PX = 10

function wall(x1: number, y1: number, x2: number, y2: number, level = 0): ParsedWall {
  return { x1, y1, x2, y2, thickness: 14, source: 'auto', detectionConfidence: 0.9, level }
}

/** A 10m x 8m rectangle, walls running clockwise. */
function room(): ParsedWall[] {
  return [
    wall(0, 0, 1000, 0),
    wall(1000, 0, 1000, 800),
    wall(1000, 800, 0, 800),
    wall(0, 800, 0, 0),
  ]
}

describe('outletPositionsAlong', () => {
  it('never leaves a point further from a receptacle than the code allows', () => {
    // NEC 210.52(A) is about the worst point on the wall, not the average gap.
    // The ends are the hard case: a wall spaced "every 12ft from one end" can
    // strand its far corner.
    const half = OUTLET_MAX_SPACING_M / 2
    for (const lengthM of [2, 3.5, 3.7, 7, 11, 12.5, 30]) {
      const pos = outletPositionsAlong(lengthM)
      expect(pos.length).toBeGreaterThan(0)
      // Walk the wall and check the worst point.
      let worst = 0
      for (let d = 0; d <= lengthM; d += 0.05) {
        const nearest = Math.min(...pos.map((p) => Math.abs(p - d)))
        worst = Math.max(worst, nearest)
      }
      expect(worst).toBeLessThanOrEqual(half + 1e-6)
    }
  })

  it('ignores a wall space too narrow to need one', () => {
    // Under 2ft is not a "wall space" under 210.52(A)(2).
    expect(outletPositionsAlong(0.3)).toEqual([])
  })

  it('puts a single outlet mid-wall on a short wall', () => {
    const pos = outletPositionsAlong(3)
    expect(pos).toHaveLength(1)
    expect(pos[0]).toBeCloseTo(1.5, 6)
  })

  it('adds outlets as the wall grows, never spacing them too far apart', () => {
    const pos = outletPositionsAlong(20)
    expect(pos.length).toBeGreaterThan(1)
    for (let i = 1; i < pos.length; i++) {
      expect(pos[i] - pos[i - 1]).toBeLessThanOrEqual(OUTLET_MAX_SPACING_M + 1e-6)
    }
  })
})

describe('autoPlaceOutlets', () => {
  it('places receptacles round a room at the code mount height', () => {
    const devices = autoPlaceOutlets({ walls: room(), scaleMmPerPx: MM_PER_PX })
    expect(devices.length).toBeGreaterThan(4)
    expect(devices.every((d) => d.type === 'duplex-outlet')).toBe(true)
    const expected = electricalMountM('outlet')!
    expect(devices.every((d) => d.mountM === expected)).toBe(true)
  })

  it('mounts on the interior FACE of a wall, not buried in its middle', () => {
    // A wall is stored as its centreline. A device left on that line sits
    // inside the studs, behind the board — invisible, and nowhere a box is ever
    // mounted. It belongs half a wall-thickness out, on the room side.
    const walls = room()
    const devices = autoPlaceOutlets({ walls, scaleMmPerPx: MM_PER_PX })
    const halfThickness = 14 / 2
    for (const d of devices) {
      const onAFace = walls.some((w) => {
        const dx = w.x2 - w.x1
        const dy = w.y2 - w.y1
        const len = Math.hypot(dx, dy)
        const perp = Math.abs((d.pxX - w.x1) * dy - (d.pxY - w.y1) * dx) / len
        return Math.abs(perp - halfThickness) < 0.001
      })
      expect(onAFace).toBe(true)
    }
  })

  it('steps INTO the room, never out into the yard', () => {
    const devices = autoPlaceOutlets({ walls: room(), scaleMmPerPx: MM_PER_PX })
    // The 10x8m room spans 0..1000 x 0..800 px; every device must land inside it.
    for (const d of devices) {
      expect(d.pxX).toBeGreaterThanOrEqual(-0.001)
      expect(d.pxX).toBeLessThanOrEqual(1000.001)
      expect(d.pxY).toBeGreaterThanOrEqual(-0.001)
      expect(d.pxY).toBeLessThanOrEqual(800.001)
    }
  })

  it('faces devices into the building, not out at the yard', () => {
    const walls = room()
    const devices = autoPlaceOutlets({ walls, scaleMmPerPx: MM_PER_PX })
    const cx = 500
    const cy = 400
    for (const d of devices) {
      // Step a little way along the facing and check we moved inward.
      const fx = Math.sin(d.rotationY)
      const fy = -Math.cos(d.rotationY)
      const before = Math.hypot(d.pxX - cx, d.pxY - cy)
      const after = Math.hypot(d.pxX + fx * 10 - cx, d.pxY + fy * 10 - cy)
      expect(after).toBeLessThan(before)
    }
  })

  it('REFUSES to place anything when the drawing has no scale', () => {
    // A spacing rule in feet is meaningless without a scale, and inventing one
    // would put devices in confidently wrong places.
    expect(autoPlaceOutlets({ walls: room(), scaleMmPerPx: null })).toEqual([])
    expect(autoPlaceOutlets({ walls: room(), scaleMmPerPx: 0 })).toEqual([])
  })

  it('only works the storey it was asked for', () => {
    const walls = [...room(), wall(0, 0, 1000, 0, 1)]
    const ground = autoPlaceOutlets({ walls, scaleMmPerPx: MM_PER_PX, level: 0 })
    const upper = autoPlaceOutlets({ walls, scaleMmPerPx: MM_PER_PX, level: 1 })
    expect(ground.every((d) => d.level === 0)).toBe(true)
    expect(upper.every((d) => d.level === 1)).toBe(true)
    expect(upper.length).toBeGreaterThan(0)
    expect(upper.length).toBeLessThan(ground.length)
  })

  it('says why each device is there', () => {
    const devices = autoPlaceOutlets({ walls: room(), scaleMmPerPx: MM_PER_PX })
    expect(devices[0].reason).toMatch(/210\.52/)
  })
})

describe('heating type changes electrical placement', () => {
  // A baseboard heater lives under a window and a receptacle may not sit
  // directly above one — which is exactly where spacing wants to put it. This
  // is why heating has to be settled BEFORE electrical, not bolted on after.
  const windowOnTopWall = [{ pxX: 500, pxY: 0 }]

  it('keeps receptacles off the baseboard under a window', () => {
    const devices = autoPlaceOutlets({
      walls: room(),
      scaleMmPerPx: MM_PER_PX,
      heating: 'electric-baseboard',
      windows: windowOnTopWall,
    })
    const onTopWall = devices.filter((d) => Math.abs(d.pxY) < 0.001)
    // Nothing within the keep-out of the window centre (500px = 5m).
    for (const d of onTopWall) {
      expect(Math.abs(d.pxX - 500) * (MM_PER_PX / 1000)).toBeGreaterThanOrEqual(1.2 - 1e-6)
    }
  })

  it('leaves placement alone for systems with nothing on the wall', () => {
    const plain = autoPlaceOutlets({ walls: room(), scaleMmPerPx: MM_PER_PX, heating: 'forced-air', windows: windowOnTopWall })
    const hydronic = autoPlaceOutlets({ walls: room(), scaleMmPerPx: MM_PER_PX, heating: 'in-floor-hydronic', windows: windowOnTopWall })
    const minisplit = autoPlaceOutlets({ walls: room(), scaleMmPerPx: MM_PER_PX, heating: 'mini-split', windows: windowOnTopWall })
    // A mini-split head is up near the ceiling and a hydronic floor has no wall
    // emitter at all, so neither displaces a receptacle.
    expect(hydronic.map((d) => d.pxX)).toEqual(plain.map((d) => d.pxX))
    expect(minisplit.map((d) => d.pxX)).toEqual(plain.map((d) => d.pxX))
  })

  it('still covers the wall — it shifts outlets, it does not silently drop them', () => {
    // A missing receptacle is a code violation of its own, so nudging must not
    // become deleting.
    const plain = autoPlaceOutlets({ walls: room(), scaleMmPerPx: MM_PER_PX, heating: 'forced-air', windows: windowOnTopWall })
    const baseboard = autoPlaceOutlets({
      walls: room(), scaleMmPerPx: MM_PER_PX, heating: 'electric-baseboard', windows: windowOnTopWall,
    })
    expect(baseboard.length).toBe(plain.length)
  })

  it('explains itself when it had to move one', () => {
    const devices = autoPlaceOutlets({
      walls: room(), scaleMmPerPx: MM_PER_PX, heating: 'electric-baseboard', windows: windowOnTopWall,
    })
    expect(devices.some((d) => /shifted clear/.test(d.reason))).toBe(true)
  })
})

describe('nudgeClear', () => {
  it('leaves a clear position untouched', () => {
    expect(nudgeClear(5, [1], 10)).toBe(5)
  })

  it('moves to the nearer clear side', () => {
    expect(nudgeClear(5.2, [5], 10)).toBeCloseTo(3.8, 6)
  })

  it('takes the other side when the first would fall off the wall', () => {
    expect(nudgeClear(0.5, [0.4], 10)).toBeCloseTo(1.6, 6)
  })

  it('gives up honestly when the wall has nowhere legal left', () => {
    expect(nudgeClear(1, [1], 1.5)).toBeNull()
  })
})
