import { describe, it, expect } from 'vitest'
import { seatInGap, type Seg2 } from './openingSeat'

// A 10 m wall along X with a 0.9 m doorway left in it at x = 5.
const LEFT: Seg2 = { ax: 0, az: 0, bx: 4.55, bz: 0 }
const RIGHT: Seg2 = { ax: 5.45, az: 0, bx: 10, bz: 0 }
const WALL_WITH_GAP = [LEFT, RIGHT]

describe('seating an opening into a gap already in the wall', () => {
  it('finds the gap centre when you drop anywhere near it', () => {
    const seat = seatInGap(5, 0, WALL_WITH_GAP)!
    expect(seat).not.toBeNull()
    expect(seat.x).toBeCloseTo(5, 6)
    expect(seat.z).toBeCloseTo(0, 6)
    expect(seat.widthM).toBeCloseTo(0.9, 6)
  })

  it('seats from an off-centre, sloppy drop — the whole point', () => {
    // Dropped a metre short and half a metre off the wall. Snapping to a
    // centreline would have slid this onto the end of the left run instead.
    const seat = seatInGap(4.2, 0.5, WALL_WITH_GAP)!
    expect(seat.x).toBeCloseTo(5, 6)
    expect(seat.z).toBeCloseTo(0, 6)
  })

  it('aligns with the wall run so the door sits IN the wall', () => {
    expect(seatInGap(5, 0, WALL_WITH_GAP)!.yaw).toBeCloseTo(0, 6)
    // Same wall turned 90°: the yaw follows it.
    const vert: Seg2[] = [
      { ax: 0, az: 0, bx: 0, bz: 4.55 },
      { ax: 0, az: 5.45, bx: 0, bz: 10 },
    ]
    expect(Math.abs(seatInGap(0, 5, vert)!.yaw)).toBeCloseTo(Math.PI / 2, 6)
  })

  it('ignores a drop that is nowhere near the gap', () => {
    expect(seatInGap(1, 0, WALL_WITH_GAP)).toBeNull()
    expect(seatInGap(5, 4, WALL_WITH_GAP)).toBeNull()
  })

  it('does not treat a butt joint as an opening', () => {
    // Two runs meeting with a 20mm sliver is a joint, not a doorway.
    const butted: Seg2[] = [
      { ax: 0, az: 0, bx: 4.99, bz: 0 },
      { ax: 5.01, az: 0, bx: 10, bz: 0 },
    ]
    expect(seatInGap(5, 0, butted)).toBeNull()
  })

  it('does not treat a whole missing wall as an opening', () => {
    const wide: Seg2[] = [
      { ax: 0, az: 0, bx: 2, bz: 0 },
      { ax: 12, az: 0, bx: 14, bz: 0 },
    ]
    expect(seatInGap(7, 0, wide)).toBeNull()
  })

  it('ignores two walls that merely pass near each other', () => {
    // A corner: perpendicular runs whose ends are close. Not one wall, so not a
    // gap in one — putting a door "in" it would be nonsense.
    const corner: Seg2[] = [
      { ax: 0, az: 0, bx: 4.5, bz: 0 },
      { ax: 5.4, az: 0, bx: 5.4, bz: 4 },
    ]
    expect(seatInGap(5, 0, corner)).toBeNull()
  })

  it('ignores a parallel wall on the other side of the room', () => {
    // Same direction, but 3 m away — a different wall, not a gap in this one.
    const offset: Seg2[] = [
      { ax: 0, az: 0, bx: 4.5, bz: 0 },
      { ax: 5.4, az: 3, bx: 10, bz: 3 },
    ]
    expect(seatInGap(5, 1.5, offset)).toBeNull()
  })

  it('picks the nearer gap when a wall has two', () => {
    const two: Seg2[] = [
      { ax: 0, az: 0, bx: 3.55, bz: 0 },
      { ax: 4.45, az: 0, bx: 7.55, bz: 0 },
      { ax: 8.45, az: 0, bx: 12, bz: 0 },
    ]
    expect(seatInGap(4.2, 0, two)!.x).toBeCloseTo(4, 6)
    expect(seatInGap(8.2, 0, two)!.x).toBeCloseTo(8, 6)
  })
})
