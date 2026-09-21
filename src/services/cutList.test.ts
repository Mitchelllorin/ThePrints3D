import { describe, it, expect } from 'vitest'
import { buildWallFraming } from './framingGeometry'
import {
  cutsFromFraming, buyList, nestIntoStock, stockLengthsFt, toSixteenth,
  DEFAULT_WASTE_PCT, type WallCuts, type BuyLine,
  nominalSize, boardFeet, orderBoardFeet,
} from './cutList'
import { countBuiltMembers } from './builtScene'

const IN = 1 / 0.0254
const wall = { length: 4, height: 2.44, thickness: 0.09, material: 'wood' as const }
const cuts = (opts: Parameters<typeof buildWallFraming>[0]) => cutsFromFraming(buildWallFraming(opts))
const line = (ls: ReturnType<typeof cuts>, role: string) => ls.filter((l) => l.role === role)
const qty = (ls: ReturnType<typeof cuts>, role: string) => line(ls, role).reduce((n, l) => n + l.qty, 0)

describe('a stud is as long as the stud, not as tall as the wall', () => {
  it('cuts studs to the gap between the plates', () => {
    const studs = line(cuts(wall), 'stud')
    expect(studs).toHaveLength(1)                   // every field stud the same length
    // Double bottom plate + double top plate = 6" of plate out of the wall height.
    expect(studs[0].lengthIn).toBeCloseTo(toSixteenth((2.44 - 4 * 0.038) * IN), 1)
    // The bug this replaces: a stud reported at the full wall height.
    expect(studs[0].lengthIn).toBeLessThan(2.44 * IN - 5)
  })

  it('cuts the plates to the wall, four of them, and nothing to length zero', () => {
    const ls = cuts(wall)
    expect(qty(ls, 'bottom plate')).toBe(2)
    expect(qty(ls, 'top plate')).toBe(1)
    expect(qty(ls, 'cap plate')).toBe(1)
    for (const l of ls) expect(l.lengthIn).toBeGreaterThan(0)
    for (const l of line(ls, 'bottom plate')) expect(l.lengthIn).toBeCloseTo(4 * IN, 1)
  })

  it('counts exactly the members the model stands up', () => {
    // The whole claim of a counted list: it cannot disagree with the model. The
    // model tallies by the name on the member, this by the job it does — every
    // mesh has to land in exactly one row, none lost and none invented.
    const g = buildWallFraming({ ...wall, openings: [{ centerM: 2, widthM: 0.9, type: 'door' }] })
    const named = (label: string) => countBuiltMembers(g)
      .filter((m) => m.label === label).reduce((n, m) => n + m.count, 0)
    const ls = cutsFromFraming(g)
    expect(qty(ls, 'stud')).toBe(named('2×4 wood stud'))
    expect(qty(ls, 'king stud')).toBe(named('2×4 king stud'))
    expect(qty(ls, 'jack stud')).toBe(named('2×4 jack stud'))
    expect(qty(ls, 'cripple')).toBe(named('2×4 cripple stud'))
    expect(qty(ls, 'blocking')).toBe(named('2×4 blocking'))
    // Nothing in the wall is left off the list: every stamped mesh is counted.
    const meshes = countBuiltMembers(g).reduce((n, m) => n + m.count, 0)
    const listedPieces = ls.reduce((n, l) => n + l.qty, 0)
    // The header is one mesh bought as two plies, so the list runs one ahead.
    expect(listedPieces).toBe(meshes + 1)
  })
})

describe('a corner is bought once', () => {
  it('shortens the butting wall by a member depth, plates and end stud alike', () => {
    const plain = cuts(wall)
    const butting = cuts({ ...wall, capLap: { start: 'back' } })
    const plateOf = (ls: ReturnType<typeof cuts>, role: string) => line(ls, role)[0].lengthIn
    expect(plateOf(butting, 'bottom plate')).toBeCloseTo(plateOf(plain, 'bottom plate') - wall.thickness * IN, 1)
    expect(plateOf(butting, 'top plate')).toBeCloseTo(plateOf(plain, 'top plate') - wall.thickness * IN, 1)
  })

  it('laps the cap the other way, so the two walls tie', () => {
    // Lower plate short one way, cap short the other — that is the double top
    // plate doing its job. Both short on the same wall is no tie at all.
    const through = cuts({ ...wall, capLap: { start: 'lap' } })
    const butting = cuts({ ...wall, capLap: { start: 'back' } })
    const capOf = (ls: ReturnType<typeof cuts>) => line(ls, 'cap plate')[0].lengthIn
    const botOf = (ls: ReturnType<typeof cuts>) => line(ls, 'bottom plate')[0].lengthIn
    expect(capOf(through)).toBeLessThan(botOf(through))
    expect(capOf(butting)).toBeGreaterThan(botOf(butting))
  })

  it('stops a tee arrival at the face of the wall it lands on', () => {
    const arriving = cuts({ ...wall, endTrim: { end: 0.07 } })
    const plain = cuts(wall)
    expect(line(arriving, 'bottom plate')[0].lengthIn)
      .toBeCloseTo(line(plain, 'bottom plate')[0].lengthIn - 0.07 * IN, 1)
  })
})

describe('an opening is framed, and the framing is on the list', () => {
  const doorWall = { ...wall, openings: [{ centerM: 2, widthM: 0.9, type: 'door' as const, heightM: 2.06 }] }

  it('lists kings, jacks and a header in plies', () => {
    const ls = cuts(doorWall)
    expect(qty(ls, 'king stud')).toBe(2)
    expect(qty(ls, 'jack stud')).toBe(2)
    // A 2×4 wall takes two plies of 1-3/4" LVL; one box drawn, two pieces cut.
    const header = line(ls, 'header')
    expect(header).toHaveLength(1)
    expect(header[0].qty).toBe(2)
    expect(header[0].member).toContain('LVL')
    // The header spans the rough opening plus a jack each side.
    expect(header[0].lengthIn).toBeCloseTo(toSixteenth((0.9 + 2 * 0.038) * IN), 1)
  })

  it('makes a jack shorter than a king, and a cripple shorter again', () => {
    const ls = cuts(doorWall)
    const len = (role: string) => line(ls, role)[0].lengthIn
    expect(len('jack stud')).toBeLessThan(len('king stud'))
    expect(qty(ls, 'cripple')).toBeGreaterThan(0)
    expect(len('cripple')).toBeLessThan(len('jack stud'))
  })

  it('gives a window a sill cut to the rough opening, and sill cripples under it', () => {
    const ls = cuts({ ...wall, openings: [{ centerM: 2, widthM: 1.2, type: 'window', sillM: 0.9, heightM: 1.13 }] })
    expect(line(ls, 'sill')[0].lengthIn).toBeCloseTo(toSixteenth(1.2 * IN), 1)
    expect(qty(ls, 'sill cripple')).toBeGreaterThan(0)
  })

  it('grows the bearing with the span — a garage opening is not a closet door', () => {
    const jacks = (widthM: number) =>
      qty(cuts({ ...wall, length: Math.max(6, widthM + 2), openings: [{ centerM: Math.max(6, widthM + 2) / 2, widthM, type: 'door' }] }), 'jack stud')
    expect(jacks(0.9)).toBe(2)     // 3 ft door — one each side
    expect(jacks(1.8)).toBe(4)     // 6 ft patio — two each side
    expect(jacks(4.9)).toBe(6)     // 16 ft garage — three each side
  })

  it('doubles the kings on an opening wide enough to need them', () => {
    const kings = (widthM: number) =>
      qty(cuts({ ...wall, length: Math.max(6, widthM + 2), openings: [{ centerM: Math.max(6, widthM + 2) / 2, widthM, type: 'door' }] }), 'king stud')
    expect(kings(0.9)).toBe(2)
    expect(kings(4.9)).toBe(4)
  })

  it('makes the header long enough to bear on every jack under it', () => {
    const big = cuts({ ...wall, length: 8, openings: [{ centerM: 4, widthM: 4.9, type: 'door' }] })
    // 16 ft opening, three jacks a side: the header runs over all six.
    expect(line(big, 'header')[0].lengthIn).toBeCloseTo(toSixteenth((4.9 + 6 * 0.038) * IN), 1)
  })

  it('three plies in a 2×6 wall, four in a 2×8', () => {
    const ply = (thickness: number) =>
      line(cuts({ ...wall, thickness, openings: doorWall.openings }), 'header')[0].qty
    expect(ply(0.14)).toBe(3)
    expect(ply(0.1841)).toBe(4)
  })
})

describe('no offcut blocking', () => {
  it('does not block between the studs of a pack', () => {
    // A pack leaves a stud-width gap; blocking it would be a 1-3/4" offcut.
    const ls = cuts({ ...wall, packs: [{ atM: 2, studs: 3 }] })
    for (const l of line(ls, 'blocking')) expect(l.lengthIn).toBeGreaterThan(5)
  })

  it('still blocks a full stud bay', () => {
    expect(line(cuts(wall), 'blocking')[0].lengthIn).toBeGreaterThan(13)
  })
})

describe('packs are picked out of the field', () => {
  it('counts a 5-pack as five studs standing in a pack', () => {
    const ls = cuts({ ...wall, packs: [{ atM: 2, studs: 5 }] })
    const studs = line(ls, 'stud')
    expect(studs.reduce((n, l) => n + l.inPacks, 0)).toBeGreaterThanOrEqual(5)
  })
})

describe('steel walls are cut too', () => {
  const steel = { length: 4, height: 2.7, thickness: 0.0921, material: 'steel' as const, steelGauge: '20' }
  it('lists track by the web, once per run, not three times for the legs', () => {
    const ls = cuts(steel)
    expect(qty(ls, 'track')).toBe(2)                    // floor track + top track
    expect(line(ls, 'track')[0].member).toContain('steel track')
    expect(line(ls, 'track')[0].member).toContain('20ga')
  })
  it('has no wood blocking, and studs short of the track webs', () => {
    const ls = cuts(steel)
    expect(qty(ls, 'blocking')).toBe(0)
    expect(line(ls, 'stud')[0].lengthIn).toBeLessThan(2.7 * IN)
  })
})

describe('nesting pieces into stock lengths', () => {
  it('takes one stick per stud', () => {
    expect([...nestIntoStock([90, 90, 90], [8, 10, 12, 16])]).toEqual([[8, 3]])
  })

  it('puts short pieces in one stick, allowing for the saw', () => {
    // 6 × 15" plus kerfs fits an 8' stick; nothing longer is bought.
    const out = nestIntoStock(Array(6).fill(15), [8, 10, 12, 16])
    expect([...out]).toEqual([[8, 1]])
  })

  it('splices a plate longer than the longest stick', () => {
    // A 30' plate off 20' stock: one full stick and a 10' piece.
    const out = nestIntoStock([360], [8, 10, 12, 14, 16, 18, 20])
    expect(out.get(20)).toBe(1)
    expect(out.get(10)).toBe(1)
  })

  it('buys one 16 footer for two 6ft headers, not two 12s', () => {
    // Two 75" pieces do not fit a 12' stick, so piece-by-piece packing opens one
    // each and buys 24 feet. One 16' cut in two is 16 feet and the same two cuts.
    expect([...nestIntoStock([75, 75], [12, 16, 20, 24])]).toEqual([[16, 1]])
  })

  it('drops to the shortest stick a part-used one could come from', () => {
    expect([...nestIntoStock([100], [8, 10, 12, 16])]).toEqual([[10, 1]])
  })

  it('buys nothing for nothing', () => {
    expect([...nestIntoStock([], [8, 10])]).toEqual([])
    expect([...nestIntoStock([90], [])]).toEqual([])
  })

  it('knows the stock each member is sold in', () => {
    expect(stockLengthsFt('2×6')).toContain(16)
    expect(stockLengthsFt('LVL 1-3/4 × 9-1/4')).toContain(24)
    expect(stockLengthsFt('3-5/8" 25ga steel stud')).toContain(20)
  })
})

describe('the buy list rounds UP, per kind of member', () => {
  const walls: WallCuts[] = [{
    index: 0, name: 'Wall 1', level: 0, masonry: false,
    lines: [
      { member: '2×4', role: 'stud', lengthIn: 90, qty: 10, inPacks: 0 },
      { member: '2×4', role: 'bottom plate', lengthIn: 96, qty: 2, inPacks: 0 },
    ],
  }]

  it('adds the waste allowance and never orders a part stick', () => {
    const studs = buyList(walls).filter((b) => b.category === 'studs')
    expect(studs).toHaveLength(1)
    expect(studs[0].needed).toBe(10)
    expect(studs[0].order).toBe(11)               // 10% waste, rounded up
    expect(DEFAULT_WASTE_PCT.studs).toBe(10)
  })

  it('takes a zero allowance at its word', () => {
    const none = buyList(walls, { ...DEFAULT_WASTE_PCT, studs: 0 }).filter((b) => b.category === 'studs')
    expect(none[0].order).toBe(none[0].needed)
  })

  it('buys a stud as a stud, and nests the short stuff', () => {
    // Ten 90" studs are ten 8' studs, not five 16-footers halved. A jack and a
    // cripple out of the same 2×4 DO share a stick.
    const studsOnly = buyList([{ index: 0, name: 'Wall 1', level: 0, masonry: false, lines: [
      { member: '2×4', role: 'stud', lengthIn: 90, qty: 10, inPacks: 0 },
    ] }])
    expect(studsOnly.map((b) => [b.stockFt, b.needed])).toEqual([[8, 10]])
    const shorts = buyList([{ index: 0, name: 'Wall 1', level: 0, masonry: false, lines: [
      { member: '2×4', role: 'jack stud', lengthIn: 80, qty: 1, inPacks: 0 },
      { member: '2×4', role: 'cripple', lengthIn: 12, qty: 1, inPacks: 0 },
    ] }])
    expect(shorts.reduce((n, b) => n + b.needed, 0)).toBe(1)
  })

  it('separates the plates from the studs even in the same stock', () => {
    const cats = buyList(walls).map((b) => b.category)
    expect(new Set(cats)).toEqual(new Set(['studs', 'plates']))
  })

  it('has nothing to order for a wall with nothing cut', () => {
    expect(buyList([{ index: 0, name: 'Wall 1', level: 0, masonry: true, lines: [] }])).toEqual([])
  })
})

describe('board feet — how the yard prices it', () => {
  it('reads the nominal size off a sawn member, and nothing off LVL or steel', () => {
    expect(nominalSize('2×4')).toEqual({ t: 2, w: 4 })
    expect(nominalSize('2×10')).toEqual({ t: 2, w: 10 })
    expect(nominalSize('LVL 1-3/4×9-1/4')).toBeNull()
    expect(nominalSize('3-5/8" 20ga steel stud')).toBeNull()
  })

  it('figures on the nominal size: a 2x4x8 is 5 1/3, a 2x6x16 is 16', () => {
    expect(boardFeet(2, 4, 8)).toBeCloseTo(16 / 3, 9)
    expect(boardFeet(2, 6, 16)).toBe(16)
  })

  it('counts the ORDER — whole sticks with waste — not the pieces cut from them', () => {
    const wall: WallCuts = {
      index: 0, name: 'W1', level: 0, masonry: false,
      lines: [{ member: '2×6', role: 'stud', lengthIn: 92.625, qty: 10, inPacks: 0 }],
    }
    const [line] = buyList([wall], { studs: 10, plates: 0, headers: 0, blocking: 0 })
    // 10 studs nest into 10 eight-footers; +10% waste orders 11.
    expect(line.stockFt).toBe(8)
    expect(line.order).toBe(11)
    expect(line.boardFt).toBeCloseTo(boardFeet(2, 6, 8) * 11, 9)   // 8 BF a stick x 11 = 88
  })

  it('totals the order and says what it left out', () => {
    const buy: BuyLine[] = [
      { member: '2×4', category: 'studs', stockFt: 8, needed: 3, order: 3, boardFt: 16 },
      { member: '2×6', category: 'plates', stockFt: 16, needed: 2, order: 2, boardFt: 32 },
      { member: 'LVL 1-3/4×9-1/4', category: 'headers', stockFt: 12, needed: 1, order: 1, boardFt: null },
    ]
    expect(orderBoardFeet(buy)).toEqual({ total: 48, notCounted: ['LVL 1-3/4×9-1/4'] })
  })
})
