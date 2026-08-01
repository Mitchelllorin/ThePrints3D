import { describe, it, expect } from 'vitest'
import { perimeterTest, outwardSign, inwardSign, footprintCentroids } from './wallFacing'

// A 800x500 rectangle with one partition straight through the middle.
const N = { x1: 100, y1: 100, x2: 900, y2: 100, level: 0 }
const E = { x1: 900, y1: 100, x2: 900, y2: 600, level: 0 }
const S = { x1: 900, y1: 600, x2: 100, y2: 600, level: 0 }
const W = { x1: 100, y1: 600, x2: 100, y2: 100, level: 0 }
const PARTITION = { x1: 500, y1: 100, x2: 500, y2: 600, level: 0 }
const SHELL = [N, E, S, W]

describe('which walls are on the outside', () => {
  it('picks the four shell walls and not the partition', () => {
    // The partition runs wall-to-wall and touches the footprint at both ends, so
    // "touches the edge" is not enough — it must LIE ALONG one.
    const onPerimeter = perimeterTest([...SHELL, PARTITION])
    for (const w of SHELL) expect(onPerimeter(w)).toBe(true)
    expect(onPerimeter(PARTITION)).toBe(false)
  })

  it('rejects a partition that runs parallel to a wall but inside it', () => {
    const inner = { x1: 200, y1: 300, x2: 800, y2: 300, level: 0 }
    expect(perimeterTest([...SHELL, inner])(inner)).toBe(false)
  })

  it('tolerates a hand-traced line that wanders off the edge', () => {
    // Traced by hand a few pixels inside the corner — still the north wall.
    const sloppy = { x1: 104, y1: 103, x2: 896, y2: 102, level: 0 }
    expect(perimeterTest([...SHELL, sloppy])(sloppy)).toBe(true)
  })

  it('says nothing is exterior when there are no walls', () => {
    expect(perimeterTest([])(N)).toBe(false)
  })
})

describe('which face is out', () => {
  it('always makes inside the opposite of outside', () => {
    const c = footprintCentroids(SHELL)[0]
    for (const w of SHELL) {
      expect(inwardSign(w, c)).toBe(outwardSign(w, c) === 1 ? -1 : 1)
    }
  })

  it('centres the footprint on the shell, per storey', () => {
    const upper = SHELL.map((w) => ({ ...w, level: 1, x1: w.x1 + 1000, x2: w.x2 + 1000 }))
    const c = footprintCentroids([...SHELL, ...upper])
    expect(c[0].x).toBeCloseTo(500, 6)
    expect(c[1].x).toBeCloseTo(1500, 6)   // judged against its OWN outline
  })
})
