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
export function buildFloorJoists(opts: {
  lenX: number; lenZ: number; element: string; ocM: number; opacity?: number
}): THREE.Group {
  const { lenX, lenZ, element, ocM, opacity = 1 } = opts
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
  for (const p of positions) {
    if (spanAlongX) addJoist(spanLen, width, 0, p)
    else            addJoist(width, spanLen, p, 0)
  }
  // Rim/band joists capping the joist ends (perpendicular to the joists).
  for (const s of [-1, 1]) {
    const e = s * (spanLen / 2 - width / 2)
    if (spanAlongX) addJoist(width, runLen, e, 0)
    else            addJoist(runLen, width, 0, e)
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
export function buildFloorDeck(opts: { lenX: number; lenZ: number; opacity?: number }): THREE.Group {
  const g = new THREE.Group()
  const { lenX, lenZ, opacity = 1 } = opts
  if (lenX < 0.1 || lenZ < 0.1) { g.userData.sheetCount = 0; return g }
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
  return g
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
