import { describe, it, expect } from 'vitest'
import {
  classifyWallType,
  pxToMm,
  FRAMING_MM,
} from './wallTypeClassifier'

describe('classifyWallType', () => {
  describe('single-layer drywall (default residential)', () => {
    // Finished = framing + 1¼" (32 mm)
    it('classifies a 4¾" finished wall as 2x4', () => {
      // 4¾" finished = 120.65 mm. Framing = 88.65 ≈ 89 mm (2x4)
      const result = classifyWallType(120.65, 'single-layer')
      expect(result.type).toBe('stud-2x4')
      expect(result.framingMm).toBeCloseTo(88.65, 1)
      expect(result.confidence).toBeGreaterThan(0.8)
    })

    it('classifies a 6¾" finished wall as 2x6', () => {
      // 6¾" = 171.45 mm. Framing = 139.45 ≈ 140 mm (2x6)
      const result = classifyWallType(171.45, 'single-layer')
      expect(result.type).toBe('stud-2x6')
      expect(result.confidence).toBeGreaterThan(0.8)
    })

    it('classifies a 2¾" finished wall as 1½" partition', () => {
      // 2¾" = 69.85 mm. Framing = 37.85 ≈ 41 mm
      const result = classifyWallType(69.85, 'single-layer')
      expect(result.type).toBe('partition-thin')
    })

    it('classifies a 16" thick wall as masonry', () => {
      // 16" = 406 mm finished, framing ≈ 374 mm — far beyond 2x12 → masonry
      const result = classifyWallType(406, 'single-layer')
      expect(result.type).toBe('masonry-thick')
    })

    it('returns unknown for too-thin lines (dimension/leader)', () => {
      expect(classifyWallType(30, 'single-layer').type).toBe('unknown')
    })
  })

  describe('double-layer drywall (fire-rated demising / shaft walls)', () => {
    // Finished = framing + 2½" (64 mm)
    it('classifies a 6" finished demising wall as 2x4 with double drywall', () => {
      // 6" = 152.4 mm. Framing = 88.4 ≈ 89 mm (2x4 with 2x drywall)
      const result = classifyWallType(152.4, 'double-layer')
      expect(result.type).toBe('stud-2x4')
    })

    it('classifies an 8" finished demising wall as 2x6 with double drywall', () => {
      // 8" = 203.2 mm. Framing = 139.2 ≈ 140 mm (2x6)
      const result = classifyWallType(203.2, 'double-layer')
      expect(result.type).toBe('stud-2x6')
    })
  })

  describe('no-drywall (raw framing — structural sheets)', () => {
    it('classifies 3½" raw framing as 2x4', () => {
      const result = classifyWallType(89, 'no-drywall')
      expect(result.type).toBe('stud-2x4')
      expect(result.confidence).toBeGreaterThan(0.9)
    })
  })

  it('exposes nominal framing for every bucket', () => {
    expect(FRAMING_MM['stud-2x4']).toBe(89)
    expect(FRAMING_MM['stud-2x6']).toBe(140)
    expect(FRAMING_MM['stud-2x8']).toBe(184)
  })
})

describe('pxToMm', () => {
  it('returns null when scale is missing', () => {
    expect(pxToMm(50, null)).toBeNull()
  })

  it('returns null for invalid scale values', () => {
    expect(pxToMm(50, 0)).toBeNull()
    expect(pxToMm(50, -1)).toBeNull()
    expect(pxToMm(50, NaN)).toBeNull()
  })

  it('converts pixels using calibrated scale', () => {
    // 1:50 metric @ 150 dpi rasterization ≈ 8.47 mm/px (typical)
    expect(pxToMm(10, 1.5)).toBeCloseTo(15, 5)
  })
})
