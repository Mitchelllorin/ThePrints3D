/**
 * The cases this stage exists for, drawn small enough to reason about.
 *
 * Each image is a few strokes on white: a wall is a solid dark run, a label is
 * a row of short marks with gaps, a fixture is a rectangle that touches nothing.
 * That is the whole distinction the stage is making on a real plan, at a size
 * where the expected answer is not a matter of opinion.
 */
import { describe, expect, it } from 'vitest'
import { corroborateWalls, rasterSearchPx } from './wallCorroboration'
import type { ParsedWall } from '../types'

const W = 200
const H = 200

interface Canvas { data: Uint8ClampedArray; img: ImageData }

function blank(): Canvas {
  const data = new Uint8ClampedArray(W * H * 4).fill(255)
  return { data, img: { data, width: W, height: H, colorSpace: 'srgb' } as ImageData }
}

function ink(c: Canvas, x: number, y: number, v = 20) {
  if (x < 0 || y < 0 || x >= W || y >= H) return
  const i = (Math.round(y) * W + Math.round(x)) * 4
  c.data[i] = c.data[i + 1] = c.data[i + 2] = v
}

/** A solid run, `t` pixels thick — what a wall looks like. */
function stroke(c: Canvas, x1: number, y1: number, x2: number, y2: number, t = 3, v = 20) {
  const steps = Math.ceil(Math.hypot(x2 - x1, y2 - y1)) * 2
  for (let s = 0; s <= steps; s++) {
    const p = s / steps
    const x = x1 + (x2 - x1) * p
    const y = y1 + (y2 - y1) * p
    for (let k = -t; k <= t; k++) {
      if (Math.abs(x2 - x1) >= Math.abs(y2 - y1)) ink(c, x, y + k, v)
      else ink(c, x + k, y, v)
    }
  }
}

/** A row of short marks with gaps — what a word looks like to a line sampler. */
function lettering(c: Canvas, x1: number, y: number, x2: number, v = 90) {
  for (let x = x1; x <= x2; x++) {
    if (Math.floor((x - x1) / 3) % 2 === 1) continue // the gaps between strokes
    for (let k = -2; k <= 2; k++) ink(c, x, y + k, v)
  }
}

const wall = (x1: number, y1: number, x2: number, y2: number): ParsedWall => ({
  x1, y1, x2, y2, thickness: 6, source: 'auto', detectionConfidence: 0.75,
})

describe('corroborateWalls', () => {
  it('keeps a wall that has ink under it and lands on another wall', () => {
    const c = blank()
    stroke(c, 20, 20, 180, 20)   // top
    stroke(c, 20, 20, 20, 180)   // left
    const out = corroborateWalls(c.img, [wall(20, 20, 180, 20), wall(20, 20, 20, 180)])
    expect(out.walls).toHaveLength(2)
    expect(out.dropped).toBe(0)
  })

  /**
   * THE ONE THAT MATTERS. A segment through a room label reads as nearly
   * continuous dark at this size — brightness alone cannot reject it — but it
   * lands on nothing at either end.
   */
  it('drops a segment through a label, which touches nothing', () => {
    const c = blank()
    stroke(c, 20, 20, 180, 20)
    stroke(c, 20, 20, 20, 180)
    stroke(c, 20, 180, 180, 180)
    lettering(c, 70, 100, 130)
    const out = corroborateWalls(c.img, [
      wall(20, 20, 180, 20),
      wall(20, 20, 20, 180),
      wall(20, 180, 180, 180),
      wall(70, 100, 130, 100),   // the label
    ])
    expect(out.walls.map((w) => w.y1)).not.toContain(100)
    expect(out.dropped).toBe(1)
  })

  it('drops a segment drawn over blank paper', () => {
    const c = blank()
    stroke(c, 20, 20, 180, 20)
    stroke(c, 20, 20, 20, 180)
    const out = corroborateWalls(c.img, [
      wall(20, 20, 180, 20),
      wall(20, 20, 20, 180),
      wall(60, 120, 160, 120),   // nothing there at all
    ])
    expect(out.dropped).toBe(1)
    expect(out.walls).toHaveLength(2)
  })

  /**
   * The mask is 256px upscaled onto the raster, so a correct wall arrives a
   * few pixels off the ink. Snapping it back is half the value of the stage:
   * a wall that misses its neighbour by 6px does not close a room.
   */
  it('snaps a wall onto the ink it stands for', () => {
    const c = blank()
    stroke(c, 20, 26, 180, 26)   // the ink
    stroke(c, 20, 26, 20, 180)
    const out = corroborateWalls(c.img, [wall(20, 20, 180, 20), wall(20, 26, 20, 180)])
    const top = out.walls.find((w) => Math.abs(w.x2 - w.x1) > 100)
    expect(top).toBeDefined()
    expect(top!.y1).toBeCloseTo(26, 0)   // moved the 6px onto the wall
    expect(out.snapped).toBeGreaterThan(0)
    expect(out.maxSnapPx).toBeGreaterThanOrEqual(6)
  })

  it('does not demand a junction when there is nothing to join to', () => {
    const c = blank()
    stroke(c, 20, 100, 180, 100)
    const out = corroborateWalls(c.img, [wall(20, 100, 180, 100)])
    expect(out.walls).toHaveLength(1)
  })

  /**
   * An empty answer has to stay empty rather than becoming a null — the caller
   * reads "nothing survived" as "let the classical ladder have its turn".
   */
  it('returns nothing for nothing', () => {
    const c = blank()
    expect(corroborateWalls(c.img, []).walls).toHaveLength(0)
  })

  it('gives a wall a confidence that reflects the evidence, not a stamp', () => {
    const c = blank()
    stroke(c, 20, 20, 180, 20)
    stroke(c, 20, 20, 20, 180)
    stroke(c, 180, 20, 180, 180)
    const out = corroborateWalls(c.img, [
      wall(20, 20, 180, 20), wall(20, 20, 20, 180), wall(180, 20, 180, 180),
    ])
    // Every one of them is real, so every one should read high — and none of
    // them should be the old flat 0.75.
    expect(out.walls.every((w) => (w.detectionConfidence ?? 0) > 0.75)).toBe(true)
  })
})

describe('rasterSearchPx', () => {
  /**
   * The regression this function exists for: a flat 8px search tuned on a
   * screenshot threw away half the walls on a full permit sheet, because the
   * same registration error is a few pixels at 732px and forty at 3888px.
   */
  it('grows with the sheet, because the mask does not', () => {
    expect(rasterSearchPx(732, 727)).toBeGreaterThanOrEqual(6)
    expect(rasterSearchPx(3888, 2592)).toBeGreaterThan(rasterSearchPx(732, 727))
  })

  it('never searches so wide it could snap a wall onto its neighbour', () => {
    expect(rasterSearchPx(20000, 20000)).toBeLessThanOrEqual(28)
  })

  it('still searches something on a tiny raster', () => {
    expect(rasterSearchPx(120, 90)).toBeGreaterThanOrEqual(6)
  })
})
