import { describe, it, expect } from 'vitest'
import { autoPlaceOutlets, outletPositionsAlong } from './autoPlaceTrades'
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

  it('lands every device ON its wall, not floating in the room', () => {
    const walls = room()
    const devices = autoPlaceOutlets({ walls, scaleMmPerPx: MM_PER_PX })
    for (const d of devices) {
      const onSomeWall = walls.some((w) => {
        const dx = w.x2 - w.x1
        const dy = w.y2 - w.y1
        const len = Math.hypot(dx, dy)
        // Perpendicular distance from the device to the wall's line.
        const dist = Math.abs((d.pxX - w.x1) * dy - (d.pxY - w.y1) * dx) / len
        return dist < 0.001
      })
      expect(onSomeWall).toBe(true)
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
