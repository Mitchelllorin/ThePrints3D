/**
 * framingGeometry — shared stud-framing geometry so the live trace preview and
 * the built model draw the SAME studs and plates (never solid boxes).
 *
 * Produces a wall's stud cage centred on the origin along X (−L/2 … +L/2),
 * sitting on the floor (Y 0 … height). The caller positions/rotates the group
 * to seat it on the traced wall — exactly where the solid box used to go.
 *
 * Real-world detail modelled: double bottom plate + double top plate, studs at
 * 16" OC, doubled end studs (corner/end posts, so perpendicular walls read as
 * connected), and a mid-height row of blocking between studs.
 */
import * as THREE from 'three'
import { joistProfile } from '../data/traceLayers'

const STUD_WIDTH_M = 0.038    // 1-1/2" nominal stud face
const PLATE_H_M = 0.038       // one plate's thickness
const STUD_SPACING_M = 0.4064 // 16" on-centre

/** Block face size on the wall (~16") — texture tile size. */
export const BLOCK_TILE_M = 0.4

export type MasonryKind = 'brick' | 'cmu' | 'stone'

// Per-kind running-bond texture with per-unit colour variation + thin mortar so
// it reads like real masonry, not a flat cartoon. One tile ≈ 0.8m × 0.4m.
const _masonryTex: Partial<Record<MasonryKind, THREE.Texture>> = {}
const clamp255 = (v: number) => Math.max(0, Math.min(255, Math.round(v)))

function masonryTexture(kind: MasonryKind): THREE.Texture | null {
  if (_masonryTex[kind]) return _masonryTex[kind]!
  if (typeof document === 'undefined') return null
  const W = 512, H = 256
  const c = document.createElement('canvas'); c.width = W; c.height = H
  const ctx = c.getContext('2d'); if (!ctx) return null
  // Unit grid, base colour, colour jitter, mortar colour + joint width by kind.
  const cfg = kind === 'brick'
    ? { cols: 4, rows: 6, base: [0x9c, 0x4a, 0x38], jit: 20, mortar: '#cabfa8', gap: 5 }
    : kind === 'stone'
      ? { cols: 3, rows: 4, base: [0x8c, 0x88, 0x7e], jit: 34, mortar: '#b8b1a3', gap: 6 }
      : { cols: 2, rows: 2, base: [0x95, 0x91, 0x88], jit: 16, mortar: '#73726f', gap: 9 } // cmu
  ctx.fillStyle = cfg.mortar
  ctx.fillRect(0, 0, W, H)
  const uw = W / cfg.cols, uh = H / cfg.rows
  for (let r = 0; r < cfg.rows; r++) {
    const off = (r % 2) ? uw / 2 : 0               // running bond
    for (let i = -1; i < cfg.cols; i++) {
      const j = (Math.random() * 2 - 1) * cfg.jit
      ctx.fillStyle = `rgb(${clamp255(cfg.base[0] + j)},${clamp255(cfg.base[1] + j)},${clamp255(cfg.base[2] + j)})`
      ctx.fillRect(i * uw + off + cfg.gap / 2, r * uh + cfg.gap / 2, uw - cfg.gap, uh - cfg.gap)
    }
  }
  const tex = new THREE.CanvasTexture(c)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  _masonryTex[kind] = tex
  return tex
}

/** Back-compat: the default masonry texture (CMU). */
export function blockTexture(): THREE.Texture | null { return masonryTexture('cmu') }

const MASONRY_BASE: Record<MasonryKind, string> = { brick: '#8a4636', cmu: '#8f8b82', stone: '#8a867c' }
const TILE_W_M = 0.8, TILE_H_M = 0.4

/** Masonry-faced material (brick/CMU/stone) tiled to a wall face's size. */
export function blockMaterial(faceLengthM: number, faceHeightM: number, opacity = 1, kind: MasonryKind = 'cmu'): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    color: new THREE.Color(MASONRY_BASE[kind]), roughness: 0.95, metalness: 0,
    transparent: opacity < 1, opacity,
  })
  const tex = masonryTexture(kind)
  if (tex) {
    const t = tex.clone(); t.needsUpdate = true
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.repeat.set(Math.max(1, faceLengthM / TILE_W_M), Math.max(1, faceHeightM / TILE_H_M))
    m.map = t
  }
  return m
}

export interface WallFramingOpts {
  /** Wall run length, metres. */
  length: number
  /** Wall height, metres (floor to top of the upper top plate). */
  height: number
  /** Wall thickness, metres (stud depth). */
  thickness: number
  /** Stud on-centre spacing, metres. Defaults to 16" OC. */
  spacingM?: number
  /** Framing material — drives colour/finish: tan lumber vs silvery steel. */
  material?: 'wood' | 'steel'
  /** Heavy-duty / exterior steel: threads a cold-rolled carrying channel
   *  through the knockouts. Interior 25ga steel leaves the knockouts empty. */
  heavyDuty?: boolean
  /** Steel gauge ('25'|'20'|'18'|'16'|'12'). Lower = heavier steel → a visibly
   *  beefier stud. Ignored for wood. */
  steelGauge?: string
  /** Top track profile: 'shallow' | 'deep' | 'slotted' (deep slotted-deflection)
   *  | 'double'. The bottom track is always a shallow floor track. Steel only. */
  topTrackStyle?: 'shallow' | 'deep' | 'slotted' | 'double'
  /** Slotted-deflection gap (mm) left between the stud top and the top-track web
   *  so the structure can deflect without loading the wall. Steel only. */
  deflectionGapMm?: number
  /** Lumber colour override. */
  color?: string
  /** 0–1; < 1 renders translucent (used for the ghost preview). */
  opacity?: number
  /** Door/window rough openings to frame into this wall. `centerM` is the
   *  opening centre measured from the wall START (0..length); `widthM` is the
   *  rough-opening width. Studs are dropped through the opening and replaced with
   *  king + jack studs, a header, cripples (and a sill for windows). */
  openings?: WallOpening[]
}

export interface WallOpening {
  centerM: number
  widthM: number
  type: 'door' | 'window'
  /** Window sill height (m AFF). Doors ignore it. Defaults to ~0.9m. */
  sillM?: number
  /** Opening height (m). Door ≈ 2.06, window ≈ 1.13 by default. */
  heightM?: number
}

/**
 * Build the stud cage for one wall: 2 bottom plates, 2 top plates, studs at
 * spacing with doubled end posts, and a mid-height blocking row.
 * Returns a THREE.Group the caller positions and rotates.
 */
export function buildWallFraming(opts: WallFramingOpts): THREE.Group {
  const {
    length,
    height,
    thickness,
    spacingM = STUD_SPACING_M,
    material = 'wood',
    heavyDuty = false,
    steelGauge = '25',
    topTrackStyle = 'deep',
    deflectionGapMm = 0,
    opacity = 1,
    openings = [],
  } = opts

  const group = new THREE.Group()
  if (length < 0.02 || height < 0.05) return group

  const steel = material === 'steel'
  // Heavier gauge (lower number) → a visibly beefier stud face.
  const GAUGE_SCALE: Record<string, number> = { '25': 1, '20': 1.06, '18': 1.14, '16': 1.24, '12': 1.42 }
  const studW = steel ? STUD_WIDTH_M * (GAUGE_SCALE[steelGauge] ?? 1) : STUD_WIDTH_M
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(opts.color ?? (steel ? '#d2d6dc' : '#c9a56c')),  // bright galvanized silver
    roughness: steel ? 0.22 : 0.75,
    metalness: steel ? 0.95 : 0.05,
    transparent: opacity < 1,
    opacity,
    // Ghost (semi-transparent) studs must NOT write depth, or the many
    // overlapping thin boxes z-fight and the opening framing "falls apart"
    // depending on camera angle. Opaque (built) walls keep depth writes.
    depthWrite: opacity >= 1,
  })
  const depth = Math.max(STUD_WIDTH_M, thickness)
  const sizeLabel = thickness >= 0.18 ? '2×8' : thickness >= 0.13 ? '2×6' : '2×4'
  const framingInfo = steel ? `${steelGauge}ga steel stud` : `${sizeLabel} wood stud`
  const add = (geo: THREE.BufferGeometry, x: number, y: number, z = 0) => {
    const m = new THREE.Mesh(geo, mat)
    m.position.set(x, y, z)
    m.castShadow = true
    m.receiveShadow = true
    m.userData.layer = 'framing'
    m.userData.info = framingInfo
    group.add(m)
  }

  // Plates/track differ by material:
  //   Wood  → double bottom plate + double top plate (studs run full height).
  //   Steel → real U-shaped tracks the studs NEST INTO: a shallow floor track
  //           at the bottom (opens up) and a deep / slotted-deflection track at
  //           the top (opens down). The track legs wrap the OUTSIDE of the studs.
  const SHEET_T = 0.012   // rendered sheet thickness of track web + legs
  const studDepth = steel ? Math.max(0.02, depth - 2 * SHEET_T) : depth
  let studBottom = 0
  let studTop = height
  if (steel) {
    const botLegH = 0.032   // shallow floor track legs (~1-1/4")
    const topLegH = topTrackStyle === 'shallow' ? 0.032
      : topTrackStyle === 'slotted' ? 0.076   // deep slotted-deflection track
      : 0.064                                  // standard deep-leg track
    const legZ = depth / 2 - SHEET_T / 2
    // Bottom track — web on the floor, two legs rising (channel opens up).
    add(new THREE.BoxGeometry(length, SHEET_T, depth), 0, SHEET_T / 2, 0)
    add(new THREE.BoxGeometry(length, botLegH, SHEET_T), 0, SHEET_T + botLegH / 2, legZ)
    add(new THREE.BoxGeometry(length, botLegH, SHEET_T), 0, SHEET_T + botLegH / 2, -legZ)
    // Top track — web at the ceiling, two legs descending (channel opens down).
    add(new THREE.BoxGeometry(length, SHEET_T, depth), 0, height - SHEET_T / 2, 0)
    add(new THREE.BoxGeometry(length, topLegH, SHEET_T), 0, height - SHEET_T - topLegH / 2, legZ)
    add(new THREE.BoxGeometry(length, topLegH, SHEET_T), 0, height - SHEET_T - topLegH / 2, -legZ)
    // Studs seat on the bottom-track web and rise to just under the top-track
    // web; a slotted track leaves a deflection gap so the stud isn't pinned.
    studBottom = SHEET_T
    studTop = height - SHEET_T - deflectionGapMm / 1000
  } else {
    const plateGeo = new THREE.BoxGeometry(length, PLATE_H_M, depth)
    add(plateGeo, 0, PLATE_H_M / 2, 0)            // sole plate
    add(plateGeo, 0, PLATE_H_M * 1.5, 0)          // 2nd bottom plate
    add(plateGeo, 0, height - PLATE_H_M / 2, 0)   // upper top plate
    add(plateGeo, 0, height - PLATE_H_M * 1.5, 0) // lower top plate
  }

  const studH = Math.max(0.02, studTop - studBottom)
  const studY = studBottom + studH / 2
  const studGeo = new THREE.BoxGeometry(studW, studH, studDepth)

  const half = length / 2

  // Rough openings, mapped to local-centred X and clamped to the wall. Only
  // openings that fully fit (with a stud-pack margin at each end) are framed.
  const ops = openings
    .map((o) => ({ type: o.type, x: o.centerM - half, w: Math.min(o.widthM, length - 0.2), sillM: o.sillM, heightM: o.heightM }))
    .filter((o) => o.w > 0.1 && o.x - o.w / 2 > -half + studW * 2 && o.x + o.w / 2 < half - studW * 2)
  // A regular stud / blocking span is "in the clear" (dropped) if it falls inside
  // an opening's rough span — king/jack studs are added back at the edges.
  const inClear = (x: number) => ops.some((o) => x > o.x - o.w / 2 - studW * 0.5 && x < o.x + o.w / 2 + studW * 0.5)

  const xs: number[] = []
  for (let x = -half; x < half - 1e-4; x += spacingM) xs.push(Math.round(x * 1000) / 1000)
  xs.push(half)
  // Doubled end posts: an extra stud just inside each end (corner/end packs).
  const endInset = studW
  xs.push(-half + endInset, half - endInset)

  const seen = new Set<number>()
  for (const x of xs) {
    const key = Math.round(x * 1000)
    if (seen.has(key)) continue
    seen.add(key)
    if (inClear(x)) continue   // no studs through a rough opening
    add(studGeo, Math.max(-half, Math.min(half, x)), studY)
  }

  const ordered = [...seen].map((k) => k / 1000).sort((a, b) => a - b)
  const midY = studBottom + studH / 2
  if (steel) {
    // Steel studs are punched with knockouts at 2', 4' and 6'. A cold-rolled
    // carrying channel runs through them ONLY on heavy-duty / exterior walls;
    // typical interior 25ga leaves them empty. No wood blocking.
    const koMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#0b0f17'), roughness: 1, metalness: 0,
      transparent: opacity < 1, opacity,
    })
    const koGeo = new THREE.CylinderGeometry(studW * 0.32, studW * 0.32, studDepth + 0.006, 10)
    const koHeights = [0.610, 1.219, 1.829, 2.438].filter((h) => h > studBottom + 0.05 && h < studTop - 0.05)
    for (const x of ordered) {
      for (const h of koHeights) {
        const m = new THREE.Mesh(koGeo, koMat)
        m.position.set(x, h, 0)
        m.rotation.x = Math.PI / 2  // bore through the web (along depth)
        m.userData.layer = 'framing'
        group.add(m)
      }
    }
    if (heavyDuty) {
      // Cold-rolled carrying channel runs through the knockouts at 4' and 8'.
      for (const h of [1.219, 2.438].filter((y) => y > studBottom + 0.05 && y < studTop - 0.05)) {
        add(new THREE.BoxGeometry(length, studW * 0.7, studDepth * 0.55), 0, h, 0)
      }
    }
  } else {
    // Wood: solid blocking between consecutive studs at mid-height.
    for (let i = 0; i < ordered.length - 1; i++) {
      const gap = ordered[i + 1] - ordered[i]
      const span = gap - STUD_WIDTH_M
      if (span < 0.04) continue
      const mid = (ordered[i] + ordered[i + 1]) / 2
      if (inClear(mid)) continue   // no blocking across a rough opening
      add(new THREE.BoxGeometry(span, STUD_WIDTH_M, depth), mid, midY)
    }
  }

  // ── Rough-opening framing: king + jack studs, header, cripples, sill ────────
  // Modelled like a real rough opening so placing a door/window reads as "frame
  // the opening first" — exactly how it'd be built on site.
  for (const op of ops) {
    const isDoor = op.type === 'door'
    const hw = op.w / 2
    // Rough-opening bottom (floor for doors, sill for windows) and top, from the
    // opening's own sill/height, clamped so low ceilings still frame sanely.
    const sill = isDoor ? 0 : (op.sillM ?? 0.9)
    const oh = op.heightM ?? (isDoor ? 2.06 : 1.13)
    const roBot = isDoor ? studBottom : Math.min(studBottom + sill, studTop - studW - 0.3)
    const roTop = Math.min(roBot + oh, studTop - studW)
    // Wood openings get a beefy LVL header; steel keeps the slimmer box beam.
    const headerDepth = steel ? 0.18 : 0.235

    // King studs — full height, just outside the opening.
    for (const s of [-1, 1]) add(studGeo, op.x + s * (hw + studW * 1.5), studY)

    // Jack studs — carry the header, from the floor up to the header.
    const jackH = Math.max(0.05, roTop - studBottom)
    const jackGeo = new THREE.BoxGeometry(studW, jackH, studDepth)
    for (const s of [-1, 1]) add(jackGeo, op.x + s * (hw + studW * 0.5), studBottom + jackH / 2)

    // Header spanning the opening, sitting on the jacks.
    add(new THREE.BoxGeometry(op.w + studW * 2, headerDepth, studDepth), op.x, roTop + headerDepth / 2)

    // Cripple studs above the header up to the top plate/track.
    const cripBot = roTop + headerDepth
    if (studTop - cripBot > 0.05) {
      const ch = studTop - cripBot
      const cripGeo = new THREE.BoxGeometry(studW, ch, studDepth)
      for (let cx = op.x - hw + spacingM; cx < op.x + hw; cx += spacingM) add(cripGeo, cx, cripBot + ch / 2)
    }

    // Windows also get a sill + cripples down to the bottom plate.
    if (!isDoor) {
      add(new THREE.BoxGeometry(op.w + studW * 2, studW, studDepth), op.x, roBot - studW / 2)
      const sbH = roBot - studW - studBottom
      if (sbH > 0.05) {
        const sillGeo = new THREE.BoxGeometry(studW, sbH, studDepth)
        for (let cx = op.x - hw + spacingM; cx < op.x + hw; cx += spacingM) add(sillGeo, cx, studBottom + sbH / 2)
      }
    }
  }

  return group
}

// ── Drywall boarding ─────────────────────────────────────────────────────────

// ── Masonry (CMU/brick) wall with openings ──────────────────────────────────

/**
 * Solid block/brick wall built as segments AROUND any door/window openings —
 * full-height piers between openings, a lintel course above each opening, and a
 * sill course below windows — so doors/windows cut a real hole through masonry
 * (which has no studs to frame). Centred on origin along X like buildWallFraming.
 */
export function buildMasonryWall(opts: {
  length: number; height: number; thickness: number
  openings?: WallOpening[]; opacity?: number; kind?: MasonryKind
}): THREE.Group {
  const { length, height, thickness, openings = [], opacity = 1, kind = 'cmu' } = opts
  const g = new THREE.Group()
  if (length < 0.05 || height < 0.05) return g
  const depth = Math.max(0.05, thickness)
  const half = length / 2
  const add = (w: number, h: number, cx: number, cy: number) => {
    if (w < 0.02 || h < 0.02) return
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, depth), blockMaterial(w, h, opacity, kind))
    m.position.set(cx, cy, 0)
    m.castShadow = true
    m.receiveShadow = true
    m.userData.layer = 'walls'
    g.add(m)
  }

  const ops = openings
    .map((o) => {
      const x = o.centerM - half
      const w = Math.min(o.widthM, length)
      const isDoor = o.type === 'door'
      const sill = isDoor ? 0 : (o.sillM ?? 0.9)
      const oh = o.heightM ?? (isDoor ? 2.06 : 1.13)
      const roBot = isDoor ? 0 : Math.min(sill, height - 0.3)
      const roTop = Math.min(roBot + oh, height - 0.05)
      return { x0: x - w / 2, x1: x + w / 2, roBot, roTop }
    })
    .filter((o) => o.x1 > -half + 0.02 && o.x0 < half - 0.02 && o.roTop > o.roBot)
    .sort((a, b) => a.x0 - b.x0)

  if (ops.length === 0) { add(length, height, 0, height / 2); return g }

  let cursor = -half
  for (const o of ops) {
    const lo = Math.max(-half, o.x0), hi = Math.min(half, o.x1)
    if (lo - cursor > 0.02) add(lo - cursor, height, (cursor + lo) / 2, height / 2)  // pier before
    if (height - o.roTop > 0.02) add(hi - lo, height - o.roTop, (lo + hi) / 2, (o.roTop + height) / 2)  // lintel above
    if (o.roBot > 0.02) add(hi - lo, o.roBot, (lo + hi) / 2, o.roBot / 2)  // sill course below (windows)
    cursor = Math.max(cursor, hi)
  }
  if (half - cursor > 0.02) add(half - cursor, height, (cursor + half) / 2, height / 2)  // pier after
  return g
}

// ── Floor joists ─────────────────────────────────────────────────────────────

/**
 * A floor's joist field for a traced rectangle: common joists spanning the
 * SHORTER side, repeated at on-centre spacing along the longer side, plus an
 * outer joist flush to each long edge and a rim/band joist capping each end.
 *
 * Built centred on origin in the XZ plane; joists hang just below y=0 so their
 * tops sit at the floor plane. The caller positions/rotates the group onto the
 * traced floor area (centre + overlay yaw), exactly like the wall layers.
 */
/** Floor-element names that build a concrete slab instead of a joist field. */
export const FLOOR_SLAB_TYPES = new Set(['Concrete Slab'])
export const SUBFLOOR_T = 0.019   // 3/4" plywood subfloor sheathing
export const SLAB_T = 0.102       // 4" concrete slab-on-grade
/** Floor-assembly height (joists + subfloor) — the rise a floor adds on top of
 *  the walls below, so a 2nd-floor deck rests ON the lower wall's top plate. */
export const FLOOR_ASSEMBLY_H = 0.32

/**
 * Joist field (or concrete slab) for a traced floor rectangle, built centred on
 * the ORIGIN in Y (members straddle y=0). The caller seats it at the right
 * height and renders the joists and the subfloor DECK as SEPARATE children, so
 * the explode view lifts the sheets cleanly off the joists.
 */
/** A rectangular opening in a floor, in the area's LOCAL centred coords (metres):
 *  centre (x,z) and size (w,d). Used to frame a stairwell/shaft through the deck. */
export interface FloorHole { x: number; z: number; w: number; d: number }

export function buildFloorJoists(opts: {
  lenX: number; lenZ: number; element: string; ocM: number; opacity?: number; holes?: FloorHole[]
}): THREE.Group {
  const { lenX, lenZ, element, ocM, opacity = 1, holes = [] } = opts
  const g = new THREE.Group()
  if (lenX < 0.1 || lenZ < 0.1) return g

  // Concrete slab-on-grade — one slab centred on y=0 (caller drops it so the top
  // sits at grade). Rebar + in-floor radiant PEX are later detail.
  if (FLOOR_SLAB_TYPES.has(element)) {
    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(lenX, SLAB_T, lenZ),
      new THREE.MeshStandardMaterial({ color: new THREE.Color('#b9bcc2'), roughness: 0.95, metalness: 0, transparent: opacity < 1, opacity }),
    )
    slab.castShadow = true; slab.receiveShadow = true
    slab.userData.layer = 'floors'
    slab.userData.info = 'Concrete slab · 4"'
    g.add(slab)
    return g
  }

  const { width, depth, color } = joistProfile(element)
  const oc = Math.max(0.2, ocM)
  const ocIn = Math.round(oc / 0.0254)
  const joistInfo = `${element} · ${ocIn}" OC`
  const joistMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(color), roughness: 0.72, metalness: 0,
    transparent: opacity < 1, opacity,
  })
  const addJoist = (w: number, d: number, x: number, z: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, depth, d), joistMat)
    m.position.set(x, 0, z)
    m.castShadow = true; m.receiveShadow = true
    m.userData.layer = 'floors'
    m.userData.info = joistInfo
    g.add(m)
  }
  // Joists span the shorter dimension; the row of them runs along the longer.
  const spanAlongX = lenX <= lenZ
  const spanLen = spanAlongX ? lenX : lenZ   // each joist's length
  const runLen  = spanAlongX ? lenZ : lenX   // span the row of joists covers
  const halfRun = runLen / 2
  // Common joists at OC, plus an outer joist flush to each long edge.
  const positions: number[] = [-halfRun + width / 2, halfRun - width / 2]
  for (let p = -halfRun + width / 2; p < halfRun - width / 2; p += oc) positions.push(p)
  // Each hole, mapped to (span-range s0..s1, run-range p0..p1) for this orientation.
  const spanHalf = spanLen / 2
  const mapped = holes.map((h) => spanAlongX
    ? { s0: h.x - h.w / 2, s1: h.x + h.w / 2, p0: h.z - h.d / 2, p1: h.z + h.d / 2 }
    : { s0: h.z - h.d / 2, s1: h.z + h.d / 2, p0: h.x - h.w / 2, p1: h.x + h.w / 2 })
  // A joist segment from a→b along the span axis at run-position p.
  const addJoistSeg = (p: number, a: number, b: number) => {
    if (b - a < 0.05) return
    const mid = (a + b) / 2, len = b - a
    if (spanAlongX) addJoist(len, width, mid, p)
    else            addJoist(width, len, p, mid)
  }
  for (const p of positions) {
    // Span-axis cuts from any hole whose run-range straddles this joist.
    const cuts = mapped
      .filter((m) => p > m.p0 && p < m.p1)
      .map((m) => [Math.max(-spanHalf, m.s0), Math.min(spanHalf, m.s1)] as [number, number])
      .filter(([a, b]) => b > a)
      .sort((a, b) => a[0] - b[0])
    if (cuts.length === 0) { addJoistSeg(p, -spanHalf, spanHalf); continue }
    let cursor = -spanHalf
    for (const [a, b] of cuts) { addJoistSeg(p, cursor, a); cursor = Math.max(cursor, b) }
    addJoistSeg(p, cursor, spanHalf)
  }
  // Rim/band joists capping the joist ends (perpendicular to the joists).
  for (const s of [-1, 1]) {
    const e = s * (spanLen / 2 - width / 2)
    if (spanAlongX) addJoist(width, runLen, e, 0)
    else            addJoist(runLen, width, 0, e)
  }
  // Headers/trimmers framing each opening (doubled members along the run axis at
  // the span edges of the hole) — how a real stairwell is framed.
  for (const m of mapped) {
    const runLenH = m.p1 - m.p0
    if (runLenH < 0.05) continue
    for (const s of [m.s0, m.s1]) {
      if (spanAlongX) addJoist(width, runLenH, s, (m.p0 + m.p1) / 2)
      else            addJoist(runLenH, width, (m.p0 + m.p1) / 2, s)
    }
  }

  // Galvanised joist hangers — a shiny metal saddle at each joist-to-rim
  // connection (bottom seat + two side flanges hugging the joist end).
  const hangerMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#cdd2d9'), roughness: 0.25, metalness: 0.9,
    transparent: opacity < 1, opacity,
  })
  const HSEAT = 0.008, HFLANGE = 0.005, HDEPTH = 0.05
  const half = spanLen / 2
  const addHanger = (w: number, h: number, d: number, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), hangerMat)
    m.position.set(x, y, z)
    m.castShadow = true
    m.userData.layer = 'floors'
    m.userData.info = 'Joist hanger (galv.)'
    g.add(m)
  }
  for (const p of positions) {
    for (const s of [-1, 1]) {
      const end = s * half
      if (spanAlongX) {
        addHanger(HDEPTH, HSEAT, width + 2 * HFLANGE, end - s * HDEPTH / 2, -depth / 2 - HSEAT / 2, p)
        for (const sj of [-1, 1]) addHanger(HDEPTH, depth * 0.8, HFLANGE, end - s * HDEPTH / 2, -depth * 0.1, p + sj * (width / 2 + HFLANGE / 2))
      } else {
        addHanger(width + 2 * HFLANGE, HSEAT, HDEPTH, p, -depth / 2 - HSEAT / 2, end - s * HDEPTH / 2)
        for (const sj of [-1, 1]) addHanger(HFLANGE, depth * 0.8, HDEPTH, p + sj * (width / 2 + HFLANGE / 2), -depth * 0.1, end - s * HDEPTH / 2)
      }
    }
  }
  return g
}

/**
 * The plywood subfloor DECK for a traced floor rectangle, as individual 4'×8'
 * sheets with visible joints — staggered (running-bond) courses with the long
 * side running across the joists, partial cut sheets at the edges. Centred on
 * y=0; the caller seats it just above the joists. The sheet COUNT is stashed on
 * `group.userData.sheetCount` for the material takeoff / nameplate.
 */
export function buildFloorDeck(opts: { lenX: number; lenZ: number; opacity?: number; holes?: FloorHole[] }): THREE.Group {
  const g = new THREE.Group()
  const { lenX, lenZ, opacity = 1, holes = [] } = opts
  if (lenX < 0.1 || lenZ < 0.1) { g.userData.sheetCount = 0; return g }
  // A sheet is dropped if it overlaps any opening, leaving a clean gap over it.
  const inHole = (x0: number, z0: number, x1: number, z1: number) =>
    holes.some((h) => x0 < h.x + h.w / 2 && x1 > h.x - h.w / 2 && z0 < h.z + h.d / 2 && z1 > h.z - h.d / 2)
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#caa66e'), roughness: 0.85, metalness: 0,
    transparent: opacity < 1, opacity,
  })
  // 8' (long) side runs along the longer dimension; 4' (short) across it.
  const longAlongX = lenX >= lenZ
  const sw = longAlongX ? SHEET_LONG : SHEET_SHORT
  const sl = longAlongX ? SHEET_SHORT : SHEET_LONG
  const halfX = lenX / 2, halfZ = lenZ / 2
  let count = 0, row = 0
  for (let z = -halfZ; z < halfZ - 0.02; z += sl + SHEET_GAP, row++) {
    const d = Math.min(sl, halfZ - z)
    const stagger = (row % 2 === 1) ? -sw / 2 : 0   // running-bond stagger
    for (let x = -halfX + stagger; x < halfX - 0.02; x += sw + SHEET_GAP) {
      const x0 = Math.max(-halfX, x)
      const w = Math.min(x + sw, halfX) - x0
      if (w < 0.05 || d < 0.05) continue
      if (inHole(x0, z, x0 + w, z + d)) continue   // leave the opening clear
      const sheet = new THREE.Mesh(new THREE.BoxGeometry(w - SHEET_GAP, SUBFLOOR_T, d - SHEET_GAP), mat)
      sheet.position.set(x0 + w / 2, 0, z + d / 2)
      sheet.castShadow = true; sheet.receiveShadow = true
      sheet.userData.layer = 'floor-sheeting'
      sheet.userData.info = 'Subfloor · 3/4" ply · 4×8'
      g.add(sheet); count++
    }
  }
  g.userData.sheetCount = count
  return g
}

// ── Ceiling (joists + drywall) ───────────────────────────────────────────────

const CEILING_JOIST = { width: 0.038, depth: 0.184, color: '#d8c08a' }   // ≈ 2×8
const CEILING_GYP_T = 0.0127   // 1/2" ceiling drywall

/** Ceiling-joist section depth (m) — so the layer can seat it on the wall plate. */
export const CEILING_JOIST_DEPTH = CEILING_JOIST.depth

/**
 * A ceiling: a joist field (centred on y=0) with a gypsum board hung just below.
 * No hangers — ceiling joists bear on the wall top plate. The caller seats the
 * group so the joist BOTTOMS rest on the wall top and the drywall faces the room.
 */
export function buildCeiling(opts: { lenX: number; lenZ: number; ocM: number; opacity?: number }): THREE.Group {
  const { lenX, lenZ, ocM, opacity = 1 } = opts
  const g = new THREE.Group()
  if (lenX < 0.1 || lenZ < 0.1) return g
  const { width, depth, color } = CEILING_JOIST
  const oc = Math.max(0.2, ocM)
  const joistMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(color), roughness: 0.75, metalness: 0, transparent: opacity < 1, opacity,
  })
  const addJoist = (w: number, d: number, x: number, z: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, depth, d), joistMat)
    m.position.set(x, 0, z)
    m.castShadow = true; m.receiveShadow = true
    m.userData.layer = 'ceiling'
    m.userData.info = 'Ceiling joist'
    g.add(m)
  }
  const spanAlongX = lenX <= lenZ
  const spanLen = spanAlongX ? lenX : lenZ
  const runLen = spanAlongX ? lenZ : lenX
  const halfRun = runLen / 2
  const positions: number[] = [-halfRun + width / 2, halfRun - width / 2]
  for (let p = -halfRun + width / 2; p < halfRun - width / 2; p += oc) positions.push(p)
  for (const p of positions) {
    if (spanAlongX) addJoist(spanLen, width, 0, p)
    else            addJoist(width, spanLen, p, 0)
  }
  for (const s of [-1, 1]) {
    const e = s * (spanLen / 2 - width / 2)
    if (spanAlongX) addJoist(width, runLen, e, 0)
    else            addJoist(runLen, width, 0, e)
  }
  const board = new THREE.Mesh(
    new THREE.BoxGeometry(lenX, CEILING_GYP_T, lenZ),
    new THREE.MeshStandardMaterial({ color: new THREE.Color('#ece9e4'), roughness: 0.95, metalness: 0, transparent: opacity < 1, opacity }),
  )
  board.position.set(0, -depth / 2 - CEILING_GYP_T / 2, 0)
  board.castShadow = true; board.receiveShadow = true
  board.userData.layer = 'ceiling'
  board.userData.info = 'Ceiling drywall · 1/2"'
  g.add(board)
  return g
}

// ── Gable roof (common rafters + ridge) ──────────────────────────────────────

/**
 * A gable roof over a traced rectangle: common rafters at on-centre spacing
 * sloping from each eave up to a ridge board, with the gable ends on the short
 * sides. Built centred on origin with the EAVES at y=0 (the caller seats the
 * group on the wall top plate); the ridge rises by half-span × pitch.
 *
 * Same pull-to-place flow as floors; hip/valley/shed are future profiles that
 * reuse this builder with different rafter geometry.
 */
export function buildGableRoof(opts: {
  lenX: number; lenZ: number; pitch: number; ocM: number; opacity?: number
}): THREE.Group {
  const { lenX, lenZ, pitch, ocM, opacity = 1 } = opts
  const g = new THREE.Group()
  if (lenX < 0.2 || lenZ < 0.2) return g
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#c79a5e'), roughness: 0.75, metalness: 0,
    transparent: opacity < 1, opacity,
  })
  const RT = 0.184   // rafter depth (≈ 2×8)
  const RW = 0.038   // rafter width
  const spanAlongX = lenX <= lenZ      // ridge runs along the LONGER side
  const span = spanAlongX ? lenX : lenZ
  const runLen = spanAlongX ? lenZ : lenX
  const half = span / 2
  const rise = Math.max(0.1, half * pitch)
  const rafterLen = Math.hypot(half, rise)
  const angle = Math.atan2(rise, half)

  const rafterInfo = `Rafter · ${Math.round(pitch * 12)}:12`
  const addBox = (w: number, h: number, d: number, x: number, y: number, z: number, rx: number, ry: number, rz: number, info: string) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat)
    m.position.set(x, y, z)
    m.rotation.set(rx, ry, rz)
    m.castShadow = true; m.receiveShadow = true
    m.userData.layer = 'roof'
    m.userData.info = info
    g.add(m)
  }

  // Rafter pairs at OC along the ridge run, plus one flush to each gable end.
  const halfRun = runLen / 2
  const ps: number[] = [-halfRun + RW / 2, halfRun - RW / 2]
  for (let p = -halfRun + RW / 2 + Math.max(0.3, ocM); p < halfRun - RW / 2; p += Math.max(0.3, ocM)) ps.push(p)

  if (spanAlongX) {
    for (const p of ps) {
      addBox(rafterLen, RT, RW, -half / 2, rise / 2, p, 0, 0, angle, rafterInfo)   // left slope
      addBox(rafterLen, RT, RW, half / 2, rise / 2, p, 0, 0, -angle, rafterInfo)   // right slope
    }
    addBox(RW, RT, runLen, 0, rise, 0, 0, 0, 0, 'Ridge board')                     // ridge board
  } else {
    for (const p of ps) {
      addBox(RW, RT, rafterLen, p, rise / 2, -half / 2, -angle, 0, 0, rafterInfo)
      addBox(RW, RT, rafterLen, p, rise / 2, half / 2, angle, 0, 0, rafterInfo)
    }
    addBox(runLen, RT, RW, 0, rise, 0, 0, 0, 0, 'Ridge board')
  }

  // ── Complete the framing: ties + gable-end studs (not rafters alone) ──
  // Spec: rafter ties ≤24" OC in the lower third; collar ties ≤48" OC in the
  // upper third; gable studs 16" OC (see research notes).
  const TT = 0.089, TW2 = 0.038
  const tieY = Math.min(rise * 0.2, 0.3)        // ceiling/rafter ties above the plate
  const collarY = rise * 0.66                    // collar ties in the upper third
  const collarHalf = half * (1 - collarY / rise) // rafter half-width at collar height
  const studOC = 0.4064                          // 16"
  for (const p of ps) {                          // ceiling/rafter tie at every rafter
    if (spanAlongX) addBox(span, TT, TW2, 0, tieY, p, 0, 0, 0, 'Ceiling/rafter tie')
    else addBox(TW2, TT, span, p, tieY, 0, 0, 0, 0, 'Ceiling/rafter tie')
  }
  for (let p = -halfRun + 0.3; p <= halfRun; p += 1.219) { // collar ties ~48" OC
    if (spanAlongX) addBox(2 * collarHalf, TT, TW2, 0, collarY, p, 0, 0, 0, 'Collar tie')
    else addBox(TW2, TT, 2 * collarHalf, p, collarY, 0, 0, 0, 0, 'Collar tie')
  }
  for (const gp of [-halfRun + RW / 2, halfRun - RW / 2]) { // gable-end studs
    for (let s = -half + studOC; s < half; s += studOC) {
      const hAt = Math.max(0.05, rise * (1 - Math.abs(s) / half))
      if (spanAlongX) addBox(TW2, hAt, TW2, s, hAt / 2, gp, 0, 0, 0, 'Gable stud')
      else addBox(TW2, hAt, TW2, gp, hAt / 2, s, 0, 0, 0, 'Gable stud')
    }
  }
  return g
}

// ── Additional roof types (hip / shed / flat) ────────────────────────────────
// Shared stock + helpers so every roof type frames consistently with the gable.
const ROOF_RT = 0.184   // rafter depth (≈ 2×8)
const ROOF_RW = 0.038   // rafter width

function roofMat(opacity: number) {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color('#c79a5e'), roughness: 0.75, metalness: 0,
    transparent: opacity < 1, opacity,
  })
}
function addRoofBox(
  g: THREE.Group, mat: THREE.Material,
  w: number, h: number, d: number, x: number, y: number, z: number,
  rx: number, ry: number, rz: number, info: string,
) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat)
  m.position.set(x, y, z)
  m.rotation.set(rx, ry, rz)
  m.castShadow = true; m.receiveShadow = true
  m.userData.layer = 'roof'
  m.userData.info = info
  g.add(m)
}
/** Evenly-spaced positions along a run (outer member at each end + OC between). */
function roofRun(runLen: number, ocM: number, memberW: number): number[] {
  const halfRun = runLen / 2
  const ps: number[] = [-halfRun + memberW / 2, halfRun - memberW / 2]
  for (let p = -halfRun + memberW / 2 + Math.max(0.3, ocM); p < halfRun - memberW / 2; p += Math.max(0.3, ocM)) ps.push(p)
  return ps
}

/** Shed / mono-pitch / lean-to — a single slope across the shorter side. */
export function buildShedRoof(opts: {
  lenX: number; lenZ: number; pitch: number; ocM: number; opacity?: number
}): THREE.Group {
  const { lenX, lenZ, pitch, ocM, opacity = 1 } = opts
  const g = new THREE.Group()
  if (lenX < 0.2 || lenZ < 0.2) return g
  const mat = roofMat(opacity)
  const slopeAlongX = lenX <= lenZ
  const span = slopeAlongX ? lenX : lenZ
  const runLen = slopeAlongX ? lenZ : lenX
  const rise = Math.max(0.1, span * pitch)
  const rafterLen = Math.hypot(span, rise)
  const angle = Math.atan2(rise, span)
  const info = `Shed rafter · ${Math.round(pitch * 12)}:12`
  for (const p of roofRun(runLen, ocM, ROOF_RW)) {
    if (slopeAlongX) addRoofBox(g, mat, rafterLen, ROOF_RT, ROOF_RW, 0, rise / 2, p, 0, 0, angle, info)
    else addRoofBox(g, mat, ROOF_RW, ROOF_RT, rafterLen, p, rise / 2, 0, angle, 0, 0, info)
  }
  if (slopeAlongX) {
    addRoofBox(g, mat, ROOF_RW, ROOF_RT, runLen, span / 2, rise, 0, 0, 0, 0, 'High wall beam')
    addRoofBox(g, mat, ROOF_RW, ROOF_RT, runLen, -span / 2, 0, 0, 0, 0, 0, 'Low wall plate')
  } else {
    addRoofBox(g, mat, runLen, ROOF_RT, ROOF_RW, 0, rise, span / 2, 0, 0, 0, 'High wall beam')
    addRoofBox(g, mat, runLen, ROOF_RT, ROOF_RW, 0, 0, -span / 2, 0, 0, 0, 'Low wall plate')
  }
  return g
}

/** Flat roof — horizontal joists across the shorter span + a membrane deck. */
export function buildFlatRoof(opts: {
  lenX: number; lenZ: number; ocM: number; opacity?: number
}): THREE.Group {
  const { lenX, lenZ, ocM, opacity = 1 } = opts
  const g = new THREE.Group()
  if (lenX < 0.2 || lenZ < 0.2) return g
  const mat = roofMat(opacity)
  const JT = 0.235, JW = 0.038   // ≈ 2×10 roof joists
  const spanAlongX = lenX <= lenZ
  const span = spanAlongX ? lenX : lenZ
  const runLen = spanAlongX ? lenZ : lenX
  for (const p of roofRun(runLen, ocM, JW)) {
    if (spanAlongX) addRoofBox(g, mat, span, JT, JW, 0, 0, p, 0, 0, 0, 'Roof joist · flat')
    else addRoofBox(g, mat, JW, JT, span, p, 0, 0, 0, 0, 0, 'Roof joist · flat')
  }
  const deckMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#3b3f46'), roughness: 0.92, metalness: 0,
    transparent: opacity < 1, opacity,
  })
  const deck = new THREE.Mesh(new THREE.BoxGeometry(lenX, 0.03, lenZ), deckMat)
  deck.position.set(0, JT / 2 + 0.015, 0)
  deck.castShadow = true; deck.receiveShadow = true
  deck.userData.layer = 'roof'; deck.userData.info = 'Flat roof membrane'
  g.add(deck)
  return g
}

/** Hip — ridge along the longer side, all four sides slope (both ends hipped). */
export function buildHipRoof(opts: {
  lenX: number; lenZ: number; pitch: number; ocM: number; opacity?: number
}): THREE.Group {
  const { lenX, lenZ, pitch, ocM, opacity = 1 } = opts
  const g = new THREE.Group()
  if (lenX < 0.2 || lenZ < 0.2) return g
  const mat = roofMat(opacity)
  // Build canonically with the ridge along X (L = long, W = short), then rotate
  // 90° if the footprint's long side is actually along Z.
  const ridgeAlongX = lenX >= lenZ
  const L = Math.max(lenX, lenZ)
  const W = Math.min(lenX, lenZ)
  const half = W / 2
  const rise = Math.max(0.1, half * pitch)
  const ridgeLen = Math.max(0, L - W)            // hips eat `half` off each end
  const angle = Math.atan2(rise, half)
  const rafterLen = Math.hypot(half, rise)
  const info = `Hip · ${Math.round(pitch * 12)}:12`

  // Ridge board.
  addRoofBox(g, mat, Math.max(ROOF_RW, ridgeLen), ROOF_RT, ROOF_RW, 0, rise, 0, 0, 0, 0, 'Ridge board')
  // Common rafters on both long sides, over the ridge portion only.
  const halfRidge = ridgeLen / 2
  const ps: number[] = []
  for (let p = -halfRidge + ROOF_RW / 2; p <= halfRidge; p += Math.max(0.3, ocM)) ps.push(p)
  if (ps.length === 0) ps.push(0)
  for (const p of ps) {
    addRoofBox(g, mat, ROOF_RW, ROOF_RT, rafterLen, p, rise / 2, -half / 2, -angle, 0, 0, info)
    addRoofBox(g, mat, ROOF_RW, ROOF_RT, rafterLen, p, rise / 2, half / 2, angle, 0, 0, info)
  }
  // Four hip rafters: each eave corner up to the nearest ridge end.
  const corners: Array<[number, number, number]> = [
    [-L / 2, -half, -ridgeLen / 2], [-L / 2, half, -ridgeLen / 2],
    [L / 2, -half, ridgeLen / 2], [L / 2, half, ridgeLen / 2],
  ]
  for (const [cx, cz, rx] of corners) {
    const c = new THREE.Vector3(cx, 0, cz)
    const r = new THREE.Vector3(rx, rise, 0)
    const dir = new THREE.Vector3().subVectors(r, c)
    const len = dir.length()
    const m = new THREE.Mesh(new THREE.BoxGeometry(len, ROOF_RT, ROOF_RW), mat)
    m.position.copy(c).addScaledVector(dir, 0.5)
    m.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir.clone().normalize())
    m.castShadow = true; m.receiveShadow = true
    m.userData.layer = 'roof'; m.userData.info = 'Hip rafter'
    g.add(m)
  }
  if (!ridgeAlongX) g.rotation.y = Math.PI / 2
  return g
}

/**
 * Fink (W-web) truss roof — the residential workhorse. Trusses at 24" OC, each
 * with 2×4 top chords, a bottom chord (ceiling), a centre king post and the
 * Fink W webs. Built canonically with the span along X, then rotated so the
 * ridge runs along the footprint's longer side.
 * Spec: SBCA / typical residential — Fink, 24" OC (see research notes).
 */
export function buildFinkTrussRoof(opts: {
  lenX: number; lenZ: number; pitch: number; ocM?: number; opacity?: number
}): THREE.Group {
  const { lenX, lenZ, pitch, opacity = 1 } = opts
  const g = new THREE.Group()
  if (lenX < 0.2 || lenZ < 0.2) return g
  const mat = roofMat(opacity)
  const TC = 0.089   // chord depth (2×4 = 3.5")
  const TW = 0.038   // member width (1.5") — truss thickness along the run
  const OC = 0.6096  // 24" on-centre (truss spec)
  const span = Math.min(lenX, lenZ)
  const runLen = Math.max(lenX, lenZ)
  const half = span / 2
  const rise = Math.max(0.1, half * pitch)
  const info = `Fink truss · ${Math.round(pitch * 12)}:12`

  // A member in the truss's X–Y plane (thin in Z), at run-position p.
  const member = (x0: number, y0: number, x1: number, y1: number, p: number, depth: number, lbl: string) => {
    const dx = x1 - x0, dy = y1 - y0
    const len = Math.hypot(dx, dy)
    if (len < 1e-3) return
    addRoofBox(g, mat, len, depth, TW, (x0 + x1) / 2, (y0 + y1) / 2, p, 0, 0, Math.atan2(dy, dx), lbl)
  }

  for (const p of roofRun(runLen, OC, TW)) {
    addRoofBox(g, mat, span, TC, TW, 0, 0, p, 0, 0, 0, 'Bottom chord')   // ceiling chord
    member(-half, 0, 0, rise, p, TC, info)        // left top chord
    member(half, 0, 0, rise, p, TC, info)         // right top chord
    member(0, 0, 0, rise, p, TW, 'King post')     // centre post
    // Fink W: apex down to the bottom-chord quarter points + the quarter verticals
    member(0, rise, -half / 2, 0, p, TW, 'Web')
    member(0, rise, half / 2, 0, p, TW, 'Web')
    member(-half / 2, 0, -half / 2, rise / 2, p, TW, 'Web')
    member(half / 2, 0, half / 2, rise / 2, p, TW, 'Web')
  }
  // Canonical ridge runs along Z; rotate when the footprint's long side is X.
  if (lenX >= lenZ) g.rotation.y = Math.PI / 2
  return g
}

/** An angled framing member in the X–Y plane (thin in Z), at run-position z. */
function addRoofMemberXY(
  g: THREE.Group, mat: THREE.Material,
  x0: number, y0: number, x1: number, y1: number,
  z: number, depth: number, width: number, info: string,
) {
  const dx = x1 - x0, dy = y1 - y0
  const len = Math.hypot(dx, dy)
  if (len < 1e-3) return
  addRoofBox(g, mat, len, depth, width, (x0 + x1) / 2, (y0 + y1) / 2, z, 0, 0, Math.atan2(dy, dx), info)
}

/** Gambrel (barn) — two slopes per side: steep lower, shallow upper. */
export function buildGambrelRoof(opts: {
  lenX: number; lenZ: number; pitch: number; ocM: number; opacity?: number
}): THREE.Group {
  const { lenX, lenZ, pitch, ocM, opacity = 1 } = opts
  const g = new THREE.Group()
  if (lenX < 0.2 || lenZ < 0.2) return g
  const mat = roofMat(opacity)
  const span = Math.min(lenX, lenZ)
  const runLen = Math.max(lenX, lenZ)
  const half = span / 2
  const kneeX = half * 0.55
  const kneeY = half * (0.7 + Math.min(1, pitch) * 0.4)
  const peakY = kneeY + kneeX * 0.5
  const info = `Gambrel · ${Math.round(pitch * 12)}:12`
  for (const p of roofRun(runLen, Math.max(0.3, ocM), ROOF_RW)) {
    addRoofMemberXY(g, mat, -half, 0, -kneeX, kneeY, p, ROOF_RT, ROOF_RW, info)
    addRoofMemberXY(g, mat, -kneeX, kneeY, 0, peakY, p, ROOF_RT, ROOF_RW, info)
    addRoofMemberXY(g, mat, half, 0, kneeX, kneeY, p, ROOF_RT, ROOF_RW, info)
    addRoofMemberXY(g, mat, kneeX, kneeY, 0, peakY, p, ROOF_RT, ROOF_RW, info)
    addRoofBox(g, mat, span, 0.089, 0.038, 0, 0, p, 0, 0, 0, 'Ceiling/rafter tie')
  }
  addRoofBox(g, mat, ROOF_RW, ROOF_RT, runLen, 0, peakY, 0, 0, 0, 0, 'Ridge board')
  addRoofBox(g, mat, ROOF_RW, ROOF_RT, runLen, -kneeX, kneeY, 0, 0, 0, 0, 'Knuckle purlin')
  addRoofBox(g, mat, ROOF_RW, ROOF_RT, runLen, kneeX, kneeY, 0, 0, 0, 0, 'Knuckle purlin')
  if (lenX >= lenZ) g.rotation.y = Math.PI / 2
  return g
}

/** Saltbox — asymmetric gable: one long shallow slope, one short steep slope. */
export function buildSaltboxRoof(opts: {
  lenX: number; lenZ: number; pitch: number; ocM: number; opacity?: number
}): THREE.Group {
  const { lenX, lenZ, pitch, ocM, opacity = 1 } = opts
  const g = new THREE.Group()
  if (lenX < 0.2 || lenZ < 0.2) return g
  const mat = roofMat(opacity)
  const span = Math.min(lenX, lenZ)
  const runLen = Math.max(lenX, lenZ)
  const half = span / 2
  const ridgeX = -half * 0.35
  const rise = Math.max(0.2, half * pitch * 1.3)
  const info = `Saltbox · ${Math.round(pitch * 12)}:12`
  for (const p of roofRun(runLen, Math.max(0.3, ocM), ROOF_RW)) {
    addRoofMemberXY(g, mat, -half, 0, ridgeX, rise, p, ROOF_RT, ROOF_RW, info)
    addRoofMemberXY(g, mat, half, 0, ridgeX, rise, p, ROOF_RT, ROOF_RW, info)
    addRoofBox(g, mat, span, 0.089, 0.038, 0, 0, p, 0, 0, 0, 'Ceiling/rafter tie')
  }
  addRoofBox(g, mat, ROOF_RW, ROOF_RT, runLen, ridgeX, rise, 0, 0, 0, 0, 'Ridge board')
  if (lenX >= lenZ) g.rotation.y = Math.PI / 2
  return g
}

/**
 * Boxed-eave overhang: soffit panels, fascia around the outer edge, and
 * lookouts framing back to the wall (the "framing back to the wall" + blocking
 * in the overhang). Built axis-aligned to the footprint so it's added as a
 * sibling of the roof — never spun by a roof type's own internal rotation.
 * Spec: eave overhang ~16" (12–24" typical); fascia from 2× stock; lookouts
 * 2×6 ~4 ft at 24" OC; soffit captured under the fascia (see research notes).
 */
function buildEaveOverhang(
  g: THREE.Group,
  opts: { lenX: number; lenZ: number; overhang: number; opacity: number },
): void {
  const { lenX, lenZ, overhang, opacity } = opts
  if (overhang <= 0 || lenX < 0.2 || lenZ < 0.2) return
  const wood = roofMat(opacity)
  const soffitMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#d9d3c6'), roughness: 0.9, metalness: 0,
    transparent: opacity < 1, opacity,
  })
  const FAS = 0.184, FW = 0.038, SOF = 0.018, LOOK = 0.089
  const hx = lenX / 2, hz = lenZ / 2
  const ox = hx + overhang, oz = hz + overhang
  const soffitY = -FAS + SOF / 2
  const fasciaY = -FAS / 2
  // Soffit panels — X sides span lenZ; Z sides span the full outer width so the
  // four corners are covered.
  addRoofBox(g, soffitMat, overhang, SOF, lenZ, hx + overhang / 2, soffitY, 0, 0, 0, 0, 'Soffit')
  addRoofBox(g, soffitMat, overhang, SOF, lenZ, -hx - overhang / 2, soffitY, 0, 0, 0, 0, 'Soffit')
  addRoofBox(g, soffitMat, lenX + 2 * overhang, SOF, overhang, 0, soffitY, hz + overhang / 2, 0, 0, 0, 'Soffit')
  addRoofBox(g, soffitMat, lenX + 2 * overhang, SOF, overhang, 0, soffitY, -hz - overhang / 2, 0, 0, 0, 'Soffit')
  // Fascia around the outer edge.
  addRoofBox(g, wood, FW, FAS, lenZ + 2 * overhang, ox, fasciaY, 0, 0, 0, 0, 'Fascia')
  addRoofBox(g, wood, FW, FAS, lenZ + 2 * overhang, -ox, fasciaY, 0, 0, 0, 0, 'Fascia')
  addRoofBox(g, wood, lenX + 2 * overhang, FAS, FW, 0, fasciaY, oz, 0, 0, 0, 'Fascia')
  addRoofBox(g, wood, lenX + 2 * overhang, FAS, FW, 0, fasciaY, -oz, 0, 0, 0, 'Fascia')
  // Lookouts — cantilever back to the wall at 24" OC on every side.
  const OC = 0.6096
  for (let z = -hz + 0.3; z <= hz; z += OC) {
    addRoofBox(g, wood, overhang, LOOK, FW, hx + overhang / 2, -LOOK / 2, z, 0, 0, 0, 'Lookout')
    addRoofBox(g, wood, overhang, LOOK, FW, -hx - overhang / 2, -LOOK / 2, z, 0, 0, 0, 'Lookout')
  }
  for (let x = -hx + 0.3; x <= hx; x += OC) {
    addRoofBox(g, wood, FW, LOOK, overhang, x, -LOOK / 2, hz + overhang / 2, 0, 0, 0, 'Lookout')
    addRoofBox(g, wood, FW, LOOK, overhang, x, -LOOK / 2, -hz - overhang / 2, 0, 0, 0, 'Lookout')
  }
}

/** Dispatch to the right roof builder by type name (defaults to gable), then add
 *  the boxed-eave overhang (soffit/fascia/lookouts) as an axis-aligned sibling. */
export function buildRoofByType(
  type: string,
  opts: { lenX: number; lenZ: number; pitch: number; ocM: number; opacity?: number; overhangM?: number },
): THREE.Group {
  const roof = (() => {
    switch ((type || '').trim().toLowerCase()) {
      case 'truss':
      case 'trusses': return buildFinkTrussRoof(opts)
      case 'gambrel': return buildGambrelRoof(opts)
      case 'saltbox': return buildSaltboxRoof(opts)
      case 'hip': return buildHipRoof(opts)
      case 'shed':
      case 'lean-to':
      case 'mono':
      case 'mono-pitch': return buildShedRoof(opts)
      case 'flat': return buildFlatRoof(opts)
      default: return buildGableRoof(opts)
    }
  })()
  const overhangM = opts.overhangM ?? 0.4 // ~16" boxed eave
  if (overhangM > 0) {
    const wrapper = new THREE.Group()
    wrapper.add(roof)
    const eave = new THREE.Group()
    buildEaveOverhang(eave, { lenX: opts.lenX, lenZ: opts.lenZ, overhang: overhangM, opacity: opts.opacity ?? 1 })
    wrapper.add(eave)
    return wrapper
  }
  return roof
}

export interface WallDrywallOpts {
  length: number
  height: number
  thickness: number
  /** Sheet orientation: 'vertical' (4'w × 8'h) or 'horizontal' (8'w × 4'h). */
  orientation?: 'vertical' | 'horizontal'
  /** Openings to leave unboarded (centreM from wall start, widthM, type). */
  openings?: WallOpening[]
  /** Board both faces, or just the interior (default both). */
  bothSides?: boolean
  opacity?: number
}

const SHEET_LONG = 2.438   // 8'
const SHEET_SHORT = 1.219  // 4'
const DRYWALL_T = 0.0127   // 1/2"
const SHEET_GAP = 0.004    // visible joint between sheets

/**
 * Board a wall with real 4×8 drywall sheets, tiled in the chosen orientation so
 * the joints read, with sheets that overlap a door/window opening left off (the
 * opening stays open). Centred on origin along X like buildWallFraming.
 */
export function buildWallDrywall(opts: WallDrywallOpts): THREE.Group {
  const { length, height, thickness, orientation = 'vertical', openings = [], bothSides = true, opacity = 1 } = opts
  const group = new THREE.Group()
  if (length < 0.05 || height < 0.05) return group

  const cellW = orientation === 'horizontal' ? SHEET_LONG : SHEET_SHORT
  const cellH = orientation === 'horizontal' ? SHEET_SHORT : SHEET_LONG
  const depth = Math.max(STUD_WIDTH_M, thickness)
  const half = length / 2
  const faceZ = depth / 2 + DRYWALL_T / 2

  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#e8e6e1'), roughness: 0.95, metalness: 0,
    transparent: opacity < 1, opacity,
  })

  // Opening rectangles in local (x, y): x from start − half; sill/height by type.
  const rects = openings.map((o) => {
    const cx = o.centerM - half
    const isDoor = o.type === 'door'
    const sill = isDoor ? 0 : (o.sillM ?? 0.9)
    const oh = o.heightM ?? (isDoor ? 2.06 : 1.13)
    const yLo = isDoor ? 0 : Math.min(sill, height - 0.3)
    const yHi = Math.min(yLo + oh, height)
    return { x0: cx - o.widthM / 2, x1: cx + o.widthM / 2, y0: yLo, y1: yHi }
  })
  const overlapsOpening = (x0: number, x1: number, y0: number, y1: number) =>
    rects.some((r) => x0 < r.x1 && x1 > r.x0 && y0 < r.y1 && y1 > r.y0)

  const zs = bothSides ? [faceZ, -faceZ] : [faceZ]
  for (let x = -half; x < half - 0.02; x += cellW + SHEET_GAP) {
    const w = Math.min(cellW, half - x)
    if (w < 0.05) continue
    for (let y = 0; y < height - 0.02; y += cellH + SHEET_GAP) {
      const h = Math.min(cellH, height - y)
      if (h < 0.05) continue
      if (overlapsOpening(x, x + w, y, y + h)) continue   // leave the opening open
      for (const z of zs) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(w - SHEET_GAP, h - SHEET_GAP, DRYWALL_T), mat)
        m.position.set(x + w / 2, y + h / 2, z)
        m.castShadow = true
        m.receiveShadow = true
        m.userData.layer = 'drywall'
        group.add(m)
      }
    }
  }
  return group
}
