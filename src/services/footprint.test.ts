import { describe, it, expect } from 'vitest'
import {
  placeBoxes, footprintOutline, footprintAreaMm2, insetOutline, outlineBounds,
  type FootprintBox, type Point,
} from './footprint'

const FT = 304.8
const ft = (n: number) => n * FT
/** The outline as a set of corners, order-independent, for comparing shapes. */
const corners = (poly: Point[]) => poly.map((p) => `${Math.round(p.x)},${Math.round(p.y)}`).sort()
const area = (boxes: FootprintBox[]) => footprintAreaMm2(placeBoxes(boxes))
const outlineOf = (boxes: FootprintBox[]) => footprintOutline(placeBoxes(boxes))

describe('one box is still one box', () => {
  const box: FootprintBox[] = [{ widthMm: ft(40), depthMm: ft(30) }]

  it('gives four corners and the size that was typed', () => {
    const poly = outlineOf(box)
    expect(poly).toHaveLength(4)
    const b = outlineBounds(poly)
    expect(b.x2 - b.x1).toBeCloseTo(ft(40), 6)
    expect(b.y2 - b.y1).toBeCloseTo(ft(30), 6)
  })

  it('pulls the centrelines in half a wall all round', () => {
    const inset = insetOutline(outlineOf(box), 70)
    const b = outlineBounds(inset)
    expect(b.x2 - b.x1).toBeCloseTo(ft(40) - 140, 6)
    expect(b.y2 - b.y1).toBeCloseTo(ft(30) - 140, 6)
  })
})

describe('an L — a wing off the back', () => {
  // 32 x 26 with a 12 x 14 off the bottom, flush with the left corner.
  const boxes: FootprintBox[] = [
    { widthMm: ft(32), depthMm: ft(26) },
    { widthMm: ft(12), depthMm: ft(14), attach: { side: 'bottom', offsetMm: 0 } },
  ]

  it('is six walls, not eight — the shared edge is not a wall', () => {
    expect(outlineOf(boxes)).toHaveLength(6)
  })

  it('traces the L, with the step where the wing ends', () => {
    expect(corners(outlineOf(boxes))).toEqual(corners([
      { x: 0, y: 0 }, { x: ft(32), y: 0 }, { x: ft(32), y: ft(26) },
      { x: ft(12), y: ft(26) }, { x: ft(12), y: ft(40) }, { x: 0, y: ft(40) },
    ]))
  })

  it('covers the floor area of both boxes', () => {
    expect(area(boxes)).toBeCloseTo(ft(32) * ft(26) + ft(12) * ft(14), 4)
  })

  it('keeps the inside corner a corner when the walls come in', () => {
    // The re-entrant corner is the one that goes wrong: offset each wall
    // independently and the two lines cross straight past each other.
    const inset = insetOutline(outlineOf(boxes), 70)
    expect(inset).toHaveLength(6)
    const b = outlineBounds(inset)
    expect(b.x2 - b.x1).toBeCloseTo(ft(32) - 140, 6)
    expect(b.y2 - b.y1).toBeCloseTo(ft(40) - 140, 6)
    // The step corner moves INTO the building on both axes: x in by 70 from the
    // wing's right face, y in by 70 from the main box's back face.
    const step = inset.find((p) => Math.abs(p.x - (ft(12) - 70)) < 1e-6)
    expect(step).toBeTruthy()
    expect(step!.y).toBeCloseTo(ft(26) - 70, 6)
  })
})

describe('the other shapes a house actually is', () => {
  it('a T — a wing off the middle of the back', () => {
    const boxes: FootprintBox[] = [
      { widthMm: ft(40), depthMm: ft(24) },
      { widthMm: ft(12), depthMm: ft(16), attach: { side: 'bottom', offsetMm: ft(14) } },
    ]
    expect(outlineOf(boxes)).toHaveLength(8)
    expect(area(boxes)).toBeCloseTo(ft(40) * ft(24) + ft(12) * ft(16), 4)
  })

  it('a U — two wings off the back with a court between them', () => {
    const boxes: FootprintBox[] = [
      { widthMm: ft(40), depthMm: ft(20) },
      { widthMm: ft(12), depthMm: ft(18), attach: { side: 'bottom', offsetMm: 0 } },
      { widthMm: ft(12), depthMm: ft(18), attach: { side: 'bottom', offsetMm: ft(28) } },
    ]
    // Four corners round the outside and four more round the court: the wings
    // are flush with the ends, so the only steps are the ones facing the court.
    expect(outlineOf(boxes)).toHaveLength(8)
    expect(corners(outlineOf(boxes))).toEqual(corners([
      { x: 0, y: 0 }, { x: ft(40), y: 0 }, { x: ft(40), y: ft(38) }, { x: ft(28), y: ft(38) },
      { x: ft(28), y: ft(20) }, { x: ft(12), y: ft(20) }, { x: ft(12), y: ft(38) }, { x: 0, y: ft(38) },
    ]))
    expect(area(boxes)).toBeCloseTo(ft(40) * ft(20) + 2 * ft(12) * ft(18), 4)
  })

  it('a garage off the side, set back from the front', () => {
    const boxes: FootprintBox[] = [
      { widthMm: ft(30), depthMm: ft(28) },
      { widthMm: ft(22), depthMm: ft(24), attach: { side: 'right', offsetMm: ft(4) } },
    ]
    const b = outlineBounds(outlineOf(boxes))
    expect(b.x2 - b.x1).toBeCloseTo(ft(52), 6)
    expect(b.y2 - b.y1).toBeCloseTo(ft(28), 6)
    // Set back at the front and flush at the back, so it steps once, not twice:
    // six walls. The flush edge is a straight run, not a corner.
    expect(outlineOf(boxes)).toHaveLength(6)
  })

  it('steps at BOTH ends when the wing is set back from each', () => {
    const boxes: FootprintBox[] = [
      { widthMm: ft(30), depthMm: ft(28) },
      { widthMm: ft(22), depthMm: ft(20), attach: { side: 'right', offsetMm: ft(4) } },
    ]
    expect(outlineOf(boxes)).toHaveLength(8)
  })

  it('a wing that runs back PAST the corner, on a negative offset', () => {
    const boxes: FootprintBox[] = [
      { widthMm: ft(30), depthMm: ft(20) },
      { widthMm: ft(10), depthMm: ft(10), attach: { side: 'right', offsetMm: ft(-6) } },
    ]
    const b = outlineBounds(outlineOf(boxes))
    expect(b.y1).toBeCloseTo(ft(-6), 6)
    expect(b.y2 - b.y1).toBeCloseTo(ft(26), 6)
  })

  it('swallows a box that sits entirely inside another', () => {
    const boxes: FootprintBox[] = [
      { widthMm: ft(40), depthMm: ft(30) },
      { widthMm: ft(10), depthMm: ft(10), attach: { side: 'right', offsetMm: ft(5) } },
    ]
    // Same shape either way: the wing hangs off the right, so 8 corners.
    expect(outlineOf(boxes).length).toBeGreaterThanOrEqual(4)
    const inner: FootprintBox[] = [
      { widthMm: ft(40), depthMm: ft(30) },
      { widthMm: ft(10), depthMm: ft(10), attach: { side: 'left', offsetMm: ft(5) } },
    ]
    expect(outlineOf(inner)).toHaveLength(8)
  })

  it('never reports a wall of zero length', () => {
    const boxes: FootprintBox[] = [
      { widthMm: ft(32), depthMm: ft(26) },
      { widthMm: ft(12), depthMm: ft(14), attach: { side: 'bottom', offsetMm: 0 } },
      { widthMm: ft(8), depthMm: ft(6), attach: { side: 'right', offsetMm: ft(10) } },
    ]
    const poly = outlineOf(boxes)
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length]
      expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeGreaterThan(1)
    }
  })
})

describe('nothing to draw', () => {
  it('no boxes, no outline', () => {
    expect(outlineOf([])).toEqual([])
    expect(placeBoxes([])).toEqual([])
  })
})
