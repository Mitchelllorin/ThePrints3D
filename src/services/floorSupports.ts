/**
 * WHAT HOLDS A FLOOR UP — the walls under it and the beams it needs.
 *
 * A floor used to be one field of joists running the short way across the
 * whole building, wall to wall, whatever the distance. On site the joists
 * land on whatever bears under them:
 *
 *   - an INSIDE WALL on the floor below, running across the joists, carries
 *     them — they break over it and lap on its top plate;
 *   - where the clear span is still longer than the joist can go, a FLUSH LVL
 *     BEAM goes in, as deep as the joists, the joists hung off both faces of
 *     it, and the beam comes down on POSTS, or on the outside walls at its
 *     ends (a stud pack in the wall under each end).
 *
 * Spans are rule-of-thumb (40 psf live, 10 dead, L/360, SPF No.2 / typical
 * I-joist and LVL). They are a first layout, not a design: the beam supplier's
 * sizing, or the engineer, has the last word — the same deal as the headers
 * (see lvlHeaderFor).
 *
 * Works in the floor area's own metres: x across, z down, centred on the box —
 * the space buildFloorJoists draws in. "Span" is the axis the joists run along,
 * "run" the axis the row of joists covers.
 */

/** A wall from the floor below, in the area's metres. */
export interface LocalWall { x1: number; z1: number; x2: number; z2: number; t: number }

/** An inside wall under the floor, across the joists: at `s` on the span
 *  axis, covering `p0..p1` of the run. */
export interface BearingLine { s: number; p0: number; p1: number; t: number }

export interface FloorBeam {
  /** Where it sits on the span axis, and the stretch of the run it covers. */
  s: number; p0: number; p1: number
  plies: number
  /** Section, metres (one ply is 1-3/4"). */
  widthM: number; depthM: number
  /** Where posts come down under it, on the run axis. Ends that land on an
   *  outside wall are not posts — they bear on a stud pack in that wall. */
  posts: number[]
  /** Longest clear span between its supports. */
  spanM: number
  /** As the yard says it: 'LVL 1-3/4 × 11-7/8, 3-ply'. */
  label: string
}

export interface FloorSupportPlan {
  spanAlongX: boolean
  maxSpanM: number
  bearings: BearingLine[]
  beams: FloorBeam[]
}

/** How far each joist can go at 16" o.c. (metres). */
export const JOIST_MAX_SPAN_M: Record<string, number> = {
  '2x6': 2.9,
  '2x8': 3.6,
  'Skids + 2x6': 2.9,
  '2x10': 4.37,   // 14'-4"
  '2x12': 5.08,   // 16'-8"
  'I-Joist': 5.5, // 11-7/8", ~18'
  'LVL': 6.4,
}
export const LVL_PLY_M = 0.0445

/** Max span for the joist at its spacing: closer goes further. */
export function maxJoistSpanM(element: string, ocM: number): number {
  const base = JOIST_MAX_SPAN_M[element] ?? JOIST_MAX_SPAN_M['I-Joist']
  const ocIn = ocM / 0.0254
  const f = ocIn <= 13 ? 1.09 : ocIn <= 17 ? 1 : ocIn <= 20 ? 0.94 : 0.87
  return base * f
}

const LVL_DEPTHS_IN = [9.25, 11.25, 11.875, 14, 16]
const frac = (d: number) => d === 9.25 ? '9-1/4' : d === 11.25 ? '11-1/4' : d === 11.875 ? '11-7/8' : String(d)

/** The LVL depth a flush beam takes: the stock depth closest to the joists. */
export function flushLvlDepthIn(joistDepthM: number): number {
  const want = joistDepthM / 0.0254
  return LVL_DEPTHS_IN.reduce((b, d) => (Math.abs(d - want) < Math.abs(b - want) ? d : b))
}

/**
 * How far a flush LVL can span, rule of thumb: about 20× its depth as a 2-ply
 * carrying 3 m of floor each side between them; more plies go a little further,
 * more floor on it a little less.
 */
export function lvlSpanM(depthIn: number, plies: number, tribM: number): number {
  const d = depthIn * 0.0254
  return 20 * d * Math.cbrt(plies / 2) * Math.cbrt(3 / Math.max(0.5, tribM))
}

/** The inside walls below that run across the joists. */
export function bearingLines(walls: LocalWall[], lenX: number, lenZ: number): BearingLine[] {
  const spanAlongX = lenX <= lenZ
  const spanHalf = (spanAlongX ? lenX : lenZ) / 2
  const runHalf = (spanAlongX ? lenZ : lenX) / 2
  const out: BearingLine[] = []
  for (const w of walls) {
    // span axis value s, run axis value p
    const s1 = spanAlongX ? w.x1 : w.z1, s2 = spanAlongX ? w.x2 : w.z2
    const p1 = spanAlongX ? w.z1 : w.x1, p2 = spanAlongX ? w.z2 : w.x2
    const ds = s2 - s1, dp = p2 - p1
    const L = Math.hypot(ds, dp)
    if (L < 0.6) continue
    // Across the joists: along the run, within 10 degrees.
    if (Math.abs(ds) / L > Math.sin((10 * Math.PI) / 180)) continue
    const s = (s1 + s2) / 2
    // The outside walls are the floor's own ends; the rim bears on those.
    if (Math.abs(s) > spanHalf - 0.3) continue
    const p0 = Math.max(-runHalf, Math.min(p1, p2)), pe = Math.min(runHalf, Math.max(p1, p2))
    if (pe - p0 < 0.6) continue
    out.push({ s, p0, p1: pe, t: w.t || 0.14 })
  }
  // Two walls in line (a wall broken by a door) are one bearing line.
  out.sort((a, b) => a.s - b.s || a.p0 - b.p0)
  const merged: BearingLine[] = []
  for (const b of out) {
    const m = merged.find((x) => Math.abs(x.s - b.s) < 0.08 && b.p0 <= x.p1 + 1.2 && b.p1 >= x.p0 - 1.2)
    if (m) { m.p0 = Math.min(m.p0, b.p0); m.p1 = Math.max(m.p1, b.p1) }
    else merged.push({ ...b })
  }
  return merged
}

/** Every support line inside the span at run position `p`, sorted: bearing
 *  walls and beams. */
export function supportsAt(plan: Pick<FloorSupportPlan, 'bearings' | 'beams'>, p: number): Array<{ s: number; kind: 'wall' | 'beam'; w: number }> {
  const hits: Array<{ s: number; kind: 'wall' | 'beam'; w: number }> = []
  for (const b of plan.bearings) if (p >= b.p0 - 1e-6 && p <= b.p1 + 1e-6) hits.push({ s: b.s, kind: 'wall', w: b.t })
  for (const b of plan.beams) if (p >= b.p0 - 1e-6 && p <= b.p1 + 1e-6) hits.push({ s: b.s, kind: 'beam', w: b.widthM })
  return hits.sort((a, b) => a.s - b.s)
}

export function planFloorSupports(opts: {
  lenX: number; lenZ: number; element: string; ocM: number; joistDepthM: number
  /** Walls on the floor below, in the area's metres. */
  wallsBelow: LocalWall[]
}): FloorSupportPlan {
  const { lenX, lenZ, element, ocM, joistDepthM, wallsBelow } = opts
  const spanAlongX = lenX <= lenZ
  const spanHalf = (spanAlongX ? lenX : lenZ) / 2
  const runHalf = (spanAlongX ? lenZ : lenX) / 2
  const maxSpanM = maxJoistSpanM(element, ocM)
  const bearings = bearingLines(wallsBelow, lenX, lenZ)
  const oc = Math.max(0.2, ocM)

  // Walk the row of joists; wherever a joist's clear span is too long, mark
  // where a beam has to go.
  const marks: Array<{ s: number; p: number; trib: number }> = []
  for (let p = -runHalf + oc / 2; p < runHalf; p += oc) {
    const lines = [-spanHalf, ...supportsAt({ bearings, beams: [] }, p).map((x) => x.s), spanHalf]
    for (let i = 0; i + 1 < lines.length; i++) {
      const gap = lines[i + 1] - lines[i]
      if (gap <= maxSpanM) continue
      const k = Math.ceil(gap / maxSpanM)
      for (let j = 1; j < k; j++) marks.push({ s: lines[i] + (gap * j) / k, p, trib: gap / k })
    }
  }
  // Marks in line make one beam.
  marks.sort((a, b) => a.s - b.s)
  const groups: Array<typeof marks> = []
  for (const m of marks) {
    const g = groups.find((x) => Math.abs(x[0].s - m.s) < 0.3)
    if (g) g.push(m)
    else groups.push([m])
  }
  const depthIn = flushLvlDepthIn(joistDepthM)
  const beams: FloorBeam[] = []
  for (const g of groups) {
    const ss = g.map((m) => m.s).sort((a, b) => a - b)
    const s = ss[Math.floor(ss.length / 2)]
    let p0 = Math.min(...g.map((m) => m.p)) - oc / 2
    let p1 = Math.max(...g.map((m) => m.p)) + oc / 2
    // Within a bay of the outside wall, run it on to the wall and bear there.
    const toWall0 = p0 - -runHalf < oc * 1.5, toWall1 = runHalf - p1 < oc * 1.5
    if (toWall0) p0 = -runHalf
    if (toWall1) p1 = runHalf
    const trib = Math.max(...g.map((m) => m.trib))
    const len = p1 - p0
    // Fewest posts, then fewest plies, that carry it.
    let best: { plies: number; bays: number } | null = null
    for (let bays = 1; bays <= 8 && !best; bays++) {
      for (let plies = 2; plies <= 4; plies++) {
        if (len / bays <= lvlSpanM(depthIn, plies, trib)) { best = { plies, bays }; break }
      }
    }
    const { plies, bays } = best ?? { plies: 4, bays: 8 }
    const posts: number[] = []
    if (!toWall0) posts.push(p0)
    for (let i = 1; i < bays; i++) posts.push(p0 + (len * i) / bays)
    if (!toWall1) posts.push(p1)
    beams.push({
      s, p0, p1, plies,
      widthM: plies * LVL_PLY_M,
      depthM: depthIn * 0.0254,
      posts,
      spanM: len / bays,
      label: `LVL 1-3/4 × ${frac(depthIn)}, ${plies}-ply`,
    })
  }
  return { spanAlongX, maxSpanM, bearings, beams }
}
