import { describe, expect, it } from 'vitest'
import { sectionBearingPoints, studsUnderBearing } from './bearingPacks'
import { placeBoxes, type FootprintBox } from './footprint'
import { createDrawnProject } from './drawnProject'

const FT = 304.8

describe('where a section opens into the main house, a beam comes down at both ends', () => {
  it('a plain rectangle has no bearing points — trusses along a wall are not point loads', () => {
    expect(sectionBearingPoints(placeBoxes([{ widthMm: 12000, depthMm: 9000 }]))).toEqual([])
  })

  it('a section off the back gives the two ends of its opening', () => {
    const boxes: FootprintBox[] = [
      { widthMm: 12000, depthMm: 9000 },
      { widthMm: 3600, depthMm: 4200, attach: { side: 'bottom', offsetMm: 3000 } },
    ]
    const pts = sectionBearingPoints(placeBoxes(boxes))
    expect(pts.map((p) => [p.x, p.y])).toEqual([[3000, 9000], [6600, 9000]])
    expect(pts[0].spanMm).toBe(3600)
    expect(pts[0].along).toBe('x')
  })

  it('only the stretch the two boxes really share — a section longer than the wall does not bear past it', () => {
    const boxes: FootprintBox[] = [
      { widthMm: 12000, depthMm: 9000 },
      { widthMm: 4000, depthMm: 12000, attach: { side: 'right', offsetMm: 2000 } },
    ]
    const pts = sectionBearingPoints(placeBoxes(boxes))
    expect(pts.map((p) => [p.x, p.y])).toEqual([[12000, 2000], [12000, 9000]])
  })
})

describe('sized like the jacks under a header of the same span (IRC R602.7)', () => {
  it('never fewer than two studs', () => {
    expect(studsUnderBearing(3 * FT)).toBe(2)
  })
  it('three under a 12-foot opening', () => {
    expect(studsUnderBearing(12 * FT)).toBe(3)
  })
})

describe('Draw it puts the packs in the walls, where the wall sheet can reach them', () => {
  const packsOf = (wings: FootprintBox[]) => {
    const p = createDrawnProject({ widthMm: 12000, depthMm: 9000, wallTypeKey: 'wood-2x6', floor: 'slab', wings })
    return p.drawing.parsedWalls.flatMap((w) => w.studPacks ?? [])
  }

  it('none on a plain box', () => {
    expect(packsOf([])).toEqual([])
  })

  it('one at each end of a section opening in the middle of a wall', () => {
    const packs = packsOf([{ widthMm: 3600, depthMm: 4200, attach: { side: 'bottom', offsetMm: 3000 } }])
    expect(packs).toHaveLength(2)
    expect(packs.every((k) => k.studs === 3)).toBe(true)
  })

  it('still two when the section is flush with a corner — one comes down mid-span on the side wall', () => {
    const packs = packsOf([{ widthMm: 3600, depthMm: 4200, attach: { side: 'bottom', offsetMm: 0 } }])
    expect(packs).toHaveLength(2)
    expect(packs.some((k) => k.atFrac > 0.05 && k.atFrac < 0.95)).toBe(true)
  })
})
