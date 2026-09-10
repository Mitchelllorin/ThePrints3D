import { describe, it, expect } from 'vitest'
import { wallsFromRooms } from './wallsFromRooms'
import type { ParsedRoom } from '../types'

const room = (name: string, x1: number, y1: number, x2: number, y2: number): ParsedRoom =>
  ({ id: name, name, cx: (x1+x2)/2, cy: (y1+y2)/2, x1, y1, x2, y2,
     areaPx: (x2-x1)*(y2-y1), areaSqM: null } as ParsedRoom)

describe('wallsFromRooms', () => {
  it('gives a single room four walls', () => {
    const r = wallsFromRooms([room('KITCHEN', 0, 0, 200, 160)])
    expect(r.walls).toHaveLength(4)
  })

  it('collapses the wall two rooms share instead of stacking two', () => {
    // Kitchen and dining sharing the x=200 line: 8 edges, 7 walls, 1 shared.
    const r = wallsFromRooms([
      room('KITCHEN', 0, 0, 200, 160),
      room('DINING', 200, 0, 400, 160),
    ])
    expect(r.shared).toBe(1)
    expect(r.walls).toHaveLength(7)
  })

  /**
   * THE PARTY LINE, BUILT ONCE.
   *
   * Neighbours on a real plan share a LINE, not an edge. A deep living room
   * beside a stacked kitchen and bath all meet on x=200, in three different
   * spans. Keying edges on their exact coordinates collapsed none of them and
   * built the same wall three times, stacked on itself:
   *   [0→295.8], [0→132.6], [132.6→295.8]
   * That is why `sharedEdges` read 0 on print after print.
   */
  it('collapses a party line the neighbours share only partly', () => {
    const out = wallsFromRooms([
      room('LIVING', 0, 0, 200, 300),
      room('KITCHEN', 200, 0, 380, 130),
      room('BATH', 200, 130, 380, 300),
    ], 6, 400 * 320)
    const onLine = out.walls.filter((w) => w.x1 === w.x2 && Math.abs(w.x1 - 200) < out.snapPx)
    expect(onLine).toHaveLength(1)
    // And it spans the whole line, not just one room's share of it.
    const [party] = onLine
    expect(Math.abs(party.y1 - party.y2)).toBeGreaterThan(280)
  })

  /**
   * A GAP ON A LINE IS A DOORWAY, NOT A WALL.
   *
   * Merging must need real overlap. Two spans that merely touch end-to-end are
   * two rooms' walls meeting, and two spans with space between them are an
   * opening — neither is one wall counted twice.
   */
  it('does not join two spans that have a gap between them', () => {
    const out = wallsFromRooms([
      room('A', 0, 0, 100, 100),
      room('B', 0, 300, 100, 400),
    ], 6, 200 * 500)
    const right = out.walls.filter((w) => w.x1 === w.x2 && w.x1 > 50)
    expect(right).toHaveLength(2)
  })

  it('marks its output as inferred, not measured', () => {
    // The user has to be able to tell an estimate from a reading.
    const r = wallsFromRooms([room('BATH', 0, 0, 100, 90)])
    expect(r.walls.every((w) => w.roomDerived === true)).toBe(true)
  })

  it('closes: every endpoint meets another wall', () => {
    // The whole point — detected walls on the ADU screenshot enclosed nothing.
    const r = wallsFromRooms([room('LIVING', 0, 0, 300, 240)])
    const pts = r.walls.flatMap((w) => [[w.x1, w.y1], [w.x2, w.y2]] as const)
    for (const [x, y] of pts) {
      const touching = pts.filter((q) => q[0] === x && q[1] === y).length
      expect(touching).toBeGreaterThanOrEqual(2)
    }
  })

  it('snaps rooms that nearly line up onto one shared wall', () => {
    // Flood-filled rooms rarely agree to the pixel; a few px apart is one wall.
    const r = wallsFromRooms([
      room('A', 0, 0, 200, 160),
      room('B', 203, 0, 400, 160),
    ])
    expect(r.shared).toBe(1)
  })

  it('carries the drawing’s own wall thickness', () => {
    const r = wallsFromRooms([room('A', 0, 0, 200, 160)], 11)
    expect(r.walls.every((w) => w.thickness === 11)).toBe(true)
  })

  it('returns nothing when there are no usable rooms', () => {
    expect(wallsFromRooms([]).walls).toHaveLength(0)
  })

  /**
   * THE PORTLAND CASE.
   *
   * A permit booklet page with body text above the plan. `extractRooms`
   * returned 57 regions for a two-bedroom drawing — the tail of them
   * paragraphs of lettering at 0.05% of the page against a largest room of
   * 8.6% — and every one got four walls built around it. 228 fabricated walls
   * on top of 69 read off the ink, so the model was mostly text.
   */
  it('does not build walls around lettering', () => {
    const rooms = [
      room('big', 0, 0, 400, 300),
      room('real', 400, 0, 700, 300),
      // Text blobs: each well under a twentieth of the largest room.
      ...Array.from({ length: 20 }, (_, i) =>
        room(`text${i}`, i * 12, 400, i * 12 + 10, 406)),
    ]
    // 1000x600 page: the blobs are 60px² each, ~0.01% of it.
    const out = wallsFromRooms(rooms, 6, 1000 * 600)
    expect(out.rejected).toBe(20)
    // Two rooms sharing one edge: seven walls, not 88.
    expect(out.walls.length).toBeLessThanOrEqual(8)
  })

  it('keeps every room on a plan whose rooms are all real', () => {
    // The adu-71sqm shape: a large region and six smaller ones, none tiny.
    const rooms = [
      room('a', 0, 0, 600, 400),
      room('b', 600, 0, 800, 200),
      room('c', 600, 200, 800, 400),
      room('d', 0, 400, 300, 600),
    ]
    const out = wallsFromRooms(rooms, 6, 800 * 600)
    expect(out.rejected).toBe(0)
  })

  /**
   * ONE BIG SPACE MUST NOT CONDEMN THE SMALL ONES.
   *
   * The first cut at this measured each room against the LARGEST room, and the
   * largest is often the whole footprint read as a single region.
   * screenshot-studio-1bed lost five of its six rooms that way, and
   * bungalow-ukiah lost the room holding its enclosure together — 5 enclosed
   * regions down to 2. Real rooms are judged against the page, not against the
   * biggest thing on it.
   */
  it('keeps small real rooms on a plan that also has one very large region', () => {
    const page = 1000 * 1000
    const rooms = [
      room('footprint', 0, 0, 750, 750),   // 56% of the page, like adu-71sqm
      room('bath', 800, 0, 950, 150),      // 2.25%
      room('closet', 800, 200, 920, 320),  // 1.44%
    ]
    const out = wallsFromRooms(rooms, 6, page)
    expect(out.rejected).toBe(0)
  })
})
