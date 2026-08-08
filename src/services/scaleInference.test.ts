import { describe, expect, it } from 'vitest'
import type { ParsedWall } from '../types'
import { inferScaleFromPaper, inferScaleFromStructure } from './scaleInference'

function wall(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  thickness: number,
  detectionConfidence = 0.85,
): ParsedWall {
  return { x1, y1, x2, y2, thickness, source: 'auto', detectionConfidence }
}

describe('inferScaleFromStructure', () => {
  it('returns null when there is not enough structural evidence', () => {
    expect(inferScaleFromStructure([])).toBeNull()
    expect(inferScaleFromStructure([wall(0, 0, 40, 0, 1)])).toBeNull()
  })

  it('infers scale from consistent wall thickness and opening width priors', () => {
    const inferred = inferScaleFromStructure([
      wall(0, 0, 220, 0, 30),
      wall(448, 0, 760, 0, 30),
      wall(0, 240, 280, 240, 43),
      wall(520, 240, 840, 240, 43),
      wall(100, 60, 100, 360, 30),
      wall(620, 60, 620, 360, 30),
    ])

    expect(inferred).not.toBeNull()
    expect(inferred!.scaleMmPerPx).toBeCloseTo(4, 1)
    expect(inferred!.support.walls).toBeGreaterThanOrEqual(2)
    expect(inferred!.support.openings).toBeGreaterThanOrEqual(1)
  })
})

/**
 * The paper-anchored route, built against the real 1-&-2-family set: a 36"×24"
 * sheet rendered at 3888px wide, which is 108 pixels to the paper inch, drawn at
 * 1/4"=1'-0" — so 11.29 real millimetres per pixel, and one foot is 27px.
 */
const PX_PER_PAPER_INCH = 108
const TRUE_MM_PER_PX = (25.4 / PX_PER_PAPER_INCH) * 48
const FT = 27

/**
 * A 24'-6" × 42'-6" house drawn at 1/4"=1'-0": 8" shell (18px), 6" partitions
 * (14px), and openings that are real sizes at this scale — a 3'-0" door is 81px
 * and a 5'-0" window is 135px.
 */
const DOOR = 81
const WINDOW = 135
function quarterInchPlan(): ParsedWall[] {
  const w = Math.round(24.5 * FT)   // 661
  const h = Math.round(42.5 * FT)   // 1148
  return [
    // Shell, each side broken by one opening.
    wall(0, 0, 290, 0, 18), wall(290 + WINDOW, 0, w, 0, 18),
    wall(0, h, 240, h, 18), wall(240 + DOOR, h, w, h, 18),
    wall(0, 0, 0, 500, 18), wall(0, 500 + WINDOW, 0, h, 18),
    wall(w, 0, w, 420, 18), wall(w, 420 + DOOR, w, h, 18),
    // Partitions.
    wall(0, 560, 280, 560, 14), wall(280 + DOOR, 560, w, 560, 14),
    wall(300, 0, 300, 300, 14), wall(300, 300 + DOOR, 300, 560, 14),
  ]
}

describe('inferScaleFromPaper', () => {
  it('lands within a rung of the real scale of a 1/4"=1\'-0" sheet', () => {
    const inferred = inferScaleFromPaper(quarterInchPlan(), PX_PER_PAPER_INCH)
    expect(inferred).not.toBeNull()
    // Deliberately a rung of tolerance, not a hit. Neighbouring architectural
    // scales are only 1.33× apart (and 1:50 is 4% off 1/4"=1'-0"), so several
    // of them explain the same walls and doors about equally well — landing on
    // the right rung is the honest guarantee. On the real 1-&-2-family sheet
    // this route returns 11.76 against a true 11.29, +4.2%. Exactness is what
    // Recalibrate is for; what must never come back is the 2.7×–4× miss below.
    expect(inferred!.scaleMmPerPx).toBeGreaterThan(TRUE_MM_PER_PX / 1.4)
    expect(inferred!.scaleMmPerPx).toBeLessThan(TRUE_MM_PER_PX * 1.4)
  })

  it('is not fooled by a crowd of pen lines', () => {
    // THE bug this route exists to fix. On the real sheet 217 of 274 "walls"
    // came back 3–5px — single drawn faces, 0.7–1.2mm of pen at this
    // resolution. They outnumbered the genuine walls 6:1 and dragged the
    // estimate to 2.7× too large, because a big scale turns a pen line into a
    // tidy 120mm partition.
    const penLines: ParsedWall[] = []
    for (let i = 0; i < 200; i++) {
      const y = 20 + i * 3
      penLines.push(wall(40, y, 40 + 60 + (i % 40), y, 4))
    }
    const mixed = [...quarterInchPlan(), ...penLines]

    const inferred = inferScaleFromPaper(mixed, PX_PER_PAPER_INCH)
    expect(inferred).not.toBeNull()
    expect(inferred!.scaleMmPerPx).toBeLessThan(TRUE_MM_PER_PX * 1.5)
  })

  it('falls back to the whole crowd when almost nothing survives the filter', () => {
    // A lightly drawn plan is still a plan; the filter must not empty it out.
    const light = quarterInchPlan().map((w) => ({ ...w, thickness: 4 }))
    expect(inferScaleFromPaper(light, PX_PER_PAPER_INCH)).not.toBeNull()
  })

  it('refuses a scale that would make the drawing a city block wide', () => {
    // Extent is the signal that cannot be faked by line weight.
    const inferred = inferScaleFromPaper(quarterInchPlan(), PX_PER_PAPER_INCH)
    const extentPx = 42.5 * FT
    expect((extentPx * inferred!.scaleMmPerPx) / 1000).toBeLessThan(60)
  })

  it('needs a real paper resolution to say anything', () => {
    expect(inferScaleFromPaper(quarterInchPlan(), 0)).toBeNull()
    expect(inferScaleFromPaper(quarterInchPlan(), NaN)).toBeNull()
    expect(inferScaleFromPaper([], PX_PER_PAPER_INCH)).toBeNull()
  })
})
