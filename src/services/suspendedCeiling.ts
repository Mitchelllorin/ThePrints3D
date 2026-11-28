/**
 * A HUNG DRYWALL CEILING — laid out the way it is built on site:
 *
 *   - hanger wire, 4' x 4', tied up to the structure above (the slab in a
 *     tower, the joists in wood) and wrapped round the carrying channel;
 *   - 1-1/2" carrying channel (C-channel) at 4' on centre, wall to wall;
 *   - 7/8" hat track (furring channel) at 16" on centre, clipped across the
 *     carrying channel at every crossing;
 *   - wall angle round the edge, on the face of every wall of the room;
 *   - the board screwed up to the hat.
 *
 * Every member is laid in plan (print px) and clipped to the room's floor, so
 * an L-shaped room or a room with an angled wall gets channel that stops at
 * its walls. Pure: the 3D layer turns it into steel and the counts into a list.
 */
import type { ParsedWall } from '../types'
import { bulkheadLayout, clipToRegion, regionHas, type RoomRegion } from './roomRegions'

type Pt = { x: number; y: number }
export type CSeg = [Pt, Pt]

export interface SuspendedLayout {
  carrying: CSeg[]
  hats: CSeg[]
  wires: Pt[]
  angle: CSeg[]
  /** For the material list. Lengths in mm. */
  counts: { wires: number; carryingMm: number; hatMm: number; angleMm: number; clips: number; boardM2: number }
}

export const CEILING_SPEC = {
  carryingOcMm: 1219,
  hatOcMm: 406,
  wireOcMm: 1219,
  /** First carrying channel / first wire in from the wall. */
  carryingInMm: 150,
  /** First hat in from the wall. */
  hatInMm: 50,
  /** Section depths, metres — board, hat, carrying channel, stacked upward. */
  boardM: 0.0127,
  hatM: 0.0222,
  carryingM: 0.0381,
}

const lenOf = (s: CSeg) => Math.hypot(s[1].x - s[0].x, s[1].y - s[0].y)

export function suspendedCeilingLayout(
  region: RoomRegion,
  walls: Pick<ParsedWall, 'x1' | 'y1' | 'x2' | 'y2' | 'thickness'>[],
  mmPerPx: number,
  spec = CEILING_SPEC,
): SuspendedLayout {
  const px = (mm: number) => mm / mmPerPx
  const { x1, y1, x2, y2 } = region
  // Carrying channel runs the long way; hat across it.
  const alongX = x2 - x1 >= y2 - y1
  const lines = (oc: number, inset: number, across: boolean): CSeg[] => {
    const out: CSeg[] = []
    // `across` = the line runs along y, stepping in x.
    const lo = across ? x1 : y1, hi = across ? x2 : y2
    const first = lo + px(inset)
    const last = hi - px(inset)
    const steps: number[] = []
    for (let v = first; v < last - px(oc) * 0.25; v += px(oc)) steps.push(v)
    steps.push(Math.max(first, last))
    for (const v of steps) {
      const a = across ? { x: v, y: y1 - 1 } : { x: x1 - 1, y: v }
      const b = across ? { x: v, y: y2 + 1 } : { x: x2 + 1, y: v }
      out.push(...clipToRegion(region, a, b, Math.max(1, px(25))))
    }
    return out
  }
  const carrying = lines(spec.carryingOcMm, spec.carryingInMm, !alongX)
  const hats = lines(spec.hatOcMm, spec.hatInMm, alongX)

  const wires: Pt[] = []
  for (const s of carrying) {
    const L = lenOf(s)
    const ux = (s[1].x - s[0].x) / L, uy = (s[1].y - s[0].y) / L
    const first = Math.min(px(spec.carryingInMm), L / 2)
    const at: number[] = []
    for (let t = first; t < L - first - px(spec.wireOcMm) * 0.25; t += px(spec.wireOcMm)) at.push(t)
    at.push(L - first)
    for (const t of at) wires.push({ x: s[0].x + ux * t, y: s[0].y + uy * t })
  }

  // Clips: one where each hat crosses a carrying channel, on the floor.
  let clips = 0
  for (const h of hats) {
    for (const c of carrying) {
      const hx = alongX ? h[0].x : null, cy = alongX ? c[0].y : null
      const p = alongX ? { x: hx!, y: cy! } : { x: c[0].x, y: h[0].y }
      const inH = alongX ? p.y >= Math.min(h[0].y, h[1].y) && p.y <= Math.max(h[0].y, h[1].y) : p.x >= Math.min(h[0].x, h[1].x) && p.x <= Math.max(h[0].x, h[1].x)
      const inC = alongX ? p.x >= Math.min(c[0].x, c[1].x) && p.x <= Math.max(c[0].x, c[1].x) : p.y >= Math.min(c[0].y, c[1].y) && p.y <= Math.max(c[0].y, c[1].y)
      if (inH && inC && regionHas(region, p)) clips++
    }
  }

  const angle: CSeg[] = []
  for (const w of walls) {
    const lay = bulkheadLayout(w, region, w.thickness || 10)
    if (lay) angle.push([{ x: lay.a[0], y: lay.a[1] }, { x: lay.z[0], y: lay.z[1] }])
  }

  const mm = (segs: CSeg[]) => Math.round(segs.reduce((t, s) => t + lenOf(s), 0) * mmPerPx)
  return {
    carrying, hats, wires, angle,
    counts: {
      wires: wires.length,
      carryingMm: mm(carrying),
      hatMm: mm(hats),
      angleMm: mm(angle),
      clips,
      boardM2: Math.round(region.areaPx * mmPerPx * mmPerPx / 1e4) / 100,
    },
  }
}

/** A steel job: most of the walls drawn are steel studs. (Settings → framing
 *  material steel counts too; the caller checks that.) */
export function isSteelJob(walls: Pick<ParsedWall, 'source' | 'framingType'>[]): boolean {
  const mine = walls.filter((w) => w.source === 'user')
  if (mine.length === 0) return false
  return mine.filter((w) => (w.framingType ?? '').startsWith('steel')).length * 2 > mine.length
}
