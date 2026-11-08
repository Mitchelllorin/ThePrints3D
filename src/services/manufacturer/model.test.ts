import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { MANUFACTURER_PARTS, getManufacturerPart } from '../../data/manufacturerParts'
import { getMember, memberSectionM } from '../../data/members'
import { buildPartModel, partPlyCount } from './model'
import { brandForMemberName, laminationCount, surfaceKind } from './surface'

const size = (g: THREE.Object3D) => new THREE.Box3().setFromObject(g).getSize(new THREE.Vector3())
/**
 * A glued-up member is one glue line short of its nominal section: each ply is
 * inset by half a line at the two outer faces, so the stack measures w - gap,
 * not w. That is the model being right, not the section being wrong.
 */
const GLUE_TOL = 0.002

describe('a manufacturer part, modelled', () => {
  it.each(MANUFACTURER_PARTS.map((p) => [p.id, p] as const))('%s draws at the catalogue section', (_id, part) => {
    const model = buildPartModel(part, { lengthM: 2.4 })
    expect(model, `${part.id} has no model`).not.toBeNull()
    const member = getMember(part.memberId)!
    const section = memberSectionM(member)
    const box = size(model!.group)
    expect(box.x).toBeCloseTo(2.4, 3)
    // Never bigger than the section it claims to be, and never short of it by
    // more than the glue lines.
    expect(box.y).toBeGreaterThan(section.depth - GLUE_TOL)
    expect(box.y).toBeLessThanOrEqual(section.depth + 1e-6)
    expect(box.z).toBeGreaterThan(section.width - GLUE_TOL)
    expect(box.z).toBeLessThanOrEqual(section.width + 1e-6)
  })

  // The point of modelling them at all: the plies are the product.
  it('lays a glulam up as its real lamination count', () => {
    const nordic = getManufacturerPart('nordic-lam-24f-e-es1m1-7x18')!
    expect(surfaceKind(nordic)).toBe('glulam')
    // 18" deep, 1-1/2" laminations.
    expect(laminationCount(nordic)).toBe(12)
    const model = buildPartModel(nordic)!
    expect(model.plies).toBe(12)
    expect(model.group.children).toHaveLength(12)
  })

  it('stacks an LVL as veneers through its thickness', () => {
    const lvl = getManufacturerPart('west-fraser-lvl-3000fb-1_9e')!
    expect(surfaceKind(lvl)).toBe('lvl')
    // 1-3/4" of 1/8" veneer.
    expect(partPlyCount(lvl)).toBe(14)
    expect(buildPartModel(lvl)!.group.children).toHaveLength(14)
  })

  // Parallam's selling point is that it has no plies. Drawing it as a stack
  // would be the opposite of the product.
  it('draws the strand products as one billet, not a stack', () => {
    for (const id of ['weyerhaeuser-parallam-2_2e-3_1_2x19', 'lp-lsl-1_35e-1_3_4x9-1_2']) {
      const part = getManufacturerPart(id)!
      expect(surfaceKind(part)).toBe(part.product.toLowerCase().includes('lsl') ? 'lsl' : 'psl')
      expect(partPlyCount(part)).toBe(1)
      expect(buildPartModel(part)!.group.children).toHaveLength(1)
    }
  })

  it('separates the plies along their own glue line when spread', () => {
    const nordic = getManufacturerPart('nordic-lam-24f-e-es1m1-7x18')!
    const tight = size(buildPartModel(nordic, { spread: 0 })!.group)
    const apart = size(buildPartModel(nordic, { spread: 1 })!.group)
    expect(apart.y).toBeGreaterThan(tight.y * 1.05)
    // They come apart through the depth, not sideways.
    expect(apart.z).toBeCloseTo(tight.z, 6)
  })

  it('names the maker on the model, so a clip can prove whose part it is', () => {
    const part = getManufacturerPart('nordic-lam-24f-e-es1m1-7x18')!
    const model = buildPartModel(part)!
    expect(model.group.userData.brandPart).toBe(part.id)
    expect(model.group.userData.manufacturer).toBe('Nordic Structures')
    expect(model.group.children[0].userData.info).toContain('Nordic Lam')
  })
})

describe('the brand surface resolver', () => {
  it('finds a part from the stock name a cut list already writes', () => {
    const name = getMember('glulam-7x18')!.name
    expect(brandForMemberName(name)?.manufacturer).toBe('Nordic Structures')
    expect(brandForMemberName('2×4')).toBeNull()
  })

  it('knows which figures it cannot quote', () => {
    const lsl = getManufacturerPart('lp-lsl-1_35e-1_3_4x9-1_2')!
    // Strand products have no lamination count to give.
    expect(laminationCount(lsl)).toBeNull()
  })
})

// The part is worth nothing if it stays in a data file. This is the wiring: a
// header asked for from a maker's stock is drawn as that part, and the takeoff
// still sees a header — one ply at a time, which is what a saw actually cuts.
describe('a header cut from a maker\'s part', () => {
  it('draws the beam as its laminations and keeps the cut on every ply', async () => {
    const { buildWallFraming } = await import('../framingGeometry')
    const group = buildWallFraming({
      length: 4,
      height: 3.5,
      thickness: 0.14,
      openings: [{ centerM: 2, widthM: 0.9, type: 'door' }],
      headerMemberId: 'nordic-lam-24f-e-es1m1-7x18',
    })
    const branded = group.children.filter((c) => c.userData.brandPart)
    expect(branded).toHaveLength(1)
    expect(branded[0].children).toHaveLength(12)
    for (const ply of branded[0].children) {
      expect(ply.userData.cut.role).toBe('header')
      expect(ply.userData.cut.member).toContain('Nordic Lam')
    }
  })

  it('falls back to the catalogue header when the real section will not fit', async () => {
    const { buildWallFraming } = await import('../framingGeometry')
    // 2.4 m walls: an 18" beam cannot sit over a 2.06 m door and under the plate.
    const group = buildWallFraming({
      length: 4,
      height: 2.4,
      thickness: 0.14,
      openings: [{ centerM: 2, widthM: 0.9, type: 'door' }],
      headerMemberId: 'nordic-lam-24f-e-es1m1-7x18',
    })
    expect(group.children.filter((c) => c.userData.brandPart)).toHaveLength(0)
    // The header is still there, and still on the cut list.
    const headers = group.children.filter((c) => c.userData.cut?.role === 'header')
    expect(headers.length).toBeGreaterThan(0)
  })
})
