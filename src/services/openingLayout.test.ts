import { describe, it, expect } from 'vitest'
import { planWalls, type WallPlanInput } from './wallFramingPlan'
import { locateOpening, centreFromEnd, moveOpeningTo } from './openingLayout'
import type { Drawing, ParsedWall, PlacedObject } from '../types'

/** 1000px across the sheet is 10m, so 1px = 10mm and the sheet centre is world 0,0. */
const w = (x1: number, y1: number, x2: number, y2: number): ParsedWall =>
  ({ x1, y1, x2, y2, thickness: 10, source: 'user', framingType: 'wood-2x4' } as unknown as ParsedWall)

const door = (id: string, x: number, z: number): PlacedObject =>
  ({ id, type: 'door', x, z, rotationY: 0, scaleX: 1, scaleY: 1, scaleZ: 1, label: 'Door' } as unknown as PlacedObject)

const plan = (walls: ParsedWall[], objects: PlacedObject[]) => planWalls({
  drawings: [{ id: 'd1', parsedWalls: walls, parsedOpenings: [], rasterWidth: 1000, rasterHeight: 1000,
    scaleMmPerPx: 10, floorNumber: 0 } as unknown as Drawing],
  overlay: { drawingId: 'd1', scale: [10, 10], rotationDeg: 0, position: [0, 0] },
  placedObjects: objects,
  ceilingM: 2.44, storeyM: 2.76,
  framingMaterial: 'wood', steelGauge: '25', steelTrackTop: 'slotted', steelDeflectionGapMm: 19,
  studSpacingIn: 16,
} as WallPlanInput)

describe('reading where an opening sits', () => {
  // One free-standing 6m wall across the plan, world x -3..3 at z -4.
  const plans = plan([w(200, 100, 800, 100)], [door('a', -1, -4)])

  it('finds the wall it was framed into', () => {
    const spot = locateOpening(plans, 'a')!
    expect(spot.wall.index).toBe(0)
    expect(spot.lengthM).toBeCloseTo(6, 6)
  })

  it('measures to the centre from the left end, and from the right', () => {
    const spot = locateOpening(plans, 'a')!
    expect(spot.ends).toEqual(['left', 'right'])
    expect(centreFromEnd(spot, true)).toBeCloseTo(2, 6)
    expect(centreFromEnd(spot, false)).toBeCloseTo(4, 6)
  })

  it('names the ends by the plan, whichever way the wall was drawn', () => {
    const back = locateOpening(plan([w(800, 100, 200, 100)], [door('a', -1, -4)]), 'a')!
    expect(centreFromEnd(back, true)).toBeCloseTo(2, 6)      // still 2m from the LEFT end
    const up = locateOpening(plan([w(100, 800, 100, 200)], [door('a', -4, -1)]), 'a')!
    expect(up.ends).toEqual(['top', 'bottom'])
    expect(centreFromEnd(up, true)).toBeCloseTo(2, 6)        // top end is world z -3
  })

  it('knows nothing of an object that is not in a wall', () => {
    expect(locateOpening(plans, 'nope')).toBeNull()
  })
})

describe('moving an opening by a typed distance', () => {
  const plans = plan([w(200, 100, 800, 100)], [door('a', -1, -4.02)])
  const spot = locateOpening(plans, 'a')!

  it('slides it along the wall to the typed centre', () => {
    const to = moveOpeningTo(spot, { x: -1, z: -4.02 }, 4.5, true)
    expect(to.x).toBeCloseTo(1.5, 6)
    expect(to.distM).toBeCloseTo(4.5, 6)
  })

  it('keeps its small offset off the centreline, so nothing else moves', () => {
    const to = moveOpeningTo(spot, { x: -1, z: -4.02 }, 4.5, true)
    expect(to.z).toBeCloseTo(-4.02, 6)
  })

  it('measures from the far end when asked', () => {
    const to = moveOpeningTo(spot, { x: -1, z: -4.02 }, 1, false)
    expect(to.x).toBeCloseTo(2, 6)
  })

  it('never hangs the opening off the end of the wall', () => {
    const half = spot.widthM / 2
    expect(moveOpeningTo(spot, { x: -1, z: -4 }, 0, true).distM).toBeCloseTo(half, 6)
    expect(moveOpeningTo(spot, { x: -1, z: -4 }, 99, true).distM).toBeCloseTo(6 - half, 6)
  })

  it('lands where the framing plan then reads it back', () => {
    const to = moveOpeningTo(spot, { x: -1, z: -4.02 }, 1.2, true)
    const again = locateOpening(plan([w(200, 100, 800, 100)], [door('a', to.x, to.z)]), 'a')!
    expect(centreFromEnd(again, true)).toBeCloseTo(1.2, 6)
  })
})

describe('at a corner the tape hooks on the outside face', () => {
  // An L meeting at the left end: the framed wall starts half a thickness early.
  const plans = plan([w(200, 100, 800, 100), w(200, 100, 200, 600)], [door('a', -1, -4)])
  const spot = locateOpening(plans, 'a')!

  it('counts the corner extension in the distance', () => {
    const ext = spot.wall.thicknessM / 2
    expect(centreFromEnd(spot, true)).toBeCloseTo(2 + ext, 6)
  })
})
