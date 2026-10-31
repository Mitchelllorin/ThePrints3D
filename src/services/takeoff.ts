// Material takeoff — counts EVERYTHING that's been drawn so a tradesperson can
// quote from the model: wall linear feet + studs + board sheets, plumbing /
// electrical / HVAC feet grouped by type·size·material, floor & roof areas with
// subfloor/sheathing sheet counts, and fixture counts. Pure (no store/THREE) so
// it's unit-testable and reusable by the takeoff panel and any export.
//
// Geometry is in image pixels; `scaleMmPerPx` converts to real units
// (1 ft = 304.8 mm). Line systems measure length; floors/roofs measure area.
//
// BEYOND THE FRAME. A frame-only takeoff is half a house: it tells you the studs
// and the sheathing, then stops where the job actually starts spending — the
// slab, the units that go in the holes, insulation, wrap, roofing, nails, mud,
// trim, wire and pipe. Those are here too now, each one measured off what was
// drawn and converted with the trade's own rule of thumb. Every rule is a named
// constant below with the convention it comes from, because an estimate you
// cannot audit is a guess with a decimal point. The numbers are labelled
// estimates in the panel and in the CSV; the counted-from-the-model members are
// kept separate for exactly this reason.

import type { ParsedWall, TracedLine } from '../types'
import { generateRoofPlanes, summarizeRoof } from './roofPlanes'
import { pitchToRatio } from '../data/traceLayers'
import { roughOpening } from './roughOpening'

const MM_PER_FT = 304.8
const MM_PER_M = 1000
const MM_PER_IN = 25.4
const SQM_PER_SQFT = 0.09290304
const M_PER_FT = 0.3048
const FT_PER_M = 3.28084
const STUD_OC_IN = 16
const SHEET_SQFT = 32 // 4'×8'
const DEFAULT_ROOF_OVERHANG_M = 0.4 // ~16" boxed eave (matches roofPlanes default)

export interface TakeoffItem {
  key: string
  label: string
  quantity: number
  unit: string
}

export interface TakeoffSection {
  title: string
  items: TakeoffItem[]
}

/**
 * A placed object, as the schedules need it. `orderAs` is the buy line built
 * elsewhere (see doorOrderName); `widthM`/`heightM` are the UNIT — the leaf or
 * the nominal window — not the rough opening, so the takeoff can work the hole
 * out the same way the framer did.
 */
export interface TakeoffObject {
  type: string
  orderAs?: string
  /** The door leaf / window unit width in metres. */
  widthM?: number
  /** The door leaf / window unit height in metres. */
  heightM?: number
  subtype?: string
}

export interface TakeoffInput {
  scaleMmPerPx: number
  /** Wall height (m) — drives board/sheathing area. */
  wallHeightM: number
  walls: ParsedWall[]
  plumbing: TracedLine[]
  electrical: TracedLine[]
  hvac: TracedLine[]
  /** Floor areas — corner-pair rectangles. */
  floors: TracedLine[]
  /** Roof areas — corner-pair rectangles. */
  roof: TracedLine[]
  /** `orderAs` names what gets bought when the type alone does not — a door
   *  is a pocket kit, a slider or a bifold, and a size (see doorOrderName). */
  placedObjects: TakeoffObject[]
  /** Eave overhang depth (m) used for the roof takeoff. Defaults to ~16". */
  roofOverhangM?: number
}

const lineFt = (l: { x1: number; y1: number; x2: number; y2: number }, mmPerPx: number): number =>
  (Math.hypot(l.x2 - l.x1, l.y2 - l.y1) * mmPerPx) / MM_PER_FT

/** An area's sq ft — its shape's when it has one (an angled floor), else its box's. */
const rectSqFt = (a: { x1: number; y1: number; x2: number; y2: number; shape?: Array<[number, number]> }, mmPerPx: number): number => {
  let frac = 1
  if (a.shape && a.shape.length >= 3) {
    let s = 0
    for (let i = 0; i < a.shape.length; i++) {
      const p = a.shape[i], q = a.shape[(i + 1) % a.shape.length]
      s += p[0] * q[1] - q[0] * p[1]
    }
    frac = Math.abs(s) / 2
  }
  return (Math.abs(a.x2 - a.x1) * Math.abs(a.y2 - a.y1) * frac * mmPerPx * mmPerPx) / (MM_PER_FT * MM_PER_FT)
}

/** The box's perimeter in feet — the edge you form a slab to, the wall you run base to. */
const boxPerimeterFt = (a: { x1: number; y1: number; x2: number; y2: number }, mmPerPx: number): number =>
  (2 * (Math.abs(a.x2 - a.x1) + Math.abs(a.y2 - a.y1)) * mmPerPx) / MM_PER_FT

const round1 = (n: number): number => Math.round(n * 10) / 10
const round0 = (n: number): number => Math.round(n)

/** Sum a quantity into a keyed bucket, accumulating same-key entries. */
function bucket() {
  const map = new Map<string, { label: string; qty: number }>()
  return {
    add(label: string, qty: number) {
      const e = map.get(label) ?? { label, qty: 0 }
      e.qty += qty
      map.set(label, e)
    },
    items(unit: string): TakeoffItem[] {
      return Array.from(map.entries())
        .map(([key, e]) => ({ key, label: e.label, quantity: round1(e.qty), unit }))
        .sort((a, b) => b.quantity - a.quantity)
    },
    get size() { return map.size },
  }
}

/** Linear-run takeoff for a trade (plumbing/electrical/hvac): feet by type·size·material. */
function runSection(title: string, lines: TracedLine[], mmPerPx: number): TakeoffSection | null {
  if (lines.length === 0) return null
  const b = bucket()
  for (const l of lines) {
    const temp = l.tempType ? ` (${l.tempType})` : ''
    const label = [l.elementType, l.size, l.material].filter(Boolean).join(' · ') + temp
    b.add(label || title, lineFt(l, mmPerPx))
  }
  return { title, items: b.items('ft') }
}

/**
 * Which floor builds take a subfloor sheet on top.
 *
 * A slab and a skid set are their own finished surface — they are placed, not
 * decked — so 4×8 sheathing on them is a floor that never gets built. This used
 * to sum EVERY floor area and divide by 32 sq ft, so the showcase's ground-floor
 * slab ordered 34 sheets of subfloor it has no use for. Ceilings are the same
 * story in reverse: they take drywall, not deck.
 */
const SHEETED_FLOOR_TYPES = new Set(['2x10', '2x12', 'I-Joist', 'LVL', 'Skids + 2x6'])

/** Floors that hang on hangers at both ends. A skid set sits on the ground. */
const HANGER_FLOOR_TYPES = new Set(['2x10', '2x12', 'I-Joist', 'LVL'])

/** Area takeoff (floors/roof): sq ft + a sheet count for the areas that are decked. */
function areaSection(
  title: string,
  areas: TracedLine[],
  mmPerPx: number,
  sheeted: (area: TracedLine) => boolean,
): TakeoffSection | null {
  if (areas.length === 0) return null
  const area = bucket()
  let sheetedSqFt = 0
  for (const a of areas) {
    const sqft = rectSqFt(a, mmPerPx)
    if (sheeted(a)) sheetedSqFt += sqft
    area.add(a.elementType || title, sqft)
  }
  const items = area.items('sq ft')
  if (sheetedSqFt > 0) {
    items.push({ key: '__sheets', label: 'Subfloor/sheathing sheets (4×8)', quantity: Math.ceil(sheetedSqFt / SHEET_SQFT), unit: 'sheets' })
  }
  return { title, items }
}

interface RoofMetrics {
  /** True sloped covering area, sq ft. */
  surfaceSqFt: number
  eaveFt: number
  ridgeFt: number
}

/**
 * Roof takeoff — consumes the roofPlanes keystone so a steep or hipped roof
 * reports its true SLOPED covering area (not the flat footprint), plus fascia
 * and ridge/hip cap footage. Each roof area is a plan rectangle carrying its
 * type (elementType), pitch (ridge override or `size`), so we regenerate the
 * same plane model the renderer uses and sum the real quantities.
 *
 * The same totals feed the envelope: underlayment, shingles and venting are all
 * bought by the square yard of ROOF, not of ceiling.
 */
function roofTakeoff(
  roofs: TracedLine[],
  mmPerPx: number,
  overhangM: number,
): { section: TakeoffSection | null; metrics: RoofMetrics } {
  const metrics: RoofMetrics = { surfaceSqFt: 0, eaveFt: 0, ridgeFt: 0 }
  if (roofs.length === 0) return { section: null, metrics }
  const byType = bucket()
  let surfaceSqFt = 0
  let eaveFt = 0, ridgeFt = 0, hipFt = 0, valleyFt = 0
  for (const r of roofs) {
    const lenX = (Math.abs(r.x2 - r.x1) * mmPerPx) / MM_PER_M
    const lenZ = (Math.abs(r.y2 - r.y1) * mmPerPx) / MM_PER_M
    if (lenX <= 0 || lenZ <= 0) continue
    const pitch = r.ridge?.pitch ?? pitchToRatio(r.size)
    const structure = generateRoofPlanes({ lenX, lenZ }, r.elementType || 'gable', pitch, overhangM)
    const q = summarizeRoof(structure)
    const sqft = q.surfaceAreaM2 / SQM_PER_SQFT
    surfaceSqFt += sqft
    byType.add(r.elementType || 'Roof', sqft)
    eaveFt += q.eaveM / M_PER_FT
    ridgeFt += q.ridgeM / M_PER_FT
    hipFt += q.hipM / M_PER_FT
    valleyFt += q.valleyM / M_PER_FT
  }
  if (surfaceSqFt <= 0) return { section: null, metrics }
  metrics.surfaceSqFt = surfaceSqFt
  metrics.eaveFt = eaveFt
  metrics.ridgeFt = ridgeFt + hipFt
  const items = byType.items('sq ft') // sloped covering area by roof type
  items.push({ key: '__sheets', label: 'Roof sheathing (4×8)', quantity: Math.ceil(surfaceSqFt / SHEET_SQFT), unit: 'sheets' })
  if (eaveFt > 0) items.push({ key: '__fascia', label: 'Fascia / eave', quantity: round1(eaveFt), unit: 'ft' })
  const capFt = ridgeFt + hipFt
  if (capFt > 0) items.push({ key: '__ridgecap', label: 'Ridge & hip cap', quantity: round1(capFt), unit: 'ft' })
  if (valleyFt > 0) items.push({ key: '__valley', label: 'Valley flashing', quantity: round1(valleyFt), unit: 'ft' })
  return { section: { title: 'Roof', items }, metrics }
}

// ═══════════════════════════════════════════════════════════════════════════
// FOUNDATION
// ═══════════════════════════════════════════════════════════════════════════

/** A residential slab on grade is 4" over 4" of compacted base. */
const SLAB_IN = 4
const BASE_IN = 4
/** Rebar/mesh laps and a little pour waste; form boards cut to the edge. */
const SLAB_WASTE = 1.05
/** IRC R403.1.6 — anchor bolts at 6'-0" o.c., one within 12" of each end. */
const ANCHOR_OC_FT = 6
/** A 5'×10' sheet of welded wire mesh. */
const MESH_SHEET_SQFT = 50

/**
 * FOUNDATION — the part under the building, which the takeoff used to report as
 * a floor area and nothing else. A slab is the only foundation this app models
 * (a joist floor's foundation walls are not drawn), so the schedule is the
 * slab's own concrete, base, barrier, mesh, bolts and edge forms. What it is
 * NOT: a footing schedule. A slab on grade at 4" needs no thickened footing
 * except under bearing walls, which are not drawn as separate lines.
 */
function foundationSection(floors: TracedLine[], mmPerPx: number): TakeoffSection | null {
  const slabs = floors.filter((f) => f.elementType === 'Concrete Slab')
  if (slabs.length === 0) return null
  let sqft = 0, perimFt = 0
  for (const s of slabs) {
    sqft += rectSqFt(s, mmPerPx)
    perimFt += boxPerimeterFt(s, mmPerPx)
  }
  if (sqft <= 0) return null
  const slabCuFt = sqft * (SLAB_IN / 12) * SLAB_WASTE
  const baseCuFt = sqft * (BASE_IN / 12) * SLAB_WASTE
  return {
    title: 'Foundation',
    items: [
      { key: '__slab', label: `Concrete, ${SLAB_IN}" slab (incl. waste)`, quantity: round1(slabCuFt / 27), unit: 'cu yd' },
      { key: '__base', label: `Compacted base, ${BASE_IN}"`, quantity: round1(baseCuFt / 27), unit: 'cu yd' },
      { key: '__vb', label: 'Vapour barrier, 6 mil', quantity: round0(sqft * 1.1), unit: 'sq ft' },
      { key: '__mesh', label: 'Welded wire mesh (5×10 sheets)', quantity: Math.ceil((sqft * 1.1) / MESH_SHEET_SQFT), unit: 'sheets' },
      { key: '__anchors', label: 'Anchor bolts, ½"×10"', quantity: Math.ceil(perimFt / ANCHOR_OC_FT) + 2, unit: 'ea' },
      { key: '__forms', label: 'Edge forms, 2×10', quantity: round0(perimFt), unit: 'ft' },
    ],
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// WINDOWS & DOORS
// ═══════════════════════════════════════════════════════════════════════════

/** Unit sizes when the object carries none — the catalog defaults (see data/objectCatalog). */
const DEFAULT_DOOR_M = { w: 0.9144, h: 2.032 }
const DEFAULT_WINDOW_M = { w: 1.2, h: 1.2 }
/** A 100-ft roll of peel-and-stick flashing. */
const FLASHING_ROLL_FT = 100
/** One 12-oz can of low-expansion foam does about four units. */
const OPENINGS_PER_FOAM_CAN = 4

const inOf = (m: number): number => Math.round((m * 1000) / MM_PER_IN)
/** 48 → 4'-0". */
const ftIn = (inches: number): string => `${Math.floor(inches / 12)}'-${inches % 12}"`

/**
 * WINDOWS & DOORS — a SCHEDULE, not a head count.
 *
 * This used to say "Door, 30" 2 ea" and stop. A door is bought as a unit, framed
 * as a bigger hole, flashed, shimmed and foamed, and every one of those is a
 * separate line on a real order. The units are grouped by size (using the same
 * `orderAs` name the catalogue builds, so a pocket kit stays a pocket kit), and
 * the rough opening each one needs is worked out by the SAME function the
 * framer uses — so the schedule and the framing cannot disagree.
 */
function openingsSection(objects: TakeoffObject[]): TakeoffSection | null {
  const units = objects.filter((o) => o.type === 'door' || o.type === 'window')
  if (units.length === 0) return null
  const b = bucket()
  let roPerimFt = 0
  let doors = 0
  for (const o of units) {
    const fallback = o.type === 'window' ? DEFAULT_WINDOW_M : DEFAULT_DOOR_M
    const w = o.widthM ?? fallback.w
    const h = o.heightM ?? fallback.h
    const ro = roughOpening(o.type, o.subtype, w, h)
    roPerimFt += 2 * (ro.widthM + ro.heightM) * FT_PER_M
    if (o.type === 'door') doors += 1
    const label = o.orderAs ?? (o.type === 'window'
      ? `Window, ${ftIn(inOf(w))} × ${ftIn(inOf(h))}`
      : `Door, ${inOf(w)}"`)
    b.add(label, 1)
  }
  const items = b.items('ea')
  items.push({ key: '__flashing', label: 'Opening flashing (100 ft rolls)', quantity: Math.ceil((roPerimFt * 1.1) / FLASHING_ROLL_FT), unit: 'rolls' })
  if (doors > 0) items.push({ key: '__sillpans', label: 'Door sill pans', quantity: doors, unit: 'ea' })
  items.push({ key: '__foam', label: 'Low-expansion foam (12 oz)', quantity: Math.ceil(units.length / OPENINGS_PER_FOAM_CAN), unit: 'cans' })
  return { title: 'Windows & doors', items }
}

// ═══════════════════════════════════════════════════════════════════════════
// ENVELOPE
// ═══════════════════════════════════════════════════════════════════════════

/** Cavity insulation by wall build. Steel gets a batt, not a thicker one. */
const WALL_R_VALUE: Record<string, string> = {
  'wood-2x4': 'R-13',
  'wood-2x6': 'R-21',
  'wood-2x8': 'R-25',
  'steel-6': 'R-19',
}
/** A ceiling in a vented attic (IRC climate zones 4–8 territory). */
const CEILING_R_VALUE = 'R-49'
/** Wrap, siding and roofing are bought over the area with a lap. */
const ENVELOPE_WASTE = 1.1
/** A 3'-wide × 100' housewrap roll. */
const WRAP_ROLL_SQFT = 300
/** A 4-square (400 sq ft) roll of synthetic underlayment. */
const UNDERLAYMENT_ROLL_SQFT = 400
/** Shingles and siding are sold by the SQUARE — 100 sq ft. */
const SQUARE_SQFT = 100
/** Ridge vent comes in 4' sections; soffit vent in 8' strips. */
const RIDGE_VENT_FT = 4
const SOFFIT_VENT_FT = 8
/** Drip edge in 10' sticks. */
const DRIP_EDGE_FT = 10

/** R-value for a wall build, falling back to what its framing size implies. */
function wallRValue(framingType: string | undefined, role: string | undefined): string {
  if (framingType && WALL_R_VALUE[framingType]) return WALL_R_VALUE[framingType]
  const s = `${framingType ?? ''} ${role ?? ''}`.toLowerCase()
  if (s.includes('2x4') || s.includes('2×4')) return 'R-13'
  if (s.includes('2x8') || s.includes('2×8')) return 'R-25'
  if (s.includes('steel')) return 'R-19'
  return 'R-21'
}

/**
 * ENVELOPE — what closes the building: insulation in the studs, wrap outside
 * them, siding over that, and the roof's underlayment, covering and venting.
 *
 * Insulation is measured on the EXTERIOR walls only: an interior partition is
 * not a thermal envelope, and counting it would order batts for the hallway.
 * Gable ends are not added to the siding — the framing model has no gable
 * surface to measure, so ordering only the walls is the recoverable direction
 * (a short order you can top up, not four squares you cannot return).
 */
function envelopeSection(
  walls: ParsedWall[],
  floors: TracedLine[],
  roof: RoofMetrics,
  mmPerPx: number,
  wallHeightM: number,
): TakeoffSection | null {
  if (walls.length === 0 && roof.surfaceSqFt <= 0) return null
  const heightFt = wallHeightM * FT_PER_M
  const ext = walls.filter((w) => !/interior/i.test(w.wallRole ?? ''))
  const grossSqFt = ext.reduce((n, w) => n + lineFt(w, mmPerPx), 0) * heightFt

  // The ceiling is the area of the TOP storey — every storey under it has a
  // floor above it, so only the highest one is under the roof.
  const topLevel = floors.reduce((n, f) => Math.max(n, f.level ?? 0), 0)
  const ceilingSqFt = floors
    .filter((f) => (f.level ?? 0) === topLevel)
    .reduce((n, f) => n + rectSqFt(f, mmPerPx), 0)

  const ins = bucket()
  for (const w of ext) {
    const ft = lineFt(w, mmPerPx)
    if (ft <= 0) continue
    ins.add(`Batt insulation, ${wallRValue(w.framingType, w.wallRole)} (walls)`, ft * heightFt)
  }
  if (ceilingSqFt > 0) ins.add(`Blown insulation, ${CEILING_R_VALUE} (ceiling)`, ceilingSqFt)

  const items = ins.items('sq ft')
  if (grossSqFt > 0) {
    items.push({ key: '__wrap', label: 'Housewrap (3×100 ft rolls)', quantity: Math.ceil((grossSqFt * ENVELOPE_WASTE) / WRAP_ROLL_SQFT), unit: 'rolls' })
    items.push({ key: '__siding', label: 'Siding (100 sq ft squares)', quantity: Math.ceil((grossSqFt * ENVELOPE_WASTE) / SQUARE_SQFT), unit: 'squares' })
  }
  if (roof.surfaceSqFt > 0) {
    items.push({ key: '__underlay', label: 'Roof underlayment (400 sq ft rolls)', quantity: Math.ceil((roof.surfaceSqFt * ENVELOPE_WASTE) / UNDERLAYMENT_ROLL_SQFT), unit: 'rolls' })
    items.push({ key: '__shingles', label: 'Roof covering (100 sq ft squares)', quantity: Math.ceil((roof.surfaceSqFt * ENVELOPE_WASTE) / SQUARE_SQFT), unit: 'squares' })
    if (roof.ridgeFt > 0) items.push({ key: '__ridgevent', label: 'Ridge vent (4 ft sections)', quantity: Math.ceil(roof.ridgeFt / RIDGE_VENT_FT), unit: 'ea' })
    if (roof.eaveFt > 0) {
      items.push({ key: '__soffitvent', label: 'Soffit vent (8 ft strips)', quantity: Math.ceil(roof.eaveFt / SOFFIT_VENT_FT), unit: 'ea' })
      items.push({ key: '__dripedge', label: 'Drip edge (10 ft sticks)', quantity: Math.ceil(roof.eaveFt / DRIP_EDGE_FT), unit: 'ea' })
    }
  }
  if (items.length === 0) return null
  return { title: 'Envelope', items }
}

// ═══════════════════════════════════════════════════════════════════════════
// FASTENERS & CONSUMABLES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Nail weights per pound, from the shank: a 16d common (3½") runs about 53 to
 * the pound, an 8d about 82, a hanger nail about 110. The counts per member are
 * the trade's own: ~8 nails per stud end (two ends, two plates), ~48 per sheet
 * of sheathing at 6"/12", ten per hanger.
 */
const FRAMING_NAIL_LB_PER_STUD = 0.15
const SHEATHING_NAIL_LB_PER_SHEET = 0.6
const HANGER_NAIL_LB_PER_HANGER = 0.1
/** One 28-oz tube of subfloor adhesive lays about four sheets. */
const SHEETS_PER_ADHESIVE_TUBE = 4

/**
 * FASTENERS & CONSUMABLES — the line every material list has and every app
 * forgets. Nothing here is drawn, so all of it is derived: nails from the studs
 * and sheets that ARE drawn, hangers from the joist field, adhesive from the
 * deck. It is the first thing a crew runs out of and the last thing anyone
 * remembers to order.
 */
function fastenersSection(
  floors: TracedLine[],
  studs: number,
  sheetCount: number,
  mmPerPx: number,
): TakeoffSection | null {
  const joistFloors = floors.filter((f) => HANGER_FLOOR_TYPES.has(f.elementType))
  let hangers = 0
  for (const f of joistFloors) {
    const spanFt = (Math.min(Math.abs(f.x2 - f.x1), Math.abs(f.y2 - f.y1)) * mmPerPx) / MM_PER_FT
    const ocM = (parseFloat(f.size) || STUD_OC_IN) * MM_PER_IN / 1000
    const spanM = (Math.min(Math.abs(f.x2 - f.x1), Math.abs(f.y2 - f.y1)) * mmPerPx) / MM_PER_M
    const joists = ocM > 0 ? Math.floor(spanM / ocM) + 1 : Math.ceil(spanFt / (STUD_OC_IN / 12)) + 1
    hangers += joists * 2 // both ends of every joist
  }
  const items: TakeoffItem[] = []
  if (studs > 0) items.push({ key: '__16d', label: '16d framing nails', quantity: round1(studs * FRAMING_NAIL_LB_PER_STUD), unit: 'lb' })
  if (sheetCount > 0) items.push({ key: '__8d', label: '8d sheathing nails', quantity: round1(sheetCount * SHEATHING_NAIL_LB_PER_SHEET), unit: 'lb' })
  if (hangers > 0) {
    items.push({ key: '__hangers', label: 'Joist hangers', quantity: hangers, unit: 'ea' })
    items.push({ key: '__hangernails', label: 'Joist hanger nails', quantity: round1(hangers * HANGER_NAIL_LB_PER_HANGER), unit: 'lb' })
  }
  if (sheetCount > 0) items.push({ key: '__adhesive', label: 'Subfloor adhesive (28 oz)', quantity: Math.ceil(sheetCount / SHEETS_PER_ADHESIVE_TUBE), unit: 'tubes' })
  if (items.length === 0) return null
  return { title: 'Fasteners & consumables', items }
}

// ═══════════════════════════════════════════════════════════════════════════
// FINISHES
// ═══════════════════════════════════════════════════════════════════════════

/** Tape, mud and paint coverage, per the manufacturers' published numbers. */
const TAPE_FT_PER_BOARD_SQFT = 1.4
const TAPE_ROLL_FT = 500
const MUD_BUCKET_SQFT = 500 // a 4.5-gal bucket
const PRIMER_GAL_SQFT = 400
const PAINT_GAL_SQFT = 350 // per coat
const PAINT_COATS = 2
/** Finish trim comes in 8' and 16' stock; bead and casing in 8' sticks. */
const TRIM_STICK_FT = 8
const TRIM_WASTE = 1.05

/**
 * Corner-junction points, counted off the wall ends.
 *
 * Two wall ends on the same point are a corner; two ends on the same line are a
 * straight run traced in pieces and are not. Endpoints are clustered at ~2 px so
 * a traced (or dragged) corner that is a pixel out still counts once. Interior
 * corners get taped, not beaded — a plan's OUTSIDE corners are roughly half the
 * junctions, so bead is ordered on half of them rather than guessed per room.
 */
function cornerJunctions(walls: ParsedWall[]): number {
  const key = (x: number, y: number) => `${Math.round(x / 2)},${Math.round(y / 2)}`
  const points = new Map<string, number[]>()
  for (const w of walls) {
    const a = Math.atan2(w.y2 - w.y1, w.x2 - w.x1)
    for (const [x, y] of [[w.x1, w.y1], [w.x2, w.y2]] as const) {
      const k = key(x, y)
      const arr = points.get(k) ?? []
      arr.push(a)
      points.set(k, arr)
    }
  }
  let n = 0
  for (const angles of points.values()) {
    const distinct = angles.filter((a, i) =>
      angles.findIndex((b) => Math.abs(Math.atan2(Math.sin(b - a), Math.cos(b - a))) < 0.26) === i)
    if (distinct.length >= 2) n++
  }
  return n
}

/**
 * FINISHES — what makes the boarded shell a room: tape, mud, corner bead,
 * baseboard, casing and paint. Measured from the board area, the wall ends
 * (corner bead), the floor perimeter (base) and the opening sizes (casing).
 */
function finishesSection(
  walls: ParsedWall[],
  floors: TracedLine[],
  objects: TakeoffObject[],
  boardSqFt: number,
  ceilingSqFt: number,
  mmPerPx: number,
  wallHeightM: number,
): TakeoffSection | null {
  if (boardSqFt <= 0 && ceilingSqFt <= 0) return null
  const heightFt = wallHeightM * FT_PER_M
  const items: TakeoffItem[] = []
  if (boardSqFt > 0) {
    items.push({ key: '__tape', label: 'Joint tape (500 ft rolls)', quantity: Math.ceil((boardSqFt * TAPE_FT_PER_BOARD_SQFT) / TAPE_ROLL_FT), unit: 'rolls' })
    items.push({ key: '__mud', label: 'Joint compound (4.5 gal)', quantity: Math.ceil(boardSqFt / MUD_BUCKET_SQFT), unit: 'buckets' })
    const corners = cornerJunctions(walls)
    if (corners > 0) {
      items.push({ key: '__bead', label: 'Corner bead (8 ft sticks)', quantity: Math.ceil(((corners / 2) * heightFt) / TRIM_STICK_FT), unit: 'ea' })
    }
  }
  // Baseboard runs the perimeter of the ground floor; casing wraps every unit.
  const groundFt = floors.filter((f) => (f.level ?? 0) === 0)
    .reduce((n, f) => n + boxPerimeterFt(f, mmPerPx), 0)
  if (groundFt > 0) items.push({ key: '__base', label: 'Baseboard (ft)', quantity: round0(groundFt * TRIM_WASTE), unit: 'ft' })
  const casingFt = objects
    .filter((o) => o.type === 'door' || o.type === 'window')
    .reduce((n, o) => {
      const fallback = o.type === 'window' ? DEFAULT_WINDOW_M : DEFAULT_DOOR_M
      return n + 2 * ((o.widthM ?? fallback.w) + (o.heightM ?? fallback.h)) * FT_PER_M
    }, 0)
  if (casingFt > 0) items.push({ key: '__casing', label: 'Opening casing (ft)', quantity: round0(casingFt * TRIM_WASTE), unit: 'ft' })
  const paintSqFt = boardSqFt + ceilingSqFt
  if (paintSqFt > 0) {
    items.push({ key: '__primer', label: 'Primer (gal)', quantity: Math.ceil(paintSqFt / PRIMER_GAL_SQFT), unit: 'gal' })
    items.push({ key: '__paint', label: `Paint, ${PAINT_COATS} coats (gal)`, quantity: Math.ceil((paintSqFt * PAINT_COATS) / PAINT_GAL_SQFT), unit: 'gal' })
  }
  if (items.length === 0) return null
  return { title: 'Finishes', items }
}

// ═══════════════════════════════════════════════════════════════════════════
// MEP — fittings, coils and the device schedule
// ═══════════════════════════════════════════════════════════════════════════

/** What the trade buys a pipe in, by material. */
const PIPE_STOCK_FT: Record<string, number> = {
  PEX: 100, // coil
  Copper: 20,
  CPVC: 10,
  PVC: 10,
  ABS: 10,
  'Cast Iron': 10,
  Galvanized: 10,
}
/** Wire in 250' coils, or 500' for a big pull. */
const WIRE_COIL_FT = 250
/** Duct: sheet metal in 5' sections, flex in 25' boxes, fibre in 10' lengths. */
const DUCT_STOCK_FT: Record<string, number> = {
  'Sheet Metal': 5,
  'Spiral Metal': 10,
  Flex: 25,
  'Rigid Fiberglass': 10,
}
/** Every run turns at both ends, so two fittings are the minimum honest count. */
const FITTINGS_PER_RUN = 2

const ELECTRICAL_DEVICE_LABELS: Record<string, string> = {
  'device-box': 'Device boxes (1-gang)',
  'junction-box': 'Junction boxes',
  'light-box': 'Ceiling boxes',
  'duplex-outlet': 'Duplex outlets (15A)',
  'gfci-outlet': 'GFCI outlets (20A)',
  switch: 'Switches',
  'ceiling-light': 'Ceiling lights',
  'recessed-light': 'Recessed lights',
  'exhaust-fan': 'Exhaust fans',
  'panel-box': 'Panel boxes',
}

const PLUMBING_FIXTURE_LABELS: Record<string, string> = {
  toilet: 'Toilets',
  'bathroom-sink': 'Bathroom vanities',
  'kitchen-sink': 'Kitchen sinks',
  bathtub: 'Bathtubs',
  shower: 'Showers',
  washer: 'Washing machines',
  dryer: 'Dryers',
  'water-heater': 'Water heaters',
  'kitchen-counter': 'Kitchen counters',
}

/** The key a pipe or wire is bought by — its material, which is what a yard stocks. */
const stockLabel = (line: TracedLine): string => line.material || line.elementType || 'Pipe'

/**
 * PLUMBING FITTINGS & FIXTURES — pipe is bought in coils and lengths, not feet,
 * and every run needs elbows at both ends. Fixtures are counted off what was
 * placed, by name, so the line reads "Toilets 2 ea" instead of disappearing
 * into the furniture list.
 */
function plumbingDetail(lines: TracedLine[], objects: TakeoffObject[], mmPerPx: number): TakeoffSection | null {
  const fixtures = bucket()
  for (const o of objects) {
    const label = PLUMBING_FIXTURE_LABELS[o.type]
    if (label) fixtures.add(label, 1)
  }
  const stock = bucket()
  let elbows = 0, tees = 0
  for (const l of lines) {
    const ft = lineFt(l, mmPerPx)
    const label = stockLabel(l)
    const piece = PIPE_STOCK_FT[label] ?? 10
    stock.add(`${label}${l.size ? ` ${l.size}` : ''} (${piece} ft)`, Math.ceil(ft / piece))
    elbows += FITTINGS_PER_RUN
    if (/branch/i.test(l.elementType)) tees += 1
  }
  const items = stock.items('ea')
  if (elbows > 0) items.push({ key: '__elbows', label: 'Elbows / couplings', quantity: elbows, unit: 'ea' })
  if (tees > 0) items.push({ key: '__tees', label: 'Tees (branch take-offs)', quantity: tees, unit: 'ea' })
  items.push(...fixtures.items('ea'))
  if (items.length === 0) return null
  return { title: 'Plumbing fittings & fixtures', items }
}

/**
 * ELECTRICAL DEVICES & WIRE — the device schedule the panel never had, plus
 * wire bought by the coil instead of by the foot. A lumber-yard order does not
 * take "412 ft of 14/2"; it takes two coils and you come back for a third.
 */
function electricalDetail(lines: TracedLine[], objects: TakeoffObject[], mmPerPx: number): TakeoffSection | null {
  const wire = bucket()
  for (const l of lines) {
    const coil = WIRE_COIL_FT
    wire.add(`${stockLabel(l)} (${coil} ft coils)`, Math.ceil(lineFt(l, mmPerPx) / coil))
  }
  const devices = bucket()
  for (const o of objects) {
    const label = ELECTRICAL_DEVICE_LABELS[o.type]
    if (label) devices.add(label, 1)
  }
  const items = wire.items('ea')
  items.push(...devices.items('ea'))
  if (items.length === 0) return null
  return { title: 'Electrical devices & wire', items }
}

/**
 * HVAC FITTINGS — duct is bought in lengths and boxes, and every run turns. Air
 * devices (registers, returns) are not placeable yet, so they are not counted;
 * the exhaust fans that ARE placed are in the electrical schedule.
 */
function hvacDetail(lines: TracedLine[], mmPerPx: number): TakeoffSection | null {
  if (lines.length === 0) return null
  const stock = bucket()
  let fittings = 0
  for (const l of lines) {
    const material = l.material || 'Sheet Metal'
    const piece = DUCT_STOCK_FT[material] ?? 5
    stock.add(`${material}${l.size ? ` ${l.size}` : ''} (${piece} ft)`, Math.ceil(lineFt(l, mmPerPx) / piece))
    fittings += FITTINGS_PER_RUN
  }
  const items = stock.items('ea')
  items.push({ key: '__fittings', label: 'Elbows / take-offs', quantity: fittings, unit: 'ea' })
  return { title: 'HVAC fittings & duct', items }
}

export function computeTakeoff(input: TakeoffInput): TakeoffSection[] {
  const { scaleMmPerPx: mm, wallHeightM } = input
  const sections: TakeoffSection[] = []
  const wallHeightFt = wallHeightM * FT_PER_M

  // ── Walls: linear ft + stud count + board sheets, grouped by framing type ──
  let totalFt = 0
  let studs = 0
  if (input.walls.length > 0) {
    const lin = bucket()
    for (const w of input.walls) {
      const ft = lineFt(w, mm)
      totalFt += ft
      studs += Math.floor((ft * 12) / STUD_OC_IN) + 1
      const label = w.framingType || w.wallRole || 'Wall framing'
      lin.add(label, ft)
    }
    const items = lin.items('ft')
    items.push({ key: '__studs', label: `Studs (~${STUD_OC_IN}" OC)`, quantity: studs, unit: 'ea' })
    items.push({ key: '__plates', label: 'Plate stock (top+bottom)', quantity: round1(totalFt * 2), unit: 'ft' })
    sections.push({ title: 'Walls', items })
  }

  // BOARD IS ITS OWN SECTION. It is not part of the cut list, and the panel
  // drops the estimated Walls section the moment the framing is counted (see
  // TakeoffPanel), so riding along in there meant the drywall and sheathing
  // sheet count — two of the biggest orders on the job — vanished the moment
  // the model had a cut list. Each face is height × length; both faces boarded.
  const boardSqFt = totalFt * wallHeightFt * 2
  if (boardSqFt > 0) {
    sections.push({
      title: 'Board & sheathing',
      items: [{ key: '__board', label: 'Wall board/sheathing (4×8)', quantity: Math.ceil(boardSqFt / SHEET_SQFT), unit: 'sheets' }],
    })
  }

  // ── Under the building, in the holes, round the outside, and on top ──
  const foundation = foundationSection(input.floors, mm)
  if (foundation) sections.push(foundation)

  const openings = openingsSection(input.placedObjects)
  if (openings) sections.push(openings)

  const floor = areaSection('Floors', input.floors, mm, (f) => SHEETED_FLOOR_TYPES.has(f.elementType))
  if (floor) sections.push(floor)

  const roof = roofTakeoff(input.roof, mm, input.roofOverhangM ?? DEFAULT_ROOF_OVERHANG_M)
  if (roof.section) sections.push(roof.section)

  const envelope = envelopeSection(input.walls, input.floors, roof.metrics, mm, wallHeightM)
  if (envelope) sections.push(envelope)

  // Sheet goods for the nail and adhesive takeoff: what is actually decked, and
  // the roof sheathing, which roofTakeoff already rounded to whole sheets.
  const floorSheets = input.floors
    .filter((f) => SHEETED_FLOOR_TYPES.has(f.elementType))
    .reduce((n, f) => n + rectSqFt(f, mm), 0)
  const roofSheets = roof.metrics.surfaceSqFt
  const sheetCount = Math.ceil(boardSqFt / SHEET_SQFT)
    + Math.ceil(floorSheets / SHEET_SQFT)
    + Math.ceil(roofSheets / SHEET_SQFT)

  const fasteners = fastenersSection(input.floors, studs, sheetCount, mm)
  if (fasteners) sections.push(fasteners)

  const topLevel = input.floors.reduce((n, f) => Math.max(n, f.level ?? 0), 0)
  const ceilingSqFt = input.floors
    .filter((f) => (f.level ?? 0) === topLevel)
    .reduce((n, f) => n + rectSqFt(f, mm), 0)
  const finishes = finishesSection(input.walls, input.floors, input.placedObjects, boardSqFt, ceilingSqFt, mm, wallHeightM)
  if (finishes) sections.push(finishes)

  const plumb = runSection('Plumbing', input.plumbing, mm)
  if (plumb) sections.push(plumb)
  const elec = runSection('Electrical', input.electrical, mm)
  if (elec) sections.push(elec)
  const hvac = runSection('HVAC', input.hvac, mm)
  if (hvac) sections.push(hvac)

  const plumbDetail = plumbingDetail(input.plumbing, input.placedObjects, mm)
  if (plumbDetail) sections.push(plumbDetail)
  const elecDetail = electricalDetail(input.electrical, input.placedObjects, mm)
  if (elecDetail) sections.push(elecDetail)
  const hvacDet = hvacDetail(input.hvac, mm)
  if (hvacDet) sections.push(hvacDet)

  // ── Furniture / every other placed object, counted by type ──
  // ONCE EACH. A door is in the windows-and-doors schedule, a toilet in the
  // plumbing fixture list, a switch in the device schedule — counting them
  // again as "objects" would order every one of them twice.
  const scheduled = new Set([
    'door', 'window',
    ...Object.keys(ELECTRICAL_DEVICE_LABELS),
    ...Object.keys(PLUMBING_FIXTURE_LABELS),
  ])
  const objectItems = input.placedObjects.filter((o) => !scheduled.has(o.type))
  if (objectItems.length > 0) {
    const b = bucket()
    for (const o of objectItems) b.add(o.orderAs ?? o.type, 1)
    sections.push({ title: 'Fixtures & objects', items: b.items('ea') })
  }

  return sections
}

/**
 * The takeoff as a spreadsheet — the form a supplier, an estimator or an
 * accountant can actually use. Both halves go in: the quantities derived from
 * what was drawn, and the members counted off the standing model, kept as
 * separate sections because they answer different questions and disagree on
 * purpose (see the note in TakeoffPanel).
 *
 * Quoting every field, because material labels legitimately contain commas —
 * `2×6 wood stud, 8'` would otherwise split into two columns and quietly
 * corrupt the row.
 */
export function takeoffToCsv(
  sections: TakeoffSection[],
  built: { layer: string; items: { label: string; count: number }[] }[] = [],
): string {
  const q = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`
  const rows: string[] = ['Section,Item,Quantity,Unit']

  for (const sec of sections) {
    for (const it of sec.items) {
      rows.push([q(sec.title), q(it.label), q(it.quantity), q(it.unit)].join(','))
    }
  }
  for (const group of built) {
    for (const m of group.items) {
      rows.push([q(`Counted from the model — ${group.layer}`), q(m.label), q(m.count), q('ea')].join(','))
    }
  }

  return `${rows.join('\n')}\n`
}
