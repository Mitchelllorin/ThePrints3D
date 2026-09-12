import { describe, it, expect } from 'vitest'
import { parseTag, readPlanTags, tagSummary, legendGaps, learnLegendEntry, LEGEND, type LegendEntry } from './planTags'

const tok = (text: string, x = 0, y = 0) => ({ text, x, y, confidence: 90 })

describe('parseTag', () => {
  it('reads a panel tag off a real shop drawing', () => {
    // Straight off Mitchell's Castle by Telus sheet.
    const t = parseTag('EXT-101.3')!
    expect(t.prefix).toBe('EXT')
    expect(t.number).toBe('101')
    expect(t.suffix).toBe('3')          // the floor
    expect(t.kind).toBe('panel')
    expect(t.label).toMatch(/exterior/i)
  })

  it('keeps a tag whose prefix is not in the legend', () => {
    // H&P is one shop's scheme. We do not know it, but "something is tagged
    // here" is still worth more than dropping it on the floor.
    const t = parseTag('H&P-505.3')!
    expect(t.prefix).toBe('H&P')
    expect(t.number).toBe('505')
    expect(t.kind).toBe('unknown')
    expect(t.label).toBeNull()
  })

  it('reads a unit label', () => {
    const t = parseTag('UNIT C3 305')!
    expect(t.kind).toBe('unit')
    expect(t.number).toBe('C3 305')
  })

  it('reads schedule marks for shear walls and holdowns', () => {
    expect(parseTag('SW2')!.kind).toBe('shear')
    expect(parseTag('HDU5')!.kind).toBe('holdown')
    // HDU must not resolve to the "HD" or "D" entry — longest prefix wins.
    expect(parseTag('HDU8')!.label).toMatch(/holdown/i)
    expect(parseTag('D-01')!.kind).toBe('opening')
  })

  it('is not fooled by ordinary words or dimensions', () => {
    expect(parseTag('BEDROOM')).toBeNull()
    expect(parseTag("8'-9 1/2\"")).toBeNull()
    expect(parseTag('')).toBeNull()
    expect(parseTag('TOTAL AREA = 71 m2')).toBeNull()
  })

  it('takes a shop of its own legend without touching the shipped one', () => {
    const shop: LegendEntry[] = [...LEGEND, { prefix: 'H&P', kind: 'panel', label: 'Hall and party panel', source: 'Giusti' }]
    expect(parseTag('H&P-505.3', shop)!.label).toBe('Hall and party panel')
    // The shipped legend is unchanged — one contractor's scheme is not everyone's.
    expect(parseTag('H&P-505.3')!.label).toBeNull()
  })
})

describe('legendGaps — what to ask the user about', () => {
  const sheet = [
    tok('EXT-101.3'), tok('EXT-102.3'),                     // known, never asked about
    tok('H&P-505.3'), tok('H&P-506.3'), tok('H&P-507.3'),   // unknown, three of them
    tok('ZZ-900.1'), tok('ZZ-901.1'),                       // unknown, two
    tok('QQ-1.1'),                                          // unknown, once — a typo, probably
  ]

  it('asks about what it cannot read, most-used first', () => {
    const gaps = legendGaps(readPlanTags(sheet))
    expect(gaps.map((g) => g.prefix)).toEqual(['H&P', 'ZZ'])
    expect(gaps[0].count).toBe(3)
    expect(gaps[0].examples).toContain('H&P-505.3')
  })

  it('does not interview anybody about a one-off', () => {
    expect(legendGaps(readPlanTags(sheet)).some((g) => g.prefix === 'QQ')).toBe(false)
    // Unless you ask it to — a single tag is still a gap if you want it.
    expect(legendGaps(readPlanTags(sheet), 1).some((g) => g.prefix === 'QQ')).toBe(true)
  })

  it('asks nothing when the legend already covers the sheet', () => {
    expect(legendGaps(readPlanTags([tok('EXT-101.3'), tok('SW2'), tok('HDU5')]))).toEqual([])
  })

  it('an answer decodes that prefix from then on', () => {
    const learned = learnLegendEntry(LEGEND, { prefix: 'h&p', kind: 'panel', label: 'Hall and party panel', source: 'Giusti' })
    const tags = readPlanTags([tok('H&P-505.3')], learned)
    expect(tags[0].kind).toBe('panel')
    expect(tags[0].label).toBe('Hall and party panel')
    expect(legendGaps(tags)).toEqual([])
  })
})

describe('readPlanTags', () => {
  it('keeps where each tag sits, so it can be matched to geometry later', () => {
    const tags = readPlanTags([tok('EXT-101.3', 120, 340), tok('KITCHEN', 400, 400), tok('SW2', 700, 210)])
    expect(tags).toHaveLength(2)
    expect(tags[0]).toMatchObject({ prefix: 'EXT', x: 120, y: 340 })
    expect(tags[1]).toMatchObject({ prefix: 'SW', x: 700, y: 210 })
  })

  it('counts what the sheet told us', () => {
    const tags = readPlanTags([tok('EXT-101.3'), tok('INT-204.1'), tok('UNIT C3 305'), tok('H&P-505.3')])
    const s = tagSummary(tags)
    expect(s.panel).toBe(2)
    expect(s.unit).toBe(1)
    expect(s.unknown).toBe(1)
  })
})
