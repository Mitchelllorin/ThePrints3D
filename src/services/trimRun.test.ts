import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { buildTrimRun, buildOpeningCasing, trimTakeoff } from './trimRun'
import {
  TRIM_PROFILES, trimProfile, profilesOfKind, profileAreaM2, profileProudM, profileWidthM,
} from './trimProfiles'

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)
const OUT = V(0, 0, 1)   // a wall facing +Z
const need = (id: string) => {
  const p = trimProfile(id)
  if (!p) throw new Error(`missing profile ${id}`)
  return p
}

function positions(g: THREE.Group): Float32Array {
  const mesh = g.children[0] as THREE.Mesh
  return mesh.geometry.getAttribute('position').array as Float32Array
}

describe('trim profiles', () => {
  it('are all wound counter-clockwise', () => {
    // A clockwise outline sweeps into a solid with its faces inside out, which
    // renders as a hole rather than a board. Signed area catches it at the
    // source instead of in somebody's screenshot.
    for (const p of TRIM_PROFILES) {
      expect(profileAreaM2(p), `${p.id} is wound backwards`).toBeGreaterThan(0)
    }
  })

  it('are milled sizes, not nominal ones', () => {
    // A 1x4 is 3-1/2 inch and 3/4 inch thick. Same rule as the 2x8 being 7-1/4:
    // this geometry is also the takeoff, so nominal numbers are wrong by an
    // inch a board.
    const c = need('corner-1x4')
    expect(profileWidthM(c)).toBeCloseTo(3.5 * 0.0254, 6)
    expect(profileProudM(c)).toBeCloseTo(0.75 * 0.0254, 6)
    expect(profileWidthM(need('frieze-1x8'))).toBeCloseTo(7.25 * 0.0254, 6)
  })

  it('offers more than one choice for every run a house needs', () => {
    for (const kind of ['corner-board', 'casing', 'base', 'crown'] as const) {
      expect(profilesOfKind(kind).length, kind).toBeGreaterThan(1)
    }
  })

  it('gives a craftsman casing a step a colonial does not have', () => {
    // The backband is the whole difference. Without it the two render alike and
    // the picker is a lie.
    const craftsman = need('casing-craftsman')
    const flatStock = need('casing-flat-1x4')
    expect(profileProudM(craftsman)).toBeGreaterThan(profileProudM(flatStock))
  })
})

describe('buildTrimRun', () => {
  it('sweeps a straight run and reports its length', () => {
    const g = buildTrimRun({ profile: need('base-ranch'), path: [V(0, 0, 0), V(4, 0, 0)], normal: OUT })
    expect(g.children).toHaveLength(1)
    expect(g.userData.lengthM).toBeCloseTo(4, 3)
  })

  it('carries a volume so the takeoff can price it', () => {
    const p = need('corner-1x4')
    const g = buildTrimRun({ profile: p, path: [V(0, 0, 0), V(0, 2.4, 0)], normal: OUT })
    expect(g.userData.volumeM3).toBeCloseTo(profileAreaM2(p) * 2.4, 5)
  })

  it('builds nothing from a degenerate path', () => {
    expect(buildTrimRun({ profile: need('base-ranch'), path: [V(0, 0, 0)], normal: OUT }).children).toHaveLength(0)
    // A repeated point is not a run; it also has no direction, and one of those
    // used to make every frame after it NaN.
    expect(buildTrimRun({
      profile: need('base-ranch'), path: [V(1, 0, 0), V(1, 0, 0)], normal: OUT,
    }).children).toHaveLength(0)
  })

  it('never emits NaN, even when the path runs along the normal', () => {
    // `across` is normal x tangent, which collapses when the two are parallel.
    const g = buildTrimRun({ profile: need('casing-flat-1x4'), path: [V(0, 0, 0), V(0, 0, 3)], normal: OUT })
    expect(g.children).toHaveLength(1)
    expect([...positions(g)].every(Number.isFinite)).toBe(true)
  })

  it('widens the profile at a corner instead of pinching it', () => {
    // THE MITRE. Sitting a ring on the bisector foreshortens it by cos(theta/2);
    // a square corner therefore has to be 1/cos(45) = 1.414x wider, or the
    // board visibly necks exactly where two walls meet.
    const p = need('corner-1x4')
    const g = buildTrimRun({
      profile: p,
      path: [V(-2, 0, 0), V(0, 0, 0), V(0, 0, -2)],
      normal: V(0, 1, 0),
    })
    const pos = positions(g)
    const ringN = p.points.length
    // Profile points 0 and 1 are [0,0] and [w,0] — the two ends of the board's
    // face. The world distance between them IS w x mitre, so comparing that at
    // the corner against a straight end measures the mitre and nothing else.
    // (Comparing raw coordinate ranges instead measures the path offset, which
    // is how the first version of this test came out at 0.04.)
    const faceWidth = (i: number) => {
      const o = i * ringN * 3
      return Math.hypot(pos[o + 3] - pos[o], pos[o + 4] - pos[o + 1], pos[o + 5] - pos[o + 2])
    }
    expect(faceWidth(0)).toBeCloseTo(profileWidthM(p), 6)
    expect(faceWidth(1) / faceWidth(0)).toBeCloseTo(Math.SQRT2, 3)
  })

  it('clamps a fold rather than firing a spike at the horizon', () => {
    // A path that doubles back has theta -> 0, so 1/cos(theta/2) -> infinity.
    const g = buildTrimRun({
      profile: need('corner-1x4'),
      path: [V(-1, 0, 0), V(0, 0, 0), V(-1, 0, 0.001)],
      normal: V(0, 1, 0),
    })
    const far = Math.max(...[...positions(g)].map(Math.abs))
    expect(far).toBeLessThan(2)
  })

  it('caps an open run and leaves a closed one uncapped', () => {
    // An uncapped open run renders as a hole straight through the board where
    // the baseboard stops at a doorway.
    const p = need('base-ranch')
    const open = buildTrimRun({ profile: p, path: [V(0, 0, 0), V(2, 0, 0)], normal: OUT })
    const loop = buildTrimRun({
      profile: p, path: [V(0, 0, 0), V(2, 0, 0), V(2, 0, 2), V(0, 0, 2)], normal: OUT, closed: true,
    })
    const tris = (g: THREE.Group) => ((g.children[0] as THREE.Mesh).geometry.getIndex()!.count) / 3
    const ringN = p.points.length
    expect(tris(open)).toBe(ringN * 2 + (ringN - 2) * 2)  // one segment + two caps
    expect(tris(loop)).toBe(ringN * 2 * 4)                // four segments, no caps
  })

  it('closes the loop back to the start', () => {
    const g = buildTrimRun({
      profile: need('band-1x4'),
      path: [V(0, 0, 0), V(3, 0, 0), V(3, 0, 3), V(0, 0, 3)],
      normal: V(0, 1, 0),
      closed: true,
    })
    expect(g.userData.lengthM).toBeCloseTo(12, 3)
  })
})

describe('buildOpeningCasing', () => {
  const common = {
    center: V(0, 1.2, 0), along: V(1, 0, 0), up: V(0, 1, 0), normal: OUT,
    widthM: 0.9, heightM: 1.2,
  }

  it('frames an opening on all four sides by default', () => {
    const g = buildOpeningCasing({ profile: need('casing-colonial'), ...common })
    expect(g.children).toHaveLength(4)
  })

  it('runs each leg past the opening so the corners close', () => {
    // Stopping every leg at the opening's own corner leaves four square notches
    // of bare wall — the tell that trim was drawn on rather than built.
    const p = need('casing-flat-1x4')
    const g = buildOpeningCasing({ profile: p, ...common })
    const head = g.children[0] as THREE.Group
    expect(head.userData.lengthM).toBeCloseTo(common.widthM + profileWidthM(p) * 2, 3)
  })

  it('leaves the sill leg off a window that gets a real sill', () => {
    const g = buildOpeningCasing({
      profile: need('casing-colonial'), ...common, sides: { sill: false },
    })
    expect(g.children).toHaveLength(3)
  })

  it('totals its legs for the takeoff', () => {
    const g = buildOpeningCasing({ profile: need('casing-colonial'), ...common })
    const legs = g.children.reduce((n, c) => n + (c.userData.lengthM as number), 0)
    expect(g.userData.lengthM).toBeCloseTo(legs, 3)
  })
})

describe('trimTakeoff', () => {
  it('adds up linear metres per profile without double-counting a frame', () => {
    // buildOpeningCasing is a group of run groups, and both levels carry
    // `trim` + `lengthM`. Counting both would report every casing twice.
    const scene = new THREE.Group()
    scene.add(buildTrimRun({ profile: need('corner-1x4'), path: [V(0, 0, 0), V(0, 2.4, 0)], normal: OUT }))
    scene.add(buildTrimRun({ profile: need('corner-1x4'), path: [V(3, 0, 0), V(3, 2.4, 0)], normal: OUT }))
    scene.add(buildOpeningCasing({
      profile: need('casing-colonial'),
      center: V(1.5, 1.2, 0), along: V(1, 0, 0), up: V(0, 1, 0), normal: OUT,
      widthM: 0.9, heightM: 1.2,
    }))

    const t = trimTakeoff(scene)
    expect(t.get('corner-1x4')).toBeCloseTo(4.8, 3)

    const casing = t.get('casing-colonial')!
    const w = profileWidthM(need('casing-colonial'))
    // Lengths are rounded to the millimetre at each level (run, frame, takeoff),
    // so the tolerance here is millimetres and not less.
    expect(casing).toBeCloseTo((0.9 + w * 2) * 2 + (1.2 + w * 2) * 2, 2)
  })
})
