import { describe, it, expect } from 'vitest'
import { generateRoofPlanes, summarizeRoof } from './roofPlanes'

describe('summarizeRoof', () => {
  it('flat roof: sloped area equals plan area (no ridge/hip/valley)', () => {
    const q = summarizeRoof(generateRoofPlanes({ lenX: 10, lenZ: 6 }, 'flat', 0, 0))
    expect(q.planAreaM2).toBeCloseTo(60, 3)
    expect(q.surfaceAreaM2).toBeCloseTo(60, 3) // pitch 0 → slope factor 1
    expect(q.ridgeM).toBe(0)
    expect(q.hipM).toBe(0)
    expect(q.valleyM).toBe(0)
  })

  it('gable roof: sloped area exceeds footprint by √(1+pitch²); one ridge, no hips', () => {
    const pitch = 0.5
    const q = summarizeRoof(generateRoofPlanes({ lenX: 10, lenZ: 6 }, 'gable', pitch, 0))
    expect(q.planAreaM2).toBeCloseTo(60, 3)
    expect(q.surfaceAreaM2).toBeCloseTo(60 * Math.sqrt(1 + pitch * pitch), 2) // ≈ 67.08
    expect(q.surfaceAreaM2).toBeGreaterThan(q.planAreaM2)
    expect(q.ridgeM).toBeCloseTo(10, 3) // ridge runs the long side
    expect(q.hipM).toBe(0)
    expect(q.eaveM).toBeCloseTo(20, 3) // two eaves, each the long wall
  })

  it('hip roof: four planes, one ridge + four hips, plan area preserved', () => {
    const q = summarizeRoof(generateRoofPlanes({ lenX: 10, lenZ: 6 }, 'hip', 0.5, 0))
    expect(q.planAreaM2).toBeCloseTo(60, 2)
    expect(q.ridgeM).toBeCloseTo(4, 2) // L - W = 10 - 6
    expect(q.hipM).toBeGreaterThan(0)
    expect(q.surfaceAreaM2).toBeGreaterThan(q.planAreaM2)
  })

  it('eave overhang enlarges the covering area', () => {
    const noOH = summarizeRoof(generateRoofPlanes({ lenX: 10, lenZ: 6 }, 'gable', 0.5, 0))
    const withOH = summarizeRoof(generateRoofPlanes({ lenX: 10, lenZ: 6 }, 'gable', 0.5, 0.4))
    expect(withOH.surfaceAreaM2).toBeGreaterThan(noOH.surfaceAreaM2)
  })
})
