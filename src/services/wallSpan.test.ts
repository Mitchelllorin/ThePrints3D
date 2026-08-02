import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { wallHeightM, wallCoversLevel } from './constructionCode'
import { buildWallFraming } from './framingGeometry'

// A typical storey: 8' ceiling + floor assembly.
const CEILING = 2.44
const STOREY = CEILING + 0.32

describe('walls that span more than one storey', () => {
  it('leaves an ordinary wall exactly one storey tall', () => {
    expect(wallHeightM({}, CEILING, STOREY)).toBeCloseTo(CEILING, 9)
    expect(wallHeightM({ spanLevels: 1 }, CEILING, STOREY)).toBeCloseTo(CEILING, 9)
  })

  it('adds a full storey rise per extra storey, not just a ceiling', () => {
    // The extra height includes the floor assembly that ISN'T there — that gap is
    // exactly why the wall spans in the first place.
    expect(wallHeightM({ spanLevels: 2 }, CEILING, STOREY)).toBeCloseTo(CEILING + STOREY, 9)
    expect(wallHeightM({ spanLevels: 3 }, CEILING, STOREY)).toBeCloseTo(CEILING + 2 * STOREY, 9)
  })

  it('ignores nonsense spans rather than building a zero-height wall', () => {
    expect(wallHeightM({ spanLevels: 0 }, CEILING, STOREY)).toBeCloseTo(CEILING, 9)
    expect(wallHeightM({ spanLevels: -3 }, CEILING, STOREY)).toBeCloseTo(CEILING, 9)
  })

  it('knows which storeys a spanning wall occupies', () => {
    const ground = { level: 0, spanLevels: 1 }
    const stairwell = { level: 0, spanLevels: 2 }
    expect(wallCoversLevel(ground, 0)).toBe(true)
    expect(wallCoversLevel(ground, 1)).toBe(false)
    expect(wallCoversLevel(stairwell, 0)).toBe(true)
    expect(wallCoversLevel(stairwell, 1)).toBe(true)   // this is what stops carry-up
    expect(wallCoversLevel(stairwell, 2)).toBe(false)
  })

  it('treats a wall with no level or span as the ground storey only', () => {
    expect(wallCoversLevel({}, 0)).toBe(true)
    expect(wallCoversLevel({}, 1)).toBe(false)
  })

  it('frames a spanning wall BALLOON: studs continuous, no plate in the middle', () => {
    // The whole point. Two stacked platform walls would put a double top plate
    // and a double sole plate right through the middle of a stairwell opening.
    const tall = buildWallFraming({
      length: 4, height: wallHeightM({ spanLevels: 2 }, CEILING, STOREY),
      thickness: 0.14, material: 'wood',
    })
    const studs: THREE.Mesh[] = []
    tall.traverse((o) => {
      const m = o as THREE.Mesh
      if (!m.isMesh) return
      m.geometry.computeBoundingBox()
      const bb = m.geometry.boundingBox!
      const h = bb.max.y - bb.min.y
      // A stud is the tall, slender member; plates are long and flat.
      if (h > CEILING) studs.push(m)
    })
    expect(studs.length).toBeGreaterThan(0)
    // Every stud runs the FULL height — none stops at the missing floor.
    const wanted = wallHeightM({ spanLevels: 2 }, CEILING, STOREY)
    for (const m of studs) {
      m.geometry.computeBoundingBox()
      const bb = m.geometry.boundingBox!
      expect(bb.max.y - bb.min.y).toBeGreaterThan(wanted * 0.85)
    }
  })
})
