import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import {
  resolveOverhang, overhangIsAsymmetric, buildRoofByType,
  type OverhangSpec, type RoofEdge,
} from './framingGeometry'

const EDGES: RoofEdge[] = ['eaveA', 'eaveB', 'rakeA', 'rakeB']

describe('resolveOverhang — one number, or per edge', () => {
  it('gives every edge the same value for a plain number', () => {
    for (const e of EDGES) expect(resolveOverhang(0.4, e)).toBeCloseTo(0.4, 9)
  })

  it('falls back to the default for edges that say nothing', () => {
    const spec: OverhangSpec = { default: 0.4, eaveA: 0.9 }
    expect(resolveOverhang(spec, 'eaveA')).toBeCloseTo(0.9, 9)
    expect(resolveOverhang(spec, 'eaveB')).toBeCloseTo(0.4, 9)
    expect(resolveOverhang(spec, 'rakeA')).toBeCloseTo(0.4, 9)
  })

  it('treats a missing spec as no overhang at all', () => {
    expect(resolveOverhang(undefined, 'eaveA')).toBe(0)
  })

  it('never returns a negative overhang', () => {
    expect(resolveOverhang(-2, 'eaveA')).toBe(0)
    expect(resolveOverhang({ default: 0.4, eaveB: -1 }, 'eaveB')).toBe(0)
  })

  it('lets an edge legitimately be zero without inheriting the default', () => {
    // A wall built to a lot line has no eave on that side — 0 is an ANSWER,
    // not a missing value, so it must not fall back.
    expect(resolveOverhang({ default: 0.4, eaveB: 0 }, 'eaveB')).toBe(0)
  })
})

describe('overhangIsAsymmetric', () => {
  it('is false for a single number', () => {
    expect(overhangIsAsymmetric(0.4)).toBe(false)
  })
  it('is false when every edge resolves the same', () => {
    expect(overhangIsAsymmetric({ default: 0.4, eaveA: 0.4 })).toBe(false)
  })
  it('is true when one edge differs', () => {
    expect(overhangIsAsymmetric({ default: 0.4, eaveA: 0.9 })).toBe(true)
  })
})

/** World-space Y range of every mesh whose info matches. */
function yRange(g: THREE.Object3D, re: RegExp): { min: number; max: number; n: number } {
  let min = Infinity, max = -Infinity, n = 0
  g.updateMatrixWorld(true)
  g.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh) return
    if (!re.test(String(m.userData?.info ?? ''))) return
    const geo = m.geometry
    if (!geo.boundingBox) geo.computeBoundingBox()
    const bb = geo.boundingBox!.clone().applyMatrix4(m.matrixWorld)
    min = Math.min(min, bb.min.y); max = Math.max(max, bb.max.y); n++
  })
  return { min, max, n }
}

/** World-space extent along an axis. */
function axisRange(g: THREE.Object3D, re: RegExp, axis: 'x' | 'z') {
  let min = Infinity, max = -Infinity
  g.updateMatrixWorld(true)
  g.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh) return
    if (!re.test(String(m.userData?.info ?? ''))) return
    const geo = m.geometry
    if (!geo.boundingBox) geo.computeBoundingBox()
    const bb = geo.boundingBox!.clone().applyMatrix4(m.matrixWorld)
    min = Math.min(min, bb.min[axis]); max = Math.max(max, bb.max[axis])
  })
  return { min, max }
}

describe('the roof covers its own overhang', () => {
  // Ridge runs along the LONGER side, so with lenZ > lenX the eaves are at ±x.
  const base = { lenX: 8, lenZ: 12, pitch: 0.5, ocM: 0.4064 }

  it('runs the shingles out past the wall, not just the soffit', () => {
    const roof = buildRoofByType('gable', { ...base, overhangM: 0.9 })
    const shingles = axisRange(roof, /shingle/i, 'x')
    // Wall line is at ±4; the shingles must reach beyond it, not stop on it.
    expect(shingles.max).toBeGreaterThan(4.5)
    expect(shingles.min).toBeLessThan(-4.5)
  })

  it('drops the fascia to the tail, below the wall top', () => {
    const roof = buildRoofByType('gable', { ...base, overhangM: 0.9 })
    const fascia = yRange(roof, /^Fascia/)
    expect(fascia.n).toBeGreaterThan(0)
    // 0.9 m out at a 0.5 gradient descends 0.45 m below the eave line (y=0).
    expect(fascia.max).toBeLessThan(-0.3)
  })

  it('keeps the fascia at the wall line when the roof did NOT extend itself', () => {
    // A hip roof still stops at the wall, so its boxed eave must stay put —
    // dropping it would hang the soffit off nothing.
    const roof = buildRoofByType('hip', { ...base, overhangM: 0.9 })
    const fascia = yRange(roof, /^Fascia/)
    expect(fascia.n).toBeGreaterThan(0)
    expect(fascia.max).toBeGreaterThan(-0.05)
  })
})

describe('asymmetry — the thing the old scalar could not say', () => {
  const base = { lenX: 8, lenZ: 12, pitch: 0.5, ocM: 0.4064 }

  it('overhangs one eave further than the other', () => {
    const roof = buildRoofByType('gable', {
      ...base, overhangM: { default: 0.3, eaveA: 1.2 },
    })
    const shingles = axisRange(roof, /shingle/i, 'x')
    // eaveA is the +x side: it should reach ~5.2 while -x stops near -4.3.
    expect(shingles.max).toBeGreaterThan(5.0)
    expect(Math.abs(shingles.min)).toBeLessThan(4.6)
    expect(shingles.max).toBeGreaterThan(Math.abs(shingles.min) + 0.5)
  })

  it('gives each side its own fascia height, since each tail ends lower', () => {
    const roof = buildRoofByType('gable', {
      ...base, overhangM: { default: 0.3, eaveA: 1.2 },
    })
    const tops: number[] = []
    roof.updateMatrixWorld(true)
    roof.traverse((o) => {
      const m = o as THREE.Mesh
      if (!m.isMesh || !/^Fascia/.test(String(m.userData?.info ?? ''))) return
      const geo = m.geometry
      if (!geo.boundingBox) geo.computeBoundingBox()
      const bb = geo.boundingBox!.clone().applyMatrix4(m.matrixWorld)
      tops.push(+bb.max.y.toFixed(3))
    })
    const distinct = [...new Set(tops)]
    // Two eaves overhanging differently cannot share one fascia height.
    expect(distinct.length).toBeGreaterThan(1)
  })

  it('still builds symmetrically when given a single number', () => {
    const roof = buildRoofByType('gable', { ...base, overhangM: 0.6 })
    const shingles = axisRange(roof, /shingle/i, 'x')
    expect(shingles.max).toBeCloseTo(Math.abs(shingles.min), 1)
  })
})
