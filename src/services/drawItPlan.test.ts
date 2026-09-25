import { describe, expect, it } from 'vitest'
import {
  acceptsWall, clipToShell, fitPage, houseRects, initialPlan, insideHouse, movedHouse, resized, snapWallPoint,
  withLength, wallLength, MIN_WALL_MM, PAGE_MARGIN_MM, type DrawItPlan,
} from './drawItPlan'

const plan = (): DrawItPlan => initialPlan({ widthMm: 12000, depthMm: 9000 })
const SNAP = { gridMm: 100, tolMm: 300, shellMm: 150 }

describe('the page', () => {
  it('starts with the house on paper, room all round', () => {
    const p = plan()
    const [r] = houseRects(p)
    expect(r).toEqual({ x1: PAGE_MARGIN_MM, y1: PAGE_MARGIN_MM, x2: PAGE_MARGIN_MM + 12000, y2: PAGE_MARGIN_MM + 9000 })
    expect(p.page.w).toBe(12000 + 2 * PAGE_MARGIN_MM)
  })

  it('grows when the house is pulled past it, and shifts so nothing is lost off the left', () => {
    const p = { ...plan(), origin: { x: 100, y: 100 } }
    const q = fitPage(p)
    expect(q.origin.x).toBeGreaterThan(100)
    expect(q.page.w).toBeGreaterThan(p.page.w)
  })

  it('never shrinks', () => {
    const p = plan()
    expect(fitPage(p)).toBe(p)
  })
})

describe('moving the house', () => {
  it('moves the house and the walls inside it together', () => {
    const p = { ...plan(), walls: [{ x1: 8000, y1: 7000, x2: 8000, y2: 12000 }] }
    const q = movedHouse(p, 1000, -500, 100)
    expect(q.origin).toEqual({ x: p.origin.x + 1000, y: p.origin.y - 500 })
    expect(q.walls[0]).toEqual({ x1: 9000, y1: 6500, x2: 9000, y2: 11500 })
  })

  it('stays on the paper', () => {
    const q = movedHouse(plan(), -1e6, 1e6, 100)
    const [r] = houseRects(q)
    expect(r.x1).toBeGreaterThanOrEqual(0)
    expect(r.y2).toBeLessThanOrEqual(q.page.d)
  })
})

describe('pulling a wall of the outline', () => {
  it('pulling the left wall out leaves the right wall and every inside wall where they were', () => {
    const p = { ...plan(), walls: [{ x1: 9000, y1: 7000, x2: 9000, y2: 12000 }] }
    const grip = { box: 0, kind: 'w' as const, fromLeft: true }
    const q = resized(p, [{ widthMm: 13000, depthMm: 9000 }], grip)
    expect(houseRects(q)[0].x2).toBe(houseRects(p)[0].x2)
    expect(houseRects(q)[0].x1).toBe(houseRects(p)[0].x1 - 1000)
    expect(q.walls).toEqual(p.walls)
  })
})

describe('drawing an inside wall', () => {
  it('a nearly square drag comes out square', () => {
    const p = plan()
    const from = { x: 10000, y: 8000 }
    const to = snapWallPoint(p, { x: 14000, y: 8300 }, { ...SNAP, from })
    expect(to.y).toBe(8000)
  })

  it('runs to the inside face of the shell, not its outside', () => {
    const p = plan()
    const [r] = houseRects(p)
    const from = { x: r.x1 + 4000, y: r.y1 + 3000 }
    const to = snapWallPoint(p, { x: r.x1 + 4000, y: r.y2 - 100 }, { ...SNAP, from })
    expect(to.x).toBe(from.x)
    expect(to.y).toBeCloseTo(r.y2 - SNAP.shellMm, 6)
  })

  it('lands on another wall’s end', () => {
    const p = { ...plan(), walls: [{ x1: 10000, y1: 8000, x2: 14000, y2: 8000 }] }
    expect(snapWallPoint(p, { x: 14150, y: 8100 }, SNAP)).toEqual({ x: 14000, y: 8000 })
  })

  it('falls on the grid when it lands on nothing', () => {
    const p = plan()
    expect(snapWallPoint(p, { x: 10049, y: 9951 }, SNAP)).toEqual({ x: 10000, y: 10000 })
  })

  it('a typed length keeps the start and moves the end along the wall', () => {
    const w = withLength({ x1: 0, y1: 0, x2: 3000, y2: 0 }, 4572)
    expect(w).toEqual({ x1: 0, y1: 0, x2: 4572, y2: 0 })
    expect(wallLength(w)).toBe(4572)
  })

  it('keeps a wall inside the house and long enough to be one', () => {
    const p = plan()
    const [r] = houseRects(p)
    expect(acceptsWall(p, { x1: r.x1 + 1000, y1: r.y1 + 1000, x2: r.x1 + 5000, y2: r.y1 + 1000 })).toBe(true)
    expect(acceptsWall(p, { x1: r.x1 + 1000, y1: r.y1 + 1000, x2: r.x1 + 1000 + MIN_WALL_MM / 2, y2: r.y1 + 1000 })).toBe(false)
    expect(acceptsWall(p, { x1: 10, y1: 10, x2: 3000, y2: 10 })).toBe(false)
    expect(insideHouse(p, { x: r.x1 + 10, y: r.y1 + 10 })).toBe(true)
  })
})

describe('a wall dragged past the shell', () => {
  it('stops at the shell’s inside face', () => {
    const p = plan()
    const [r] = houseRects(p)
    const from = { x: r.x1 + 4000, y: r.y1 + 3000 }
    const to = clipToShell(p, from, { x: r.x2 + 5000, y: from.y }, 150)
    expect(to.y).toBe(from.y)
    expect(to.x).toBeCloseTo(r.x2 - 150, 6)
  })

  it('a wall with an end outside the house is not kept', () => {
    const p = plan()
    const [r] = houseRects(p)
    expect(acceptsWall(p, { x1: r.x1 + 4000, y1: r.y1 + 3000, x2: r.x2 + 3000, y2: r.y1 + 3000 })).toBe(false)
    expect(acceptsWall(p, { x1: r.x1 + 4000, y1: r.y1 + 3000, x2: r.x2 - 150, y2: r.y1 + 3000 })).toBe(true)
  })
})
