import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { DIGIT_ADVANCE, flatTopDigitGeometries, type FlatTopDigit } from '../src/brand/flatTop'

// The authored frame, in the app's units: 1000-unit em, 700 cap, 560 wide.
const SIZE = 0.62
const DEPTH = 0.18
const s = SIZE / 1000

const DIGITS: FlatTopDigit[] = ['3', '5', '7']
const PRISMS: Record<FlatTopDigit, number> = { '3': 4, '5': 4, '7': 3 }

function bounds(digit: FlatTopDigit): THREE.Box3 {
  const box = new THREE.Box3()
  for (const geometry of flatTopDigitGeometries(digit, { size: SIZE, depth: DEPTH, bevel: false })) {
    geometry.computeBoundingBox()
    box.union(geometry.boundingBox!)
  }
  return box
}

describe('the flat-top numerals', () => {
  it('builds every prism flat3.py builds, and nothing degenerate', () => {
    for (const digit of DIGITS) {
      const parts = flatTopDigitGeometries(digit, { size: SIZE, depth: DEPTH, bevel: false })
      expect(parts, digit).toHaveLength(PRISMS[digit])
      for (const part of parts) expect(part.getAttribute('position').count, digit).toBeGreaterThan(0)
    }
  })

  // They set together only if they share a cap height and a width. This is the
  // part that would catch a stray point being nudged for one glyph.
  it('shares one cap height and one width across the set', () => {
    for (const digit of DIGITS) {
      const box = bounds(digit)
      expect(box.min.x, digit).toBeCloseTo(0, 6)
      expect(box.max.x, digit).toBeCloseTo(560 * s, 6)
      // The cap is the flat top bar, so that edge is exact on all three.
      expect(box.max.y, digit).toBeCloseTo(700 * s, 6)
      // The bowl is a 40-step arc, so its lowest vertex can sit a hair above the
      // baseline rather than on it — flat3.py's polyline does the same. Within a
      // step is sitting on the baseline; a dropped prism would not be.
      expect(box.min.y, digit).toBeGreaterThanOrEqual(0)
      expect(box.min.y, digit).toBeLessThan(2 * s)
    }
  })

  // Baseline at y=0 and extrusion from z=0 are what let a drawn digit drop into
  // a line of Text3D without a hand-tuned offset.
  it('sits on the baseline and extrudes the way Text3D does', () => {
    for (const digit of DIGITS) {
      const box = bounds(digit)
      expect(box.min.z, digit).toBeCloseTo(0, 6)
      expect(box.max.z, digit).toBeCloseTo(DEPTH, 6)
    }
  })

  it('fits the advance slot of the numeral it replaces', () => {
    for (const digit of DIGITS) {
      expect(bounds(digit).max.x, digit).toBeLessThan(DIGIT_ADVANCE * s)
    }
  })
})
