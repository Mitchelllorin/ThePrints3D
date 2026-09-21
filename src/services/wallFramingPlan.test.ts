import { describe, it, expect } from 'vitest'
import { planWalls, teeArrivals, overlayPixelToWorld, type WallPlanInput } from './wallFramingPlan'
import type { Drawing, ParsedWall, PlacedObject } from '../types'

const IN = 1 / 0.0254

/** A wall in print pixels. 1000px across the sheet maps to 10m, so 1px = 10mm. */
const w = (x1: number, y1: number, x2: number, y2: number, extra: Partial<ParsedWall> = {}): ParsedWall =>
  ({ x1, y1, x2, y2, thickness: 10, source: 'user', framingType: 'wood-2x4', ...extra } as unknown as ParsedWall)

const drawing = (walls: ParsedWall[]): Drawing =>
  ({ id: 'd1', parsedWalls: walls, parsedOpenings: [], rasterWidth: 1000, rasterHeight: 1000,
    scaleMmPerPx: 10, floorNumber: 0 } as unknown as Drawing)

const input = (walls: ParsedWall[], placedObjects: PlacedObject[] = []): WallPlanInput => ({
  drawings: [drawing(walls)],
  overlay: { drawingId: 'd1', scale: [10, 10], rotationDeg: 0, position: [0, 0] },
  placedObjects,
  ceilingM: 2.44,
  storeyM: 2.76,
  framingMaterial: 'wood',
  steelGauge: '25',
  steelTrackTop: 'slotted',
  steelDeflectionGapMm: 19,
  studSpacingIn: 16,
})

describe('the overlay transform', () => {
  it('puts the middle of the sheet at the overlay position', () => {
    const p = overlayPixelToWorld({ drawingId: 'd1', scale: [10, 10], rotationDeg: 0, position: [2, 3] }, 1000, 1000)
    expect(p(500, 500)).toEqual({ x: 2, z: 3 })
    expect(p(1000, 500).x).toBeCloseTo(7, 6)
  })

  it('turns with the overlay', () => {
    const p = overlayPixelToWorld({ drawingId: 'd1', scale: [10, 10], rotationDeg: 90, position: [0, 0] }, 1000, 1000)
    const q = p(1000, 500)          // +5m along local X
    expect(q.x).toBeCloseTo(0, 6)
    expect(q.z).toBeCloseTo(-5, 6)  // a +Y rotation swings local X to -Z
  })
})

describe('corners: one wall runs through, the other butts into it', () => {
  // An L: one wall east-west, one north-south, meeting at (100,100).
  const plans = planWalls(input([w(100, 100, 600, 100), w(100, 100, 100, 500)]))

  it('gives the two walls opposite modes at the shared end', () => {
    expect(plans[0].opts.capLap?.start).toBe('lap')   // the east-west wall runs through
    expect(plans[1].opts.capLap?.start).toBe('back')  // the north-south one butts in
  })

  it('extends only the ends that meet something', () => {
    // 500px = 5m of traced line, plus half a wall thickness at the corner end.
    expect(plans[0].length).toBeCloseTo(5 + plans[0].thicknessM / 2, 6)
    expect(plans[0].opts.endTrim).toBeUndefined()
  })

  it('frames at the wall type thickness, not the traced line width', () => {
    expect(plans[0].thicknessM * IN).toBeCloseTo(3.5, 2)
  })
})

describe('tees: the arriving wall stops at the face it lands on', () => {
  //  ── host ──  with a partition arriving at its middle from below.
  const host = w(0, 100, 1000, 100)
  const partition = w(500, 100, 500, 600)

  it('reports which wall an end lands on', () => {
    const arr = teeArrivals([host, partition])
    expect(arr[1].start).toBe(0)     // the partition's first end lands on the host
    expect(arr[1].end).toBe(-1)
    expect(arr[0].start).toBe(-1)    // the host arrives nowhere
  })

  it('trims the arriving wall by half the host thickness', () => {
    const plans = planWalls(input([host, partition]))
    expect(plans[1].opts.endTrim?.start).toBeCloseTo(plans[0].thicknessM / 2, 6)
    // And the host carries the pack, measured along its own framed length.
    expect(plans[0].opts.tees?.[0]).toBeCloseTo(5, 6)
  })

  it('leaves a lone wall untrimmed', () => {
    const plans = planWalls(input([w(0, 100, 1000, 100)]))
    expect(plans[0].opts.endTrim).toBeUndefined()
    expect(plans[0].opts.tees).toEqual([])
  })
})

describe('openings land where they were placed', () => {
  const door = ({
    id: 'o1', type: 'door', x: 0, z: -4, rotationY: 0, scaleX: 1, scaleY: 1, scaleZ: 1,
    label: 'Door', level: 0,
  } as unknown as PlacedObject)

  it('measures an opening from the framed start of the wall', () => {
    // Wall along the top of the sheet: pixels 100..900 → world x -4..4, z -4.
    const plans = planWalls(input([w(100, 100, 900, 100)], [door]))
    const op = plans[0].opts.openings?.[0]
    expect(op).toBeTruthy()
    // The door sits at world x=0, which is the middle of an 8m wall.
    expect(op!.centerM).toBeCloseTo(4, 2)
    expect(op!.type).toBe('door')
  })

  it('carries the stud spacing the settings ask for', () => {
    const plans = planWalls({ ...input([w(100, 100, 900, 100)]), studSpacingIn: 24 })
    expect(plans[0].opts.spacingM).toBeCloseTo(24 * 0.0254, 6)
  })
})

describe('nothing to plan', () => {
  it('returns nothing for a drawing with no walls', () => {
    expect(planWalls(input([]))).toEqual([])
  })
})

describe('a tub gets its two L\'s, the way the panel layout frames an alcove', () => {
  // An 8 m wall along world z = 0 (pixel y = 500), from x = -4 to +4.
  const back = w(100, 500, 900, 500)
  // A 60 x 30 tub, its back against that wall's face, centred on the wall.
  const tub = (): PlacedObject => ({
    id: 't1', type: 'bathtub', x: 0, z: 0.762 / 2 + 0.0445, rotationY: 0,
    scaleX: 1, scaleZ: 1, scaleY: 1, label: 'Bathtub', level: 0,
  } as PlacedObject)
  // The alcove is the tub plus an inch; each pack's inner face is the alcove face.
  const half = (1.524 + 0.0254) / 2 + 0.0381

  it('frames a pack at each end of the alcove on the wall behind it', () => {
    const packs = planWalls(input([back], [tub()]))[0].opts.packs ?? []
    expect(packs).toHaveLength(2)
    const at = packs.map((p) => p.atM).sort((a, b) => a - b)
    expect(at[0]).toBeCloseTo(4 - half, 3)
    expect(at[1]).toBeCloseTo(4 + half, 3)
    expect(packs.every((p) => p.studs === 2)).toBe(true)
  })

  it('adds nothing where the end walls are drawn — each lands as a tee, and a tee is the L', () => {
    const endX = (1.524 + 0.0254) / 2 + 0.0445           // end wall centreline, metres off centre
    const px = (m: number) => 500 + m * 100
    const walls = [back, w(px(-endX), 500, px(-endX), 580), w(px(endX), 500, px(endX), 580)]
    const plan = planWalls(input(walls, [tub()]))[0]
    expect(plan.opts.tees).toHaveLength(2)
    expect(plan.opts.packs ?? []).toHaveLength(0)
  })

  it('leaves a wall with no tub alone', () => {
    expect(planWalls(input([back]))[0].opts.packs ?? []).toHaveLength(0)
  })
})
