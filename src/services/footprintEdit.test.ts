import { describe, expect, it } from 'vitest'
import {
  MIN_BOX_MM, MIN_OVERLAP_MM, cornerShift, dimensionLanes, dragBoxes, normalizeBoxes, snapTo, typeBoxSize, typeOffset,
} from './footprintEdit'
import { placeBoxes, type FootprintBox } from './footprint'

const FT = 304.8
const main = (w: number, d: number): FootprintBox => ({ widthMm: w, depthMm: d })
const wing = (w: number, d: number, side: 'left' | 'right' | 'top' | 'bottom', off = 0): FootprintBox =>
  ({ widthMm: w, depthMm: d, attach: { side, offsetMm: off } })

describe('dragging the main box', () => {
  it('pulls the right edge out and the width follows', () => {
    const out = dragBoxes([main(12000, 9000)], { box: 0, kind: 'w' }, 1000, 0, 100)
    expect(out[0].widthMm).toBe(13000)
    expect(out[0].depthMm).toBe(9000)
  })

  it('pulls the corner and both sizes follow', () => {
    const out = dragBoxes([main(12000, 9000)], { box: 0, kind: 'wd' }, 500, -1000, 100)
    expect(out[0]).toMatchObject({ widthMm: 12500, depthMm: 8000 })
  })

  it('snaps to 6 inches in feet-and-inches, so a finger lands on 40′ 6″ not 40′ 5 7/8″', () => {
    const start = [main(40 * FT, 30 * FT)]
    const out = dragBoxes(start, { box: 0, kind: 'w' }, 0.5 * FT - 3, 0, 6 * 25.4)
    expect(out[0].widthMm / 25.4).toBeCloseTo(40 * 12 + 6, 6)
  })

  it('measures from where the drag started, so a slow drag does not creep', () => {
    // Forty frames of a quarter-inch each is ten inches; snapped to 6″ that is
    // one step, not zero. Accumulating the snapped value per frame would round
    // every frame down to nothing and the edge would never move.
    const start = [main(40 * FT, 30 * FT)]
    const out = dragBoxes(start, { box: 0, kind: 'w' }, 40 * 0.25 * 25.4, 0, 6 * 25.4)
    expect(out[0].widthMm / 25.4).toBeCloseTo(40 * 12 + 12, 6)
  })

  it('will not go below the smallest box', () => {
    const out = dragBoxes([main(3000, 3000)], { box: 0, kind: 'w' }, -9000, 0, 100)
    expect(out[0].widthMm).toBe(MIN_BOX_MM)
  })

  it('pulls the LEFT edge out to the left and the width follows', () => {
    const out = dragBoxes([main(12000, 9000)], { box: 0, kind: 'w', fromLeft: true }, -1000, 0, 100)
    expect(out[0].widthMm).toBe(13000)
  })

  it('pulls the TOP edge up and the depth follows', () => {
    const out = dragBoxes([main(12000, 9000)], { box: 0, kind: 'd', fromTop: true }, 0, -1500, 100)
    expect(out[0].depthMm).toBe(10500)
  })

  it('pulls the top-left corner and both follow, outward', () => {
    const out = dragBoxes([main(12000, 9000)], { box: 0, kind: 'wd', fromLeft: true, fromTop: true }, -500, 1000, 100)
    expect(out[0]).toMatchObject({ widthMm: 12500, depthMm: 8000 })
  })

  it('pulling the left edge leaves a section on the back wall where it was on the ground', () => {
    const start = [main(12000, 9000), wing(4000, 3000, 'bottom', 2000)]
    const out = dragBoxes(start, { box: 0, kind: 'w', fromLeft: true }, -1000, 0, 100)
    const before = placeBoxes(start)[1], after = placeBoxes(out)[1]
    const shift = cornerShift(start, out, { box: 0, kind: 'w', fromLeft: true })
    // The plan origin moved left by the growth; the section did not move on the ground.
    expect(after.x1 - shift.xMm).toBeCloseTo(before.x1, 6)
    expect(shift.xMm).toBe(1000)
  })

  it('pulling the top edge leaves a section on the right wall where it was', () => {
    const start = [main(12000, 9000), wing(4000, 3000, 'right', 2000)]
    const grip = { box: 0, kind: 'd' as const, fromTop: true }
    const out = dragBoxes(start, grip, 0, -1000, 100)
    const shift = cornerShift(start, out, grip)
    expect(placeBoxes(out)[1].y1 - shift.yMm).toBeCloseTo(placeBoxes(start)[1].y1, 6)
  })

  it('a right or bottom edge does not move the corner', () => {
    const start = [main(12000, 9000)]
    const out = dragBoxes(start, { box: 0, kind: 'wd' }, 1000, 1000, 100)
    expect(cornerShift(start, out, { box: 0, kind: 'wd' })).toEqual({ xMm: 0, yMm: 0 })
  })
})

describe('dragging a section grows it OUTWARD, whichever side it hangs off', () => {
  it('a section on the left grows when pulled left', () => {
    const out = dragBoxes([main(12000, 9000), wing(3000, 4000, 'left')], { box: 1, kind: 'w' }, -1000, 0, 100)
    expect(out[1].widthMm).toBe(4000)
    // and its outer edge really did move left, under the finger
    expect(placeBoxes(out)[1].x1).toBe(-4000)
  })

  it('a section on top (the front) grows when pulled up', () => {
    const out = dragBoxes([main(12000, 9000), wing(4000, 3000, 'top')], { box: 1, kind: 'd' }, 0, -1000, 100)
    expect(out[1].depthMm).toBe(4000)
    expect(placeBoxes(out)[1].y1).toBe(-4000)
  })

  it('a section on the right grows when pulled right', () => {
    const out = dragBoxes([main(12000, 9000), wing(3000, 4000, 'right')], { box: 1, kind: 'w' }, 1000, 0, 100)
    expect(out[1].widthMm).toBe(4000)
  })
})

describe('a section corner grip', () => {
  it('changes both sizes at once, outward from whichever side it hangs off', () => {
    const left = dragBoxes([main(12000, 9000), wing(3000, 4000, 'left')], { box: 1, kind: 'wd' }, -1000, 500, 100)
    expect(left[1]).toMatchObject({ widthMm: 4000, depthMm: 4500 })
    const top = dragBoxes([main(12000, 9000), wing(3000, 4000, 'top')], { box: 1, kind: 'wd' }, 1000, -500, 100)
    expect(top[1]).toMatchObject({ widthMm: 4000, depthMm: 4500 })
  })
})

describe('sliding a section along its side', () => {
  it('slides down the wall it hangs off on the right', () => {
    const out = dragBoxes([main(12000, 9000), wing(3000, 4000, 'right', 0)], { box: 1, kind: 'slide' }, 800, 2000, 100)
    // the sideways part of the drag is ignored — it slides along the wall, not off it
    expect(out[1].attach?.offsetMm).toBe(2000)
  })

  it('cannot be slid off the end of the wall', () => {
    const out = dragBoxes([main(12000, 9000), wing(3000, 4000, 'right', 0)], { box: 1, kind: 'slide' }, 0, 50000, 100)
    // still shares at least the minimum of the main box's side
    expect(out[1].attach?.offsetMm).toBe(9000 - MIN_OVERLAP_MM)
  })

  it('cannot be slid off the start of the wall either', () => {
    const out = dragBoxes([main(12000, 9000), wing(3000, 4000, 'bottom', 0)], { box: 1, kind: 'slide' }, -50000, 0, 100)
    expect(out[1].attach?.offsetMm).toBe(MIN_OVERLAP_MM - 3000)
  })
})

describe('shrinking the main box keeps its sections attached', () => {
  it('pulls a section back when the wall it hung off gets shorter', () => {
    const start = [main(12000, 9000), wing(3000, 4000, 'right', 6000)]
    const out = dragBoxes(start, { box: 0, kind: 'd' }, 0, -5000, 100)
    expect(out[0].depthMm).toBe(4000)
    expect(out[1].attach?.offsetMm).toBe(4000 - MIN_OVERLAP_MM)
  })
})

describe('typing a size exact', () => {
  it('is not snapped — a typed number is the number you meant', () => {
    const out = typeBoxSize([main(12000, 9000)], 0, 'w', 12345)
    expect(out[0].widthMm).toBe(12345)
  })

  it('types a section offset, including one that runs back past the corner', () => {
    const out = typeOffset([main(12000, 9000), wing(3000, 4000, 'bottom', 0)], 1, -1200)
    expect(out[1].attach?.offsetMm).toBe(-1200)
  })

  it('still keeps a typed offset on the wall', () => {
    const out = typeOffset([main(12000, 9000), wing(3000, 4000, 'bottom', 0)], 1, 99999)
    expect(out[1].attach?.offsetMm).toBe(12000 - MIN_OVERLAP_MM)
  })
})

describe('snapTo', () => {
  it('rounds to the nearest step and leaves a zero step alone', () => {
    expect(snapTo(149, 100)).toBe(100)
    expect(snapTo(151, 100)).toBe(200)
    expect(snapTo(123.4, 0)).toBe(123.4)
  })

  it('normalises an empty list to an empty list', () => {
    expect(normalizeBoxes([])).toEqual([])
  })
})

describe('dimension lanes', () => {
  it('puts a lone building\'s two dimensions in the first lane, top and left', () => {
    const { lanes, count } = dimensionLanes([main(12000, 9000)])
    expect(lanes[0]).toEqual({ w: { side: 'top', lane: 0 }, d: { side: 'left', lane: 0 } })
    expect(count).toEqual({ top: 1, bottom: 0, left: 1, right: 0 })
  })

  it('stacks a second dimension on the same edge one lane further out', () => {
    // A section on the left dimensions its depth on the left too — so it goes
    // one lane OUT from the main box's depth, not on top of it.
    const { lanes, count } = dimensionLanes([main(12000, 9000), wing(3000, 4000, 'left')])
    expect(lanes[0].d).toEqual({ side: 'left', lane: 0 })
    expect(lanes[1].d).toEqual({ side: 'left', lane: 1 })
    expect(count.left).toBe(2)
  })

  it('dimensions a section on the end of the building it is nearer', () => {
    // A section off the back at the LEFT end has its depth on the left, not on
    // the far right beside the main box's corner where it reads as the main
    // box's depth.
    const leftEnd = dimensionLanes([main(12000, 9000), wing(3000, 4000, 'bottom', 0)])
    expect(leftEnd.lanes[1].w).toEqual({ side: 'bottom', lane: 0 })
    expect(leftEnd.lanes[1].d.side).toBe('left')
    const rightEnd = dimensionLanes([main(12000, 9000), wing(3000, 4000, 'bottom', 9000)])
    expect(rightEnd.lanes[1].d).toEqual({ side: 'right', lane: 0 })
  })

  it('chains two dimensions that run end to end onto one lane, the way a print does', () => {
    // Main depth runs 0 to 9000; a section off the back runs 9000 to 13000.
    // They do not overlap, so they share the first lane instead of stacking.
    const { lanes, count } = dimensionLanes([main(12000, 9000), wing(3000, 4000, 'bottom', 0)])
    expect(lanes[0].d).toEqual({ side: 'left', lane: 0 })
    expect(lanes[1].d).toEqual({ side: 'left', lane: 0 })
    expect(count.left).toBe(1)
  })

  it('counts the same every time it is asked', () => {
    const boxes = [main(12000, 9000), wing(3000, 4000, 'top')]
    expect(dimensionLanes(boxes)).toEqual(dimensionLanes(boxes))
  })
})
