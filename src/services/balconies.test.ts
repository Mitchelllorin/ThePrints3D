import { describe, it, expect } from 'vitest'
import { balconyShape, onBalcony, postsAlong } from './balconies'
import type { Balcony, ParsedWall } from '../types'

// 1 px = 10 mm: a 6 m x 4 m floor.
const w = (x1: number, y1: number, x2: number, y2: number) => ({ x1, y1, x2, y2, thickness: 20, source: 'user', level: 0 }) as unknown as ParsedWall
const box = [w(0, 0, 600, 0), w(600, 0, 600, 400), w(600, 400, 0, 400), w(0, 400, 0, 0)]
const bal = (x1: number, y1: number, x2: number, y2: number): Balcony => ({ id: 'b', level: 0, x1, y1, x2, y2, depthM: 1.8, kind: 'wood', guard: 'glass' })

describe('a balcony off an outside wall', () => {
  it('comes out on the outside, at its depth, from the wall face', () => {
    const s = balconyShape(bal(100, 400, 400, 400), box, 10)!
    expect(s.out[1]).toBeCloseTo(1)          // down the page: outside
    expect(s.a[1]).toBeCloseTo(410)          // the face, half the wall out
    expect(s.d[1]).toBeCloseTo(590)          // 1.8 m further
  })
  it('the same however the wall was drawn', () => {
    const s = balconyShape(bal(400, 0, 100, 0), box, 10)!
    expect(s.out[1]).toBeCloseTo(-1)
    expect(s.d[1]).toBeCloseTo(-190)
  })
  it('a tap on it finds it', () => {
    const s = balconyShape(bal(100, 400, 400, 400), box, 10)!
    expect(onBalcony(s, { x: 250, y: 500 })).toBe(true)
    expect(onBalcony(s, { x: 250, y: 300 })).toBe(false)
  })
  it('guard posts never more than 1.5 m apart, one at each end', () => {
    const p = postsAlong(4)
    expect(p[0]).toBe(0)
    expect(p[p.length - 1]).toBe(4)
    for (let i = 1; i < p.length; i++) expect(p[i] - p[i - 1]).toBeLessThanOrEqual(1.5)
  })
})
