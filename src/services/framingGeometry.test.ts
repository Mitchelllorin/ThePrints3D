import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { buildFloorDeck, buildFloorJoists, buildRoofByType, buildFinkTrussRoof, buildWallFraming, buildRidgeRoof, ridgeIsShaped } from './framingGeometry'

const meshCount = (g: THREE.Object3D) => {
  let n = 0
  g.traverse((o) => { if ((o as THREE.Mesh).isMesh) n++ })
  return n
}

describe('roof renders for every type (regression lock)', () => {
  const opts = { lenX: 9, lenZ: 7, pitch: 0.5, ocM: 0.6096 }
  it('Fink truss produces geometry', () => {
    expect(meshCount(buildFinkTrussRoof(opts))).toBeGreaterThan(0)
  })
  for (const type of ['Truss', 'Gable', 'Hip', 'Shed', 'Flat', 'Gambrel', 'Saltbox']) {
    it(`buildRoofByType('${type}') produces geometry`, () => {
      expect(meshCount(buildRoofByType(type, opts))).toBeGreaterThan(0)
    })
  }
})

describe('gable-end rake termination', () => {
  const opts = { lenX: 9, lenZ: 7, pitch: 0.5, ocM: 0.6096 }
  const infos = (g: THREE.Object3D) => {
    const out: string[] = []
    g.traverse((o) => { if ((o as THREE.Mesh).isMesh) out.push((o.userData?.info as string) ?? '') })
    return out
  }
  const angledRakes = (g: THREE.Object3D) => {
    let n = 0
    g.traverse((o) => {
      const m = o as THREE.Mesh
      if (m.isMesh && m.userData?.info === 'Rake fascia') {
        // a rake must actually be tilted to follow the slope (not a flat board)
        if (Math.abs(m.rotation.x) > 0.05 || Math.abs(m.rotation.z) > 0.05) n++
      }
    })
    return n
  }

  it('gable & truss roofs get sloped rake fascia on the gable ends', () => {
    expect(angledRakes(buildRoofByType('Gable', opts))).toBeGreaterThan(0)
    expect(angledRakes(buildRoofByType('Truss', opts))).toBeGreaterThan(0)
  })
  it('hip / flat / shed keep the four-side boxed eave (no rake)', () => {
    for (const type of ['Hip', 'Flat', 'Shed', 'Gambrel', 'Saltbox']) {
      expect(infos(buildRoofByType(type, opts))).not.toContain('Rake fascia')
    }
  })
})

describe('buildRidgeRoof — drag-the-ridge shapes', () => {
  const base = { lenX: 9, lenZ: 7, pitch: 0.5, ocM: 0.6096 }
  const infos = (g: THREE.Object3D) => {
    const out: string[] = []
    g.traverse((o) => { if ((o as THREE.Mesh).isMesh) out.push((o.userData?.info as string) ?? '') })
    return out
  }

  it('centred, no inset → a plain gable (rafters + ridge + gable studs, no hips)', () => {
    const g = buildRidgeRoof(base)
    expect(meshCount(g)).toBeGreaterThan(0)
    const i = infos(g)
    expect(i).toContain('Ridge board')
    expect(i).toContain('Gable stud')
    expect(i).not.toContain('Hip rafter')
  })

  it('end insets add hip rafters and drop the gable studs on that end', () => {
    const g = buildRidgeRoof({ ...base, insetA: 0.3, insetB: 0.3 })
    expect(infos(g)).toContain('Hip rafter')
    expect(infos(g)).not.toContain('Gable stud')   // both ends hipped
  })

  it('one inset → hip on that end, gable studs still on the flush end', () => {
    const i = infos(buildRidgeRoof({ ...base, insetB: 0.3 }))
    expect(i).toContain('Hip rafter')
    expect(i).toContain('Gable stud')
  })

  it('cross-offset keeps a single ridge but skews the slopes (still renders)', () => {
    const g = buildRidgeRoof({ ...base, crossFrac: 0.5 })
    expect(meshCount(g)).toBeGreaterThan(0)
    expect(infos(g)).toContain('Ridge board')
  })

  it('ridgeIsShaped flags only real shape changes', () => {
    expect(ridgeIsShaped(undefined)).toBe(false)
    expect(ridgeIsShaped({ crossFrac: 0, insetA: 0, insetB: 0 })).toBe(false)
    expect(ridgeIsShaped({ crossFrac: 0.4 })).toBe(true)
    expect(ridgeIsShaped({ insetA: 0.3 })).toBe(true)
  })
})

describe('door/window openings get framed (regression lock)', () => {
  const base = { length: 4, height: 2.44, thickness: 0.14 }
  it('a door opening adds a header spanning the rough opening', () => {
    const g = buildWallFraming({ ...base, openings: [{ centerM: 2, widthM: 0.9, type: 'door', heightM: 2.06 }] })
    expect(meshCount(g)).toBeGreaterThan(0)
    // The header spans roughly the opening width — wider than a stud, narrower
    // than the full-length plates. A solid wall has no such member.
    let header = false
    g.traverse((o) => {
      const m = o as THREE.Mesh
      const w = (m.geometry as THREE.BoxGeometry)?.parameters?.width
      if (typeof w === 'number' && w > 0.6 && w < base.length - 0.4) header = true
    })
    expect(header).toBe(true)
  })
})

describe('floor openings (stairwell/shaft holes)', () => {
  const area = { lenX: 8, lenZ: 6 }

  it('drops deck sheets over an opening, leaving fewer sheets', () => {
    const solid = buildFloorDeck({ ...area }).userData.sheetCount as number
    const holed = buildFloorDeck({ ...area, holes: [{ x: 0, z: 0, w: 2, d: 3 }] }).userData.sheetCount as number
    expect(solid).toBeGreaterThan(0)
    expect(holed).toBeLessThan(solid)
  })

  it('no holes → deck unchanged', () => {
    const a = buildFloorDeck({ ...area }).userData.sheetCount as number
    const b = buildFloorDeck({ ...area, holes: [] }).userData.sheetCount as number
    expect(a).toBe(b)
  })

  it('builds a joist field with framed openings without throwing', () => {
    const g = buildFloorJoists({ ...area, element: '2x10', ocM: 0.4064, holes: [{ x: 0, z: 0, w: 2, d: 2 }] })
    // Header/trimmer members + segmented joists still leave a populated group.
    expect(g.children.length).toBeGreaterThan(0)
  })
})
