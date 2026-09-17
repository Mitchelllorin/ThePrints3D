import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { buildWallFraming } from './framingGeometry'
import { applyMemberColours, memberKind, ownedMaterial, MEMBER_KEY } from './memberColours'

describe('memberKind', () => {
  it('reads the live-wall labels', () => {
    expect(memberKind({ info: '2×4 king stud' })).toBe('king')
    expect(memberKind({ info: '2×4 jack stud' })).toBe('jack')
    expect(memberKind({ info: 'LVL header' })).toBe('header')
    expect(memberKind({ info: '2×4 sill cripple' })).toBe('cripple')
    expect(memberKind({ info: '2×4 sill plate' })).toBe('sill')
    expect(memberKind({ info: '2×4 cap plate' })).toBe('plate')
    expect(memberKind({ info: '25ga steel floor track' })).toBe('plate')
    expect(memberKind({ info: '2×4 corner backer' })).toBe('pack')
    expect(memberKind({ info: '2×4 blocking' })).toBe('blocking')
    expect(memberKind({ info: '2×4 wood stud' })).toBe('stud')
  })

  it('reads the built-model component types', () => {
    expect(memberKind({ componentType: 'king-stud' })).toBe('king')
    expect(memberKind({ componentType: 'top-plate' })).toBe('plate')
    expect(memberKind({ componentType: 'corner-assembly' })).toBe('pack')
  })

  it('a pack stud is a pack even though its label says stud', () => {
    expect(memberKind({ member: 'pack', info: '2×4 wood stud' })).toBe('pack')
  })

  it('every kind has a distinct colour', () => {
    expect(new Set(MEMBER_KEY.map((m) => m.color)).size).toBe(MEMBER_KEY.length)
  })
})

describe('applyMemberColours on a real wall', () => {
  const wall = () => buildWallFraming({
    length: 4, height: 2.44, thickness: 0.09, material: 'wood',
    openings: [{ centerM: 2, widthM: 0.9, type: 'window' }],
    capLap: { start: 'lap', end: 'back' },
  })
  const kinds = (g: THREE.Object3D) => {
    const out = new Map<string, Set<string>>()
    g.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return
      const k = memberKind({ ...o.userData })
      if (!k) return
      const c = '#' + (o.material as THREE.MeshStandardMaterial).color.getHexString()
      if (!out.has(k)) out.set(k, new Set())
      out.get(k)!.add(c)
    })
    return out
  }

  it('gives every member of a window wall its own colour, one colour per kind', () => {
    const g = wall()
    applyMemberColours(g, true)
    const k = kinds(g)
    for (const kind of ['stud', 'pack', 'plate', 'blocking', 'king', 'jack', 'header', 'cripple', 'sill']) {
      expect(k.has(kind), kind).toBe(true)
      expect(k.get(kind)!.size, kind).toBe(1)
    }
  })

  it('marks the end and corner studs as the pack, not field studs', () => {
    const g = wall()
    let packs = 0
    g.traverse((o) => { if (o.userData.member === 'pack') packs++ })
    // two flush end studs + the lapping corner's doubled stud
    expect(packs).toBeGreaterThanOrEqual(3)
  })

  it('turning it off puts the original material back', () => {
    const g = wall()
    const before: THREE.Material[] = []
    g.traverse((o) => { if (o instanceof THREE.Mesh) before.push(o.material as THREE.Material) })
    applyMemberColours(g, true)
    applyMemberColours(g, true)
    applyMemberColours(g, false)
    const after: THREE.Material[] = []
    g.traverse((o) => { if (o instanceof THREE.Mesh) after.push(o.material as THREE.Material) })
    expect(after).toEqual(before)
  })

  it('cleanup never disposes a shared colour material', () => {
    const g = wall()
    applyMemberColours(g, true)
    g.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return
      const m = ownedMaterial(o)
      if (m && !Array.isArray(m)) expect(m.userData?.sharedMemberColour).toBeFalsy()
    })
  })
})
