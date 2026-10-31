import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { candidatesFrom, nextAfter, type PickTag } from './tapCycle'

const tag = (key: string, members = false): PickTag => ({ key, select: () => {}, members })
const mesh = (userData: Record<string, unknown> = {}) => {
  const m = new THREE.Mesh()
  Object.assign(m.userData, userData)
  return m
}

/** A small scene: a wall's pick box, the framing (a stud), a floor with a joist. */
function scene() {
  const wallBox = mesh({ pick: tag('wall:d:3') })
  const framing = new THREE.Group()
  framing.userData.pickMembers = true
  const wallGroup = new THREE.Group()
  framing.add(wallGroup)
  const stud = mesh({ id: 'stud-7', label: 'Stud' })
  wallGroup.add(stud)
  const floorBox = mesh({ pick: tag('floor:f1') })
  const joists = new THREE.Group()
  joists.userData.pick = tag('floor:f1', true)
  const joist = mesh({ id: 'f1-4', label: 'Joist' })
  joists.add(joist)
  const door = new THREE.Group()
  door.userData.pick = tag('object:o1')
  const doorLeaf = mesh()
  door.add(doorLeaf)
  return { wallBox, stud, floorBox, joist, doorLeaf }
}

describe('tap again: what is under the finger, in order', () => {
  it('goes front to back, each whole thing before its pieces', () => {
    const s = scene()
    const keys = candidatesFrom([s.wallBox, s.stud, s.floorBox, s.joist].map((object) => ({ object })))
      .map((c) => c.key)
    expect(keys).toEqual(['wall:d:3', 'member:stud-7', 'floor:f1', 'member:f1-4'])
  })

  it('puts a door in front of the wall it sits in', () => {
    const s = scene()
    const keys = candidatesFrom([s.doorLeaf, s.wallBox, s.stud].map((object) => ({ object }))).map((c) => c.key)
    expect(keys).toEqual(['object:o1', 'wall:d:3', 'member:stud-7'])
  })

  it('lists a floor once however many of its meshes the ray went through', () => {
    const s = scene()
    const keys = candidatesFrom([s.floorBox, s.joist, s.floorBox].map((object) => ({ object }))).map((c) => c.key)
    expect(keys).toEqual(['floor:f1', 'member:f1-4'])
  })

  it('skips anything marked noPick, like the print', () => {
    const sheet = new THREE.Group()
    sheet.userData.noPick = true
    const ink = mesh({ pick: tag('should-not-appear') })
    sheet.add(ink)
    expect(candidatesFrom([{ object: ink }])).toEqual([])
  })

  it('steps to the next one and comes back round past the last', () => {
    const list = [tag('wall'), tag('member:s'), tag('floor'), tag('member:j')]
    expect(nextAfter(list, 'wall')?.key).toBe('member:s')
    expect(nextAfter(list, 'member:s')?.key).toBe('floor')
    expect(nextAfter(list, 'member:j')?.key).toBe('wall')
    // Something no longer under the finger: start again at the front.
    expect(nextAfter(list, 'gone')?.key).toBe('wall')
  })
})
