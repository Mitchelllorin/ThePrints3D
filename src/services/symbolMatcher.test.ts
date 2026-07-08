import { describe, it, expect } from 'vitest'
import { findSimilarSymbols, findAdditionalSymbols, toGrayImage, type GrayImage, type SeedBox } from './symbolMatcher'

const W = 220, H = 120
const GS = 12 // glyph box side

function blank(): GrayImage {
  const data = new Uint8ClampedArray(W * H).fill(255) // white paper
  return { data, width: W, height: H }
}

/** Stamp an asymmetric "L" glyph (left column + bottom row dark) so orientation
 *  is distinguishable under rotation. rot/flip transform the stamp. */
function stampL(img: GrayImage, x0: number, y0: number, rot: 0 | 90 | 180 | 270 = 0, flip = false) {
  for (let y = 0; y < GS; y++) {
    for (let x = 0; x < GS; x++) {
      // Thick, distinctive "L": left column + bottom row + a top-right notch, so
      // it's clearly asymmetric under rotation and not self-similar.
      const isInk = x <= 2 || y >= GS - 3 || (x >= GS - 3 && y <= 2)
      if (!isInk) continue
      // Apply flip then rotation to the local coords.
      let lx = flip ? GS - 1 - x : x
      let ly = y
      for (let i = 0; i < rot / 90; i++) { const nx = GS - 1 - ly; const ny = lx; lx = nx; ly = ny }
      ;(img.data as Uint8ClampedArray)[(y0 + ly) * W + (x0 + lx)] = 20
    }
  }
}

/** A different shape (solid filled block) as a distractor. */
function stampBlock(img: GrayImage, x0: number, y0: number) {
  for (let y = 0; y < GS; y++)
    for (let x = 0; x < GS; x++) (img.data as Uint8ClampedArray)[(y0 + y) * W + (x0 + x)] = 20
}

const seedAt = (x: number, y: number): SeedBox => ({ x, y, w: GS, h: GS })

describe('findSimilarSymbols', () => {
  it('finds every identical instance and flags the seed', () => {
    const img = blank()
    stampL(img, 10, 10)
    stampL(img, 70, 10)
    stampL(img, 130, 50)
    const matches = findSimilarSymbols(img, seedAt(10, 10), { rotations: [0], allowFlip: false })
    expect(matches.length).toBe(3)
    expect(matches.filter((m) => m.isSeed).length).toBe(1)
    const seed = matches.find((m) => m.isSeed)!
    expect(seed.x).toBeCloseTo(16, 0) // 10 + GS/2
    expect(seed.y).toBeCloseTo(16, 0)
  })

  it('does not match a differently-shaped distractor', () => {
    const img = blank()
    stampL(img, 10, 10)
    stampL(img, 70, 10)
    stampBlock(img, 130, 50) // solid block ≠ L
    const matches = findSimilarSymbols(img, seedAt(10, 10), { rotations: [0], allowFlip: false })
    // Only the two L's; the block is far below threshold.
    expect(matches.length).toBe(2)
    expect(matches.every((m) => Math.hypot(m.x - 136, m.y - 56) > 8)).toBe(true)
  })

  it('finds rotated instances and reports the rotation', () => {
    const img = blank()
    stampL(img, 10, 10, 0)
    stampL(img, 80, 10, 90)
    stampL(img, 150, 50, 180)
    const matches = findSimilarSymbols(img, seedAt(10, 10), { rotations: [0, 90, 180, 270], allowFlip: false })
    expect(matches.length).toBe(3)
    const rots = new Set(matches.map((m) => m.rotation))
    expect(rots.has(90)).toBe(true)
    expect(rots.has(180)).toBe(true)
  })

  it('finds a mirrored instance when flip is allowed', () => {
    const img = blank()
    stampL(img, 10, 10)
    stampL(img, 80, 10, 0, true) // horizontal mirror
    const withFlip = findSimilarSymbols(img, seedAt(10, 10), { rotations: [0], allowFlip: true })
    expect(withFlip.length).toBe(2)
    expect(withFlip.some((m) => m.flipped)).toBe(true)
    // Without flip (and without rotations), the mirror should NOT match.
    const noFlip = findSimilarSymbols(img, seedAt(10, 10), { rotations: [0], allowFlip: false })
    expect(noFlip.length).toBe(1)
  })

  it('findAdditionalSymbols returns only "the rest" (excludes the seed)', () => {
    const img = blank()
    stampL(img, 10, 10)
    stampL(img, 70, 10)
    stampL(img, 130, 50)
    const rest = findAdditionalSymbols(img, seedAt(10, 10), { rotations: [0], allowFlip: false })
    expect(rest.length).toBe(2)
    expect(rest.every((m) => !m.isSeed)).toBe(true)
  })

  it('a blank seed patch matches nothing', () => {
    const img = blank()
    stampL(img, 100, 50)
    const matches = findSimilarSymbols(img, seedAt(0, 0)) // top-left is empty paper
    expect(matches.length).toBe(0)
  })

  it('respects the score threshold (higher → fewer/no matches)', () => {
    const img = blank()
    stampL(img, 10, 10)
    stampL(img, 70, 10)
    const strict = findSimilarSymbols(img, seedAt(10, 10), { rotations: [0], allowFlip: false, threshold: 0.999 })
    // Exact copies still score ~1.0, so both remain.
    expect(strict.length).toBe(2)
  })
})

describe('toGrayImage', () => {
  it('converts RGBA to luma', () => {
    // 2×1: pure red, pure white.
    const data = new Uint8ClampedArray([255, 0, 0, 255, 255, 255, 255, 255])
    const g = toGrayImage({ data, width: 2, height: 1 })
    expect(g.width).toBe(2)
    expect(g.data[0]).toBe(76)  // 255*0.299
    expect(g.data[1]).toBe(255)
  })
})
