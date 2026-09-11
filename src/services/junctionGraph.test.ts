import { describe, it, expect } from 'vitest'
import {
  ARM_N,
  ARM_E,
  ARM_S,
  ARM_W,
  findJunctions,
  pairJunctions,
  maskSupport,
  buildJunctionSkeleton,
  type Junction,
} from './junctionGraph'

const W = 64
const H = 64

/** Four arm heatmaps the way synth.py writes them: a Gaussian per corner, in every channel it has an arm in. */
function heatmaps(corners: Array<[number, number, number]>, sigma = 1.5, peak = 1): Float32Array {
  const heat = new Float32Array(4 * W * H)
  for (const [cx, cy, arms] of corners) {
    for (let c = 0; c < 4; c++) {
      if (!(arms & (1 << c))) continue
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const v = peak * Math.exp(-((x - cx) ** 2 + (y - cy) ** 2) / (2 * sigma * sigma))
          const idx = c * W * H + y * W + x
          if (v > heat[idx]) heat[idx] = v
        }
      }
    }
  }
  return heat
}

/** A wall mask of axis-aligned walls, three pixels thick. */
function wallMask(lines: Array<[number, number, number, number]>): Float32Array {
  const mask = new Float32Array(W * H)
  for (const [x1, y1, x2, y2] of lines) {
    for (let y = Math.min(y1, y2) - 1; y <= Math.max(y1, y2) + 1; y++) {
      for (let x = Math.min(x1, x2) - 1; x <= Math.max(x1, x2) + 1; x++) {
        if (x >= 0 && x < W && y >= 0 && y < H) mask[y * W + x] = 1
      }
    }
  }
  return mask
}

/** How many walls meet at each corner. Two everywhere on a rectangle = the room closed. */
function degrees(n: number, segs: Array<{ from: number; to: number }>): number[] {
  const d = new Array(n).fill(0)
  for (const s of segs) {
    d[s.from]++
    d[s.to]++
  }
  return d
}

const RECT_CORNERS: Array<[number, number, number]> = [
  [10, 10, ARM_E | ARM_S],
  [50, 10, ARM_W | ARM_S],
  [50, 40, ARM_N | ARM_W],
  [10, 40, ARM_N | ARM_E],
]
const RECT_WALLS: Array<[number, number, number, number]> = [
  [10, 10, 50, 10],
  [50, 10, 50, 40],
  [10, 40, 50, 40],
  [10, 10, 10, 40],
]

describe('findJunctions', () => {
  it('reads one blob as one corner, where it is', () => {
    const found = findJunctions(heatmaps([[20, 30, ARM_E | ARM_S]]), W, H)
    expect(found).toHaveLength(1)
    expect(found[0].x).toBeCloseTo(20, 0)
    expect(found[0].y).toBeCloseTo(30, 0)
  })

  it('reads which ways the walls leave it', () => {
    const found = findJunctions(heatmaps([[30, 20, ARM_W | ARM_E | ARM_S]]), W, H)
    expect(found[0].arms).toBe(ARM_W | ARM_E | ARM_S)
  })

  it('finds a corner off the pixel grid within half a pixel', () => {
    const found = findJunctions(heatmaps([[20.4, 30.4, ARM_N]]), W, H)
    expect(Math.abs(found[0].x - 20.4)).toBeLessThan(0.5)
    expect(Math.abs(found[0].y - 30.4)).toBeLessThan(0.5)
  })

  it('makes one corner of a flat-topped peak, not a patch of them', () => {
    const heat = new Float32Array(4 * W * H)
    for (let y = 29; y <= 31; y++) for (let x = 19; x <= 21; x++) heat[y * W + x] = 1
    expect(findJunctions(heat, W, H)).toHaveLength(1)
  })

  it('ignores heat that never gets hot enough to be a corner', () => {
    expect(findJunctions(heatmaps([[20, 30, ARM_E]], 1.5, 0.3), W, H)).toHaveLength(0)
  })

  it('refuses heatmaps that are not four channels of this size', () => {
    expect(() => findJunctions(new Float32Array(W * H), W, H)).toThrow()
  })
})

describe('pairJunctions', () => {
  const j = (x: number, y: number, arms: number): Junction => ({ x, y, arms, score: 1 })

  it('joins arms that face each other', () => {
    expect(pairJunctions([j(10, 20, ARM_E), j(50, 20, ARM_W)])).toEqual([{ from: 0, to: 1, axis: 'h' }])
    expect(pairJunctions([j(10, 10, ARM_S), j(10, 50, ARM_N)])).toEqual([{ from: 0, to: 1, axis: 'v' }])
  })

  it('does not join corners whose arms point away from each other', () => {
    expect(pairJunctions([j(10, 20, ARM_W), j(50, 20, ARM_E)])).toEqual([])
  })

  it('allows for a print scanned a little crooked', () => {
    expect(pairJunctions([j(10, 20, ARM_E), j(50, 21.5, ARM_W)])).toHaveLength(1)
  })

  it('does not join a corner on a different row', () => {
    expect(pairJunctions([j(10, 20, ARM_E), j(20, 32, ARM_W)])).toEqual([])
  })

  it('never lets a wall leap the T in its way', () => {
    const pairs = pairJunctions([j(10, 20, ARM_E), j(30, 20, ARM_W | ARM_E), j(50, 20, ARM_W)])
    expect(pairs).toHaveLength(2)
    expect(pairs).not.toContainEqual({ from: 0, to: 2, axis: 'h' })
  })

  it('leaves an arm free when the nearest partner is vetoed', () => {
    const juncs = [j(10, 20, ARM_E), j(30, 20, ARM_W), j(50, 20, ARM_W)]
    const pairs = pairJunctions(juncs, {}, (_a, b) => b.x !== 30)
    expect(pairs).toEqual([{ from: 0, to: 2, axis: 'h' }])
  })
})

describe('maskSupport', () => {
  it('reads a wall that is there as fully backed', () => {
    const s = maskSupport(wallMask([[10, 20, 50, 20]]), W, H, 10, 20, 50, 20)
    expect(s.fraction).toBe(1)
    expect(s.longestGapPx).toBe(0)
  })

  it('reads open floor as no wall at all', () => {
    const s = maskSupport(new Float32Array(W * H), W, H, 10, 20, 50, 20)
    expect(s.fraction).toBe(0)
    expect(s.longestGapPx).toBeCloseTo(40, 0)
  })
})

describe('buildJunctionSkeleton', () => {
  it('closes a room — every corner meets exactly two walls', () => {
    const { junctions, segments } = buildJunctionSkeleton(heatmaps(RECT_CORNERS), wallMask(RECT_WALLS), W, H)
    expect(junctions).toHaveLength(4)
    expect(segments).toHaveLength(4)
    expect(degrees(junctions.length, segments)).toEqual([2, 2, 2, 2])
  })

  it('keeps a wall with a door in it', () => {
    // synth.py cuts the door out of the mask and not out of the corner labels.
    const { segments } = buildJunctionSkeleton(
      heatmaps([[10, 20, ARM_E], [50, 20, ARM_W]]),
      wallMask([[10, 20, 23, 20], [36, 20, 50, 20]]),
      W,
      H,
    )
    expect(segments).toHaveLength(1)
  })

  it('drops a wall the mask says is not there', () => {
    const { junctions, segments } = buildJunctionSkeleton(
      heatmaps(RECT_CORNERS),
      wallMask(RECT_WALLS.filter(([, y1, , y2]) => !(y1 === 40 && y2 === 40))),
      W,
      H,
    )
    expect(segments).toHaveLength(3)
    const bottom = segments.filter((s) => Math.round(s.y1) === 40 && Math.round(s.y2) === 40)
    expect(bottom).toHaveLength(0)
    expect(degrees(junctions.length, segments).sort()).toEqual([1, 1, 2, 2])
  })

  it('builds the walls either side of a T instead of one across it', () => {
    const { segments } = buildJunctionSkeleton(
      heatmaps([
        [10, 20, ARM_E],
        [30, 20, ARM_W | ARM_E | ARM_S],
        [50, 20, ARM_W],
        [30, 50, ARM_N],
      ]),
      wallMask([[10, 20, 50, 20], [30, 20, 30, 50]]),
      W,
      H,
    )
    const spans = segments.map((s) => `${Math.round(s.x1)},${Math.round(s.y1)}-${Math.round(s.x2)},${Math.round(s.y2)}`).sort()
    expect(spans).toEqual(['10,20-30,20', '30,20-30,50', '30,20-50,20'])
  })
})
