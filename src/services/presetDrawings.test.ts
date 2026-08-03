import { describe, it, expect } from 'vitest'
import { presetPlans } from './presetDrawings'

/** Is there a door on one of this room's edges? */
function hasDoor(box: [number, number, number, number], doors: Array<{ at: [number, number]; orientation: string }>) {
  const [x1, y1, x2, y2] = box
  const tol = 0.3
  return doors.some((d) => {
    const [dx, dy] = d.at
    if (d.orientation === 'horizontal') {
      return (Math.abs(dy - y1) < tol || Math.abs(dy - y2) < tol) && dx > x1 - tol && dx < x2 + tol
    }
    return (Math.abs(dx - x1) < tol || Math.abs(dx - x2) < tol) && dy > y1 - tol && dy < y2 + tol
  })
}

describe('every preset room can actually be got into', () => {
  // A closet with no door is trivial to author and invisible in code — it only
  // shows up when you look at the drawing. Twice now: first the living room and
  // hall, then the closets. So it is a test rather than a habit of checking.
  for (const plan of presetPlans()) {
    it(`${plan.name}: no room is sealed off`, () => {
      const doors = plan.openings.filter((o) => o.type === 'door')
      const sealed = plan.rooms.filter((r) => !hasDoor(r.box, doors)).map((r) => r.name)
      expect(sealed).toEqual([])
    })

    it(`${plan.name}: every room sits inside the footprint`, () => {
      for (const r of plan.rooms) {
        const [x1, y1, x2, y2] = r.box
        expect(x1).toBeGreaterThanOrEqual(0)
        expect(y1).toBeGreaterThanOrEqual(0)
        expect(x2).toBeLessThanOrEqual(plan.widthFt)
        expect(y2).toBeLessThanOrEqual(plan.depthFt)
        expect(x2).toBeGreaterThan(x1)
        expect(y2).toBeGreaterThan(y1)
      }
    })

    it(`${plan.name}: every opening lands on the plan, not off it`, () => {
      for (const o of plan.openings) {
        expect(o.at[0]).toBeGreaterThanOrEqual(0)
        expect(o.at[0]).toBeLessThanOrEqual(plan.widthFt)
        expect(o.at[1]).toBeGreaterThanOrEqual(0)
        expect(o.at[1]).toBeLessThanOrEqual(plan.depthFt)
        expect(o.widthFt).toBeGreaterThan(0)
      }
    })
  }
})
