import { describe, it, expect } from 'vitest'
import { MEMBERS, WALL_TYPES, getMember, membersFor, memberSectionM, getWallType } from './members'
import { wallFramingSpec } from '../services/constructionCode'

describe('member catalogue', () => {
  it('ids are unique', () => {
    expect(new Set(MEMBERS.map((m) => m.id)).size).toBe(MEMBERS.length)
  })

  it('every member has a real section and a default grade', () => {
    for (const m of MEMBERS) {
      expect(m.widthIn, m.id).toBeGreaterThan(0)
      expect(m.depthIn, m.id).toBeGreaterThanOrEqual(m.widthIn)
      expect(m.grades.length, m.id).toBeGreaterThan(0)
    }
  })

  it('a 2x4 is 1-1/2 by 3-1/2, not 2 by 4', () => {
    const s = memberSectionM(getMember('sawn-2x4')!)
    expect(s.width).toBeCloseTo(0.0381, 4)
    expect(s.depth).toBeCloseTo(0.0889, 4)
  })

  it('offers the engineered families for the jobs they do', () => {
    const headers = membersFor('header').map((m) => m.family)
    expect(headers).toEqual(expect.arrayContaining(['sawn', 'lvl', 'lsl', 'psl', 'glulam']))
    expect(membersFor('joist', 'i-joist').length).toBeGreaterThan(0)
    expect(membersFor('beam').some((m) => m.family === 'glulam')).toBe(true)
    expect(membersFor('post').some((m) => m.family === 'psl')).toBe(true)
    expect(membersFor('rim').some((m) => m.family === 'rim-board')).toBe(true)
  })
})

describe('wall types come from the catalogue', () => {
  it('every wall type frames with a stud that exists', () => {
    for (const t of WALL_TYPES) expect(getMember(t.studMemberId), t.key).toBeDefined()
  })

  /** The same answers the old inline table gave, so no existing wall changes. */
  it('resolves every stored wall key exactly as before', () => {
    const before: Record<string, { material: string; studSize: string; steelWidth?: string; isMasonry: boolean }> = {
      'wood-2x4':    { material: 'wood',  studSize: '2x4', isMasonry: false },
      'wood-2x6':    { material: 'wood',  studSize: '2x6', isMasonry: false },
      'wood-2x8':    { material: 'wood',  studSize: '2x8', isMasonry: false },
      'steel-1-5-8': { material: 'steel', studSize: '2x4', steelWidth: '1-5/8', isMasonry: false },
      'steel-3-5-8': { material: 'steel', studSize: '2x4', steelWidth: '3-5/8', isMasonry: false },
      'steel-6':     { material: 'steel', studSize: '2x6', steelWidth: '6', isMasonry: false },
      'steel-8':     { material: 'steel', studSize: '2x8', steelWidth: '8', isMasonry: false },
      'cmu':         { material: 'wood',  studSize: '2x6', isMasonry: true },
    }
    for (const [key, want] of Object.entries(before)) {
      const got = wallFramingSpec(key, 'interior-non-bearing')
      expect({ material: got.material, studSize: got.studSize, steelWidth: got.steelWidth, isMasonry: got.isMasonry }, key)
        .toEqual({ steelWidth: undefined, ...want })
    }
    expect(wallFramingSpec(undefined).studSize).toBe('2x4')
    expect(wallFramingSpec('nonsense').studSize).toBe('2x4')
  })

  it('looks a wall type up by its stored key', () => {
    expect(getWallType('wood-2x6')?.studMemberId).toBe('sawn-2x6')
    expect(getWallType(undefined)).toBeUndefined()
  })
})
