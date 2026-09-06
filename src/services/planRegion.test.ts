import { describe, it, expect } from 'vitest'
import { findPlanRegion, maskToPlanRegion } from './planRegion'

/** Build a white RGBA sheet to draw test ink onto. */
function sheet(width: number, height: number): ImageData {
  const data = new Uint8ClampedArray(width * height * 4).fill(255)
  return { data, width, height } as ImageData
}

function setPx(img: ImageData, x: number, y: number, v: number) {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return
  const i = (y * img.width + x) * 4
  img.data[i] = v
  img.data[i + 1] = v
  img.data[i + 2] = v
  img.data[i + 3] = 255
}

/** A rectangle of long straight strokes — what a floor plan looks like. */
function drawPlan(img: ImageData, x1: number, y1: number, x2: number, y2: number) {
  for (let x = x1; x <= x2; x++) {
    for (let t = 0; t < 3; t++) { setPx(img, x, y1 + t, 0); setPx(img, x, y2 - t, 0) }
  }
  for (let y = y1; y <= y2; y++) {
    for (let t = 0; t < 3; t++) { setPx(img, x1 + t, y, 0); setPx(img, x2 - t, y, 0) }
  }
  // An interior partition, so it reads as rooms rather than one empty box.
  const mid = Math.round((x1 + x2) / 2)
  for (let y = y1; y <= y2; y++) for (let t = 0; t < 3; t++) setPx(img, mid + t, y, 0)
}

/**
 * Dense short strokes — general notes. Deliberately DARKER and denser per unit
 * area than the plan, because density is exactly the signal that would pick the
 * wrong answer.
 */
function drawTextBlock(img: ImageData, x1: number, y1: number, x2: number, y2: number) {
  for (let y = y1; y < y2; y += 4) {
    for (let x = x1; x < x2; x += 3) {
      setPx(img, x, y, 0)
      setPx(img, x + 1, y, 0)
    }
  }
}

describe('findPlanRegion', () => {
  it('picks the drawing over a denser block of text', () => {
    const img = sheet(800, 600)
    drawPlan(img, 40, 40, 420, 400)
    // The notes column down the right-hand side, as on a real sheet.
    drawTextBlock(img, 560, 30, 780, 570)

    const { region } = findPlanRegion(img)
    expect(region).not.toBeNull()
    // The plan is on the left; the notes must not have pulled the box right.
    expect(region!.x2).toBeLessThan(560)
    expect(region!.x1).toBeLessThan(80)
    expect(region!.y2).toBeGreaterThan(360)
  })

  it('holds most of the structural ink when it commits to a region', () => {
    const img = sheet(800, 600)
    drawPlan(img, 40, 40, 420, 400)
    drawTextBlock(img, 560, 30, 780, 570)
    const { region } = findPlanRegion(img)
    expect(region!.inkShare).toBeGreaterThan(0.45)
  })

  /**
   * A step that cannot help is not allowed to do harm — the guards matter more
   * than the happy path, because a wrong crop deletes a wing of the building.
   */
  it('declines when the drawing already fills the page', () => {
    const img = sheet(400, 400)
    drawPlan(img, 5, 5, 394, 394)
    expect(findPlanRegion(img).region).toBeNull()
  })

  it('declines on a blank sheet rather than inventing a region', () => {
    expect(findPlanRegion(sheet(400, 400)).region).toBeNull()
  })

  it('declines when two drawings sit apart, rather than keeping only one', () => {
    // Two plans of equal weight on one sheet: committing to either throws the
    // other away, so the honest answer is to leave the sheet alone.
    const img = sheet(900, 400)
    drawPlan(img, 30, 40, 380, 350)
    drawPlan(img, 520, 40, 870, 350)
    expect(findPlanRegion(img).region).toBeNull()
  })

  it('survives an image too small to analyse', () => {
    expect(findPlanRegion(sheet(8, 8)).region).toBeNull()
  })
})

describe('maskToPlanRegion', () => {
  it('keeps the image the same size, so no coordinate moves', () => {
    const img = sheet(200, 150)
    drawPlan(img, 20, 20, 120, 120)
    const out = maskToPlanRegion(img, {
      x1: 10, y1: 10, x2: 130, y2: 130, inkShare: 1, areaShare: 0.5,
    })
    expect(out.width).toBe(img.width)
    expect(out.height).toBe(img.height)
  })

  it('whites out ink beyond the region and leaves ink inside untouched', () => {
    const img = sheet(200, 150)
    setPx(img, 50, 50, 0) // inside
    setPx(img, 180, 140, 0) // outside
    const out = maskToPlanRegion(img, {
      x1: 10, y1: 10, x2: 130, y2: 130, inkShare: 1, areaShare: 0.5,
    })
    const at = (x: number, y: number) => out.data[(y * out.width + x) * 4]
    expect(at(50, 50)).toBe(0)
    expect(at(180, 140)).toBe(255)
  })

  it('does not mutate the image it was given', () => {
    const img = sheet(100, 100)
    setPx(img, 90, 90, 0)
    maskToPlanRegion(img, { x1: 0, y1: 0, x2: 50, y2: 50, inkShare: 1, areaShare: 0.25 })
    expect(img.data[(90 * 100 + 90) * 4]).toBe(0)
  })
})
