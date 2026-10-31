/**
 * THE MEP STANDARD — one workflow, three trades.
 *
 * Every trade roughs in the same way, and the app now asks the same three
 * questions of each, in the order the trade answers them on site:
 *
 *   ① WHAT IT SERVES     the things at the end of the line
 *   ② WHERE IT COMES FROM the one thing everything runs back to
 *   ③ RUN IT             the wire, the pipe, the duct between them
 *
 *              ①                        ②                      ③
 *   Electrical outlets, switches, lights the panel              wire, by circuit
 *   Plumbing   toilet, sinks, tub, …    stack + water heater    drain and supply
 *   HVAC       supply registers, return the furnace             ducts
 *
 * Each step has a "do it for me" (here) and a by-hand path (the tray and the
 * tracer, unchanged). Everything below is PURE and in the drawing's pixel
 * space — the same space walls, placed objects and traced runs already live
 * in — so the store only has to turn the answers into objects and lines.
 */
import type { ParsedWall, PlacedObject, TracedLine } from '../types'
import { routeAlongWalls } from './autoRouteTrades'
import { centroid, inwardNormal, facingInward } from './autoPlaceTrades'
import { PLUMBING_FIXTURES } from './tradeRules'

export type Trade = 'electrical' | 'plumbing' | 'hvac'
export const TRADES: Trade[] = ['electrical', 'plumbing', 'hvac']

export interface TradeSpec {
  label: string
  serves: { label: string; types: string[]; hint: string }
  /** Every type here must be present for step ② to be done. */
  source: { label: string; types: string[]; hint: string }
  run: { label: string; hint: string }
}

export const TRADE_SPECS: Record<Trade, TradeSpec> = {
  electrical: {
    label: 'Electrical',
    serves: {
      label: 'Devices',
      types: ['duplex-outlet', 'gfci-outlet', 'switch', 'ceiling-light', 'recessed-light', 'exhaust-fan'],
      hint: 'Outlets, switches and lights',
    },
    source: { label: 'Panel', types: ['panel-box'], hint: 'Where every circuit starts' },
    run: { label: 'Wire', hint: 'Circuits from the panel, in the walls' },
  },
  plumbing: {
    label: 'Plumbing',
    serves: {
      label: 'Fixtures',
      types: ['toilet', 'kitchen-sink', 'bathroom-sink', 'bathtub', 'shower', 'washer', 'dishwasher'],
      hint: 'Toilet, sinks, tub, shower, washer',
    },
    source: { label: 'Stack', types: ['drain-stack', 'water-heater'], hint: 'Where it drains, and where hot water comes from' },
    run: { label: 'Pipe', hint: 'Drains under the floor, supply in the walls' },
  },
  hvac: {
    label: 'HVAC',
    serves: { label: 'Registers', types: ['supply-register', 'return-grille'], hint: 'A supply under each window, one return' },
    source: { label: 'Furnace', types: ['furnace'], hint: 'Where the air comes from' },
    run: { label: 'Ducts', hint: 'A branch to every register, the return back' },
  },
}

/** Which trade's runs a TracedLine list holds — the store keeps them apart. */
export const TRADE_LINES: Record<Trade, 'electricalLines' | 'plumbingLines' | 'hvacLines'> = {
  electrical: 'electricalLines',
  plumbing: 'plumbingLines',
  hvac: 'hvacLines',
}

export interface StepStatus {
  serves: number
  /** The source types still missing (empty = step done). */
  sourceMissing: string[]
  runs: number
}

const onLevel = <T extends { level?: number }>(xs: readonly T[], level: number) => xs.filter((x) => (x.level ?? 0) === level)

export function stepStatus(
  trade: Trade,
  objects: readonly PlacedObject[],
  lines: readonly TracedLine[],
  level: number,
): StepStatus {
  const spec = TRADE_SPECS[trade]
  const here = onLevel(objects, level)
  return {
    serves: here.filter((o) => spec.serves.types.includes(o.type)).length,
    sourceMissing: spec.source.types.filter((t) => !here.some((o) => o.type === t)),
    runs: onLevel(lines, level).length,
  }
}

/** An object to place, in pixel space — the store maps it to the world. */
export interface PlannedObject {
  type: string
  pxX: number
  pxY: number
  rotationY: number
  label: string
  level: number
}

/** A point on the inside face of a wall, `t` of the way along it. */
function onFace(w: ParsedWall, t: number, mid: { x: number; y: number }, inset = 0) {
  const { nx, ny } = inwardNormal(w, mid)
  const off = (w.thickness ?? 0) / 2 + inset
  return {
    pxX: w.x1 + (w.x2 - w.x1) * t + nx * off,
    pxY: w.y1 + (w.y2 - w.y1) * t + ny * off,
    rotationY: facingInward(w, mid),
  }
}

/** The wall nearest a point, and where along it the point falls. */
function nearestWall(walls: readonly ParsedWall[], x: number, y: number) {
  let best: { w: ParsedWall; t: number; d: number } | null = null
  for (const w of walls) {
    const dx = w.x2 - w.x1, dy = w.y2 - w.y1
    const len2 = dx * dx + dy * dy
    if (len2 === 0) continue
    const t = Math.max(0, Math.min(1, ((x - w.x1) * dx + (y - w.y1) * dy) / len2))
    const d = Math.hypot(x - (w.x1 + t * dx), y - (w.y1 + t * dy))
    if (!best || d < best.d) best = { w, t, d }
  }
  return best
}

const longest = (walls: readonly ParsedWall[]) =>
  walls.reduce((a, b) => (Math.hypot(b.x2 - b.x1, b.y2 - b.y1) > Math.hypot(a.x2 - a.x1, a.y2 - a.y1) ? b : a))

/**
 * ② Where it comes from — a sensible first spot for the source:
 *   panel    middle of the longest wall (an outside wall, on most plans);
 *   stack    in the wall nearest the middle of the wet fixtures, the wet wall;
 *            the water heater a step along the same wall;
 *   furnace  in the wall nearest the middle of the building — short runs out.
 * Only what is missing is planned; a source already placed is left alone.
 */
export function planSource(
  trade: Trade,
  walls: readonly ParsedWall[],
  objects: readonly PlacedObject[],
  level: number,
  mPerPx: number,
): PlannedObject[] {
  const ws = onLevel(walls, level)
  if (ws.length === 0) return []
  const mid = centroid(ws)
  const missing = stepStatus(trade, objects, [], level).sourceMissing
  if (missing.length === 0) return []
  const out: PlannedObject[] = []
  const put = (type: string, w: ParsedWall, t: number, label: string) =>
    out.push({ type, ...onFace(w, t, mid), label, level })

  if (trade === 'electrical') {
    put('panel-box', longest(ws), 0.5, 'Panel')
    return out
  }
  if (trade === 'hvac') {
    const n = nearestWall(ws, mid.x, mid.y)
    if (n) put('furnace', n.w, n.t, 'Furnace')
    return out
  }
  // Plumbing: the wet wall is where the fixtures are; the middle of the
  // building when there are none yet.
  const wet = onLevel(objects, level).filter((o) => TRADE_SPECS.plumbing.serves.types.includes(o.type) && o.pxX != null)
  const at = wet.length
    ? { x: wet.reduce((s, o) => s + (o.pxX as number), 0) / wet.length, y: wet.reduce((s, o) => s + (o.pxY as number), 0) / wet.length }
    : mid
  const n = nearestWall(ws, at.x, at.y)
  if (!n) return out
  const lenPx = Math.hypot(n.w.x2 - n.w.x1, n.w.y2 - n.w.y1) || 1
  // The heater sits about a metre and a half along the wall from the stack.
  const step = Math.min(0.45, (1.5 / mPerPx) / lenPx)
  if (missing.includes('drain-stack')) put('drain-stack', n.w, n.t, 'Drain stack')
  if (missing.includes('water-heater')) put('water-heater', n.w, n.t + step <= 1 ? n.t + step : n.t - step, 'Water heater')
  return out
}

/**
 * ① What it serves, for HVAC: a supply register under every window — the cold
 * glass is where the heat is lost — and one return in the wall nearest the
 * middle. (Electrical's ① is autoPlaceOutlets; plumbing's fixtures come from
 * the plan, so it has no "for me".)
 */
export function planRegisters(
  walls: readonly ParsedWall[],
  objects: readonly PlacedObject[],
  level: number,
): PlannedObject[] {
  const ws = onLevel(walls, level)
  if (ws.length === 0) return []
  const mid = centroid(ws)
  const here = onLevel(objects, level)
  const out: PlannedObject[] = []
  for (const win of here.filter((o) => o.type === 'window' && o.pxX != null)) {
    const n = nearestWall(ws, win.pxX as number, win.pxY as number)
    if (n) out.push({ type: 'supply-register', ...onFace(n.w, n.t, mid, 6), label: 'Supply register', level })
  }
  // No windows yet: one supply per outside-ish (longest four) wall.
  if (out.length === 0) {
    for (const w of [...ws].sort((a, b) => Math.hypot(b.x2 - b.x1, b.y2 - b.y1) - Math.hypot(a.x2 - a.x1, a.y2 - a.y1)).slice(0, 4)) {
      out.push({ type: 'supply-register', ...onFace(w, 0.5, mid, 6), label: 'Supply register', level })
    }
  }
  if (!here.some((o) => o.type === 'return-grille')) {
    const n = nearestWall(ws, mid.x, mid.y)
    if (n) out.push({ type: 'return-grille', ...onFace(n.w, Math.min(1, n.t + 0.2), mid), label: 'Return', level })
  }
  return out
}

/** A run to add, minus the id the store gives it. */
export type PlannedLine = Omit<TracedLine, 'id'>

const seg = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  ({ x1: Math.round(a.x), y1: Math.round(a.y), x2: Math.round(b.x), y2: Math.round(b.y) })

/** Circuits are split at this many devices — 15A general-purpose practice. */
export const DEVICES_PER_CIRCUIT = 8

/**
 * ③ Run it. Returns the runs to add for this storey, from the source out to
 * everything it serves. Empty when there is no source yet or nothing to serve
 * — the panel says which.
 */
export function planRuns(
  trade: Trade,
  walls: readonly ParsedWall[],
  objects: readonly PlacedObject[],
  level: number,
): PlannedLine[] {
  const ws = onLevel(walls, level) as ParsedWall[]
  const here = onLevel(objects, level).filter((o) => o.pxX != null && o.pxY != null)
  const spec = TRADE_SPECS[trade]
  const pt = (o: PlacedObject) => ({ x: o.pxX as number, y: o.pxY as number })
  const served = here.filter((o) => spec.serves.types.includes(o.type))
  const base = { level, material: '', size: '' }
  if (served.length === 0 || ws.length === 0) return []

  if (trade === 'electrical') {
    const panel = here.find((o) => o.type === 'panel-box')
    if (!panel) return []
    // Nearest first, then cut into circuits; each circuit is a home run from
    // the panel to its first device, then device to device along the walls.
    const byDist = [...served].sort((a, b) =>
      Math.hypot(a.pxX! - panel.pxX!, a.pxY! - panel.pxY!) - Math.hypot(b.pxX! - panel.pxX!, b.pxY! - panel.pxY!))
    const out: PlannedLine[] = []
    for (let i = 0; i < byDist.length; i += DEVICES_PER_CIRCUIT) {
      const group = byDist.slice(i, i + DEVICES_PER_CIRCUIT)
      const hops = routeAlongWalls(group.map((o) => ({ type: o.type, pxX: o.pxX!, pxY: o.pxY! })), ws, { startNear: { pxX: panel.pxX!, pxY: panel.pxY! } })
      const first = hops[0] ? { x: hops[0].x1, y: hops[0].y1 } : pt(group[0])
      const wire = { ...base, size: '15A', material: '14/2 Romex', band: 'in-wall' as const }
      out.push({ ...wire, ...seg(pt(panel), first), elementType: 'Home Run' })
      for (const h of hops) out.push({ ...wire, ...seg({ x: h.x1, y: h.y1 }, { x: h.x2, y: h.y2 }), elementType: 'Circuit Run' })
    }
    return out
  }

  if (trade === 'plumbing') {
    const stack = here.find((o) => o.type === 'drain-stack')
    const heater = here.find((o) => o.type === 'water-heater')
    if (!stack || !heater) return []
    const out: PlannedLine[] = []
    // Drains: each fixture straight to the stack under the floor, sized by
    // what it carries (a toilet takes 3").
    for (const f of served) {
      const rule = PLUMBING_FIXTURES[f.type === 'bathroom-sink' ? 'sink' : f.type === 'bathtub' ? 'tub' : f.type]
      const inches = rule?.drainIn ?? 1.5
      out.push({ ...base, ...seg(pt(f), pt(stack)), elementType: 'Drain Line', size: `${inches === 1.5 ? '1-1/2' : inches}"`, material: 'ABS', band: 'under-floor' })
    }
    // Supply: one hot-and-cold run from the heater along the walls to each
    // fixture in turn (the supply line draws as the pair).
    const hops = routeAlongWalls(served.map((o) => ({ type: o.type, pxX: o.pxX!, pxY: o.pxY! })), ws, { startNear: { pxX: heater.pxX!, pxY: heater.pxY! } })
    const first = hops[0] ? { x: hops[0].x1, y: hops[0].y1 } : pt(served[0])
    const supply = { ...base, elementType: 'Supply Line', size: '1/2"', material: 'PEX', band: 'in-wall' as const }
    out.push({ ...supply, ...seg(pt(heater), first), size: '3/4"' })
    for (const h of hops) out.push({ ...supply, ...seg({ x: h.x1, y: h.y1 }, { x: h.x2, y: h.y2 }) })
    return out
  }

  // HVAC: a branch from the furnace to each supply register, the return back.
  const furnace = here.find((o) => o.type === 'furnace')
  if (!furnace) return []
  return served.map((r) => r.type === 'return-grille'
    ? { ...base, ...seg(pt(r), pt(furnace)), elementType: 'Return Duct', size: '12"', material: 'Sheet Metal', band: 'under-floor' as const }
    : { ...base, ...seg(pt(furnace), pt(r)), elementType: 'Branch / Flex', size: '6"', material: 'Flex', band: 'under-floor' as const })
}
