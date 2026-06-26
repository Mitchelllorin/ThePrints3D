import { describe, expect, it } from 'vitest'
import { detectWallPairs, type DetectedSeg } from './wallDetector'

function seg(x1: number, y1: number, x2: number, y2: number): DetectedSeg {
  return { x1, y1, x2, y2, thickness: 1, source: 'auto', detectionConfidence: 1 }
}

/**
 * detectWallPairs pairs the two detected faces of a wall and must record the
 * wall CENTERLINE — the midpoint between the faces — so the emitted wall sits
 * flush on its centre. Snapping a trace onto a face would offset it by half the
 * thickness ("offset, not flush").
 */
describe('detectWallPairs — centerline from face pair', () => {
  it('records the centerline between two horizontal faces', () => {
    // Two long horizontal faces 12px apart → centerline at y = 36, thickness 12.
    const segs = [seg(10, 30, 230, 30), seg(10, 42, 230, 42)]
    detectWallPairs(segs, 'h', 48)

    const kept = segs.find((s) => s.thickness > 1)!
    expect(kept).toBeDefined()
    expect(kept.thickness).toBe(12)
    expect(kept.centerY).toBe(36)
    // The midpoint is genuinely off both faces, not sitting on one of them.
    expect(kept.centerY).not.toBe(30)
    expect(kept.centerY).not.toBe(42)
  })

  it('records the centerline between two vertical faces', () => {
    // Two long vertical faces 10px apart → centerline at x = 45, thickness 10.
    const segs = [seg(40, 10, 40, 200), seg(50, 10, 50, 200)]
    detectWallPairs(segs, 'v', 48)

    const kept = segs.find((s) => s.thickness > 1)!
    expect(kept.thickness).toBe(10)
    expect(kept.centerX).toBe(45)
  })

  it('leaves an unpaired face uncentered (no false centerline)', () => {
    const segs = [seg(10, 30, 230, 30)] // lone face, no partner within range
    detectWallPairs(segs, 'h', 48)

    expect(segs[0].thickness).toBe(1)
    expect(segs[0].centerY).toBeUndefined()
  })

  it('does not pair faces farther apart than maxSep', () => {
    const segs = [seg(10, 30, 230, 30), seg(10, 120, 230, 120)] // 90px apart
    detectWallPairs(segs, 'h', 48)

    expect(segs.every((s) => s.thickness === 1)).toBe(true)
    expect(segs.every((s) => s.centerY === undefined)).toBe(true)
  })

  it('pairs a thin partition with its NEAREST face, not a thicker neighbour', () => {
    // A 12px partition (y=100/112) with a third face (y=140) from another wall
    // all within maxSep. The partition's top face must pair its own bottom face
    // (sep 12), NOT swallow the y=140 face — which stays free for its own pair.
    const segs = [
      seg(10, 100, 230, 100), // partition top
      seg(10, 112, 230, 112), // partition bottom (nearest partner, sep 12)
      seg(10, 140, 230, 140), // a different wall's face (sep 40 — must stay free)
    ]
    detectWallPairs(segs, 'h', 48)

    expect(segs[0].thickness).toBe(12)
    expect(segs[0].centerY).toBe(106)
    // The far face is not consumed by the partition — no false centerline.
    expect(segs[2].thickness).toBe(1)
    expect(segs[2].centerY).toBeUndefined()
  })
})
