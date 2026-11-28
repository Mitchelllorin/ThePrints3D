import { describe, it, expect } from 'vitest'
import {
  arcOf, arcPoints, arcWalls, bulgeForRadius, bulgeThrough, clearOf, cornerAngleDeg, curveBayMm,
  DRAW, isDoubleTap, pointAtCornerAngle, snapDrawPoint, endsOf, segsOf,
  pivotedCorner, wallNear, splitWall, arrivingDir,
} from './drawSystem'

const deg = (a: { x: number; y: number }, b: { x: number; y: number }) => (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI

describe('right angles, held loosely', () => {
  const from = { x: 0, y: 0 }
  it('a drag a few degrees off level lands level', () => {
    const r = (6 * Math.PI) / 180
    const s = snapDrawPoint({ x: Math.cos(r) * 100, y: Math.sin(r) * 100 }, { from, tol: 5 })
    expect(s.kind).toBe('angle')
    expect(s.point.y).toBeCloseTo(0, 9)
    expect(s.point.x).toBeCloseTo(100 * Math.cos(r), 9)
    expect(s.heldDeg).toBe(0)
    expect(s.guide).toBeDefined()
  })
  it('a deliberate move past the hold keeps the angle drawn, to the degree', () => {
    const r = (30.4 * Math.PI) / 180
    const s = snapDrawPoint({ x: Math.cos(r) * 100, y: Math.sin(r) * 100 }, { from, tol: 5 })
    expect(s.kind).toBe('free')
    expect(deg(from, s.point)).toBeCloseTo(30, 9)
  })
  it('a 45 holds, but only from close', () => {
    const near = (48 * Math.PI) / 180, far = (39 * Math.PI) / 180
    expect(deg(from, snapDrawPoint({ x: Math.cos(near) * 100, y: Math.sin(near) * 100 }, { from, tol: 5 }).point)).toBeCloseTo(45, 9)
    expect(deg(from, snapDrawPoint({ x: Math.cos(far) * 100, y: Math.sin(far) * 100 }, { from, tol: 5 }).point)).toBeCloseTo(39, 9)
  })
  it('square to the wall before, when that wall is itself at an angle', () => {
    const p30 = { x: Math.cos(Math.PI / 6), y: Math.sin(Math.PI / 6) }
    // 120° is square off a 30° wall; aim at 114°.
    const r = (114 * Math.PI) / 180
    const s = snapDrawPoint({ x: Math.cos(r) * 100, y: Math.sin(r) * 100 }, { from, prevDir: p30, tol: 5 })
    expect(s.heldBy).toBe('turn')
    expect(deg(from, s.point)).toBeCloseTo(120, 9)
    expect(s.cornerDeg).toBe(90)
  })
  it('squaring off keeps only a light magnet', () => {
    const r = (6 * Math.PI) / 180
    const s = snapDrawPoint({ x: Math.cos(r) * 100, y: Math.sin(r) * 100 }, { from, tol: 5, square: false })
    expect(s.kind).toBe('free')
    expect(deg(from, s.point)).toBeCloseTo(6, 9)
  })
  it('steps the length on the grid when it has one', () => {
    const s = snapDrawPoint({ x: 1234, y: 30 }, { from, tol: 5, grid: 100 })
    expect(s.point).toEqual({ x: 1200, y: 0 })
  })
})

describe('ends, walls and corners are targets', () => {
  const walls = [{ x1: 0, y1: 0, x2: 1000, y2: 0 }, { x1: 1000, y1: 0, x2: 1000, y2: 800 }]
  it('lands on another wall’s end', () => {
    const s = snapDrawPoint({ x: 1010, y: 795 }, { from: { x: 0, y: 500 }, ends: endsOf(walls), tol: 20 })
    expect(s.kind).toBe('end')
    expect(s.point).toEqual({ x: 1000, y: 800 })
  })
  it('never snaps to the end it is drawing from', () => {
    const s = snapDrawPoint({ x: 1003, y: 2 }, { from: { x: 1000, y: 0 }, ends: endsOf(walls), tol: 20 })
    expect(s.kind).not.toBe('end')
  })
  it('a held wall runs on to meet a wall it nearly reaches, without kinking', () => {
    const s = snapDrawPoint({ x: 985, y: 404 }, { from: { x: 200, y: 400 }, lines: segsOf(walls), tol: 20 })
    expect(s.kind).toBe('line')
    expect(s.point.x).toBeCloseTo(1000, 9)
    expect(s.point.y).toBeCloseTo(400, 9)
  })
  it('a first point lands along a wall', () => {
    const s = snapDrawPoint({ x: 500, y: 8 }, { lines: segsOf(walls), tol: 20 })
    expect(s).toMatchObject({ kind: 'line', point: { x: 500, y: 0 } })
  })
  it('stops level with a corner it lines up with — the last wall of a room comes out square', () => {
    // Run: (0,0)→(1000,0)→(1000,800); now heading left from (1000,800) to (6, 790).
    const s = snapDrawPoint({ x: 12, y: 806 }, {
      from: { x: 1000, y: 800 }, prevDir: { x: 0, y: 1 }, runStart: { x: 0, y: 0 },
      ends: endsOf(walls), lines: segsOf(walls), tol: 20,
    })
    expect(s.kind).toBe('align')
    expect(s.point.x).toBeCloseTo(0, 9)
    expect(s.point.y).toBeCloseTo(800, 9)
    expect(s.alignGuide?.a).toEqual({ x: 0, y: 0 })
    expect(s.cornerDeg).toBe(90)
  })
  it('lines up only with the first point of the run, not other corners on the plan', () => {
    // Heading left from (1000,800); a stray corner at (300,0) is near x=306.
    const s = snapDrawPoint({ x: 306, y: 806 }, {
      from: { x: 1000, y: 800 }, prevDir: { x: 0, y: 1 }, runStart: { x: 0, y: 0 },
      ends: [{ x: 300, y: 0 }], tol: 20,
    })
    expect(s.kind).toBe('angle')
    expect(s.point.x).toBeCloseTo(306, 9)
  })
})

describe('closing the shape', () => {
  const run = { from: { x: 0, y: 800 }, prevDir: { x: -1, y: 0 }, runStart: { x: 0, y: 0 }, tol: 20 }
  it('near the first point, the point is the first point and it closes', () => {
    const s = snapDrawPoint({ x: 25, y: 4 }, run)
    expect(s).toMatchObject({ kind: 'close', closes: true, point: { x: 0, y: 0 } })
    expect(s.cornerDeg).toBe(90)
  })
  it('reaches further than an ordinary end', () => {
    expect(snapDrawPoint({ x: 0, y: 20 * DRAW.CLOSE_REACH - 1 }, run).closes).toBe(true)
    expect(snapDrawPoint({ x: 0, y: 20 * DRAW.CLOSE_REACH + 6 }, run).closes).toBe(false)
  })
  it('does not close a run that has not left its start', () => {
    expect(snapDrawPoint({ x: 3, y: 2 }, { ...run, from: { x: 5, y: 0 } }).closes).toBe(false)
  })
})

describe('corner angles', () => {
  it('reads square as 90 and straight on as 180', () => {
    expect(cornerAngleDeg({ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 5 })).toBeCloseTo(90, 9)
    expect(cornerAngleDeg({ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 5, y: 0 })).toBeCloseTo(180, 9)
    expect(cornerAngleDeg({ x: 1, y: 0 }, { x: 0, y: 0 }, { x: -5, y: 5 })).toBeCloseTo(45, 9)
  })
  it('a typed corner angle lays the wall on the side the pointer is on', () => {
    const down = pointAtCornerAngle({ x: 1, y: 0 }, { x: 0, y: 0 }, 135, 10, { x: 3, y: 4 })
    expect(down.x).toBeCloseTo(10 * Math.SQRT1_2, 9)
    expect(down.y).toBeCloseTo(10 * Math.SQRT1_2, 9)
    const up = pointAtCornerAngle({ x: 1, y: 0 }, { x: 0, y: 0 }, 135, 10, { x: 3, y: -4 })
    expect(up.y).toBeCloseTo(-10 * Math.SQRT1_2, 9)
    expect(Math.round(cornerAngleDeg({ x: 1, y: 0 }, { x: 0, y: 0 }, up))).toBe(135)
  })
})

describe('curves', () => {
  const a = { x: 0, y: 0 }, b = { x: 1000, y: 0 }
  it('a bulge of half the chord is a half circle on the chord', () => {
    const arc = arcOf(a, b, 500)!
    expect(arc.r).toBeCloseTo(500, 9)
    expect(arc.cx).toBeCloseTo(500, 9)
    expect(arc.cy).toBeCloseTo(0, 9)
  })
  it('radius and bulge go both ways', () => {
    const s = bulgeForRadius(1000, 1300, 1)
    expect(arcOf(a, b, s)!.r).toBeCloseTo(1300, 6)
    expect(bulgeForRadius(1000, 100, -1)).toBeCloseTo(-500, 9)
  })
  it('the bulge follows the point dragged, held to a half circle', () => {
    expect(bulgeThrough(a, b, { x: 400, y: 120 })).toBeCloseTo(120, 9)
    expect(bulgeThrough(a, b, { x: 400, y: -2000 })).toBeCloseTo(-500, 9)
  })
  it('an arc keeps its ends exactly and every point on the circle', () => {
    const s = 200
    const pts = arcPoints(a, b, s, 100)
    const arc = arcOf(a, b, s)!
    expect(pts[0]).toEqual(a)
    expect(pts[pts.length - 1]).toEqual(b)
    for (const p of pts) expect(Math.hypot(p.x - arc.cx, p.y - arc.cy)).toBeCloseTo(arc.r, 6)
    // It bulges the way it was dragged.
    const mid = pts[Math.floor(pts.length / 2)]
    expect(mid.y).toBeGreaterThan(100)
    for (let i = 1; i < pts.length; i++) expect(Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)).toBeLessThanOrEqual(100 + 1e-6)
  })
  it('as walls: facets of a bend, one stud per break, joined end to end', () => {
    const w = arcWalls(a, b, -300, 150)
    expect(w.length).toBeGreaterThan(4)
    expect(w.every((k) => k.bend)).toBe(true)
    expect(w[0].sharedStartStud).toBeUndefined()
    expect(w.slice(1).every((k) => k.sharedStartStud)).toBe(true)
    for (let i = 1; i < w.length; i++) { expect(w[i].x1).toBe(w[i - 1].x2); expect(w[i].y1).toBe(w[i - 1].y2) }
  })
  it('flat is a straight wall', () => {
    expect(arcWalls(a, b, 0, 100)).toEqual([{ x1: 0, y1: 0, x2: 1000, y2: 0 }])
  })
  it('the bay is a quarter of the radius, 8" to 16"', () => {
    expect(curveBayMm(1219.2)).toBeCloseTo(304.8, 9)
    expect(curveBayMm(100)).toBe(203.2)
    expect(curveBayMm(99999)).toBe(406.4)
  })
})

describe('gestures and readouts', () => {
  it('a double tap is close in time and place', () => {
    expect(isDoubleTap({ t: 0, x: 0, y: 0 }, 300, 10, 10)).toBe(true)
    expect(isDoubleTap({ t: 0, x: 0, y: 0 }, DRAW.DOUBLE_TAP_MS + 1, 0, 0)).toBe(false)
    expect(isDoubleTap({ t: 0, x: 0, y: 0 }, 100, 100, 0)).toBe(false)
    expect(isDoubleTap(null, 100, 0, 0)).toBe(false)
  })
  it('a readout sits clear of the pointer, on the far side', () => {
    const at = clearOf({ x: 100, y: 100 }, { x: 100, y: 140 }, 50)
    expect(at).toEqual({ x: 100, y: 50 })
  })
})

describe('editing after drawing', () => {
  // A 1000 x 800 room, drawn as a closed run.
  const room = [
    { x1: 0, y1: 0, x2: 1000, y2: 0 },
    { x1: 1000, y1: 0, x2: 1000, y2: 800 },
    { x1: 1000, y1: 800, x2: 0, y2: 800 },
    { x1: 0, y1: 800, x2: 0, y2: 0 },
  ]
  const apply = <W,>(ws: W[], m: Map<number, W>) => ws.map((w, i) => m.get(i) ?? w)
  it('dragging a corner of a rectangle resizes it and keeps it square', async () => {
    const { movedCorner } = await import('./drawSystem')
    const next = apply(room, movedCorner(room, { x: 1000, y: 800 }, { x: 1200, y: 900 }, 1))
    expect(next).toEqual([
      { x1: 0, y1: 0, x2: 1200, y2: 0 },
      { x1: 1200, y1: 0, x2: 1200, y2: 900 },
      { x1: 1200, y1: 900, x2: 0, y2: 900 },
      { x1: 0, y1: 900, x2: 0, y2: 0 },
    ])
  })
  it('a diagonal on the corner just stretches, and stays joined', async () => {
    const { movedCorner } = await import('./drawSystem')
    const ws = [{ x1: 0, y1: 0, x2: 500, y2: 500 }, { x1: 500, y1: 500, x2: 900, y2: 300 }]
    expect(apply(ws, movedCorner(ws, { x: 500, y: 500 }, { x: 520, y: 470 }, 1))).toEqual([
      { x1: 0, y1: 0, x2: 520, y2: 470 }, { x1: 520, y1: 470, x2: 900, y2: 300 },
    ])
  })
  it('sliding a wall moves it across itself and the walls on its ends follow', async () => {
    const { slidWall } = await import('./drawSystem')
    const next = apply(room, slidWall(room, 1, { x: 150, y: 40 }, 1))
    expect(next[1]).toEqual({ x1: 1150, y1: 0, x2: 1150, y2: 800 })
    expect(next[0]).toEqual({ x1: 0, y1: 0, x2: 1150, y2: 0 })
    expect(next[2]).toEqual({ x1: 1150, y1: 800, x2: 0, y2: 800 })
    expect(next[3]).toEqual(room[3])
  })
})

describe('the print pulls from a shorter reach than your own walls', () => {
  it('a print end just inside the full reach does not catch the point', () => {
    const q = snapDrawPoint({ x: 100, y: 12 }, { tol: 20, printEnds: [{ x: 100, y: 0 }] })
    expect(q.kind).not.toBe('end')
  })
  it('your own end at the same distance does', () => {
    const q = snapDrawPoint({ x: 100, y: 12 }, { tol: 20, ends: [{ x: 100, y: 0 }] })
    expect(q.kind).toBe('end')
  })
  it('a print end very close still catches it', () => {
    const q = snapDrawPoint({ x: 100, y: 4 }, { tol: 20, printEnds: [{ x: 100, y: 0 }] })
    expect(q.kind).toBe('end')
  })
})

describe('angling walls already drawn', () => {
  const room = [
    { x1: 0, y1: 0, x2: 100, y2: 0 },
    { x1: 100, y1: 0, x2: 100, y2: 80 },
    { x1: 100, y1: 80, x2: 0, y2: 80 },
    { x1: 0, y1: 80, x2: 0, y2: 0 },
  ]
  it('swings a corner: both walls on it go to an angle, the rest stay put', () => {
    const m = pivotedCorner(room, { x: 100, y: 0 }, { x: 80, y: 0 }, 1)
    expect(m.size).toBe(2)
    expect(m.get(0)).toMatchObject({ x1: 0, y1: 0, x2: 80, y2: 0 })
    expect(m.get(1)).toMatchObject({ x1: 80, y1: 0, x2: 100, y2: 80 })
  })
  it('finds the wall under a point, and only within reach', () => {
    expect(wallNear(room, { x: 50, y: 3 }, 5)?.i).toBe(0)
    expect(wallNear(room, { x: 50, y: 40 }, 5)).toBeNull()
  })
  it('cuts a wall in two at a point, and refuses a sliver', () => {
    const [a, b] = splitWall(room[0], { x: 70, y: 4 }, 5)!
    expect(a).toMatchObject({ x1: 0, y1: 0, x2: 70, y2: 0 })
    expect(b).toMatchObject({ x1: 70, y1: 0, x2: 100, y2: 0 })
    expect(splitWall(room[0], { x: 98, y: 0 }, 5)).toBeNull()
  })
  it('reads the way into a corner along the other wall', () => {
    expect(arrivingDir(room, 1, { x: 100, y: 0 }, 1)).toEqual({ x: 1, y: 0 })
    expect(arrivingDir([room[1]], 0, { x: 100, y: 0 }, 1)).toBeNull()
  })
})

describe('short walls go square', () => {
  const from = { x: 100, y: 100 }
  it('a short wall a few px off square holds square', () => {
    // 20 px long, 4 px off: 11° out — past the angle tolerance, inside reach.
    const s = snapDrawPoint({ x: 120, y: 104 }, { from, tol: 10 })
    expect(s.heldDeg).toBe(0)
    expect(s.point.y).toBeCloseTo(100)
  })
  it('a long wall 11° off is still an angled wall', () => {
    const s = snapDrawPoint({ x: 300, y: 139 }, { from, tol: 10 })
    expect(s.heldDeg).toBeUndefined()
  })
  it('Any angle leaves a short wall where it is put', () => {
    const s = snapDrawPoint({ x: 120, y: 104 }, { from, tol: 10, square: false })
    expect(s.point.y).toBeCloseTo(104, 0)
  })
})
