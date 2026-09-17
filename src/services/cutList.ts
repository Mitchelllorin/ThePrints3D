/**
 * THE CUT LIST AND THE BUY LIST — counted off the framing, not estimated.
 *
 * The takeoff works walls out from rules of thumb: length ÷ 16" + 1 studs, twice
 * the length in plate. It can't see a corner post, a king or a jack, a tee pack,
 * a cripple or a header, and it can't tell a 92" stud from an 80" jack. The wall
 * builder already frames every one of those, and stamps each member with the
 * stock it comes from and the length it is cut to (see MemberCut). So this does
 * no estimating at all:
 *
 *   CUT LIST — per wall, what the saw sees: member, what it is, length, how many.
 *   BUY LIST — every piece nested into the stock lengths the yard sells, plus a
 *              waste allowance per kind of member, rounded UP to whole sticks.
 *
 * Lengths are to the nearest 1/16". Pure apart from building the framing, which
 * needs no renderer, so all of it runs under test.
 */
import type { CutRole, MemberCut } from './framingGeometry'
import { buildWallFraming } from './framingGeometry'
import type { PlannedWall } from './wallFramingPlan'
import { getMember } from '../data/members'

const IN_PER_M = 1 / 0.0254
/** A saw blade takes an eighth out of every cut. */
export const KERF_IN = 0.125

/** Waste is allowed per KIND of member, because they go wrong differently. */
export type WasteCategory = 'studs' | 'plates' | 'headers' | 'blocking'

/**
 * Defaults a framer would put on a lumber order. Studs and plates cull for
 * crown, twist and splits; blocking is cut from short stock and eats offcuts
 * badly; engineered headers are straight and priced by the foot, so they
 * carry the least.
 */
export const DEFAULT_WASTE_PCT: Readonly<Record<WasteCategory, number>> = {
  studs: 10,
  plates: 10,
  headers: 5,
  blocking: 15,
}

export const WASTE_LABEL: Readonly<Record<WasteCategory, string>> = {
  studs: 'Studs', plates: 'Plates & track', headers: 'Headers', blocking: 'Blocking',
}

export const ROLE_CATEGORY: Readonly<Record<CutRole, WasteCategory>> = {
  'bottom plate': 'plates', 'top plate': 'plates', 'cap plate': 'plates', track: 'plates', sill: 'plates',
  stud: 'studs', 'king stud': 'studs', 'jack stud': 'studs', cripple: 'studs', 'sill cripple': 'studs', backer: 'studs',
  header: 'headers',
  blocking: 'blocking', channel: 'blocking',
}

/** The order a framer reads a wall: plates, the field, the openings, the fill. */
const ROLE_ORDER: readonly CutRole[] = [
  'bottom plate', 'top plate', 'cap plate', 'track',
  'stud', 'backer', 'king stud', 'jack stud', 'header', 'cripple', 'sill', 'sill cripple',
  'blocking', 'channel',
]

const ROLE_LABEL: Readonly<Record<CutRole, string>> = {
  'bottom plate': 'Bottom plate', 'top plate': 'Top plate', 'cap plate': 'Cap plate', track: 'Track',
  stud: 'Stud', backer: 'Backer', 'king stud': 'King stud', 'jack stud': 'Jack stud', header: 'Header',
  cripple: 'Cripple', sill: 'Sill', 'sill cripple': 'Sill cripple', blocking: 'Blocking', channel: 'Channel',
}

export function roleLabel(role: CutRole): string {
  return ROLE_LABEL[role]
}

/** Inches, to the nearest 1/16". */
export function toSixteenth(inches: number): number {
  return Math.round(inches * 16) / 16
}

export interface CutLine {
  member: string
  role: CutRole
  /** One piece, inches, to 1/16". */
  lengthIn: number
  qty: number
  /** Of those, how many stand in a pack (corner post, tee, point load). */
  inPacks: number
}

export interface WallCuts {
  index: number
  name: string
  level: number
  /** Block or brick — nothing to cut, but the wall is still on the list. */
  masonry: boolean
  lines: CutLine[]
}

/** The shape needed from a THREE.Object3D — structural, so tests need no scene. */
export interface CutNode {
  userData?: { cut?: unknown } | undefined
  children?: CutNode[] | undefined
}

function isMemberCut(v: unknown): v is MemberCut {
  const c = v as MemberCut
  return !!c && typeof c.role === 'string' && typeof c.member === 'string' && typeof c.lengthM === 'number'
}

/** Every stamped member under this node, grouped by stock, job and length. */
export function cutsFromFraming(root: CutNode): CutLine[] {
  const byKey = new Map<string, CutLine>()
  const walk = (n: CutNode) => {
    const c = n.userData?.cut
    if (isMemberCut(c) && c.lengthM > 0) {
      const lengthIn = toSixteenth(c.lengthM * IN_PER_M)
      const k = `${c.member}|${c.role}|${lengthIn}`
      const pieces = Math.max(1, Math.round(c.pieces ?? 1))
      const line = byKey.get(k) ?? { member: c.member, role: c.role, lengthIn, qty: 0, inPacks: 0 }
      line.qty += pieces
      if (c.pack) line.inPacks += pieces
      byKey.set(k, line)
    }
    for (const ch of n.children ?? []) walk(ch)
  }
  walk(root)
  return [...byKey.values()].sort((a, b) =>
    ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || b.lengthIn - a.lengthIn || a.member.localeCompare(b.member))
}

/** "Wall 3", or "Wall 3 · Floor 2" above the ground floor. */
export function wallName(index: number, level: number): string {
  return level > 0 ? `Wall ${index + 1} · Floor ${level + 1}` : `Wall ${index + 1}`
}

/** The cut list for every wall the model frames, in the model's own wall order. */
export function cutListForWalls(plans: readonly PlannedWall[]): WallCuts[] {
  return plans.map((p) => ({
    index: p.index,
    name: wallName(p.index, p.level),
    level: p.level,
    masonry: p.isMasonry,
    lines: p.isMasonry || p.length < 0.05 ? [] : cutsFromFraming(buildWallFraming(p.opts)),
  }))
}

// ── Buy list ────────────────────────────────────────────────────────────────

/** Stock lengths, feet, for a member as the cut list names it. */
export function stockLengthsFt(member: string): readonly number[] {
  const sawn = /^(\d)×(\d+)$/.exec(member)
  if (sawn) return getMember(`sawn-${sawn[1]}x${sawn[2]}`)?.stockLengthsFt ?? [8, 10, 12, 14, 16]
  if (member.startsWith('LVL')) return getMember('lvl-1-3_4x9-1_4')?.stockLengthsFt ?? [12, 16, 20, 24]
  const steel = /^([\d/-]+)" \d+ga steel (stud|track)$/.exec(member)
  if (steel) return getMember(`steel-${steel[2]}-${steel[1].replace(/\//g, '_')}`)?.stockLengthsFt ?? [8, 10, 12, 16, 20]
  if (member.includes('channel')) return [16, 20]
  return [8, 10, 12, 16]
}

export interface BuyLine {
  member: string
  category: WasteCategory
  stockFt: number
  /** Sticks the cuts actually need, nested. */
  needed: number
  /** With the waste allowance, rounded up — what goes on the order. */
  order: number
}

/** Longest piece first, into the stick it wastes least in — classic first-fit
 *  decreasing, free to open whatever stock length each new stick needs. */
function packMixed(pieces: readonly number[], stock: readonly number[]): Map<number, number> {
  const out = new Map<number, number>()
  const bins: Array<{ capIn: number; usedIn: number }> = []
  for (const p of pieces) {
    let best = -1
    let bestLeft = Infinity
    bins.forEach((b, i) => {
      const left = b.capIn - b.usedIn - KERF_IN - p
      if (left >= -1e-9 && left < bestLeft) { best = i; bestLeft = left }
    })
    if (best >= 0) { bins[best].usedIn += p + KERF_IN; continue }
    const ft = stock.find((s) => s * 12 >= p) ?? stock[stock.length - 1]
    bins.push({ capIn: ft * 12, usedIn: p })
  }
  // A stick only ever part-used may come off a shorter length.
  for (const b of bins) {
    const ft = stock.find((s) => s * 12 >= b.usedIn - 1e-9) ?? b.capIn / 12
    out.set(ft, (out.get(ft) ?? 0) + 1)
  }
  return out
}

/** Every piece out of ONE stock length — how a yard order usually reads. */
function packFixed(pieces: readonly number[], lengthFt: number): number | null {
  const capIn = lengthFt * 12
  const bins: number[] = []
  for (const p of pieces) {
    if (p > capIn + 1e-9) return null            // won't fit; not this length
    let best = -1
    let bestLeft = Infinity
    bins.forEach((used, i) => {
      const left = capIn - used - KERF_IN - p
      if (left >= -1e-9 && left < bestLeft) { best = i; bestLeft = left }
    })
    if (best >= 0) bins[best] += p + KERF_IN
    else bins.push(p)
  }
  return bins.length
}

const totalFeet = (sticks: Map<number, number>) =>
  [...sticks].reduce((ft, [len, n]) => ft + len * n, 0)

/**
 * Nest pieces into the stock lengths the yard sells, and buy the fewest FEET.
 *
 * Two strategies, because neither wins on its own. Mixed lengths suit a wall of
 * odd pieces. One length suits a run of equal ones: two 6'3" headers do not fit
 * a 12' stick, so first-fit opens a 12' for each and buys 24 feet, where one 16'
 * cut in two buys 16. Both get costed and the FEWER FEET wins. A tie stays with
 * the mixed lengths, which is the one with less cutting in it: ten 90" studs are
 * ten 8' studs off the pile, not five 16-footers halved for the same footage.
 *
 * A piece longer than the longest stock (a 36' plate) is spliced — full sticks,
 * and the remainder nested like any other piece. Splices land on a stud on site;
 * this counts the sticks, it does not lay out the joints.
 */
export function nestIntoStock(piecesIn: readonly number[], stockFt: readonly number[]): Map<number, number> {
  const stock = [...stockFt].filter((s) => s > 0).sort((a, b) => a - b)
  const out = new Map<number, number>()
  if (stock.length === 0 || piecesIn.length === 0) return out
  const longest = stock[stock.length - 1]
  const bump = (ft: number, n = 1) => out.set(ft, (out.get(ft) ?? 0) + n)

  const pieces: number[] = []
  for (const p of piecesIn) {
    if (p <= 0) continue
    if (p <= longest * 12) { pieces.push(p); continue }
    const full = Math.floor(p / (longest * 12))
    bump(longest, full)
    const rest = p - full * longest * 12
    if (rest > 0.5) pieces.push(rest)
  }
  pieces.sort((a, b) => b - a)
  if (pieces.length === 0) return out

  let best = packMixed(pieces, stock)
  let bestFt = totalFeet(best)
  for (const len of stock) {
    const n = packFixed(pieces, len)
    if (n === null) continue
    const ft = n * len
    if (ft < bestFt - 1e-9) {
      best = new Map([[len, n]])
      bestFt = ft
    }
  }
  for (const [len, n] of best) bump(len, n)
  return out
}

/**
 * A STUD IS A STICK, NOT HALF A SIXTEEN.
 *
 * Nesting by footage alone will happily pair two 90" studs into a 16' and
 * report "buy 76 sixteen-footers" for the same feet as 150 eight-foot studs —
 * cheaper on paper, and not how anybody frames a wall or how a yard sells
 * studs. Full-height members come one to a stick. The short stuff off an
 * opening — jacks, cripples, blocking, sill — is what gets nested, because
 * that is what a framer really does cut out of one length.
 */
const WHOLE_STICK_ROLES: ReadonlySet<CutRole> = new Set<CutRole>(['stud', 'king stud', 'backer'])

export function buyList(
  walls: readonly WallCuts[],
  wastePct: Readonly<Record<WasteCategory, number>> = DEFAULT_WASTE_PCT,
): BuyLine[] {
  const groups = new Map<string, { member: string; category: WasteCategory; whole: number[]; nested: number[] }>()
  for (const w of walls) {
    for (const l of w.lines) {
      const category = ROLE_CATEGORY[l.role]
      const k = `${l.member}|${category}`
      const g = groups.get(k) ?? { member: l.member, category, whole: [], nested: [] }
      const into = WHOLE_STICK_ROLES.has(l.role) ? g.whole : g.nested
      for (let i = 0; i < l.qty; i++) into.push(l.lengthIn)
      groups.set(k, g)
    }
  }
  const lines: BuyLine[] = []
  for (const g of groups.values()) {
    const pct = Math.max(0, wastePct[g.category] ?? 0)
    const stock = stockLengthsFt(g.member)
    const sticks = nestIntoStock(g.nested, stock)
    for (const p of g.whole) {
      const ft = stock.find((s) => s * 12 >= p) ?? stock[stock.length - 1]
      sticks.set(ft, (sticks.get(ft) ?? 0) + 1)
    }
    for (const [stockFt, needed] of [...sticks].sort((a, b) => a[0] - b[0])) {
      lines.push({ member: g.member, category: g.category, stockFt, needed, order: Math.ceil(needed * (1 + pct / 100) - 1e-9) })
    }
  }
  const catOrder: WasteCategory[] = ['plates', 'studs', 'headers', 'blocking']
  return lines.sort((a, b) =>
    catOrder.indexOf(a.category) - catOrder.indexOf(b.category) || a.member.localeCompare(b.member) || a.stockFt - b.stockFt)
}

/** Both lists as CSV rows, for the export. Every field quoted. */
export function cutListCsvRows(walls: readonly WallCuts[], buy: readonly BuyLine[], fmt: (inches: number) => string): string[] {
  const q = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`
  const rows = [['Cut list'], ['Wall', 'Member', 'Piece', 'Length', 'Qty']].map((r) => r.map(q).join(','))
  for (const w of walls) {
    if (w.masonry) { rows.push([w.name, 'Masonry', '—', '—', 0].map(q).join(',')); continue }
    for (const l of w.lines) rows.push([w.name, l.member, roleLabel(l.role), fmt(l.lengthIn), l.qty].map(q).join(','))
  }
  rows.push('', [q('Buy list')].join(','), ['Member', 'For', 'Stock length', 'Needed', 'Order (with waste)'].map(q).join(','))
  for (const b of buy) rows.push([b.member, WASTE_LABEL[b.category], `${b.stockFt}'`, b.needed, b.order].map(q).join(','))
  return rows
}
