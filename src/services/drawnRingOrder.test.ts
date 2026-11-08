/**
 * THE ORDER A DRAWN RING COMES OUT AS.
 *
 * A circle is framed as a ring of short straight walls, and the thing that goes
 * wrong in a ring is not the geometry — it is the facilities. Every break is one
 * joint, so it gets one stud; the ring closes on itself, so the last break is
 * served by the first chord's start and must not be served twice. That doubling
 * is invisible on screen — the model just has two studs standing on top of each
 * other — and shows up on the lumber order as one extra stud per ring, which is
 * the kind of error nobody catches on a quote.
 *
 * So this walks the whole way out: circle -> sheet -> walls -> framing -> cut
 * list -> buy list -> board feet, and holds the order to what the ring actually
 * needs.
 */
import { describe, it, expect } from 'vitest'
import { circleString } from './drawItPlan'
import { createDrawnProject } from './drawnProject'
import { planWalls, type WallPlanInput } from './wallFramingPlan'
import { cutListForWalls, buyList, orderBoardFeet } from './cutList'
import type { Drawing } from '../types'

const FT_MM = 304.8

/** A ring drawn on a sheet and built the way Draw it builds one. */
function ringOrder(diameterFt: number) {
  const ring = circleString({ cx: 12000, cy: 12000, r: (diameterFt * FT_MM) / 2 })
  const project = createDrawnProject({
    widthMm: 24000, depthMm: 24000, wallTypeKey: 'wood-2x4', floor: 'none',
    freeWalls: ring.walls,
  })
  const drawings = [project.drawing as unknown as Drawing]
  const plans = planWalls({
    drawings,
    overlay: { drawingId: null, scale: project.overlayScale, rotationDeg: 0, position: [0, 0] },
    placedObjects: [],
    ceilingM: 2.44, storeyM: 2.76,
    framingMaterial: 'wood', steelGauge: '25', steelTrackTop: 'slotted', steelDeflectionGapMm: 19,
    studSpacingIn: 16,
  } as WallPlanInput)
  const walls = cutListForWalls(plans)
  const buy = buyList(walls)
  const qty = (role: string) =>
    walls.flatMap((w) => w.lines).filter((l) => l.role === role).reduce((n, l) => n + l.qty, 0)
  return { ring, plans, walls, buy, bf: orderBoardFeet(buy), qty }
}

describe('the order a drawn ring comes out as', () => {
  it('stands the ring up as the chords it was drawn as', () => {
    for (const dia of [4, 8, 20]) {
      const o = ringOrder(dia)
      expect(o.plans).toHaveLength(o.ring.chords)
      expect(o.plans.every((p) => p.wall.bend === true || p.wall.sharedStartStud === true)).toBe(true)
    }
  })

  it('opens no corner, header or jack — there is no corner in a ring', () => {
    const o = ringOrder(8)
    expect(o.qty('king stud')).toBe(0)
    expect(o.qty('jack stud')).toBe(0)
    expect(o.qty('header')).toBe(0)
  })

  it('puts ONE stud at every break, at every size', () => {
    // The bug this holds shut: chord one framed both of its ends while every
    // other chord shared its start, so the break where the ring meets itself
    // carried two studs — one more stud than the ring has joints.
    for (const dia of [4, 8, 20]) {
      const o = ringOrder(dia)
      expect(o.qty('stud')).toBe(o.ring.chords)
    }
  })

  it('orders a stick for every stud in the ring, and the waste on top', () => {
    for (const dia of [4, 8, 20]) {
      const o = ringOrder(dia)
      const studs = o.buy.filter((b) => b.category === 'studs')
      expect(studs.reduce((n, b) => n + b.needed, 0)).toBe(o.ring.chords)
      expect(studs.reduce((n, b) => n + b.order, 0)).toBe(Math.ceil(o.ring.chords * 1.1 - 1e-9))
    }
  })

  it('cuts four plate pieces per chord — two bottom, one top, one cap', () => {
    for (const dia of [4, 8, 20]) {
      const o = ringOrder(dia)
      expect(o.qty('bottom plate') + o.qty('top plate') + o.qty('cap plate')).toBe(o.ring.chords * 4)
    }
  })

  it('holds the bay inside a stud space, however big the ring gets', () => {
    // The BAY is what is clamped to 16"; the chord is that bay shared out over a
    // whole number of walls, so it comes out a hair over or under the target —
    // 407.2 mm at a 20 ft ring, 0.2% long. Anything past a percent means the
    // count and the bay have come apart.
    for (const dia of [4, 8, 20, 60]) {
      const o = ringOrder(dia)
      expect(o.ring.chordMm).toBeLessThanOrEqual(406.4 * 1.01)
      expect(o.ring.chords).toBeGreaterThanOrEqual(8)
    }
  })

  it('a bigger ring never orders less lumber than a smaller one', () => {
    const sizes = [4, 8, 20].map((dia) => ringOrder(dia))
    for (let i = 1; i < sizes.length; i++) {
      expect(sizes[i].ring.chords).toBeGreaterThan(sizes[i - 1].ring.chords)
      expect(sizes[i].bf.total).toBeGreaterThan(sizes[i - 1].bf.total)
    }
  })

  it('totals the ring in board feet, and 2x4 is all sawn', () => {
    const o = ringOrder(8)
    expect(o.bf.total).toBeGreaterThan(0)
    expect(o.bf.notCounted).toEqual([])
  })
})
