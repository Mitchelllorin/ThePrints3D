/**
 * WHAT IS IN THE POCKET — the wall a pocket door slides into is hollow.
 *
 * The kit's pocket is the door's own width of wall beside the doorway, framed
 * with horizontal slats instead of studs so the slab can slide in. There is no
 * stud to hang a box on and no cavity to run a pipe or a wire through: whatever
 * goes in that stretch of wall either stops the door or gets a screw through it
 * when the board goes on. On the job it is caught at rough-in, when the
 * electrician's box is already nailed where the door has to go.
 *
 * So the app looks for it the moment both exist: any outlet, switch or box on
 * that wall, any fixture backed against it (its supply and drain come up in the
 * wall behind it), and any wire, pipe or duct run that lives in the wall there.
 *
 * Geometry: the door's own +X in the world is (cos r, −sin r) of its yaw —
 * THREE's turn about +Y (see openingSeat, which stores the negated wall angle).
 * framedShiftM gives which way the pocket runs; the pocket is the door's width
 * of wall starting at the doorway's jamb.
 */
import type { Drawing, PlacedObject, TracedLine } from '../types'
import { overlayPixelToWorld, type WallPlanInput } from './wallFramingPlan'
import { getCatalogItem } from '../data/objectCatalog'
import { doorStyle, doorWidthM, framedShiftM } from './doorStyle'

const IN = 0.0254
/** How far off the wall's centreline something still counts as IN the wall —
 *  half a 2×6 wall, plus a box's depth, plus some slop for a hand placement. */
const IN_WALL_M = 0.2
/** The kit runs a little past the slab at the pocket end. */
const KIT_EXTRA_M = 0.5 * IN

/** Boxes and devices that are set IN the wall. */
const IN_WALL_DEVICES = new Set([
  'device-box', 'junction-box', 'duplex-outlet', 'gfci-outlet', 'switch', 'panel-box',
  'drain-stack', 'return-grille',
])
/** Fixtures that stand against a wall and take their water and drain from it. */
const WALL_FED_FIXTURES = new Set([
  'toilet', 'kitchen-sink', 'bathroom-sink', 'washer', 'dishwasher', 'shower', 'bathtub', 'water-heater',
])

const tradeOf = (type: string, wired: boolean): PocketConflict['trade'] =>
  type === 'drain-stack' ? 'plumbing' : type === 'return-grille' ? 'hvac' : wired ? 'electrical' : 'plumbing'

export interface PocketConflict {
  doorId: string
  /** What is in the way, in words — "Duplex Outlet (15A)", "Supply Line". */
  what: string
  trade: 'electrical' | 'plumbing' | 'hvac'
  objectId?: string
  lineId?: string
}

/** A pocket door's pocket, in the door's own frame: along = metres along its
 *  +X from the doorway's centre, across = metres off the wall's centreline. */
function pocketFrame(door: PlacedObject) {
  const w = doorWidthM(door)
  const side = Math.sign(framedShiftM(door)) || -1
  const c = Math.cos(door.rotationY), s = Math.sin(door.rotationY)
  const local = (x: number, z: number) => {
    const dx = x - door.x, dz = z - door.z
    return { along: dx * c - dz * s, across: dx * s + dz * c }
  }
  // The pocket runs from the doorway jamb (w/2) out one door's width.
  const lo = side > 0 ? w / 2 : -(w / 2 + w + KIT_EXTRA_M)
  const hi = side > 0 ? w / 2 + w + KIT_EXTRA_M : -w / 2
  return { local, lo, hi }
}

/**
 * Everything that sits in a pocket door's pocket. `pixelToWorld` places the
 * trade runs, which are drawn on the print; leave it out to check objects only.
 */
export function pocketConflicts(
  placedObjects: readonly PlacedObject[],
  lines: { electrical?: readonly TracedLine[]; plumbing?: readonly TracedLine[]; hvac?: readonly TracedLine[] } = {},
  pixelToWorld?: (px: number, py: number) => { x: number; z: number },
): PocketConflict[] {
  const out: PocketConflict[] = []
  for (const door of placedObjects) {
    if (doorStyle(door) !== 'pocket') continue
    const level = door.level ?? 0
    const { local, lo, hi } = pocketFrame(door)

    for (const o of placedObjects) {
      if (o.id === door.id || (o.level ?? 0) !== level) continue
      const wired = IN_WALL_DEVICES.has(o.type)
      const plumbed = WALL_FED_FIXTURES.has(o.type)
      if (!wired && !plumbed) continue
      const item = getCatalogItem(o.type)
      const halfW = ((item?.defaultW ?? 0.1) * o.scaleX) / 2
      const halfD = ((item?.defaultD ?? 0.1) * o.scaleZ) / 2
      const p = local(o.x, o.z)
      // A fixture's centre stands half its depth off the wall it is backed to.
      const reach = wired ? IN_WALL_M : halfD + IN_WALL_M
      if (Math.abs(p.across) > reach) continue
      if (p.along + halfW < lo || p.along - halfW > hi) continue
      out.push({ doorId: door.id, what: item?.label ?? o.label ?? o.type, trade: tradeOf(o.type, wired), objectId: o.id })
    }

    if (!pixelToWorld) continue
    const runs: [PocketConflict['trade'], readonly TracedLine[] | undefined, string][] = [
      ['electrical', lines.electrical, 'in-wall'],
      ['plumbing', lines.plumbing, 'under-floor'],
      ['hvac', lines.hvac, 'ceiling'],
    ]
    for (const [trade, list, fallback] of runs) {
      for (const l of list ?? []) {
        if ((l.level ?? 0) !== level) continue
        // Only a run that lives IN the wall can be in the pocket; one under the
        // floor or in the ceiling passes below or above it.
        if ((l.band ?? fallback) !== 'in-wall') continue
        const a = pixelToWorld(l.x1, l.y1), b = pixelToWorld(l.x2, l.y2)
        if (segmentHitsPocket(local(a.x, a.z), local(b.x, b.z), lo, hi)) {
          out.push({ doorId: door.id, what: l.elementType || 'Run', trade, lineId: l.id })
        }
      }
    }
  }
  return out
}

/** Does the segment pass through the pocket's strip of wall? Sampled — the
 *  strip is a few feet long and a run is never thinner than a pipe. */
function segmentHitsPocket(
  a: { along: number; across: number }, b: { along: number; across: number }, lo: number, hi: number,
): boolean {
  const n = Math.max(2, Math.ceil(Math.hypot(b.along - a.along, b.across - a.across) / 0.02))
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const along = a.along + (b.along - a.along) * t
    const across = a.across + (b.across - a.across) * t
    if (along >= lo && along <= hi && Math.abs(across) <= IN_WALL_M / 2) return true
  }
  return false
}

/**
 * The same check, straight off the app's state — one place that knows where
 * the trade runs are drawn, so the review and the door's card agree.
 */
export function pocketConflictsIn(state: {
  placedObjects: readonly PlacedObject[]
  electricalLines: readonly TracedLine[]
  plumbingLines: readonly TracedLine[]
  hvacLines: readonly TracedLine[]
  drawings: readonly Drawing[]
  floorplanOverlay: WallPlanInput['overlay']
}): PocketConflict[] {
  if (!state.placedObjects.some((o) => doorStyle(o) === 'pocket')) return []
  const ov = state.floorplanOverlay
  const drawing = state.drawings.find((d) => d.id === ov.drawingId) ?? state.drawings[0]
  const toWorld = drawing
    ? overlayPixelToWorld(ov, drawing.rasterWidth ?? 1400, drawing.rasterHeight ?? 900)
    : undefined
  return pocketConflicts(
    state.placedObjects,
    { electrical: state.electricalLines, plumbing: state.plumbingLines, hvac: state.hvacLines },
    toWorld,
  )
}
