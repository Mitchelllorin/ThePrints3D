import { describe, it, expect } from 'vitest'
import { computeTakeoff } from './takeoff'
import type { ParsedWall, TracedLine } from '../types'

const roofLine = (over: Partial<TracedLine>): TracedLine => ({
  id: 'r1', x1: 0, y1: 0, x2: 100, y2: 60,
  elementType: 'gable', size: '6:12', material: '', ...over,
})

// 1px = 100mm at this scale, so the rect is 10m × 6m.
const MM_PER_PX = 100

const baseInput = {
  scaleMmPerPx: MM_PER_PX, wallHeightM: 2.7,
  walls: [], plumbing: [], electrical: [], hvac: [], floors: [], roof: [],
  placedObjects: [],
}

const floorLine = (over: Partial<TracedLine>): TracedLine => ({
  id: 'f1', x1: 0, y1: 0, x2: 100, y2: 60,
  elementType: 'I-Joist', size: '16"', material: '', ...over,
})

describe('computeTakeoff — roof section (roofPlanes-backed)', () => {
  it('reports SLOPED covering area, not the flat footprint', () => {
    const sections = computeTakeoff({ ...baseInput, roof: [roofLine({})], roofOverhangM: 0 })
    const roof = sections.find((s) => s.title === 'Roof')
    expect(roof).toBeDefined()
    // 10×6 = 60 m² footprint = 645.8 sq ft flat. 6:12 (pitch .5) → ×1.118 ≈ 722 sq ft.
    const area = roof!.items.find((i) => i.key === 'gable')!
    expect(area.quantity).toBeGreaterThan(700)
    expect(area.quantity).toBeLessThan(740)
    // Sheets from the sloped area (23), strictly more than the flat-footprint count (21).
    const sheets = roof!.items.find((i) => i.key === '__sheets')!
    expect(sheets.quantity).toBe(23)
  })

  it('lists fascia and ridge/hip cap footage', () => {
    const sections = computeTakeoff({ ...baseInput, roof: [roofLine({})], roofOverhangM: 0 })
    const roof = sections.find((s) => s.title === 'Roof')!
    const fascia = roof.items.find((i) => i.key === '__fascia')!
    const cap = roof.items.find((i) => i.key === '__ridgecap')!
    expect(fascia.quantity).toBeGreaterThan(60) // 20 m of eave ≈ 65.6 ft
    expect(cap.quantity).toBeGreaterThan(30)    // 10 m ridge ≈ 32.8 ft
  })

  it('a hip roof reports hip cap footage (ridge + hips)', () => {
    const gable = computeTakeoff({ ...baseInput, roof: [roofLine({})], roofOverhangM: 0 })
      .find((s) => s.title === 'Roof')!.items.find((i) => i.key === '__ridgecap')!.quantity
    const hip = computeTakeoff({ ...baseInput, roof: [roofLine({ elementType: 'hip' })], roofOverhangM: 0 })
      .find((s) => s.title === 'Roof')!.items.find((i) => i.key === '__ridgecap')!.quantity
    expect(hip).toBeGreaterThan(gable) // hips add substantial cap length
  })

  it('a live ridge pitch override drives the area (steeper → more sheathing)', () => {
    const steep = computeTakeoff({
      ...baseInput, roofOverhangM: 0,
      roof: [roofLine({ ridge: { pitch: 1.0 } })], // 12:12
    }).find((s) => s.title === 'Roof')!.items.find((i) => i.key === 'gable')!.quantity
    const shallow = computeTakeoff({ ...baseInput, roof: [roofLine({})], roofOverhangM: 0 })
      .find((s) => s.title === 'Roof')!.items.find((i) => i.key === 'gable')!.quantity
    expect(steep).toBeGreaterThan(shallow)
  })

  it('no roof areas → no Roof section', () => {
    const sections = computeTakeoff({ ...baseInput, roof: [] })
    expect(sections.find((s) => s.title === 'Roof')).toBeUndefined()
  })
})


describe('computeTakeoff — floor sheet goods', () => {
  it('counts subfloor sheets only on decked floors, never on a slab', () => {
    const slab = computeTakeoff({ ...baseInput, floors: [floorLine({ elementType: 'Concrete Slab' })] })
      .find((s) => s.title === 'Floors')!
    // The slab is still measured — it is a concrete order — but it takes no deck.
    expect(slab.items.find((i) => i.key === 'Concrete Slab')!.quantity).toBe(645.8)
    expect(slab.items.find((i) => i.key === '__sheets')).toBeUndefined()
  })

  it('a slab beside a joist floor does not double the sheet count', () => {
    const mixed = computeTakeoff({
      ...baseInput,
      floors: [floorLine({ elementType: 'Concrete Slab' }), floorLine({ id: 'f2' })],
    }).find((s) => s.title === 'Floors')!
    // 10 × 6 m = 645.8 sq ft ÷ 32 = 21 sheets for the joist half, not 42 for both.
    expect(mixed.items.find((i) => i.key === '__sheets')!.quantity).toBe(21)
  })
})

describe('computeTakeoff — wall board', () => {
  it('reports board in its own section, so the cut list can replace only the framing estimate', () => {
    const wall = { id: 'w1', x1: 0, y1: 0, x2: 100, y2: 0, framingType: '2×6 wood', wallRole: 'wall' } as unknown as ParsedWall
    const sections = computeTakeoff({ ...baseInput, walls: [wall] })
    const board = sections.find((s) => s.title === 'Board & sheathing')!
    expect(board.items[0].key).toBe('__board')
    expect(board.items[0].quantity).toBeGreaterThan(0)
    // The framing estimate still exists; TakeoffPanel is what drops it.
    expect(sections.find((s) => s.title === 'Walls')).toBeDefined()
  })
})

const wall = (over: Partial<ParsedWall> & { id?: string } = {}): ParsedWall => ({
  id: 'w1', x1: 0, y1: 0, x2: 100, y2: 0,
  framingType: 'wood-2x6', wallRole: 'exterior-bearing',
  ...over,
} as unknown as ParsedWall)

const item = (sections: ReturnType<typeof computeTakeoff>, title: string, key: string) =>
  sections.find((s) => s.title === title)?.items.find((i) => i.key === key)

describe('computeTakeoff — foundation', () => {
  it('orders the slab’s concrete, base, barrier, mesh, bolts and forms', () => {
    const s = computeTakeoff({ ...baseInput, floors: [floorLine({ elementType: 'Concrete Slab' })] })
    // 10 × 6 m = 645.8 sq ft at 4" + 5% waste = 8.4 cu yd.
    expect(item(s, 'Foundation', '__slab')!.quantity).toBe(8.4)
    expect(item(s, 'Foundation', '__base')!.quantity).toBe(8.4)
    expect(item(s, 'Foundation', '__vb')!.quantity).toBe(710)
    expect(item(s, 'Foundation', '__mesh')!.quantity).toBe(15)
    // 32 m perimeter = 105 ft at 6' o.c. = 18 bolts, plus the two end bolts.
    expect(item(s, 'Foundation', '__anchors')!.quantity).toBe(20)
    expect(item(s, 'Foundation', '__forms')!.quantity).toBe(105)
  })

  it('does not invent a foundation under a joist floor', () => {
    const s = computeTakeoff({ ...baseInput, floors: [floorLine({})] })
    expect(s.find((x) => x.title === 'Foundation')).toBeUndefined()
  })
})

describe('computeTakeoff — windows & doors', () => {
  const door = { type: 'door', widthM: 0.9144, heightM: 2.032, subtype: 'Hinged Single', orderAs: 'Door, 36"' }
  const window = { type: 'window', widthM: 1.2, heightM: 1.2, subtype: 'Fixed' }

  it('schedules the units by size, not as a head count', () => {
    const s = computeTakeoff({ ...baseInput, placedObjects: [door, window] })
    expect(item(s, 'Windows & doors', 'Door, 36"')!.quantity).toBe(1)
    // A 1.2 m unit is 47", so the schedule reads 3'-11" — the size on the order.
    expect(item(s, 'Windows & doors', 'Window, 3\'-11" × 3\'-11"')!.quantity).toBe(1)
  })

  it('adds the flashing, sill pans and foam the units need', () => {
    const s = computeTakeoff({ ...baseInput, placedObjects: [door, window] })
    expect(item(s, 'Windows & doors', '__flashing')!.quantity).toBe(1) // ~36 ft of rough-opening perimeter
    expect(item(s, 'Windows & doors', '__sillpans')!.quantity).toBe(1)
    expect(item(s, 'Windows & doors', '__foam')!.quantity).toBe(1)
  })

  it('says nothing when nothing is placed', () => {
    expect(computeTakeoff(baseInput).find((x) => x.title === 'Windows & doors')).toBeUndefined()
  })
})

describe('computeTakeoff — envelope', () => {
  it('insulates, wraps and sides the exterior walls by measured area', () => {
    const s = computeTakeoff({ ...baseInput, walls: [wall()] })
    // 10 m of wall × 2.7 m high = 290.6 sq ft.
    expect(item(s, 'Envelope', 'Batt insulation, R-21 (walls)')!.quantity).toBe(290.6)
    // 290.6 × 1.1 ÷ 100 = 3.2 → 4 squares; ÷ 300 = 1.07 → 2 wrap rolls.
    expect(item(s, 'Envelope', '__siding')!.quantity).toBe(4)
    expect(item(s, 'Envelope', '__wrap')!.quantity).toBe(2)
  })

  it('leaves an interior partition uninsulated', () => {
    const s = computeTakeoff({ ...baseInput, walls: [wall({ wallRole: 'interior-bearing' })] })
    expect(s.find((x) => x.title === 'Envelope')).toBeUndefined()
  })

  it('buys underlayment, shingles and venting off the SLOPED roof area', () => {
    const s = computeTakeoff({ ...baseInput, roof: [roofLine({})], roofOverhangM: 0 })
    // 722 sq ft sloped × 1.1 = 794.5 → 8 squares, 2 rolls of underlayment.
    expect(item(s, 'Envelope', '__shingles')!.quantity).toBe(8)
    expect(item(s, 'Envelope', '__underlay')!.quantity).toBe(2)
    expect(item(s, 'Envelope', '__ridgevent')!.quantity).toBeGreaterThan(0)
    expect(item(s, 'Envelope', '__dripedge')!.quantity).toBeGreaterThan(0)
  })
})

describe('computeTakeoff — fasteners & consumables', () => {
  it('counts nails off the studs and hangers off the joist field', () => {
    const s = computeTakeoff({ ...baseInput, walls: [wall()], floors: [floorLine({})] })
    // 32.8 ft at 16" o.c. = 25 studs → 3.8 lb of 16d.
    expect(item(s, 'Fasteners & consumables', '__16d')!.quantity).toBe(3.8)
    // A 6 m span at 16" o.c. is 15 joists, hanging at both ends.
    expect(item(s, 'Fasteners & consumables', '__hangers')!.quantity).toBe(30)
    expect(item(s, 'Fasteners & consumables', '__hangernails')!.quantity).toBe(3)
  })

  it('says nothing on an empty model', () => {
    expect(computeTakeoff(baseInput).find((x) => x.title === 'Fasteners & consumables')).toBeUndefined()
  })
})

describe('computeTakeoff — finishes', () => {
  it('orders tape, mud, primer and paint off the boarded area', () => {
    const s = computeTakeoff({ ...baseInput, walls: [wall()] })
    // 581.3 sq ft boarded (both faces).
    expect(item(s, 'Finishes', '__tape')!.quantity).toBe(2)
    expect(item(s, 'Finishes', '__mud')!.quantity).toBe(2)
    expect(item(s, 'Finishes', '__primer')!.quantity).toBe(2)
    expect(item(s, 'Finishes', '__paint')!.quantity).toBe(4) // two coats
  })

  it('beads the corners and runs base round the ground floor', () => {
    const corner = wall({ id: 'w2', x1: 100, y1: 0, x2: 100, y2: 100, wallRole: 'interior-bearing' })
    const s = computeTakeoff({ ...baseInput, walls: [wall(), corner], floors: [floorLine({})] })
    expect(item(s, 'Finishes', '__bead')!.quantity).toBe(1) // one junction, 8.9 ft of bead = 1 stick
    expect(item(s, 'Finishes', '__base')!.quantity).toBe(110) // 105 ft perimeter + 5% waste
  })

  it('cases every opening', () => {
    const s = computeTakeoff({
      ...baseInput, walls: [wall()],
      placedObjects: [{ type: 'door', widthM: 0.9144, heightM: 2.032 }],
    })
    // 2 × (3 ft + 6.7 ft) = 19.3 ft, plus waste.
    expect(item(s, 'Finishes', '__casing')!.quantity).toBe(20)
  })
})

describe('computeTakeoff — MEP buying units and the device schedule', () => {
  it('buys PEX by the coil and counts an elbow at each end of a run', () => {
    const line = { id: 'p1', x1: 0, y1: 0, x2: 100, y2: 0, elementType: 'Supply Line', size: '1/2"', material: 'PEX' } as TracedLine
    const s = computeTakeoff({ ...baseInput, plumbing: [line] })
    // 32.8 ft of 1/2" PEX is one 100 ft coil.
    expect(item(s, 'Plumbing fittings & fixtures', 'PEX 1/2" (100 ft)')!.quantity).toBe(1)
    expect(item(s, 'Plumbing fittings & fixtures', '__elbows')!.quantity).toBe(2)
  })

  it('counts placed fixtures and devices by name', () => {
    const s = computeTakeoff({
      ...baseInput,
      placedObjects: [{ type: 'toilet' }, { type: 'duplex-outlet' }, { type: 'switch' }],
    })
    expect(item(s, 'Plumbing fittings & fixtures', 'Toilets')!.quantity).toBe(1)
    expect(item(s, 'Electrical devices & wire', 'Duplex outlets (15A)')!.quantity).toBe(1)
    expect(item(s, 'Electrical devices & wire', 'Switches')!.quantity).toBe(1)
    // A scheduled device is not ALSO furniture — one line, one order.
    expect(s.find((x) => x.title === 'Fixtures & objects')).toBeUndefined()
  })

  it('buys wire by the 250 ft coil', () => {
    const line = { id: 'e1', x1: 0, y1: 0, x2: 100, y2: 0, elementType: 'Circuit Run', size: '20A', material: '12/2 Romex' } as TracedLine
    const s = computeTakeoff({ ...baseInput, electrical: [line] })
    expect(item(s, 'Electrical devices & wire', '12/2 Romex (250 ft coils)')!.quantity).toBe(1)
  })
})
