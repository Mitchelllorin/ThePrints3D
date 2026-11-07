/**
 * THE MEMBER CATALOGUE — every stick, beam, joist and track the app can frame with.
 *
 * Members used to be defined wherever they were needed: the wall-type picker
 * carried its own list, constructionCode a second table beside it, the header
 * a hard-coded LVL depth, the floor its joists inline. Adding an I-joist or an
 * LSL meant finding every one of those. This is the one place instead.
 *
 * An entry says what the member IS (family, real size, grades, stock lengths)
 * and what it may be USED AS. Builders ask for "a header" or "a joist" and get
 * the members that can do that job; nothing downstream needs to know the list.
 * Adding a member is adding a row.
 *
 * SIZES ARE ACTUAL, in inches, the way the yard and the manufacturer quote
 * them — a 2×4 is 1-1/2" × 3-1/2". Engineered sizes are the common stock
 * series; depths and grades vary by manufacturer, so treat these as the
 * standard offering and confirm against the maker's tables before quoting a
 * span or a load.
 */

export type MemberFamily =
  | 'sawn'         // dimensional lumber
  | 'lvl'          // laminated veneer lumber
  | 'lsl'          // laminated strand lumber
  | 'psl'          // parallel strand lumber
  | 'glulam'
  | 'i-joist'
  | 'rim-board'
  | 'steel-stud'   // cold-formed C-stud
  | 'steel-track'  // cold-formed U-track
  | 'cmu'

export type MemberUse =
  | 'stud' | 'plate' | 'header' | 'beam' | 'joist' | 'rim' | 'rafter'
  | 'post' | 'blocking' | 'ledger' | 'furring'

export interface MemberSpec {
  /** Stable key, stored on walls and in projects. Never rename one. */
  id: string
  family: MemberFamily
  /** Short size as the trade says it: '2×6', '1-3/4 × 11-7/8', '3-5/8"'. */
  size: string
  /** Full name for pickers and the cut list: 'LVL 1-3/4 × 11-7/8'. */
  name: string
  /** Actual thickness — the narrow face — in inches. */
  widthIn: number
  /** Actual depth — the wide face — in inches. */
  depthIn: number
  uses: readonly MemberUse[]
  /** Grades it is sold in; the first is the default. */
  grades: readonly string[]
  /** Lengths it is stocked in, in feet — what the buy list rounds up to. */
  stockLengthsFt: readonly number[]
  /** Steel only: gauges it is made in, heaviest last. */
  gauges?: readonly string[]
}

const SAWN_LENGTHS = [8, 10, 12, 14, 16, 18, 20] as const
const STUD_LENGTHS = [8, 9, 10, 12, 14, 16] as const  // precut studs + standard lengths
const ENG_LENGTHS = [12, 16, 20, 24, 28, 32, 36, 40, 48] as const
const STEEL_LENGTHS = [8, 9, 10, 12, 14, 16, 20] as const
const SAWN_GRADES = ['SPF No.2', 'DF-L No.2', 'Stud', 'SPF No.1/No.2'] as const

const sawn = (nominal: string, w: number, d: number, uses: MemberUse[], lengths: readonly number[] = SAWN_LENGTHS): MemberSpec => ({
  id: `sawn-${nominal.replace('×', 'x')}`, family: 'sawn', size: nominal, name: `Wood ${nominal}`,
  widthIn: w, depthIn: d, uses, grades: SAWN_GRADES, stockLengthsFt: lengths,
})

const eng = (family: 'lvl' | 'lsl' | 'psl' | 'glulam', label: string, grade: string, w: number, wLabel: string, d: number, dLabel: string, uses: MemberUse[]): MemberSpec => ({
  id: `${family}-${wLabel}x${dLabel}`.replace(/\//g, '_'), family,
  size: `${wLabel} × ${dLabel}`, name: `${label} ${wLabel} × ${dLabel}`,
  widthIn: w, depthIn: d, uses, grades: [grade], stockLengthsFt: ENG_LENGTHS,
})

const ijoist = (dLabel: string, d: number): MemberSpec => ({
  id: `i-joist-${dLabel}`.replace(/\//g, '_'), family: 'i-joist',
  size: `${dLabel}"`, name: `I-joist ${dLabel}"`,
  widthIn: 2.5, depthIn: d, uses: ['joist', 'rafter'], grades: ['Series 2-1/2" flange'], stockLengthsFt: ENG_LENGTHS,
})

const steel = (kind: 'stud' | 'track', webLabel: string, web: number): MemberSpec => ({
  id: `steel-${kind}-${webLabel}`.replace(/\//g, '_'), family: kind === 'stud' ? 'steel-stud' : 'steel-track',
  size: `${webLabel}"`, name: `Steel ${kind} ${webLabel}"`,
  widthIn: kind === 'stud' ? 1.625 : 1.25, depthIn: web,
  uses: kind === 'stud' ? (web < 2 ? ['stud', 'furring'] : ['stud', 'blocking']) : ['plate'],
  grades: ['ASTM A1003'], stockLengthsFt: STEEL_LENGTHS,
  gauges: ['25', '20', '18', '16', '14'],
})

export const MEMBERS: readonly MemberSpec[] = [
  // ── Sawn lumber ──
  sawn('2×3', 1.5, 2.5, ['stud', 'plate', 'furring', 'blocking'], STUD_LENGTHS),
  sawn('2×4', 1.5, 3.5, ['stud', 'plate', 'blocking', 'header', 'furring'], STUD_LENGTHS),
  sawn('2×6', 1.5, 5.5, ['stud', 'plate', 'blocking', 'header', 'joist', 'rafter', 'ledger']),
  sawn('2×8', 1.5, 7.25, ['stud', 'plate', 'blocking', 'header', 'joist', 'rafter', 'rim', 'ledger']),
  sawn('2×10', 1.5, 9.25, ['header', 'joist', 'rafter', 'rim', 'blocking', 'ledger', 'beam']),
  sawn('2×12', 1.5, 11.25, ['header', 'joist', 'rafter', 'rim', 'blocking', 'ledger', 'beam']),
  sawn('4×4', 3.5, 3.5, ['post']),
  sawn('4×6', 3.5, 5.5, ['post', 'header', 'beam']),
  sawn('6×6', 5.5, 5.5, ['post']),

  // ── LVL — headers and beams, plied up as needed ──
  eng('lvl', 'LVL', '2.0E', 1.75, '1-3/4', 7.25, '7-1/4', ['header', 'beam']),
  eng('lvl', 'LVL', '2.0E', 1.75, '1-3/4', 9.25, '9-1/4', ['header', 'beam']),
  eng('lvl', 'LVL', '2.0E', 1.75, '1-3/4', 9.5, '9-1/2', ['header', 'beam', 'rim']),
  eng('lvl', 'LVL', '2.0E', 1.75, '1-3/4', 11.25, '11-1/4', ['header', 'beam']),
  eng('lvl', 'LVL', '2.0E', 1.75, '1-3/4', 11.875, '11-7/8', ['header', 'beam', 'rim']),
  eng('lvl', 'LVL', '2.0E', 1.75, '1-3/4', 14, '14', ['header', 'beam']),
  eng('lvl', 'LVL', '2.0E', 1.75, '1-3/4', 16, '16', ['header', 'beam']),
  eng('lvl', 'LVL', '2.0E', 1.75, '1-3/4', 18, '18', ['beam']),

  /**
   * A MANUFACTURER'S LINE, IN THE CATALOGUE.
   *
   * West Fraser's 3000Fb 1.9E LVL, from their own LVL User's Guide (United
   * States edition, 25.1097 — 2026-07-22). 11-1/2" is one of the depths their
   * 1-3/4" 1.9E table lists, and it is deliberately not one the generic LVL rows
   * already carry: a maker's row that duplicated a generic size would shadow it
   * in the lookup and put two different beams behind one id.
   */
  eng('lvl', 'West Fraser LVL', '3000Fb 1.9E', 1.75, '1-3/4', 11.5, '11-1/2', ['header', 'beam']),

  // ── LSL — tall-wall studs, headers, rim ──
  eng('lsl', 'LSL', '1.55E', 1.75, '1-3/4', 3.5, '3-1/2', ['stud', 'plate']),
  eng('lsl', 'LSL', '1.55E', 1.75, '1-3/4', 5.5, '5-1/2', ['stud', 'plate', 'header']),
  eng('lsl', 'LSL', '1.55E', 1.75, '1-3/4', 7.25, '7-1/4', ['header', 'rim']),
  eng('lsl', 'LSL', '1.55E', 1.75, '1-3/4', 9.25, '9-1/4', ['header', 'rim']),
  eng('lsl', 'LSL', '1.55E', 1.75, '1-3/4', 11.875, '11-7/8', ['header', 'rim', 'beam']),

  /** Another maker's line: LP SolidStart LSL at the 1.35E grade, 1-3/4 × 9-1/2. */
  eng('lsl', 'LP SolidStart LSL', '1.35E', 1.75, '1-3/4', 9.5, '9-1/2', ['header', 'rim']),

  // ── PSL — posts, columns, heavy beams ──
  eng('psl', 'PSL', '2.2E', 3.5, '3-1/2', 3.5, '3-1/2', ['post']),
  eng('psl', 'PSL', '2.2E', 5.25, '5-1/4', 5.25, '5-1/4', ['post']),
  eng('psl', 'PSL', '2.2E', 3.5, '3-1/2', 11.875, '11-7/8', ['beam', 'header']),
  eng('psl', 'PSL', '2.2E', 5.25, '5-1/4', 11.875, '11-7/8', ['beam']),
  eng('psl', 'PSL', '2.2E', 5.25, '5-1/4', 14, '14', ['beam']),

  /**
   * Parallam PSL, from Weyerhaeuser's 2.2E deep-beam specifier's guide (TJ-7001,
   * April 2026), which lists 3-1/2" and 5-1/4" widths against 20", 22" and 24"
   * depths. 3-1/2 × 20 is one of those published pairs.
   */
  eng('psl', 'Parallam PSL', '2.2E', 3.5, '3-1/2', 20, '20', ['beam']),

  // ── Glulam — exposed and long-span beams ──
  /**
   * A MANUFACTURER'S LINE, IN THE CATALOGUE.
   *
   * Nordic Structures' Nordic Lam, modelled from their own published product
   * report rather than from a generic glulam assumption: the 24F-E/ES1M1 layup
   * is mechanically graded SPF, and its published width ceiling is 7-1/2" — not
   * the 8-3/4" a Douglas-fir table would lead you to. 6-3/4 × 18 sits inside
   * that layup's range with the depth-to-width ratio well under the 12:1 cap.
   *
   * It is a preview row: it exists so their part can be put in front of them
   * and taken out again, and the generic glulam rows below are what the app
   * frames with otherwise. See data/manufacturerParts.ts for the specs and the
   * source each figure came from.
   *
   * The width is the one soft spot: 6-3/4" sits inside the layup's 7-1/2" limit
   * in Table 1 of PR-L294(C), but Nordic publishes four beam widths — 1-3/4,
   * 3-1/2, 5-1/2 and 7 — so this size is at best built to order. Worth asking
   * them before it goes in front of them.
   */
  eng('glulam', 'Nordic Lam', '24F-E/ES1M1', 6.75, '6-3/4', 18, '18', ['beam', 'header']),
  eng('glulam', 'Glulam', '24F-V4', 3.125, '3-1/8', 9, '9', ['beam', 'header']),
  eng('glulam', 'Glulam', '24F-V4', 3.125, '3-1/8', 12, '12', ['beam', 'header']),
  eng('glulam', 'Glulam', '24F-V4', 5.125, '5-1/8', 12, '12', ['beam']),
  eng('glulam', 'Glulam', '24F-V4', 5.125, '5-1/8', 15, '15', ['beam']),

  // ── I-joists ──
  ijoist('9-1/2', 9.5),
  ijoist('11-7/8', 11.875),
  ijoist('14', 14),
  ijoist('16', 16),

  // ── Rim board ──
  { id: 'rim-board-1-1_8x9-1_2', family: 'rim-board', size: '1-1/8 × 9-1/2', name: 'OSB rim board 1-1/8 × 9-1/2',
    widthIn: 1.125, depthIn: 9.5, uses: ['rim'], grades: ['OSB rim'], stockLengthsFt: [12, 16, 24] },
  { id: 'rim-board-1-1_8x11-7_8', family: 'rim-board', size: '1-1/8 × 11-7/8', name: 'OSB rim board 1-1/8 × 11-7/8',
    widthIn: 1.125, depthIn: 11.875, uses: ['rim'], grades: ['OSB rim'], stockLengthsFt: [12, 16, 24] },

  // ── Cold-formed steel ──
  steel('stud', '1-5/8', 1.625),
  steel('stud', '2-1/2', 2.5),
  steel('stud', '3-5/8', 3.625),
  steel('stud', '6', 6),
  steel('stud', '8', 8),
  steel('track', '1-5/8', 1.625),
  steel('track', '2-1/2', 2.5),
  steel('track', '3-5/8', 3.625),
  steel('track', '6', 6),
  steel('track', '8', 8),

  // ── Masonry ──
  { id: 'cmu-8', family: 'cmu', size: '8"', name: 'CMU block 8"',
    widthIn: 7.625, depthIn: 7.625, uses: [], grades: ['ASTM C90'], stockLengthsFt: [] },
]

const BY_ID = new Map(MEMBERS.map((m) => [m.id, m]))

export function getMember(id: string): MemberSpec | undefined {
  return BY_ID.get(id)
}

/** Every member that can do this job, in catalogue order (smallest first within a family). */
export function membersFor(use: MemberUse, family?: MemberFamily): MemberSpec[] {
  return MEMBERS.filter((m) => m.uses.includes(use) && (!family || m.family === family))
}

const IN_TO_M = 0.0254
/** Actual cross-section in metres, for geometry. */
export function memberSectionM(m: MemberSpec): { width: number; depth: number } {
  return { width: m.widthIn * IN_TO_M, depth: m.depthIn * IN_TO_M }
}

// ── Wall types — what the per-wall picker offers ─────────────────────────────

/**
 * A wall type is a stud member plus how the wall builders already describe it.
 * The keys are stored on every wall, so they never change; the stud member is
 * what ties the type to the catalogue.
 */
export interface WallTypeSpec {
  key: string
  label: string
  short: string
  /** The stud this wall is framed with. */
  studMemberId: string
  material: 'wood' | 'steel'
  /** The stud-size key the framing builders read ('2x4' | '2x6' | '2x8'). */
  studSize: string
  steelWidth?: string
  isMasonry?: boolean
}

export const WALL_TYPES: readonly WallTypeSpec[] = [
  { key: 'wood-2x4',    label: 'Wood 2×4 (3.5")',        short: 'Wood 2×4',  studMemberId: 'sawn-2x4', material: 'wood',  studSize: '2x4' },
  { key: 'wood-2x6',    label: 'Wood 2×6 (5.5")',        short: 'Wood 2×6',  studMemberId: 'sawn-2x6', material: 'wood',  studSize: '2x6' },
  { key: 'wood-2x8',    label: 'Wood 2×8 (7-1/4")',      short: 'Wood 2×8',  studMemberId: 'sawn-2x8', material: 'wood',  studSize: '2x8' },
  { key: 'steel-1-5-8', label: 'Steel 1-5/8" (furring)', short: 'Steel 1⅝"', studMemberId: 'steel-stud-1-5_8', material: 'steel', studSize: '2x4', steelWidth: '1-5/8' },
  { key: 'steel-3-5-8', label: 'Steel 3-5/8"',           short: 'Steel 3⅝"', studMemberId: 'steel-stud-3-5_8', material: 'steel', studSize: '2x4', steelWidth: '3-5/8' },
  { key: 'steel-6',     label: 'Steel 6"',               short: 'Steel 6"',  studMemberId: 'steel-stud-6', material: 'steel', studSize: '2x6', steelWidth: '6' },
  { key: 'steel-8',     label: 'Steel 8" (heavy)',       short: 'Steel 8"',  studMemberId: 'steel-stud-8', material: 'steel', studSize: '2x8', steelWidth: '8' },
  { key: 'cmu',         label: 'CMU Block',              short: 'CMU',       studMemberId: 'cmu-8', material: 'wood', studSize: '2x6', isMasonry: true },
  { key: 'brick',       label: 'Brick',                  short: 'Brick',     studMemberId: 'cmu-8', material: 'wood', studSize: '2x6', isMasonry: true },
]

export function getWallType(key: string | undefined): WallTypeSpec | undefined {
  return key ? WALL_TYPES.find((t) => t.key === key) : undefined
}
