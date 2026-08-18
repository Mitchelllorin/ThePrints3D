import { describe, it, expect } from 'vitest'
import { countBuiltMembers, groupBuiltMembers, type CountNode } from './builtScene'

const mesh = (info: string | undefined, layer: string, visible = true): CountNode =>
  ({ isMesh: true, visible, userData: info === undefined ? {} : { info, layer } })

const group = (children: CountNode[], visible = true): CountNode => ({ visible, children })

describe('countBuiltMembers — the model IS the takeoff', () => {
  it('tallies members by name', () => {
    const root = group([
      mesh('2×6 wood stud', 'framing'),
      mesh('2×6 wood stud', 'framing'),
      mesh('2×4 wood stud', 'framing'),
    ])
    expect(countBuiltMembers(root)).toEqual([
      { label: '2×6 wood stud', layer: 'framing', count: 2 },
      { label: '2×4 wood stud', layer: 'framing', count: 1 },
    ])
  })

  it('keeps sizes apart — the estimate could not', () => {
    // The old takeoff said "Studs (~16" OC): 932 ea" with no size at all. A
    // framer cannot order from that.
    const root = group([mesh('2×6 wood stud', 'framing'), mesh('2×8 wood stud', 'framing')])
    expect(countBuiltMembers(root).map((m) => m.label).sort())
      .toEqual(['2×6 wood stud', '2×8 wood stud'])
  })

  it('folds the descriptive tail so a rafter is a rafter', () => {
    const root = group([mesh('Rafter · 6:12', 'roof'), mesh('Rafter · 8:12', 'roof')])
    expect(countBuiltMembers(root)).toEqual([{ label: 'Rafter', layer: 'roof', count: 2 }])
  })

  it('counts what is STANDING — a hidden branch is not in the model', () => {
    const root = group([
      mesh('2×6 wood stud', 'framing'),
      group([mesh('Asphalt shingles', 'roof'), mesh('Asphalt shingles', 'roof')], false),
    ])
    expect(countBuiltMembers(root)).toEqual([{ label: '2×6 wood stud', layer: 'framing', count: 1 }])
  })

  it('skips an individually hidden mesh too', () => {
    const root = group([mesh('2×6 wood stud', 'framing'), mesh('2×6 wood stud', 'framing', false)])
    expect(countBuiltMembers(root)[0].count).toBe(1)
  })

  it('ignores untagged helpers — no name, not a component', () => {
    const root = group([mesh(undefined, 'framing'), mesh('2×6 wood stud', 'framing')])
    expect(countBuiltMembers(root)).toHaveLength(1)
  })

  it('is empty before the 3D mounts', () => {
    expect(countBuiltMembers(null)).toEqual([])
  })

  it('walks nested groups', () => {
    const root = group([group([group([mesh('Top plate', 'framing')])])])
    expect(countBuiltMembers(root)).toEqual([{ label: 'Top plate', layer: 'framing', count: 1 }])
  })
})

describe('groupBuiltMembers', () => {
  it('groups by system for display', () => {
    const members = countBuiltMembers(group([
      mesh('2×6 wood stud', 'framing'),
      mesh('Asphalt shingles', 'roof'),
      mesh('Rafter', 'roof'),
    ]))
    const grouped = groupBuiltMembers(members)
    expect(grouped.map((g) => g.layer)).toEqual(['framing', 'roof'])
    expect(grouped.find((g) => g.layer === 'roof')?.items).toHaveLength(2)
  })
})
