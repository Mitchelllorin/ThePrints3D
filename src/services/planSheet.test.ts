import { describe, it, expect } from 'vitest'
import { scorePlanSheet, pickPlanPage, thumbnailScale, type PixelSource } from './planSheet'

const W = 400
const H = 300

function blankSheet(): { img: PixelSource; ink: (x: number, y: number) => void } {
  const data = new Uint8ClampedArray(W * H * 4).fill(255)
  const ink = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return
    const i = (y * W + x) * 4
    data[i] = data[i + 1] = data[i + 2] = 0
  }
  return { img: { data, width: W, height: H }, ink }
}

function hLine(ink: (x: number, y: number) => void, y: number, x0: number, x1: number) {
  for (let x = x0; x <= x1; x++) ink(x, y)
}
function vLine(ink: (x: number, y: number) => void, x: number, y0: number, y1: number) {
  for (let y = y0; y <= y1; y++) ink(x, y)
}
/** A wall drawn the way plans draw them: two thin parallel faces. */
function hWall(ink: (x: number, y: number) => void, y: number, x0: number, x1: number, t = 5) {
  hLine(ink, y, x0, x1)
  hLine(ink, y + t, x0, x1)
}
function vWall(ink: (x: number, y: number) => void, x: number, y0: number, y1: number, t = 5) {
  vLine(ink, x, y0, y1)
  vLine(ink, x + t, y0, y1)
}

function floorPlanSheet(): PixelSource {
  const { img, ink } = blankSheet()
  // Outer shell plus a few partitions, both directions — the wall signature.
  hWall(ink, 40, 40, 340)
  hWall(ink, 240, 40, 340)
  vWall(ink, 40, 40, 245)
  vWall(ink, 335, 40, 245)
  hWall(ink, 140, 45, 200)
  vWall(ink, 200, 45, 240)
  vWall(ink, 260, 45, 240)
  return img
}

function elevationSheet(): PixelSource {
  // Long horizontal storey lines and a roof — almost nothing vertical.
  const { img, ink } = blankSheet()
  for (const y of [60, 65, 150, 155, 230, 235]) hLine(ink, y, 40, 340)
  return img
}

function hatchedSheet(): PixelSource {
  // A solid poché block: masses of ink, none of it a thin line.
  const { img, ink } = blankSheet()
  for (let y = 40; y < 250; y++) for (let x = 40; x < 340; x++) ink(x, y)
  return img
}

function notesSheet(): PixelSource {
  // Short text-like runs only.
  const { img, ink } = blankSheet()
  for (let y = 30; y < 270; y += 8) for (let x = 40; x < 340; x += 14) hLine(ink, y, x, x + 5)
  return img
}

describe('scorePlanSheet', () => {
  it('scores a floor plan above an elevation, a hatched sheet and a notes sheet', () => {
    const plan = scorePlanSheet(floorPlanSheet()).score
    expect(plan).toBeGreaterThan(scorePlanSheet(elevationSheet()).score)
    expect(plan).toBeGreaterThan(scorePlanSheet(hatchedSheet()).score)
    expect(plan).toBeGreaterThan(scorePlanSheet(notesSheet()).score)
  })

  it('gives a blank sheet no score at all', () => {
    const { img } = blankSheet()
    expect(scorePlanSheet(img).score).toBe(0)
  })

  it('finds parallel faces in both directions on a plan', () => {
    const s = scorePlanSheet(floorPlanSheet())
    expect(s.wallPairs).toBeGreaterThan(3)
  })

  it('does not read solid fill as walls', () => {
    // The whole point of the thinness test: a hatched framing sheet is dense
    // with ink, and none of it is a wall face.
    const s = scorePlanSheet(hatchedSheet())
    expect(s.inkFraction).toBeGreaterThan(0.3)
    expect(s.score).toBeLessThan(1)
  })
})

describe('thumbnailScale', () => {
  it('lands the longest side on the target, whichever side that is', () => {
    // A 36x24 sheet at 72pt/in, both orientations.
    expect(thumbnailScale(2592, 1728, 1000) * 2592).toBeCloseTo(1000, 6)
    expect(thumbnailScale(1728, 2592, 1000) * 2592).toBeCloseTo(1000, 6)
  })

  it('never upscales a page that is already small', () => {
    // Letter at 72pt/in is 792pt — blowing it up to 1000 would invent
    // thickness the picker would read as a wall.
    expect(thumbnailScale(792, 612, 1000)).toBe(1)
  })

  it('survives a page with no usable size', () => {
    expect(thumbnailScale(0, 0)).toBe(1)
    expect(thumbnailScale(NaN, NaN)).toBe(1)
  })
})

describe('pickPlanPage', () => {
  it('picks the plan sheet out of a set, whatever its position', () => {
    const pick = pickPlanPage([elevationSheet(), floorPlanSheet(), hatchedSheet(), notesSheet()])
    expect(pick.page).toBe(2)
    expect(pick.weak).toBe(false)
  })

  it('falls back to page 1 — never worse than before — when nothing reads as a plan', () => {
    const pick = pickPlanPage([elevationSheet(), notesSheet()])
    expect(pick.page).toBe(1)
    expect(pick.weak).toBe(true)
  })

  it('ranks every page so the UI can offer the runner-up', () => {
    const pick = pickPlanPage([elevationSheet(), floorPlanSheet(), notesSheet()])
    expect(pick.ranked).toHaveLength(3)
    expect(pick.ranked[0].page).toBe(2)
    expect(pick.ranked[0].score).toBeGreaterThanOrEqual(pick.ranked[1].score)
  })
})
