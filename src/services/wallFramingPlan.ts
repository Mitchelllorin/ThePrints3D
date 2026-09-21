/**
 * WHAT EACH WALL IS FRAMED FROM — worked out once, for the model AND the cut list.
 *
 * This all used to live inside LiveWallsLayer: which ends are corners, where
 * the tees land, which door belongs to which wall, how far to extend an end.
 * The 3D model was the only thing that could see the answer, so a cut list had
 * two choices — count the meshes on screen (and lose every wall whose layer is
 * switched off), or work the walls out a second time and drift from the model
 * the first time either copy changed.
 *
 * Neither. The layer and the cut list both call this, so the list is a count of
 * the walls the model stands up, whether or not you are looking at them.
 */
import type { Drawing, PlacedObject, ParsedWall } from '../types'
import { roughOpening } from './roughOpening'
import type { WallFramingOpts, WallOpening } from './framingGeometry'
import { modelWalls } from './modelWalls'
import { teesForWalls } from './wallTees'
import { renderWallThicknessM, wallHeightM, wallFramingSpec } from './constructionCode'
import { getCatalogItem, VERTICAL_CIRCULATION } from '../data/objectCatalog'

export interface WallPlanInput {
  drawings: readonly Drawing[]
  overlay: { drawingId: string | null; scale: [number, number]; rotationDeg: number; position: [number, number] }
  placedObjects: readonly PlacedObject[]
  /** Ceiling height of one storey, metres. */
  ceilingM: number
  /** Floor-to-floor rise, metres. */
  storeyM: number
  framingMaterial: 'wood' | 'steel'
  steelGauge: string
  steelTrackTop: 'shallow' | 'deep' | 'slotted' | 'double'
  steelDeflectionGapMm: number
  studSpacingIn: number
}

export interface WallOpeningAt {
  /** Fraction along the TRACED line, 0..1. */
  t: number
  widthM: number
  type: 'door' | 'window'
  sillM?: number
  heightM?: number
  /** The placed door or window this came from, so it can be found again and
   *  moved by typed position. Absent for stairs and openings read off the print. */
  objectId?: string
}

export interface PlannedWall {
  /** Index in `modelWalls` order — the same index selection and editing use. */
  index: number
  wall: ParsedWall
  level: number
  thicknessM: number
  /** Framed length, metres, corner extensions included. */
  length: number
  /** Where the framed body sits in the world, and which way it faces. */
  cx: number
  cz: number
  angle: number
  isMasonry: boolean
  masonryKind: 'brick' | 'stone' | 'cmu'
  /** Everything buildWallFraming needs except the look (opacity, colour). */
  opts: WallFramingOpts
  /** Openings as fractions of the traced line, for anything that wants them raw. */
  openings: WallOpeningAt[]
}

/** Metres, from print pixels through the overlay — the same transform FloorplanOverlay uses. */
export function overlayPixelToWorld(
  overlay: WallPlanInput['overlay'],
  imageWidth: number,
  imageHeight: number,
): (px: number, py: number) => { x: number; z: number } {
  const [w, d] = overlay.scale
  const r = (overlay.rotationDeg * Math.PI) / 180
  const c = Math.cos(r), s = Math.sin(r)
  return (px, py) => {
    const lx = (px / imageWidth - 0.5) * w
    const lz = (py / imageHeight - 0.5) * d
    // A rotation about +Y, as THREE's applyAxisAngle does it.
    return { x: overlay.position[0] + lx * c + lz * s, z: overlay.position[1] - lx * s + lz * c }
  }
}

/**
 * Wall ENDS that die into another wall's span — the other half of a tee. The
 * wall being met carries the pack (see teesForWalls); the arriving wall has to
 * stop at that wall's face, so this reports, per end, which wall it lands on.
 */
export function teeArrivals(walls: readonly ParsedWall[], tolPx = 6): Array<{ start: number; end: number }> {
  return walls.map((wall, i) => {
    const hit = (ex: number, ey: number): number => {
      for (let j = 0; j < walls.length; j++) {
        if (j === i) continue
        const o = walls[j]
        if ((o.level ?? 0) !== (wall.level ?? 0)) continue
        const dx = o.x2 - o.x1, dy = o.y2 - o.y1
        const len2 = dx * dx + dy * dy
        if (len2 < 1) continue
        const t = ((ex - o.x1) * dx + (ey - o.y1) * dy) / len2
        if (t <= 0.02 || t >= 0.98) continue
        if (Math.hypot(ex - (o.x1 + t * dx), ey - (o.y1 + t * dy)) > tolPx) continue
        return j
      }
      return -1
    }
    return { start: hit(wall.x1, wall.y1), end: hit(wall.x2, wall.y2) }
  })
}

export function planWalls(input: WallPlanInput): PlannedWall[] {
  const { drawings, overlay, placedObjects } = input
  const drawing = drawings.find((d) => d.id === overlay.drawingId) ?? drawings[0] ?? null
  const imageWidth = drawing?.rasterWidth ?? 1400
  const imageHeight = drawing?.rasterHeight ?? 900
  const toWorld = overlayPixelToWorld(overlay, imageWidth, imageHeight)
  const userWalls = modelWalls([...drawings])
  if (userWalls.length === 0) return []
  const walls = userWalls.map((u) => u.wall)

  // Which wall ends meet another wall (shared endpoint, ~4px tolerance) — those
  // are corners, and get extended so the framing joins instead of gapping.
  const key = (x: number, y: number) => `${Math.round(x / 4)},${Math.round(y / 4)}`
  const counts = new Map<string, number>()
  for (const w of walls) {
    for (const k of [key(w.x1, w.y1), key(w.x2, w.y2)]) counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  const tees = teesForWalls(walls)
  const arrivals = teeArrivals(walls)

  // ── Openings: every door and window, assigned to the nearest wall ──
  // Assignment is done in WORLD space from the object's live x/z: that stays
  // correct after a drag-move (which updates x/z but not the cached pixel coords)
  // and uses the same transform as the wall geometry.
  const openings: WallOpeningAt[][] = walls.map(() => [])
  const wsegs = walls.map((w) => {
    const a = toWorld(w.x1, w.y1), b = toWorld(w.x2, w.y2)
    return { ax: a.x, az: a.z, dx: b.x - a.x, dz: b.z - a.z, thick: w.thickness, level: w.level ?? 0 }
  })
  const mPerPx = (overlay.scale[0] / imageWidth + overlay.scale[1] / imageHeight) / 2
  // Nearest wall to a world point. `reach` (m) shifts the match from the wall
  // centreline to a footprint near-edge (stairs/shafts sit edge-on to a wall).
  // `level` confines the match to the object's own storey. Exterior walls carry
  // up plumb and inline, so without it a ground-floor door and the wall directly
  // above it are the same point in XZ.
  const nearestWall = (wx: number, wz: number, reach: number, edgeBias: number, level: number) => {
    let best = -1, bestScore = Infinity, bestT = 0
    wsegs.forEach((s, i) => {
      if (s.level !== level) return
      const len2 = s.dx * s.dx + s.dz * s.dz
      if (len2 < 1e-6) return
      const t = ((wx - s.ax) * s.dx + (wz - s.az) * s.dz) / len2
      if (t < -0.02 || t > 1.02) return
      const perp = Math.hypot(wx - (s.ax + t * s.dx), wz - (s.az + t * s.dz))
      const score = reach > 0 ? Math.abs(perp - reach) : perp
      const thresh = Math.max((s.thick || 8) * 2.5, 28) * mPerPx + edgeBias
      if (score < thresh && score < bestScore) { best = i; bestScore = score; bestT = Math.max(0, Math.min(1, t)) }
    })
    return { best, t: bestT }
  }
  for (const o of placedObjects) {
    if (o.type !== 'door' && o.type !== 'window') continue
    const { best, t } = nearestWall(o.x, o.z, 0, 0, o.level ?? 0)
    if (best < 0) continue
    const item = getCatalogItem(o.type)
    // FRAME THE HOLE, NOT THE DOOR. The object's size is the unit — the leaf,
    // or the window's nominal size — and the framer frames whatever width it
    // is handed as the clear span between the jacks. Handing it the door made
    // every opening two inches tight and framed a pocket door one leaf wide.
    // See roughOpening.
    const ro = roughOpening(
      o.type,
      o.subtype,
      (item?.defaultW ?? 0.9) * o.scaleX,
      (item?.defaultH ?? (o.type === 'door' ? 2.06 : 1.13)) * o.scaleY,
    )
    openings[best].push({
      t,
      objectId: o.id,
      widthM: ro.widthM,
      type: o.type,
      sillM: o.sillM,
      heightM: ro.heightM,
    })
  }
  // Stairs/elevators cut a full-height opening where they sit flush against a
  // wall. They're DEEP, so match by the footprint's near EDGE, not the centre.
  for (const o of placedObjects) {
    if (!VERTICAL_CIRCULATION.has(o.type)) continue
    const item = getCatalogItem(o.type)
    const halfDepth = ((item?.defaultD ?? 1) * o.scaleZ) / 2
    const { best, t } = nearestWall(o.x, o.z, halfDepth, 6 * mPerPx, o.level ?? 0)
    if (best < 0) continue
    openings[best].push({ t, widthM: (item?.defaultW ?? 1) * o.scaleX, type: 'door', sillM: 0, heightM: (item?.defaultH ?? 2.4) * o.scaleY })
  }
  // A DOORWAY OFF THE PRINT IS STILL A DOORWAY. Detected openings frame too;
  // width is measured from the gap's own endpoints through the transform, so it
  // stays right when the scale is unknown or the overlay has moved.
  for (const d of drawings) {
    for (const op of d.parsedOpenings) {
      if (op.type !== 'door' && op.type !== 'window') continue
      const ang = op.angle ?? (op.orientation === 'vertical' ? Math.PI / 2 : 0)
      const hx = (Math.cos(ang) * op.widthPx) / 2
      const hy = (Math.sin(ang) * op.widthPx) / 2
      const a = toWorld(op.x - hx, op.y - hy)
      const b = toWorld(op.x + hx, op.y + hy)
      const c = toWorld(op.x, op.y)
      const widthM = Math.hypot(b.x - a.x, b.z - a.z)
      // A gap that measures to nothing is a detection artefact, not a door.
      if (!(widthM > 0.3)) continue
      // The placed leaf wins over the detected gap it was dropped into.
      if (placedObjects.some((p) => (p.type === 'door' || p.type === 'window') && Math.hypot(p.x - c.x, p.z - c.z) < 0.45)) continue
      const { best, t } = nearestWall(c.x, c.z, 0, 0, d.floorNumber ?? 0)
      if (best < 0) continue
      const item = getCatalogItem(op.type)
      openings[best].push({ t, widthM, type: op.type, heightM: item?.defaultH ?? (op.type === 'door' ? 2.06 : 1.13) })
    }
  }

  const spacingM = input.studSpacingIn * 0.0254
  return userWalls.map(({ wall, scaleMmPerPx }, i) => {
    const thicknessM = renderWallThicknessM(wall, scaleMmPerPx)
    const startCorner = (counts.get(key(wall.x1, wall.y1)) ?? 0) > 1
    const endCorner = (counts.get(key(wall.x2, wall.y2)) ?? 0) > 1
    const a = toWorld(wall.x1, wall.y1)
    const b = toWorld(wall.x2, wall.y2)
    // Extend any end that meets another wall by half the thickness, so the
    // through wall reaches the outside face of the building.
    const rawLen = Math.hypot(b.x - a.x, b.z - a.z) || 1
    const ux = (b.x - a.x) / rawLen, uz = (b.z - a.z) / rawLen
    const ext = thicknessM / 2
    const ax = a.x - (startCorner ? ux * ext : 0), az = a.z - (startCorner ? uz * ext : 0)
    const bx = b.x + (endCorner ? ux * ext : 0), bz = b.z + (endCorner ? uz * ext : 0)
    const length = Math.hypot(bx - ax, bz - az)
    const startOff = startCorner ? ext : 0

    // Cap-plate corner lap: walls on the dominant axis run through, the
    // perpendicular walls butt into them.
    const capMode: 'lap' | 'back' = Math.abs(ux) >= Math.abs(uz) ? 'lap' : 'back'
    // A tee arrival stops at the face of the wall it lands on.
    const hostHalf = (j: number) => (j >= 0 ? renderWallThicknessM(walls[j], userWalls[j].scaleMmPerPx) / 2 : 0)
    const endTrim = {
      start: !startCorner ? hostHalf(arrivals[i].start) : 0,
      end: !endCorner ? hostHalf(arrivals[i].end) : 0,
    }

    const spec = wall.framingType ? wallFramingSpec(wall.framingType, wall.wallRole) : null
    const wallOpenings: WallOpening[] = openings[i].map((o) => ({
      // Positions are fractions of the TRACED line; the framed wall starts
      // half a thickness earlier at a corner.
      centerM: startOff + o.t * rawLen, widthM: o.widthM, type: o.type, sillM: o.sillM, heightM: o.heightM,
    }))
    const isMasonry = wall.wallType === 'masonry-thick' || wall.framingType === 'cmu'
    const ex = wall.exteriorMaterial
    return {
      index: i,
      wall,
      level: wall.level ?? 0,
      thicknessM,
      length,
      cx: (ax + bx) / 2,
      cz: (az + bz) / 2,
      angle: Math.atan2(bz - az, bx - ax),
      isMasonry,
      masonryKind: ex === 'brick' || ex === 'exposedBrick' ? 'brick' : ex === 'stone' ? 'stone' : 'cmu',
      openings: openings[i],
      opts: {
        length,
        height: wallHeightM(wall, input.ceilingM, input.storeyM),
        thickness: thicknessM,
        spacingM,
        material: spec ? spec.material : input.framingMaterial,
        heavyDuty: wall.wallRole === 'exterior-bearing' || wall.wallRole === 'interior-bearing',
        steelGauge: spec?.gauge ?? input.steelGauge,
        topTrackStyle: input.steelTrackTop === 'double' ? 'deep' : input.steelTrackTop,
        deflectionGapMm: input.steelTrackTop === 'slotted' ? input.steelDeflectionGapMm : 0,
        openings: wallOpenings,
        capLap: { start: startCorner ? capMode : undefined, end: endCorner ? capMode : undefined },
        tees: tees[i].map((t) => startOff + t * rawLen),
        packs: (wall.studPacks ?? []).map((p) => ({ atM: startOff + p.atFrac * rawLen, studs: p.studs })),
        endTrim: endTrim.start || endTrim.end ? endTrim : undefined,
      },
    }
  })
}
