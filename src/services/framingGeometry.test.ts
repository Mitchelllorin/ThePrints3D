import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { buildFloorDeck, buildFloorJoists, buildRoofByType, buildFinkTrussRoof, buildWallFraming, buildRidgeRoof, ridgeIsShaped, openingPlies, OPENING_DOUBLE_SPAN_M, buildWallEnvelope } from './framingGeometry'
import { sheathingLayer, wrbLayer, wallTakesEnvelope } from './constructionCode'

const meshCount = (g: THREE.Object3D) => {
  let n = 0
  g.traverse((o) => { if ((o as THREE.Mesh).isMesh) n++ })
  return n
}

/** Every mesh whose nameplate text matches. */
const withInfo = (g: THREE.Object3D, re: RegExp) => {
  const out: THREE.Mesh[] = []
  g.traverse((o) => {
    const m = o as THREE.Mesh
    if (m.isMesh && typeof m.userData.info === 'string' && re.test(m.userData.info)) out.push(m)
  })
  return out
}

describe('exterior envelope: sheathing + housewrap', () => {
  const base = { length: 6, height: 2.44, thickness: 0.1905, outward: 1 as const }
  const wood = sheathingLayer('wood')
  const steel = sheathingLayer('steel')

  it('specs glass-mat on steel and OSB on wood', () => {
    // Steel studs + wood sheathing is not how these walls are built.
    expect(wood.label).toMatch(/OSB/)
    expect(steel.label).toMatch(/Glass-mat/)
    expect(steel.brand).toMatch(/DensGlass/)
    expect(wrbLayer()!.brand).toMatch(/Tyvek/)
  })

  it('stacks outward from the stud face: sheathing, then wrap', () => {
    const g = buildWallEnvelope({ ...base, sheathing: wood, wrb: wrbLayer() })
    const sheets = withInfo(g, /OSB/)
    const wrap = withInfo(g, /Housewrap/)
    expect(sheets.length).toBeGreaterThan(0)
    expect(wrap.length).toBeGreaterThan(0)
    const studFace = base.thickness / 2
    const sheathZ = Math.min(...sheets.map((m) => m.position.z))
    const wrapZ = Math.min(...wrap.map((m) => m.position.z))
    // Both outboard of the studs, and the wrap sits on TOP of the sheathing.
    expect(sheathZ).toBeGreaterThan(studFace)
    expect(wrapZ).toBeGreaterThan(sheathZ)
  })

  it('puts the skin on the side the caller says is outside', () => {
    const plus = buildWallEnvelope({ ...base, outward: 1, sheathing: wood, wrb: null })
    const minus = buildWallEnvelope({ ...base, outward: -1, sheathing: wood, wrb: null })
    expect(withInfo(plus, /OSB/).every((m) => m.position.z > 0)).toBe(true)
    expect(withInfo(minus, /OSB/).every((m) => m.position.z < 0)).toBe(true)
  })

  it('omits the wrap when it is switched off, keeping the sheathing', () => {
    const g = buildWallEnvelope({ ...base, sheathing: wood, wrb: null })
    expect(withInfo(g, /OSB/).length).toBeGreaterThan(0)
    expect(withInfo(g, /Housewrap/).length).toBe(0)
  })

  it('cuts both layers around a door, and counts sheets for takeoff', () => {
    const solid = buildWallEnvelope({ ...base, sheathing: wood, wrb: wrbLayer() })
    const holed = buildWallEnvelope({
      ...base, sheathing: wood, wrb: wrbLayer(),
      openings: [{ centerM: 3, widthM: 1.8, type: 'door' }],
    })
    expect(holed.userData.sheetCount as number).toBeLessThan(solid.userData.sheetCount as number)
    expect(withInfo(holed, /Housewrap/).length).toBeGreaterThan(0)
    // No wrap piece may span the doorway at door height.
    for (const m of withInfo(holed, /Housewrap/)) {
      m.geometry.computeBoundingBox()
      const bb = m.geometry.boundingBox!
      const x0 = m.position.x + bb.min.x, x1 = m.position.x + bb.max.x
      const y0 = m.position.y + bb.min.y, y1 = m.position.y + bb.max.y
      const overlaps = x0 < 0.9 && x1 > -0.9 && y0 < 2.06 && y1 > 0
      expect(overlaps).toBe(false)
    }
  })

  it('offers a WRB per what goes over it, and none when the sheathing carries it', () => {
    // Tar paper is not obsolete — still the norm under stucco and adhered stone.
    expect(wrbLayer('housewrap')?.brand).toMatch(/Tyvek/)
    expect(wrbLayer('felt')?.label).toMatch(/felt/i)
    expect(wrbLayer('fluid')?.label).toMatch(/Fluid/i)
    // ZIP-style sheathing already has the barrier on its face; a second one would
    // be wrong, so there is no layer to add.
    expect(wrbLayer('integrated')).toBeNull()
    expect(wrbLayer()?.label).toMatch(/Housewrap/)   // default
  })

  it('renders whichever barrier is chosen, still outboard of the sheathing', () => {
    for (const kind of ['housewrap', 'felt', 'fluid'] as const) {
      const layer = wrbLayer(kind)!
      const g = buildWallEnvelope({ ...base, sheathing: wood, wrb: layer })
      const sheets = withInfo(g, /OSB/)
      const barrier = withInfo(g, new RegExp(layer.label.split(' ')[0], 'i'))
      expect(barrier.length).toBeGreaterThan(0)
      expect(Math.min(...barrier.map((m) => m.position.z)))
        .toBeGreaterThan(Math.min(...sheets.map((m) => m.position.z)))
    }
  })

  it('only exterior stud walls take an envelope', () => {
    expect(wallTakesEnvelope('exterior-bearing', 'wood-2x8')).toBe(true)
    expect(wallTakesEnvelope('partition', 'wood-2x4')).toBe(false)
    expect(wallTakesEnvelope('interior-bearing', 'wood-2x6')).toBe(false)
    expect(wallTakesEnvelope('exterior-bearing', 'cmu')).toBe(false)  // its own assembly
  })
})

describe('floor openings are framed (IRC R502.10)', () => {
  const base = { lenX: 8, lenZ: 6, element: '2x10', ocM: 0.4064 }
  // A 3'x10' stairwell: header spans the 0.91 m dimension → under 4 ft → single.
  const stairwell = { x: 0, z: 0, w: 0.91, d: 3.05 }

  it('doubles header and trimmers only past a 4 ft header span', () => {
    expect(openingPlies(0.91)).toBe(1)                          // 3 ft
    expect(openingPlies(OPENING_DOUBLE_SPAN_M)).toBe(1)         // exactly 4 ft
    expect(openingPlies(OPENING_DOUBLE_SPAN_M + 0.01)).toBe(2)  // just over
    expect(openingPlies(2.4)).toBe(2)                           // 8 ft
  })

  it('adds headers AND trimmers around an opening', () => {
    const g = buildFloorJoists({ ...base, holes: [stairwell] })
    // Both must exist. Trimmers were entirely missing before, which left the cut
    // joists with nothing carrying them.
    expect(withInfo(g, /Opening header/).length).toBeGreaterThan(0)
    expect(withInfo(g, /Trimmer joist/).length).toBeGreaterThan(0)
  })

  it('frames a narrow opening single and a wide one doubled', () => {
    // Orientation matters: joists span the SHORTER dimension, so with lenX 8 x
    // lenZ 6 they run along Z and the header crosses them along X. The header's
    // span is therefore the opening's X extent (w) — widen that, not d.
    const narrow = buildFloorJoists({ ...base, holes: [{ x: 0, z: 0, w: 0.91, d: 3.05 }] })
    const wide = buildFloorJoists({ ...base, holes: [{ x: 0, z: 0, w: 2.4, d: 3.05 }] })
    // Two edges x plies. Narrow: 1 ply each side = 2. Wide: 2 plies each side = 4.
    expect(withInfo(narrow, /Opening header/).length).toBe(2)
    expect(withInfo(wide, /Opening header/).length).toBe(4)
    expect(withInfo(narrow, /single/).length).toBeGreaterThan(0)
    expect(withInfo(wide, /2-ply/).length).toBeGreaterThan(0)
  })

  it('leaves the clear opening clear — no joist crosses it', () => {
    const g = buildFloorJoists({ ...base, holes: [stairwell] })
    const commons = withInfo(g, /^2x10 · /)   // common joists only, not header/trimmer
    for (const m of commons) {
      m.geometry.computeBoundingBox()
      const bb = m.geometry.boundingBox!
      const x0 = m.position.x + bb.min.x, x1 = m.position.x + bb.max.x
      const z0 = m.position.z + bb.min.z, z1 = m.position.z + bb.max.z
      const overlaps = x0 < stairwell.w / 2 && x1 > -stairwell.w / 2
        && z0 < stairwell.d / 2 && z1 > -stairwell.d / 2
      expect(overlaps).toBe(false)
    }
  })

  it('still cuts the deck over the opening', () => {
    const solid = buildFloorDeck({ lenX: 8, lenZ: 6 })
    const holed = buildFloorDeck({ lenX: 8, lenZ: 6, holes: [stairwell] })
    expect(holed.userData.sheetCount as number).toBeLessThan(solid.userData.sheetCount as number)
  })
})

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
