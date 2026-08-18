import { describe, it, expect } from 'vitest'
import { routeAlongWalls } from './autoRouteTrades'
import type { ParsedWall } from '../types'

const wall = (x1: number, y1: number, x2: number, y2: number): ParsedWall => ({
  x1, y1, x2, y2, thickness: 8, source: 'auto', detectionConfidence: 1,
})

/** A plain rectangular room, the way a plan gives it to us. */
const room = [
  wall(0, 0, 400, 0),      // north
  wall(400, 0, 400, 300),  // east
  wall(400, 300, 0, 300),  // south
  wall(0, 300, 0, 0),      // west
]

const outlet = (pxX: number, pxY: number) => ({ type: 'duplex-outlet', pxX, pxY })

describe('routing a run along the walls', () => {
  it('chains outlets that share a wall, in order along it', () => {
    // Three on the north wall, deliberately out of order in the input.
    const segs = routeAlongWalls(
      [outlet(300, 6), outlet(100, 6), outlet(200, 6)],
      room,
      { startNear: { pxX: 0, pxY: 0 } },
    )
    expect(segs).toHaveLength(2)
    // Ordered along the wall: 100 → 200 → 300, not the order they arrived in.
    expect(segs[0].x1).toBe(100)
    expect(segs[0].x2).toBe(200)
    expect(segs[1].x2).toBe(300)
  })

  it('runs IN the wall, not through the room', () => {
    // Outlets sit a few px off the wall line; the run should sit ON it.
    const segs = routeAlongWalls([outlet(100, 9), outlet(300, 9)], room, {
      startNear: { pxX: 0, pxY: 0 },
    })
    expect(segs).toHaveLength(1)
    // Projected onto the north wall (y = 0), not left at the device's y.
    expect(segs[0].y1).toBe(0)
    expect(segs[0].y2).toBe(0)
  })

  it('crosses to the next wall at the corner, and says so', () => {
    const segs = routeAlongWalls(
      [outlet(100, 6), outlet(300, 6), outlet(394, 150)],
      room,
      { startNear: { pxX: 0, pxY: 0 } },
    )
    // Three devices make TWO hops: along the north wall, then onto the east.
    expect(segs).toHaveLength(2)
    expect(segs[1].corner).toBe(true)
    expect(segs.filter((s) => s.corner)).toHaveLength(1)
  })

  it('starts from the service end rather than wherever the list began', () => {
    // Panel at the far corner: the run should begin on the wall nearest IT.
    const segs = routeAlongWalls(
      [outlet(100, 6), outlet(300, 6), outlet(394, 150), outlet(394, 250)],
      room,
      { startNear: { pxX: 400, pxY: 300 } },
    )
    const first = segs[0]
    // Nearest wall to that corner is the east wall — the run opens there.
    expect(Math.abs(first.x1 - 400)).toBeLessThanOrEqual(8)
  })

  it('has nothing to say about a single device', () => {
    expect(routeAlongWalls([outlet(100, 6)], room)).toEqual([])
  })

  it('drops zero-length hops', () => {
    const segs = routeAlongWalls([outlet(100, 6), outlet(100, 6)], room)
    expect(segs).toEqual([])
  })
})
