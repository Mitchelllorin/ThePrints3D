import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { buildFloorDeck, buildFloorJoists, buildRoofByType, buildFinkTrussRoof, buildWallFraming, buildRidgeRoof, ridgeIsShaped, openingPlies, OPENING_DOUBLE_SPAN_M, buildWallEnvelope, buildWallCladding, buildWallDrywall } from './framingGeometry'
import {
  sheathingLayer, wrbLayer, wallTakesEnvelope, claddingSpec, recommendedWrb, boardSpec,
  finishesVisible,
} from './constructionCode'
import { outwardSign, inwardSign } from './wallFacing'

const meshCount = (g: THREE.Object3D) => {
  let n = 0
  g.traverse((o) => { if ((o as THREE.Mesh).isMesh) n++ })
  return n
}

/** First mesh in a group, in traversal order. */
const firstMesh = (g: THREE.Object3D): THREE.Mesh => {
  let found: THREE.Mesh | null = null
  g.traverse((o) => { const m = o as THREE.Mesh; if (!found && m.isMesh) found = m })
  if (!found) throw new Error('group has no meshes')
  return found
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

  it('offers OSB and plywood on wood, glass-mat regardless on steel', () => {
    expect(sheathingLayer('wood', 'osb').label).toMatch(/OSB/)
    expect(sheathingLayer('wood', 'plywood').label).toMatch(/plywood/i)
    // Different real thicknesses — the wall's outside face genuinely moves.
    expect(sheathingLayer('wood', 'plywood').thicknessM)
      .toBeGreaterThan(sheathingLayer('wood', 'osb').thicknessM)
    // Steel ignores the wood choice entirely.
    expect(sheathingLayer('steel', 'plywood').label).toMatch(/Glass-mat/)
  })

  it('only exterior stud walls take an envelope', () => {
    expect(wallTakesEnvelope('exterior-bearing', 'wood-2x8')).toBe(true)
    expect(wallTakesEnvelope('partition', 'wood-2x4')).toBe(false)
    expect(wallTakesEnvelope('interior-bearing', 'wood-2x6')).toBe(false)
    expect(wallTakesEnvelope('exterior-bearing', 'cmu')).toBe(false)  // its own assembly
  })
})

describe('finishes appear when you say, not when you pull the wall', () => {
  it('holds finishes back until asked, in "later" mode', () => {
    expect(finishesVisible('later', false, false)).toBe(false)
    expect(finishesVisible('later', true, false)).toBe(true)
  })

  it('clads as you build, in "live" mode', () => {
    expect(finishesVisible('live', false, false)).toBe(true)
  })

  it('hides finishes mid-trace either way — you cannot draw through a clad wall', () => {
    expect(finishesVisible('live', true, true)).toBe(false)
    expect(finishesVisible('later', true, true)).toBe(false)
  })
})

describe('the wall rule, whole matrix', () => {
  // Only exterior walls get sheathing; interior walls get board on BOTH faces.
  // Locked as a table because it is the rule most easily broken by a change
  // somewhere else — every role, stated once.
  const ROLES = [
    { role: 'exterior-bearing', sheathed: true },
    { role: 'interior-bearing', sheathed: false },
    { role: 'interior-non-bearing', sheathed: false },
    { role: 'partition', sheathed: false },
  ] as const

  it('sheathes exterior walls and nothing else', () => {
    for (const { role, sheathed } of ROLES) {
      expect(wallTakesEnvelope(role, 'wood-2x6')).toBe(sheathed)
    }
  })

  it('boards interior walls both sides, exterior walls one', () => {
    for (const { role, sheathed } of ROLES) {
      // DrywallLayer asks exactly this question to decide bothSides.
      const bothSides = !wallTakesEnvelope(role, 'wood-2x6')
      expect(bothSides).toBe(!sheathed)
      const g = buildWallDrywall({ length: 6, height: 2.44, thickness: 0.14, bothSides, inward: 1 })
      const sides = new Set<number>()
      g.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) sides.add(Math.sign(m.position.z)) })
      expect(sides.size).toBe(bothSides ? 2 : 1)
    }
  })

  it('treats a wall with NO role as interior — the safe way to be wrong', () => {
    // Legacy/auto walls carry no role. Boarding both faces and leaving them
    // unsheathed is recoverable; sheathing an interior partition is not.
    expect(wallTakesEnvelope(undefined, 'wood-2x6')).toBe(false)
  })

  it('leaves masonry out of it entirely', () => {
    // CMU is a solid assembly, not a sheathed stud wall — no sheathing either way.
    expect(wallTakesEnvelope('exterior-bearing', 'cmu')).toBe(false)
  })
})

describe('drywall goes inside, sheathing goes outside', () => {
  const base = { length: 6, height: 2.44, thickness: 0.1905 }

  it('boards both faces of an interior partition', () => {
    const g = buildWallDrywall({ ...base, bothSides: true })
    const zs = new Set<number>()
    g.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) zs.add(Math.sign(m.position.z)) })
    expect(zs.has(1)).toBe(true)
    expect(zs.has(-1)).toBe(true)
  })

  it('boards an exterior wall on the INSIDE face only', () => {
    // The outside face takes sheathing + WRB + cladding. Drywall out there would
    // be nonsense, and it used to happen: bothSides defaulted to true for every
    // wall, so exterior walls got boarded outside and then sheathed over the top.
    for (const inward of [1, -1] as const) {
      const g = buildWallDrywall({ ...base, bothSides: false, inward })
      const meshes: THREE.Mesh[] = []
      g.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) meshes.push(m) })
      expect(meshes.length).toBeGreaterThan(0)
      expect(meshes.every((m) => Math.sign(m.position.z) === inward)).toBe(true)
    }
  })

  it('knows which boards can go behind tile in a wet area', () => {
    // Cement board tolerates water; KERDI-BOARD IS the waterproofing. Plain
    // gypsum behind a shower is how you rot a wall out.
    expect(boardSpec('gypsum-half').wetRated).toBe(false)
    expect(boardSpec('mold-resistant').wetRated).toBe(false)   // resists mould, still not a tile backer
    expect(boardSpec('cement-board').wetRated).toBe(true)
    expect(boardSpec('glassmat-tile').wetRated).toBe(true)
    expect(boardSpec('foam-waterproof').wetRated).toBe(true)
    expect(boardSpec('foam-waterproof').brand).toMatch(/Schluter/)
    // Only Type X is fire-rated — the board a garage separation needs.
    expect(boardSpec('gypsum-type-x').fireRated).toBe(true)
    expect(boardSpec('gypsum-half').fireRated).toBe(false)
  })

  it('boards at the chosen product real thickness', () => {
    // 5/8" Type X is genuinely thicker than 1/2" gypsum, so the finished face
    // moves — the same reason OSB and plywood are not interchangeable outside.
    const half = boardSpec('gypsum-half')
    const typeX = boardSpec('gypsum-type-x')
    expect(typeX.thicknessM).toBeGreaterThan(half.thicknessM)
    const a = buildWallDrywall({ ...base, bothSides: false, inward: 1, board: half })
    const b = buildWallDrywall({ ...base, bothSides: false, inward: 1, board: typeX })
    expect(firstMesh(b).position.z).toBeGreaterThan(firstMesh(a).position.z)
    expect(withInfo(b, /Type X/).length).toBeGreaterThan(0)
  })

  it('never lands drywall and sheathing on the same face of a wall', () => {
    // The two layers ask the SAME module which way the wall faces, so this holds
    // by construction — but it is the failure that would look worst, so lock it.
    const wall = { x1: 0, y1: 0, x2: 100, y2: 0, level: 0 }
    const centroid = { x: 50, y: 50 }   // building sits below the wall in plan
    const out = outwardSign(wall, centroid)
    const inn = inwardSign(wall, centroid)
    expect(inn).toBe(out === 1 ? -1 : 1)

    const board = buildWallDrywall({ ...base, bothSides: false, inward: inn })
    const skin = buildWallEnvelope({
      ...base, outward: out, sheathing: sheathingLayer('wood'), wrb: null,
    })
    expect(Math.sign(firstMesh(board).position.z))
      .not.toBe(Math.sign(firstMesh(skin).position.z))
  })
})

describe('cladding', () => {
  const base = { length: 6, height: 2.44, standoff: 0.11, outward: 1 as const }

  it('stands brick off on a cavity, and hangs lap siding tight', () => {
    const brick = claddingSpec('brick-veneer')!
    const lap = claddingSpec('vinyl-lap')!
    // Brick's drained cavity is why a brick wall's outside face lands further out.
    expect(brick.gapM).toBeGreaterThan(0)
    expect(brick.needsLedge).toBe(true)
    expect(lap.gapM).toBe(0)
    expect(lap.needsLedge).toBe(false)
    // Rainscreen panel is furred off too.
    expect(claddingSpec('panel')!.gapM).toBeGreaterThan(0)
    expect(claddingSpec('none')).toBeNull()
  })

  it('lays coursed siding in courses and continuous finishes in one skin', () => {
    const lap = buildWallCladding({ ...base, spec: claddingSpec('fiber-cement-lap')! })
    const stucco = buildWallCladding({ ...base, spec: claddingSpec('stucco')! })
    expect(lap.userData.courseCount as number).toBeGreaterThan(1)
    expect(stucco.userData.courseCount as number).toBe(0)
    // Courses should roughly cover the wall at the spec'd exposure.
    const exposure = claddingSpec('fiber-cement-lap')!.exposureM!
    expect(lap.userData.courseCount as number).toBe(Math.ceil(base.height / exposure))
  })

  it('sits outboard of everything already on the wall', () => {
    const g = buildWallCladding({ ...base, spec: claddingSpec('wood-lap')! })
    const meshes = withInfo(g, /Wood lap/)
    expect(meshes.length).toBeGreaterThan(0)
    for (const m of meshes) expect(m.position.z).toBeGreaterThan(base.standoff)
  })

  it('puts brick further out than lap siding on the same wall', () => {
    const lapSpec = claddingSpec('vinyl-lap')!
    const brickSpec = claddingSpec('brick-veneer')!
    const lapZ = base.standoff + lapSpec.gapM + lapSpec.thicknessM / 2
    const brickZ = base.standoff + brickSpec.gapM + brickSpec.thicknessM / 2
    expect(brickZ - lapZ).toBeGreaterThan(0.05)   // ~4", a real footprint change
  })

  it('honours the outward side', () => {
    const spec = claddingSpec('vinyl-lap')!
    const out = buildWallCladding({ ...base, outward: -1, spec })
    expect(withInfo(out, /Vinyl/).every((m) => m.position.z < 0)).toBe(true)
  })

  it('cuts around a door, coursed and continuous alike', () => {
    const door = [{ centerM: 3, widthM: 1.8, type: 'door' as const }]
    for (const kind of ['fiber-cement-lap', 'stucco'] as const) {
      const g = buildWallCladding({ ...base, spec: claddingSpec(kind)!, openings: door })
      const meshes = withInfo(g, /./)
      expect(meshes.length).toBeGreaterThan(0)
      for (const m of meshes) {
        m.geometry.computeBoundingBox()
        const bb = m.geometry.boundingBox!
        const x0 = m.position.x + bb.min.x, x1 = m.position.x + bb.max.x
        const y0 = m.position.y + bb.min.y, y1 = m.position.y + bb.max.y
        // Doorway is x -0.9..0.9, y 0..2.06 in wall-local space.
        const overlaps = x0 < 0.9 - 1e-6 && x1 > -0.9 + 1e-6 && y0 < 2.06 - 1e-6 && y1 > 1e-6
        expect(overlaps).toBe(false)
      }
    }
  })

  it('asks for felt behind wet-applied finishes and housewrap behind the rest', () => {
    // Stucco and adhered stone bond to synthetic wrap and ruin its drainage.
    expect(recommendedWrb('stucco')).toBe('felt')
    expect(recommendedWrb('stone-veneer')).toBe('felt')
    expect(recommendedWrb('vinyl-lap')).toBe('housewrap')
    expect(recommendedWrb('brick-veneer')).toBe('housewrap')
  })

  it('asks for an air/vapour barrier on steel, and lets a wet finish overrule it', () => {
    // Steel walls are sheathed in DensGlass and detailed with an AVB, not
    // housewrap — housewrap there is a residential answer to a commercial wall.
    expect(recommendedWrb('none', 'steel')).toBe('avb')
    expect(recommendedWrb('panel', 'steel')).toBe('avb')
    expect(recommendedWrb('vinyl-lap', 'steel')).toBe('avb')
    // …but a wet-applied finish still wins: it will wreck a membrane it bonds to
    // no matter what is behind it.
    expect(recommendedWrb('stucco', 'steel')).toBe('felt')
    // Wood is unchanged.
    expect(recommendedWrb('vinyl-lap', 'wood')).toBe('housewrap')
  })

  it('renders the air/vapour barrier like any other', () => {
    const avb = wrbLayer('avb')!
    expect(avb.label).toMatch(/vapour/i)
    const g = buildWallEnvelope({
      length: 6, height: 2.44, thickness: 0.1524, outward: 1,
      sheathing: sheathingLayer('steel'), wrb: avb,
    })
    const sheets = withInfo(g, /Glass-mat/)
    const barrier = withInfo(g, /vapour/i)
    expect(sheets.length).toBeGreaterThan(0)
    expect(barrier.length).toBeGreaterThan(0)
    expect(Math.min(...barrier.map((m) => m.position.z)))
      .toBeGreaterThan(Math.min(...sheets.map((m) => m.position.z)))
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
    expect(holed.userData.sheetCount as number).toBeLessThanOrEqual(solid.userData.sheetCount as number)
  })

  it('CUTS the sheets it touches instead of deleting them', () => {
    // The opening used to delete every sheet it clipped, so the hole in the deck
    // came out up to a full 4x8 oversize on each side and sheets visibly vanished
    // when stairs were placed. Nothing may intrude on the opening, but the deck
    // must still reach right up to its edge.
    const g = buildFloorDeck({ lenX: 8, lenZ: 6, holes: [stairwell] })
    const sheets: THREE.Mesh[] = []
    g.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) sheets.push(m) })
    expect(sheets.length).toBeGreaterThan(0)

    const hx0 = -stairwell.w / 2, hx1 = stairwell.w / 2
    const hz0 = -stairwell.d / 2, hz1 = stairwell.d / 2
    let nearestGapX = Infinity
    for (const m of sheets) {
      m.geometry.computeBoundingBox()
      const bb = m.geometry.boundingBox!
      const x0 = m.position.x + bb.min.x, x1 = m.position.x + bb.max.x
      const z0 = m.position.z + bb.min.z, z1 = m.position.z + bb.max.z
      // Nothing overlaps the clear opening.
      expect(x0 < hx1 - 1e-6 && x1 > hx0 + 1e-6 && z0 < hz1 - 1e-6 && z1 > hz0 + 1e-6).toBe(false)
      // How close the decking gets to the opening, measured beside it.
      if (z0 < hz1 && z1 > hz0) {
        if (x1 <= hx0) nearestGapX = Math.min(nearestGapX, hx0 - x1)
        if (x0 >= hx1) nearestGapX = Math.min(nearestGapX, x0 - hx1)
      }
    }
    // Decking reaches the opening edge (bar the sheet joint), not a sheet away.
    expect(nearestGapX).toBeLessThan(0.05)
  })

  it('labels a cut piece differently from a full sheet', () => {
    const g = buildFloorDeck({ lenX: 8, lenZ: 6, holes: [stairwell] })
    expect(withInfo(g, /cut to opening/).length).toBeGreaterThan(0)
    expect(withInfo(g, /4×8/).length).toBeGreaterThan(0)
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

  it('opens the deck without wasting the sheets it cuts', () => {
    // This used to assert the count DROPPED, which only held because every sheet
    // the opening touched was deleted outright. Sheets are cut now, so a partly
    // clipped sheet is still one sheet you buy — the count should not fall unless
    // a sheet lands entirely inside the opening. What must change is the covered
    // area, not the order quantity.
    const solid = buildFloorDeck({ ...area })
    const holed = buildFloorDeck({ ...area, holes: [{ x: 0, z: 0, w: 2, d: 3 }] })
    expect(solid.userData.sheetCount as number).toBeGreaterThan(0)
    expect(holed.userData.sheetCount as number).toBeLessThanOrEqual(solid.userData.sheetCount as number)
    // The opening is genuinely open: less plywood on the floor than before.
    const deckArea = (g: THREE.Object3D) => {
      let a = 0
      g.traverse((o) => {
        const m = o as THREE.Mesh
        if (!m.isMesh) return
        m.geometry.computeBoundingBox()
        const bb = m.geometry.boundingBox!
        a += (bb.max.x - bb.min.x) * (bb.max.z - bb.min.z)
      })
      return a
    }
    expect(deckArea(holed)).toBeLessThan(deckArea(solid))
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
