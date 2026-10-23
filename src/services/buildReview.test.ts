/**
 * buildReview — the rule engine behind "Check my build for mistakes".
 *
 * The shape of these tests is deliberate: `good()` is a build that flags
 * NOTHING, and every other case breaks exactly one thing in it. A checker is
 * only worth running if the clean case is quiet, so the negative control comes
 * first — otherwise every rule passes for the wrong reason and the review
 * degenerates into noise the user learns to ignore.
 */

import { describe, it, expect } from 'vitest'
import { reviewBuildModel, formatFindings, summarizeChecked, type BuildReviewInput } from './buildReview'
import type { ParsedWall } from '../types'

function wall(over: Partial<ParsedWall> = {}): ParsedWall {
  return {
    x1: 0, y1: 0, x2: 400, y2: 0,
    thickness: 6,
    framingType: 'wood-2x6',
    wallRole: 'exterior-bearing',
    level: 0,
    ...over,
  }
}

/** A small finished bungalow: calibrated, decked, ceiled, roofed, one door. */
function good(over: Partial<BuildReviewInput> = {}): BuildReviewInput {
  return {
    scaleMmPerPx: 10,
    walls: [wall()],
    openings: [{ type: 'door', subtype: 'Hinged Single', widthM: 0.9144, level: 0 }],
    floors: [{ level: 0, elementType: 'I-Joist' }, { level: 0, elementType: 'Ceiling joists' }],
    roofs: [{ level: 0 }],
    hasVerticalCirculation: false,
    ceilingM: 2.44,
    studSpacingIn: 16,
    framingMaterial: 'wood',
    ...over,
  }
}

const ids = (input: BuildReviewInput) => reviewBuildModel(input).map((f) => f.id)
const byId = (input: BuildReviewInput, id: string) => reviewBuildModel(input).find((f) => f.id === id)

describe('a finished build is quiet', () => {
  it('flags nothing', () => {
    expect(reviewBuildModel(good())).toEqual([])
  })

  it('still reports what it looked at', () => {
    expect(summarizeChecked(good())).toBe('Checked 1 wall, 1 opening, 2 floor areas, 1 roof area, 1 storey.')
  })
})

describe('nothing to check', () => {
  it('says so instead of reviewing an empty workspace', () => {
    const f = reviewBuildModel({ ...good(), walls: [], openings: [], floors: [], roofs: [] })
    expect(f).toHaveLength(1)
    expect(f[0].id).toBe('empty')
    expect(f[0].severity).toBe('FYI')
  })
})

describe('scale', () => {
  it('leads with a STOP when nothing is calibrated', () => {
    const f = reviewBuildModel(good({ scaleMmPerPx: null }))
    expect(f[0].id).toBe('scale')
    expect(f[0].severity).toBe('STOP')
    // and it is a length-based world: the wall lengths in the finding say so
    expect(f[0].detail).toMatch(/pixels/)
  })
})

describe('the shell', () => {
  it('catches walls standing on nothing', () => {
    expect(byId(good({ floors: [] }), 'floor-missing')?.severity).toBe('CHECK')
  })

  it('catches a missing ceiling even when the floor is there', () => {
    const input = good({ floors: [{ level: 0, elementType: 'I-Joist' }] })
    expect(byId(input, 'floor-missing')).toBeUndefined()
    expect(byId(input, 'ceiling-missing')?.severity).toBe('CHECK')
  })

  it('catches walls carrying no roof', () => {
    expect(byId(good({ roofs: [] }), 'roof-missing')?.severity).toBe('CHECK')
  })
})

describe('storeys', () => {
  it('STOPs an upper storey with no deck under it', () => {
    const input = good({ walls: [wall(), wall({ level: 1, x2: 380 })] })
    const f = byId(input, 'storey-unsupported-1')
    expect(f?.severity).toBe('STOP')
    expect(f?.title).toContain('Storey 2')
  })

  it('accepts an upper storey that has its own floor', () => {
    const input = good({
      walls: [wall(), wall({ level: 1, x2: 380 })],
      floors: [...good().floors, { level: 1, elementType: 'I-Joist' }],
    })
    expect(byId(input, 'storey-unsupported-1')).toBeUndefined()
  })

  it('STOPs a two-storey building with no way up', () => {
    const input = good({
      walls: [wall(), wall({ level: 1, x2: 380 })],
      floors: [...good().floors, { level: 1, elementType: 'I-Joist' }],
    })
    const f = byId(input, 'stair-missing')
    expect(f?.severity).toBe('STOP')
    expect(f?.citation).toMatch(/R311\.7/)
  })

  it('is satisfied by a stair', () => {
    const input = good({
      walls: [wall(), wall({ level: 1, x2: 380 })],
      floors: [...good().floors, { level: 1, elementType: 'I-Joist' }],
      hasVerticalCirculation: true,
    })
    expect(byId(input, 'stair-missing')).toBeUndefined()
  })

  it('flags a wall running past a floor that lands on it', () => {
    const input = good({
      walls: [wall({ spanLevels: 2 }), wall({ level: 1, x2: 380 })],
      floors: [...good().floors, { level: 1, elementType: 'I-Joist' }],
      hasVerticalCirculation: true,
    })
    expect(byId(input, 'balloon-through-floor')?.severity).toBe('CHECK')
  })

  it('leaves a balloon wall alone when no floor lands on it', () => {
    const input = good({
      walls: [wall({ spanLevels: 2 })],
      hasVerticalCirculation: true,
    })
    expect(byId(input, 'balloon-through-floor')).toBeUndefined()
  })
})

describe('ceiling height', () => {
  it('STOPs below the absolute 6-8 minimum', () => {
    const f = byId(good({ ceilingM: 2.0 }), 'ceiling-height-stop')
    expect(f?.severity).toBe('STOP')
    expect(f?.citation).toMatch(/R305\.1/)
  })

  it('CHECKs 6-8 to 7-0 as habitable-space-only', () => {
    // 2.1 m is 6′-10¾″: over the absolute floor, under the habitable minimum.
    const f = byId(good({ ceilingM: 2.1 }), 'ceiling-height-low')
    expect(f?.severity).toBe('CHECK')
    expect(f?.detail).toMatch(/habitable/)
  })

  it('is quiet at 7-0 and above', () => {
    expect(ids(good({ ceilingM: 2.1336 }))).not.toContain('ceiling-height-low')
    expect(ids(good({ ceilingM: 2.44 }))).not.toContain('ceiling-height-stop')
  })
})

describe('openings', () => {
  it('flags a wall run with no opening in it', () => {
    const f = byId(good({ openings: [] }), 'no-openings')
    expect(f?.severity).toBe('CHECK')
    // the reason matters: framing reads openings from PLACED objects
    expect(f?.detail).toMatch(/PLACED/)
  })

  it('flags a normal 3068 door as nothing at all', () => {
    const ids0 = ids(good())
    expect(ids0).not.toContain('header-large')
    expect(ids0).not.toContain('header-engineered')
  })

  it('measures the ROUGH opening, not the leaf — a pocket door takes twice the wall', () => {
    // A 1.4 m leaf frames 2 x leaf + 1" = 2.825 m = 9.27 ft. Read as a leaf it
    // would have been a quiet 4.6 ft and the rule would never fire, which is the
    // whole point of going through roughOpening().
    const input = good({ openings: [{ type: 'door', subtype: 'Pocket', widthM: 1.4, level: 0 }] })
    const f = byId(input, 'header-engineered')
    expect(f).toBeTruthy()
    expect(f?.detail).toMatch(/9\.2\d ft/)
  })

  it('sends anything past 8 ft to an engineered header, not a built-up one', () => {
    const f = byId(good({ openings: [{ type: 'window', subtype: 'Fixed', widthM: 2.5, level: 0 }] }), 'header-engineered')
    expect(f?.severity).toBe('CHECK')
    expect(f?.citation).toMatch(/R602\.7/)
    // and it does not double up with the lesser rule
    expect(ids(good({ openings: [{ type: 'window', subtype: 'Fixed', widthM: 2.5, level: 0 }] }))).not.toContain('header-large')
  })

  it('adds the steel note only on a steel build', () => {
    const wide = [{ type: 'window' as const, subtype: 'Fixed', widthM: 2.0, level: 0 }]
    expect(ids(good({ openings: wide, framingMaterial: 'steel' }))).toContain('steel-header')
    expect(ids(good({ openings: wide, framingMaterial: 'wood' }))).not.toContain('steel-header')
  })
})

describe('walls that were never classified', () => {
  it('says so when the type and role were left at the default', () => {
    const f = byId(good({ walls: [wall({ framingType: undefined, wallRole: undefined })] }), 'wall-unclassified')
    expect(f?.severity).toBe('FYI')
  })

  it('stays quiet when they were classified', () => {
    expect(ids(good())).not.toContain('wall-unclassified')
  })

  it('marks up walls inferred from rooms as estimates', () => {
    const f = byId(good({ walls: [wall({ roomDerived: true })] }), 'walls-inferred')
    expect(f?.severity).toBe('FYI')
  })
})

describe('the reply', () => {
  it('grades worst first', () => {
    const input = good({
      scaleMmPerPx: null,
      walls: [wall({ framingType: undefined, wallRole: undefined })],
      roofs: [],
    })
    const sev = reviewBuildModel(input).map((f) => f.severity)
    expect(sev).toEqual([...sev].sort((a, b) => ({ STOP: 0, CHECK: 1, FYI: 2 })[a] - ({ STOP: 0, CHECK: 1, FYI: 2 })[b]))
    expect(sev[0]).toBe('STOP')
  })

  it('leads with the count and carries the fix and the citation on the line', () => {
    const text = formatFindings(reviewBuildModel(good({ scaleMmPerPx: null, roofs: [] })))
    expect(text.split('\n')[0]).toMatch(/^2 findings — 1 to fix first, 1 to verify\./)
    expect(text).toMatch(/• \[STOP\]/)
    expect(text).toMatch(/• \[CHECK\]/)
    expect(text).toMatch(/Recalibrate/)
  })

  it('does not claim to have found something when it found nothing', () => {
    expect(formatFindings([])).toBe('Nothing to flag. Nothing I can check is missing or outside a rule.')
  })
})

/**
 * Every finding has to say WHERE it is, or the panel can only describe it.
 *
 * These assert the indices point at the element the rule was actually about —
 * the widest opening, the unclassified wall — because an index that is merely
 * in range still puts the camera on the wrong wall, and that is worse than not
 * moving the camera at all.
 */
describe('findings can be jumped to', () => {
  it('gives every finding a target', () => {
    const input = good({ scaleMmPerPx: null, roofs: [], floors: [] })
    for (const f of reviewBuildModel(input)) expect(f.target).toBeDefined()
  })

  it('aims a whole-build finding at the building', () => {
    expect(byId(good({ scaleMmPerPx: null }), 'scale')?.target).toEqual({ focus: 'building' })
  })

  it('points a storey finding at that storey', () => {
    const t = byId(good({ walls: [wall(), wall({ x1: 0, y1: 0, x2: 400, y2: 400, level: 1 })] }), 'storey-unsupported-1')?.target
    expect(t).toEqual({ focus: 'storey', level: 1 })
  })

  it('points a header finding at the WIDEST opening, not the first', () => {
    // Second opening is the one that needs the engineered beam.
    const openings = [
      { type: 'door', subtype: 'Hinged Single', widthM: 0.9144, level: 0 },
      { type: 'door', subtype: 'Garage', widthM: 3.0, level: 0 },
    ]
    expect(byId(good({ openings }), 'header-engineered')?.target).toEqual({
      focus: 'opening', openingIndex: 1, level: 0,
    })
    // One opening, one sentence: "1 opening needs", not "1 opening need".
    expect(byId(good({ openings }), 'header-engineered')?.title).toBe('1 opening needs an engineered header')
  })

  it('points a wall finding at a wall that is actually affected', () => {
    const walls = [
      wall({ framingType: 'wood-2x6', wallRole: 'exterior-bearing' }),
      wall({ x1: 0, y1: 0, x2: 400, y2: 400, framingType: undefined, wallRole: undefined }),
    ]
    const target = byId(good({ walls }), 'wall-unclassified')?.target
    expect(target?.focus).toBe('wall')
    expect(target?.wallIndex).toBe(1)
    expect(walls[target!.wallIndex!].roomDerived).toBeUndefined()
    expect(walls[target!.wallIndex!].wallRole).toBeUndefined()
  })

  it('aims a missing ceiling at the ground storey top, not at the site', () => {
    const t = byId(good({ floors: [{ level: 0, elementType: 'I-Joist' }] }), 'ceiling-missing')?.target
    expect(t).toEqual({ focus: 'storey', level: 0 })
  })
})
