import { describe, it, expect } from 'vitest'
import { pocketConflicts } from './pocketWall'
import { roughOpening } from './roughOpening'
import type { PlacedObject, TracedLine } from '../types'

const IN = 0.0254
const obj = (o: Partial<PlacedObject> & { type: string }): PlacedObject => ({
  id: o.type + Math.random(), x: 0, z: 0, rotationY: 0, scaleX: 1, scaleY: 1, scaleZ: 1, label: o.type, ...o,
})
/** A 36" pocket door at the origin in a wall along world X, pocket to the right (+X). */
const pocket = (extra: Partial<PlacedObject> = {}) =>
  obj({ id: 'door', type: 'door', subtype: 'Pocket', swing: 'right', ...extra })

describe('pocketConflicts', () => {
  it('flags an outlet in the pocket, and not one past it or on the doorway side', () => {
    const inPocket = obj({ id: 'o1', type: 'duplex-outlet', x: 0.9 })     // 18"–54" is the pocket
    const pastIt = obj({ id: 'o2', type: 'duplex-outlet', x: 1.6 })
    const otherSide = obj({ id: 'o3', type: 'duplex-outlet', x: -0.9 })
    const hits = pocketConflicts([pocket(), inPocket, pastIt, otherSide])
    expect(hits.map((h) => h.objectId)).toEqual(['o1'])
    expect(hits[0].trade).toBe('electrical')
  })

  it('follows the pocket when it is flipped to the other side', () => {
    const o = obj({ id: 'o3', type: 'switch', x: -0.9 })
    expect(pocketConflicts([pocket({ swing: 'left' }), o]).map((h) => h.objectId)).toEqual(['o3'])
  })

  it('ignores an outlet on a different wall or storey', () => {
    expect(pocketConflicts([pocket(), obj({ type: 'duplex-outlet', x: 0.9, z: 1.5 })])).toHaveLength(0)
    expect(pocketConflicts([pocket(), obj({ type: 'duplex-outlet', x: 0.9, level: 1 })])).toHaveLength(0)
  })

  it('flags a fixture backed against the pocket wall', () => {
    // A vanity's centre stands half its depth off the wall.
    const vanity = obj({ id: 'v', type: 'bathroom-sink', x: 0.9, z: 0.25 })
    const hits = pocketConflicts([pocket(), vanity])
    expect(hits.map((h) => [h.objectId, h.trade])).toEqual([['v', 'plumbing']])
  })

  it('leaves a plain door alone', () => {
    expect(pocketConflicts([obj({ type: 'door' }), obj({ type: 'duplex-outlet', x: 0.6 })])).toHaveLength(0)
  })

  it('finds the pocket in a wall running along Z, using the yaw the way THREE turns it', () => {
    // openingSeat stores yaw = −atan2(dz, dx): a wall heading +Z has yaw −90°,
    // and the door's own +X then points down +Z.
    const d = pocket({ rotationY: -Math.PI / 2 })
    expect(pocketConflicts([d, obj({ id: 'a', type: 'duplex-outlet', z: 0.9 })]).map((h) => h.objectId)).toEqual(['a'])
    expect(pocketConflicts([d, obj({ type: 'duplex-outlet', z: -0.9 })])).toHaveLength(0)
  })

  it('flags an in-wall wire through the pocket, not one under the floor', () => {
    const toWorld = (px: number, py: number) => ({ x: px / 100, z: py / 100 })
    const line = (band: TracedLine['band']): TracedLine => ({
      id: `l-${band}`, x1: 60, y1: 0, x2: 200, y2: 0, elementType: 'Branch Circuit', size: '', material: '', band,
    })
    const hits = pocketConflicts([pocket()], { electrical: [line('in-wall')], plumbing: [line('under-floor')] }, toWorld)
    expect(hits.map((h) => h.lineId)).toEqual(['l-in-wall'])
  })
})

describe('a legacy "Sliding" door frames as what it draws as', () => {
  it('a wide one gets the patio slider opening, a narrow one the swing rule', () => {
    expect(roughOpening('door', 'Sliding', 72 * IN, 80 * IN).rule).toBe('patio')
    expect(roughOpening('door', 'Sliding', 48 * IN, 80 * IN).rule).toBe('swing')
  })
})
