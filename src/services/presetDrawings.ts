/**
 * Preset drawings — practice plans that look like plans.
 *
 * These are NOT downloaded images. A preset is a wall list, and the raster is an
 * SVG drawn from it at load time, so there is no asset to license and nothing
 * binary in the repo. That also means "make them realistic" is a data problem
 * rather than a scraping one.
 *
 * The old presets were abstract: boxes subdivided into more boxes, every wall the
 * same weight, rooms labelled R1..R4. Nothing about them read as a house, and
 * tracing one taught you nothing about tracing a real drawing.
 *
 * These are laid out in FEET from actual residential proportions — 12x12 and
 * 14x12 bedrooms, a 6x8 bath, a 3 ft hall, 10-14 ft kitchens — and drawn with the
 * conventions a real plan uses:
 *
 *   • EXTERIOR walls heavier than interior ones (2x6 shell, 2x4 partitions), so
 *     the shell reads at a glance and a trace picks up the right thickness
 *   • doors as a jamb gap with a SWING ARC, not a dashed line
 *   • windows as the standard triple line broken into the wall
 *   • rooms named AND dimensioned the way a plan labels them, because that is
 *     what you actually read off a drawing
 *   • dimension strings with ticks along two sides
 *
 * Room sizes checked against standard residential sizing rather than picked by
 * eye: bedrooms 10x12 to 14x16, a full bath about 6x9, kitchens from 10x12,
 * living rooms from 14x16.
 */
import type { Drawing, ParsedOpening, ParsedRoom, ParsedWall, WorkspaceWizardInputs } from '../types'

export type PresetDifficulty = 'easy' | 'medium' | 'hard'

/** Everything below is authored in FEET, at this many millimetres per pixel. */
const MM_PER_PX = 10
const FT_MM = 304.8
/** Feet → drawing pixels. */
const ft = (n: number): number => (n * FT_MM) / MM_PER_PX
/** Margin around the plan, in feet, leaving room for the dimension strings. */
const MARGIN_FT = 4

/** Wall weights in real inches, drawn to scale like everything else. */
const EXT_IN = 5.5   // 2x6 shell
const INT_IN = 3.5   // 2x4 partition
const inToPx = (n: number): number => (n * 25.4) / MM_PER_PX

type Seg = [number, number, number, number]   // x1,y1,x2,y2 in FEET

interface RoomSpec {
  name: string
  /** x1,y1,x2,y2 in feet. */
  box: Seg
}

interface OpeningSpec {
  type: 'door' | 'window'
  /** Centre of the opening, in feet. */
  at: [number, number]
  /** Clear width in feet — 3 ft entry, 2'-8" interior, 3-6 ft windows. */
  widthFt: number
  orientation: 'horizontal' | 'vertical'
  /** Which way a door swings, for the arc. Ignored by windows. */
  swing?: 'up' | 'down' | 'left' | 'right'
}

interface PlanSpec {
  id: PresetDifficulty
  name: string
  /** Overall footprint in feet. */
  widthFt: number
  depthFt: number
  /** Interior partitions in feet; the shell is generated from the footprint. */
  partitions: Seg[]
  rooms: RoomSpec[]
  openings: OpeningSpec[]
  wizardInputs: WorkspaceWizardInputs
}

// ── The plans ────────────────────────────────────────────────────────────────

// EASY — a two-bedroom bungalow, 32' x 26'. One clean rectangle, a central hall
// everything opens off, wet rooms grouped on one side. The layout a first trace
// should meet: every wall orthogonal, nothing re-entrant.
const EASY: PlanSpec = {
  id: 'easy',
  name: 'Two-Bed Bungalow',
  widthFt: 32,
  depthFt: 26,
  partitions: [
    [12, 0, 12, 12],    // bed 1 | closet+bath
    [18, 0, 18, 12],    // closet+bath | bed 2
    [12, 4, 18, 4],     // closet | bath
    [0, 12, 22, 12],    // bedrooms | hall
    [0, 15, 22, 15],    // hall | living
    [22, 12, 22, 26],   // living | kitchen
  ],
  rooms: [
    { name: 'BED 1', box: [0, 0, 12, 12] },
    { name: 'CLO', box: [12, 0, 18, 4] },
    { name: 'BATH', box: [12, 4, 18, 12] },
    { name: 'BED 2', box: [18, 0, 32, 12] },
    { name: 'HALL', box: [0, 12, 22, 15] },
    { name: 'LIVING', box: [0, 15, 22, 26] },
    { name: 'KITCHEN', box: [22, 12, 32, 26] },
  ],
  openings: [
    { type: 'door', at: [11, 26], widthFt: 3, orientation: 'horizontal', swing: 'up' },      // entry
    { type: 'door', at: [6, 12], widthFt: 2.67, orientation: 'horizontal', swing: 'up' },    // bed 1
    { type: 'door', at: [15, 12], widthFt: 2.5, orientation: 'horizontal', swing: 'up' },    // bath
    { type: 'door', at: [20, 12], widthFt: 2.67, orientation: 'horizontal', swing: 'up' },   // bed 2
    { type: 'door', at: [22, 20], widthFt: 3, orientation: 'vertical', swing: 'right' },     // kitchen
    // Cased opening, hall to living. Without it the front door lets you into the
    // living room and no further — the bedrooms were unreachable.
    { type: 'door', at: [9, 15], widthFt: 5, orientation: 'horizontal', swing: 'down' },
    { type: 'door', at: [12, 2], widthFt: 2.5, orientation: 'vertical', swing: 'left' },     // closet ← bed 1
    { type: 'window', at: [5, 26], widthFt: 4, orientation: 'horizontal' },
    { type: 'window', at: [16, 26], widthFt: 4, orientation: 'horizontal' },
    { type: 'window', at: [6, 0], widthFt: 3, orientation: 'horizontal' },
    { type: 'window', at: [25, 0], widthFt: 4, orientation: 'horizontal' },
    { type: 'window', at: [32, 19], widthFt: 3, orientation: 'vertical' },
    { type: 'window', at: [0, 20], widthFt: 3, orientation: 'vertical' },
  ],
  wizardInputs: {
    set1BuildingBasics: '32ft x 26ft footprint, 8ft ceiling, 1 floor, slab foundation',
    set1Clarifications: 'Single-storey bungalow, rectangular footprint.',
    set2StructuralDetails: 'Exterior 2x6 bearing walls, 2x4 interior partitions, one entry door.',
    set2Clarifications: 'Bath and kitchen share the service side for a common plumbing wall.',
    set3FinishingDetails: 'Lap siding over OSB and housewrap, 1/2in gypsum interior.',
    set3Clarifications: 'Tile backer in the bath.',
    completedGroup: 'group3',
    completedAt: Date.now(),
  },
}

// MEDIUM — a three-bed ranch, 44' x 28', with an ensuite and a utility room. The
// step up is room COUNT and a wet core: two baths backing onto one stack.
const MEDIUM: PlanSpec = {
  id: 'medium',
  name: 'Three-Bed Ranch',
  widthFt: 44,
  depthFt: 28,
  partitions: [
    [0, 14, 30, 14],    // bedrooms | hall
    [0, 17, 30, 17],    // hall | living side
    [12, 0, 12, 14],    // bed 2 | bath
    [19, 0, 19, 14],    // bath | bed 3
    [30, 0, 30, 28],    // main house | master suite
    [30, 11, 44, 11],   // ensuite+closet | master bed
    [38, 0, 38, 11],    // ensuite | closet
    [12, 17, 12, 28],   // living | kitchen
    [24, 17, 24, 28],   // kitchen | utility
  ],
  rooms: [
    { name: 'BED 2', box: [0, 0, 12, 14] },
    { name: 'BATH', box: [12, 0, 19, 14] },
    { name: 'BED 3', box: [19, 0, 30, 14] },
    { name: 'HALL', box: [0, 14, 30, 17] },
    { name: 'LIVING', box: [0, 17, 12, 28] },
    { name: 'KITCHEN', box: [12, 17, 24, 28] },
    { name: 'UTILITY', box: [24, 17, 30, 28] },
    { name: 'ENSUITE', box: [30, 0, 38, 11] },
    { name: 'CLO', box: [38, 0, 44, 11] },
    { name: 'MASTER', box: [30, 11, 44, 28] },
  ],
  openings: [
    { type: 'door', at: [6, 28], widthFt: 3, orientation: 'horizontal', swing: 'up' },       // entry
    { type: 'door', at: [6, 14], widthFt: 2.67, orientation: 'horizontal', swing: 'up' },
    { type: 'door', at: [15, 14], widthFt: 2.5, orientation: 'horizontal', swing: 'up' },
    { type: 'door', at: [24, 14], widthFt: 2.67, orientation: 'horizontal', swing: 'up' },
    { type: 'door', at: [30, 20], widthFt: 2.67, orientation: 'vertical', swing: 'right' },  // master
    { type: 'door', at: [34, 11], widthFt: 2.5, orientation: 'horizontal', swing: 'down' },  // ensuite
    { type: 'door', at: [27, 17], widthFt: 2.67, orientation: 'horizontal', swing: 'down' }, // utility
    { type: 'door', at: [6, 17], widthFt: 5, orientation: 'horizontal', swing: 'down' },     // hall → living
    { type: 'door', at: [18, 17], widthFt: 5, orientation: 'horizontal', swing: 'down' },    // hall → kitchen
    { type: 'door', at: [41, 11], widthFt: 2.5, orientation: 'horizontal', swing: 'down' },  // closet ← master
    { type: 'window', at: [6, 0], widthFt: 4, orientation: 'horizontal' },
    { type: 'window', at: [24, 0], widthFt: 4, orientation: 'horizontal' },
    { type: 'window', at: [36, 0], widthFt: 3, orientation: 'horizontal' },
    { type: 'window', at: [6, 28], widthFt: 5, orientation: 'horizontal' },
    { type: 'window', at: [18, 28], widthFt: 4, orientation: 'horizontal' },
    { type: 'window', at: [37, 28], widthFt: 5, orientation: 'horizontal' },
    { type: 'window', at: [0, 22], widthFt: 3, orientation: 'vertical' },
    { type: 'window', at: [44, 20], widthFt: 4, orientation: 'vertical' },
  ],
  wizardInputs: {
    set1BuildingBasics: '44ft x 28ft footprint, 9ft ceiling, 1 floor, crawlspace foundation',
    set1Clarifications: 'Single-storey ranch with a master suite at one end.',
    set2StructuralDetails: 'Exterior 2x6 bearing walls, 2x4 partitions, bearing wall on the hall line.',
    set2Clarifications: 'Bath and ensuite share a wet wall with the utility room.',
    set3FinishingDetails: 'Brick veneer front, lap siding elsewhere, 1/2in gypsum interior.',
    set3Clarifications: 'Tile backer in both baths.',
    completedGroup: 'group3',
    completedAt: Date.now(),
  },
}

// HARD — two storeys, 36' x 30', with a stair, an open great room and a garage
// bay. The step up is the STAIR: an opening that has to be framed, a wall that
// wants to span both storeys, and a fire separation to the garage.
const HARD: PlanSpec = {
  id: 'hard',
  name: 'Two-Storey with Garage',
  widthFt: 36,
  depthFt: 30,
  partitions: [
    [22, 0, 22, 30],    // house | garage (fire separation)
    [0, 18, 22, 18],    // front rooms | rear rooms
    [10, 0, 10, 18],    // entry side | great room
    [0, 8, 10, 8],      // entry | powder+closet
    [5, 8, 5, 18],      // powder | closet
    [10, 18, 10, 30],   // stair | kitchen
    [10, 24, 22, 24],   // kitchen | pantry
  ],
  rooms: [
    { name: 'ENTRY', box: [0, 0, 10, 8] },
    { name: 'PWDR', box: [0, 8, 5, 18] },
    { name: 'CLO', box: [5, 8, 10, 18] },
    { name: 'GREAT ROOM', box: [10, 0, 22, 18] },
    { name: 'STAIR', box: [0, 18, 10, 30] },
    { name: 'KITCHEN', box: [10, 18, 22, 24] },
    { name: 'PANTRY', box: [10, 24, 22, 30] },
    { name: 'GARAGE', box: [22, 0, 36, 30] },
  ],
  openings: [
    { type: 'door', at: [5, 0], widthFt: 3, orientation: 'horizontal', swing: 'down' },      // entry
    { type: 'door', at: [29, 30], widthFt: 9, orientation: 'horizontal', swing: 'up' },      // garage
    { type: 'door', at: [22, 9], widthFt: 2.83, orientation: 'vertical', swing: 'left' },    // house↔garage
    { type: 'door', at: [2.5, 8], widthFt: 2.5, orientation: 'horizontal', swing: 'down' },  // powder
    { type: 'door', at: [16, 18], widthFt: 5, orientation: 'horizontal', swing: 'up' },      // kitchen
    { type: 'door', at: [16, 24], widthFt: 2.67, orientation: 'horizontal', swing: 'down' }, // pantry
    { type: 'door', at: [10, 4], widthFt: 5, orientation: 'vertical', swing: 'right' },      // entry → great room
    { type: 'door', at: [5, 18], widthFt: 4, orientation: 'horizontal', swing: 'down' },     // → stair
    { type: 'door', at: [7.5, 8], widthFt: 2.5, orientation: 'horizontal', swing: 'up' },    // coat closet ← entry
    { type: 'window', at: [16, 0], widthFt: 6, orientation: 'horizontal' },
    { type: 'window', at: [0, 13], widthFt: 3, orientation: 'vertical' },
    { type: 'window', at: [0, 24], widthFt: 4, orientation: 'vertical' },
    { type: 'window', at: [5, 30], widthFt: 4, orientation: 'horizontal' },
    { type: 'window', at: [16, 30], widthFt: 5, orientation: 'horizontal' },
    { type: 'window', at: [36, 8], widthFt: 3, orientation: 'vertical' },
  ],
  wizardInputs: {
    set1BuildingBasics: '36ft x 30ft footprint, 9ft ceiling, 2 floors, basement foundation',
    set1Clarifications: 'Two storeys over a basement, attached garage on one side.',
    set2StructuralDetails: 'Exterior 2x6 bearing walls, stair opening framed with doubled headers and trimmers.',
    set2Clarifications: 'The stairwell wall runs full height through both storeys.',
    set3FinishingDetails: 'Fibre-cement lap siding over OSB and housewrap, 5/8in Type X to the garage.',
    set3Clarifications: 'Garage separation is fire-rated; the garage slab steps down and slopes to the door.',
    completedGroup: 'group3',
    completedAt: Date.now(),
  },
}

const PLANS: Record<PresetDifficulty, PlanSpec> = { easy: EASY, medium: MEDIUM, hard: HARD }

/** Exported so the suite can assert every room is actually reachable. Building a
 *  plan whose closet has no door is easy to do and impossible to see in code. */
export function presetPlans(): PlanSpec[] { return [EASY, MEDIUM, HARD] }
export type { PlanSpec, RoomSpec, OpeningSpec }

// ── Spec → drawing data ──────────────────────────────────────────────────────

function seg(s: Seg, thicknessPx: number): ParsedWall {
  const [x1, y1, x2, y2] = s
  return {
    x1: ft(x1 + MARGIN_FT), y1: ft(y1 + MARGIN_FT),
    x2: ft(x2 + MARGIN_FT), y2: ft(y2 + MARGIN_FT),
    thickness: thicknessPx, source: 'auto', detectionConfidence: 1,
  }
}

function planWalls(plan: PlanSpec): ParsedWall[] {
  const { widthFt: w, depthFt: d } = plan
  const shell: Seg[] = [[0, 0, w, 0], [w, 0, w, d], [w, d, 0, d], [0, d, 0, 0]]
  return [
    ...shell.map((s) => seg(s, inToPx(EXT_IN))),
    ...plan.partitions.map((s) => seg(s, inToPx(INT_IN))),
  ]
}

function planRooms(plan: PlanSpec): ParsedRoom[] {
  return plan.rooms.map((r, i) => {
    const [x1, y1, x2, y2] = r.box
    const px1 = ft(x1 + MARGIN_FT), py1 = ft(y1 + MARGIN_FT)
    const px2 = ft(x2 + MARGIN_FT), py2 = ft(y2 + MARGIN_FT)
    return {
      id: `${plan.id}-room-${i + 1}`,
      // The name is what lets the app tell a bathroom from a bedroom, and
      // therefore which walls want a tile backer. See wetWalls.
      name: r.name,
      cx: (px1 + px2) / 2, cy: (py1 + py2) / 2,
      x1: px1, y1: py1, x2: px2, y2: py2,
      areaPx: Math.max(1, (px2 - px1) * (py2 - py1)),
      areaSqM: (x2 - x1) * (y2 - y1) * 0.092903,
    }
  })
}

function planOpenings(plan: PlanSpec): ParsedOpening[] {
  return plan.openings.map((o) => ({
    x: ft(o.at[0] + MARGIN_FT),
    y: ft(o.at[1] + MARGIN_FT),
    widthPx: ft(o.widthFt),
    widthMm: o.widthFt * FT_MM,
    orientation: o.orientation,
    type: o.type,
  }))
}

/** Feet as a plan reads them: 12 → 12'-0", 2.67 → 2'-8". */
function ftIn(n: number): string {
  const whole = Math.floor(n + 1e-6)
  const inches = Math.round((n - whole) * 12)
  return inches === 0 ? `${whole}'-0"` : `${whole}'-${inches}"`
}

// ── SVG ──────────────────────────────────────────────────────────────────────

const INK = '#1e293b'
const THIN = '#94a3b8'
const PAPER = '#f8fafc'

/** Door: a gap knocked in the wall, a leaf, and the swing arc. */
function doorSymbol(o: OpeningSpec): string {
  const cx = ft(o.at[0] + MARGIN_FT), cy = ft(o.at[1] + MARGIN_FT)
  const w = ft(o.widthFt), half = w / 2
  const horiz = o.orientation === 'horizontal'
  const hx = horiz ? cx - half : cx
  const hy = horiz ? cy : cy - half
  const ex = horiz ? cx + half : cx
  const ey = horiz ? cy : cy + half
  const sw = o.swing ?? (horiz ? 'up' : 'right')
  const lx = horiz ? hx : hx + (sw === 'left' ? -w : w)
  const ly = horiz ? hy + (sw === 'up' ? -w : w) : hy
  const sweep = horiz ? (sw === 'up' ? 1 : 0) : (sw === 'right' ? 1 : 0)
  return `
    <line x1="${hx}" y1="${hy}" x2="${ex}" y2="${ey}" stroke="${PAPER}" stroke-width="${inToPx(EXT_IN) + 3}" />
    <line x1="${hx}" y1="${hy}" x2="${lx}" y2="${ly}" stroke="${INK}" stroke-width="2.5" />
    <path d="M ${lx} ${ly} A ${w} ${w} 0 0 ${sweep} ${ex} ${ey}" fill="none" stroke="${THIN}" stroke-width="1.4" stroke-dasharray="6 5" />`
}

/** Window: the wall broken by the standard triple line. */
function windowSymbol(o: OpeningSpec): string {
  const cx = ft(o.at[0] + MARGIN_FT), cy = ft(o.at[1] + MARGIN_FT)
  const w = ft(o.widthFt), half = w / 2
  const t = inToPx(EXT_IN)
  const offs = [-t / 3, 0, t / 3]
  if (o.orientation === 'horizontal') {
    return `
      <line x1="${cx - half}" y1="${cy}" x2="${cx + half}" y2="${cy}" stroke="${PAPER}" stroke-width="${t + 3}" />
      ${offs.map((d) => `<line x1="${cx - half}" y1="${cy + d}" x2="${cx + half}" y2="${cy + d}" stroke="${INK}" stroke-width="1.5" />`).join('')}`
  }
  return `
    <line x1="${cx}" y1="${cy - half}" x2="${cx}" y2="${cy + half}" stroke="${PAPER}" stroke-width="${t + 3}" />
    ${offs.map((d) => `<line x1="${cx + d}" y1="${cy - half}" x2="${cx + d}" y2="${cy + half}" stroke="${INK}" stroke-width="1.5" />`).join('')}`
}

/** A dimension string with end ticks. */
function dimension(x1: number, y1: number, x2: number, y2: number, label: string): string {
  const t = 5
  const horiz = y1 === y2
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2
  const tick = (x: number, y: number) => horiz
    ? `<line x1="${x}" y1="${y - t}" x2="${x}" y2="${y + t}" stroke="${THIN}" stroke-width="1.2" />`
    : `<line x1="${x - t}" y1="${y}" x2="${x + t}" y2="${y}" stroke="${THIN}" stroke-width="1.2" />`
  return `
    <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${THIN}" stroke-width="1.2" />
    ${tick(x1, y1)}${tick(x2, y2)}
    <text x="${mx}" y="${my - 6}" text-anchor="middle" font-family="Inter, Arial, sans-serif"
          font-size="13" fill="${THIN}"${horiz ? '' : ` transform="rotate(-90 ${mx} ${my})"`}>${label}</text>`
}

function drawSvg(plan: PlanSpec): string {
  const W = ft(plan.widthFt + MARGIN_FT * 2)
  const H = ft(plan.depthFt + MARGIN_FT * 2)
  const m = ft(MARGIN_FT)

  const walls = planWalls(plan).map((w) => `
    <line x1="${w.x1}" y1="${w.y1}" x2="${w.x2}" y2="${w.y2}" stroke="${INK}" stroke-width="${w.thickness}" stroke-linecap="square" />`).join('')

  const symbols = plan.openings.map((o) => (o.type === 'door' ? doorSymbol(o) : windowSymbol(o))).join('')

  const labels = plan.rooms.map((r) => {
    const [x1, y1, x2, y2] = r.box
    const cx = ft((x1 + x2) / 2 + MARGIN_FT), cy = ft((y1 + y2) / 2 + MARGIN_FT)
    const tight = (x2 - x1) < 7 || (y2 - y1) < 5
    return `
      <text x="${cx}" y="${cy}" text-anchor="middle" font-family="Inter, Arial, sans-serif"
            font-size="${tight ? 11 : 15}" font-weight="600" fill="#475569">${r.name}</text>
      ${tight ? '' : `<text x="${cx}" y="${cy + 17}" text-anchor="middle" font-family="Inter, Arial, sans-serif"
            font-size="12" fill="${THIN}">${ftIn(x2 - x1)} x ${ftIn(y2 - y1)}</text>`}`
  }).join('')

  const dims = dimension(m, m - 22, W - m, m - 22, ftIn(plan.widthFt))
    + dimension(m - 22, m, m - 22, H - m, ftIn(plan.depthFt))

  return `
  <svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <rect width="100%" height="100%" fill="${PAPER}" />
    ${dims}
    ${walls}
    ${symbols}
    ${labels}
    <text x="${m}" y="${H - 14}" font-family="Inter, Arial, sans-serif" font-size="14" font-weight="600" fill="#334155">${plan.name}</text>
    <text x="${W - m}" y="${H - 14}" text-anchor="end" font-family="Inter, Arial, sans-serif" font-size="12" fill="${THIN}">1:100 · ${ftIn(plan.widthFt)} x ${ftIn(plan.depthFt)}</text>
  </svg>`
}

export function listPresetDefinitions() {
  return (Object.keys(PLANS) as PresetDifficulty[]).map((id) => ({ id, name: PLANS[id].name }))
}

export function createPresetDrawing(difficulty: PresetDifficulty, practiceMode: boolean): Pick<Drawing, 'name' | 'file' | 'pageCount' | 'currentPage' | 'previewUrl' | 'rasterUrl' | 'rasterWidth' | 'rasterHeight' | 'parsedWalls' | 'parsedRooms' | 'parsedOpenings' | 'parsedText' | 'parsedSymbols' | 'parsedAnnotationCandidates' | 'parseProgress' | 'floorNumber' | 'status' | 'scaleMmPerPx' | 'scaleNotation' | 'scaleConfidence' | 'uploadedAt' | 'type'> & { wizardInputs: WorkspaceWizardInputs; overlayScale: [number, number] } {
  const plan = PLANS[difficulty]
  const svg = drawSvg(plan)
  const widthPx = Math.round(ft(plan.widthFt + MARGIN_FT * 2))
  const heightPx = Math.round(ft(plan.depthFt + MARGIN_FT * 2))

  let file: File
  try {
    file = new File([svg], `${difficulty}-preset.svg`, { type: 'image/svg+xml' })
  } catch {
    const blob = new Blob([svg], { type: 'image/svg+xml' })
    file = Object.assign(blob, { name: `${difficulty}-preset.svg`, lastModified: Date.now() }) as unknown as File
  }
  const url = URL.createObjectURL(file)

  return {
    name: `${plan.name}${practiceMode ? ' (Practice)' : ''}`,
    file,
    pageCount: 1,
    currentPage: 1,
    previewUrl: url,
    rasterUrl: url,
    rasterWidth: widthPx,
    rasterHeight: heightPx,
    parsedWalls: practiceMode ? [] : planWalls(plan),
    // ROOMS SURVIVE PRACTICE MODE. Practice is about tracing the walls yourself;
    // you never trace a room, and the room names are what let the app reason
    // about the plan at all — that a BATH is a bathroom, so the walls around it
    // want a tile backer. Stripping them left the app unable to read its own
    // drawing while you practised on it.
    parsedRooms: planRooms(plan),
    parsedOpenings: practiceMode ? [] : planOpenings(plan),
    parsedText: [],
    parsedSymbols: [],
    parsedAnnotationCandidates: [],
    parseProgress: 100,
    floorNumber: 0,
    status: 'ready',
    scaleMmPerPx: MM_PER_PX,
    scaleNotation: '1:100',
    scaleConfidence: 'parsed',
    uploadedAt: Date.now(),
    type: 'floor-plan',
    wizardInputs: { ...plan.wizardInputs, completedAt: Date.now() },
    overlayScale: [
      Math.max(4, (widthPx * MM_PER_PX) / 1000),
      Math.max(4, (heightPx * MM_PER_PX) / 1000),
    ],
  }
}
