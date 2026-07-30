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
import {
  type EnvelopeLayer, type CladdingSpec,
  GUARDRAIL_TOP_M, GUARDRAIL_POST_SPACING_M, GUARDRAIL_MEMBER,
} from './constructionCode'

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
  /** Corner cap-plate lap. At each end that meets a corner, the upper (cap) top
   *  plate either extends OVER the adjoining wall by one framing-member width
   *  ('lap') or is pulled back that far so it receives the neighbour's lapping
   *  cap ('back'). Perpendicular walls take opposite modes, so the two double
   *  top plates overlap and tie the corner. Undefined ends keep a full-length cap
   *  (lower top plate always runs full length and butts at the corner). */
  capLap?: { start?: 'lap' | 'back'; end?: 'lap' | 'back' }
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
    capLap,
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
    add(plateGeo, 0, height - PLATE_H_M * 1.5, 0) // lower top plate (butts at corner)
    // Upper (cap) plate — ties the corner. One wall's cap runs long enough to
    // cross its neighbour and land FLUSH with that neighbour's outer face; the
    // mating wall's cap stops one framing-member width short, leaving the pocket
    // the first one slots into. Together they make a continuous flush corner —
    // nothing projects past the building line.
    //
    // The caller extends the wall BODY by half a thickness at every corner end
    // (see LiveWallsLayer), which is exactly what carries the end out to the
    // neighbour's outer face. So a 'lap' cap is simply FULL BODY LENGTH — it
    // needs no extra. Adding a further member width on top of that (as this did)
    // pushed the cap clean past the finished corner: measured 0.089 m = 3.5" of
    // plate hanging in open air at every corner.
    //
    // 'back' still pulls back one member width — that is the pocket, and it is
    // measured from the same extended end, so the two always meet flush.
    const capLapAmt = depth // one framing-member width (≈ 3.5" for 2x4, 5.5" for 2x6)
    let capL = -length / 2
    let capR = length / 2
    if (capLap?.start === 'back') capL += capLapAmt
    if (capLap?.end === 'back') capR -= capLapAmt
    const capLen = Math.max(0.02, capR - capL)
    add(new THREE.BoxGeometry(capLen, PLATE_H_M, depth), (capL + capR) / 2, height - PLATE_H_M / 2, 0)
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

/** IRC R502.10 — a floor opening's header may be a single member while it spans
 *  4 ft or less; past that the header AND the trimmer joists must be doubled. */
export const OPENING_DOUBLE_SPAN_M = 1.2192   // 4'-0"
/** IRC R502.10 — past 6 ft the header must hang on approved framing anchors
 *  rather than bear on a ledger/notch. */
export const OPENING_HANGER_SPAN_M = 1.8288   // 6'-0"

/**
 * How many plies a floor opening's header and trimmers need, from the header's
 * span (the opening dimension the header crosses).
 *
 * Straight out of IRC R502.10, so a stairwell is framed the way an inspector
 * expects rather than to whatever looked about right. A typical 36" stair well is
 * under 4 ft across and gets single members; anything wider doubles up.
 */
export function openingPlies(headerSpanM: number): number {
  return headerSpanM > OPENING_DOUBLE_SPAN_M ? 2 : 1
}

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
  const addJoist = (w: number, d: number, x: number, z: number, info: string = joistInfo) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, depth, d), joistMat)
    m.position.set(x, 0, z)
    m.castShadow = true; m.receiveShadow = true
    m.userData.layer = 'floors'
    m.userData.info = info
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
  // Each hole, mapped to (span-range s0..s1, run-range p0..p1) for this
  // orientation. These are the CLEAR opening dimensions — what the deck cuts and
  // what you actually walk through. The framing goes OUTSIDE them, so a 3'×10'
  // stairwell stays a 3'×10' stairwell after it is framed.
  const spanHalf = spanLen / 2
  const mapped = holes.map((h) => spanAlongX
    ? { s0: h.x - h.w / 2, s1: h.x + h.w / 2, p0: h.z - h.d / 2, p1: h.z + h.d / 2 }
    : { s0: h.z - h.d / 2, s1: h.z + h.d / 2, p0: h.x - h.w / 2, p1: h.x + h.w / 2 })
  // Per opening: how many plies its header/trimmers need (IRC R502.10, see
  // openingPlies) and how far that framing reaches beyond the clear opening.
  // Carried on the opening itself rather than in a parallel array, so a later
  // filter can never slide the two out of step.
  const openings = mapped.map((m) => {
    const plies = openingPlies(m.p1 - m.p0)
    return { ...m, plies, out: plies * width }
  })
  // A joist segment from a→b along the span axis at run-position p.
  const addJoistSeg = (p: number, a: number, b: number) => {
    if (b - a < 0.05) return
    const mid = (a + b) / 2, len = b - a
    if (spanAlongX) addJoist(len, width, mid, p)
    else            addJoist(width, len, p, mid)
  }
  for (const p of positions) {
    // Span-axis cuts from any hole whose run-range straddles this joist. The cut
    // runs to the HEADER's outer face, not the opening edge — the tail joist has
    // to stop where the header begins, or the two occupy the same wood.
    const cuts = openings
      .filter((o) => p > o.p0 - o.out && p < o.p1 + o.out)
      .map((o) => [
        Math.max(-spanHalf, o.s0 - o.out),
        Math.min(spanHalf, o.s1 + o.out),
      ] as [number, number])
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
  // ── Framing each opening: HEADERS + TRIMMERS (IRC R502.10) ─────────────────
  //
  // This used to add one single member per span-edge and call itself "doubled".
  // Two things were wrong: nothing was doubled, and there were no TRIMMER joists
  // at all — so the joists cut by the opening simply ended in mid-air with
  // nothing carrying them. A stairwell framed that way is a hole with loose ends.
  //
  // A real opening is a box:
  //   HEADERS  cross the cut joists at each end of the opening and carry them.
  //   TRIMMERS run alongside the opening, full span, and carry the headers.
  // Everything sits OUTSIDE the clear opening, so framing it does not shrink it.
  for (const o of openings) {
    const clearRun = o.p1 - o.p0
    if (clearRun < 0.05 || o.s1 - o.s0 < 0.05) continue
    const plyLabel = o.plies > 1 ? `${o.plies}-ply` : 'single'
    const headerInfo = `Opening header · ${plyLabel} ${element}`
    const trimmerInfo = `Trimmer joist · ${plyLabel} ${element}`
    // Trimmers first: they are the supports, and they set how long the headers
    // must be (a header bears ON the trimmers, so it runs to their outer faces).
    for (const dir of [-1, 1] as const) {
      const edge = dir < 0 ? o.p0 : o.p1
      for (let i = 0; i < o.plies; i++) {
        const p = edge + dir * (width / 2 + i * width)
        if (Math.abs(p) > halfRun) continue          // past the floor edge
        if (spanAlongX) addJoist(spanLen, width, 0, p, trimmerInfo)
        else            addJoist(width, spanLen, p, 0, trimmerInfo)
      }
    }
    // Headers span the opening plus both trimmer packs, so their ends land on
    // wood rather than stopping short in the void.
    const headerLen = clearRun + 2 * o.out
    for (const dir of [-1, 1] as const) {
      const edge = dir < 0 ? o.s0 : o.s1
      for (let i = 0; i < o.plies; i++) {
        const s = edge + dir * (width / 2 + i * width)
        if (Math.abs(s) > spanHalf) continue
        if (spanAlongX) addJoist(width, headerLen, s, (o.p0 + o.p1) / 2, headerInfo)
        else            addJoist(headerLen, width, (o.p0 + o.p1) / 2, s, headerInfo)
      }
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
 * General ridge roof — the model behind "drag the ridge". The ridge is a line at
 * height `rise`, free to (a) sit off-centre across the span (`crossFrac`, → a
 * saltbox / asymmetric gable) and (b) stop short of either run end (`insetA/B`,
 * → a hipped end). crossFrac 0 + insets 0 reproduces a plain centred gable.
 *
 * Built canonically with the run (ridge direction) along X and the span along Z,
 * then spun 90° so the ridge follows the footprint's LONGER side (matching the
 * gable/hip builders). Pitch is nominal (rise = half-span · pitch); sliding the
 * ridge across keeps the peak height and skews the two slope pitches — exactly
 * what you'd see pulling a ridge sideways.
 */
export function buildRidgeRoof(opts: {
  lenX: number; lenZ: number; pitch: number; ocM: number; opacity?: number
  overhangM?: number
  /** ridge cross-offset as a fraction of the half-span, -0.9..0.9 (0 = centred). */
  crossFrac?: number
  /** ridge end insets as a fraction of the run, 0..0.45 each (>0 = hipped end). */
  insetA?: number
  insetB?: number
}): THREE.Group {
  const { lenX, lenZ, pitch, ocM, opacity = 1 } = opts
  const g = new THREE.Group()
  if (lenX < 0.2 || lenZ < 0.2) return g
  const mat = roofMat(opacity)

  const ridgeAlongX = lenX >= lenZ
  const L = Math.max(lenX, lenZ)          // run (ridge direction)
  const W = Math.min(lenX, lenZ)          // span (slope direction)
  const half = W / 2
  const rise = Math.max(0.1, half * pitch)
  const c = Math.max(-0.9, Math.min(0.9, opts.crossFrac ?? 0)) * half  // ridge z
  const insetA = Math.max(0, Math.min(0.45, opts.insetA ?? 0))         // -X end
  const insetB = Math.max(0, Math.min(0.45, opts.insetB ?? 0))         // +X end
  const xA = -L / 2 + insetA * L          // ridge end toward -X
  const xB = L / 2 - insetB * L           // ridge end toward +X
  const ridgeLen = Math.max(ROOF_RW, xB - xA)

  // Per-side slope geometry (the two long slopes have different runs when the
  // ridge is off-centre).
  const runPos = Math.max(0.1, half - c)  // +Z eave → ridge
  const runNeg = Math.max(0.1, half + c)  // -Z eave → ridge
  const anglePos = Math.atan2(rise, runPos)
  const angleNeg = Math.atan2(rise, runNeg)
  const lenPos = Math.hypot(runPos, rise)
  const lenNeg = Math.hypot(runNeg, rise)
  const info = `Rafter · ${Math.round(pitch * 12)}:12`

  // Common rafters along the ridge portion [xA, xB], both long sides.
  const ps = roofRun(ridgeLen, ocM, ROOF_RW).map((p) => p + (xA + xB) / 2)
  for (const p of ps) {
    addRoofBox(g, mat, ROOF_RW, ROOF_RT, lenPos, p, rise / 2, (half + c) / 2, anglePos, 0, 0, info)
    addRoofBox(g, mat, ROOF_RW, ROOF_RT, lenNeg, p, rise / 2, (-half + c) / 2, -angleNeg, 0, 0, info)
  }
  // Ridge board.
  addRoofBox(g, mat, ridgeLen, ROOF_RT, ROOF_RW, (xA + xB) / 2, rise, c, 0, 0, 0, 'Ridge board')

  // Ceiling / rafter ties across the span at each common rafter.
  const tieY = Math.min(rise * 0.2, 0.3)
  for (const p of ps) addRoofBox(g, mat, ROOF_RW, 0.089, W, p, tieY, 0, 0, 0, 0, 'Ceiling/rafter tie')

  // Hip rafters for any inset (hipped) end: the two eave corners up to the ridge
  // end, plus a couple of jack rafters landing on each hip.
  const hipRafter = (corner: THREE.Vector3, ridgeEnd: THREE.Vector3, lbl: string) => {
    const dir = new THREE.Vector3().subVectors(ridgeEnd, corner)
    const len = dir.length()
    if (len < 1e-3) return
    const m = new THREE.Mesh(new THREE.BoxGeometry(len, ROOF_RT, ROOF_RW), mat)
    m.position.copy(corner).addScaledVector(dir, 0.5)
    m.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir.clone().normalize())
    m.castShadow = true; m.receiveShadow = true
    m.userData.layer = 'roof'; m.userData.info = lbl
    g.add(m)
  }
  const ends: Array<{ inset: number; wallX: number; ridgeX: number }> = [
    { inset: insetA, wallX: -L / 2, ridgeX: xA },
    { inset: insetB, wallX: L / 2, ridgeX: xB },
  ]
  for (const end of ends) {
    if (end.inset > 0) {
      // Hipped end → two hip rafters fanning to the ridge end.
      hipRafter(new THREE.Vector3(end.wallX, 0, half), new THREE.Vector3(end.ridgeX, rise, c), 'Hip rafter')
      hipRafter(new THREE.Vector3(end.wallX, 0, -half), new THREE.Vector3(end.ridgeX, rise, c), 'Hip rafter')
    } else {
      // Flush gable end → studs filling the triangle up to the ridge.
      const studOC = 0.4064
      for (let s = -half + studOC; s < half; s += studOC) {
        // Slope height at across-position s: linear from each eave up to ridge z=c.
        const h = s <= c
          ? rise * (s + half) / Math.max(0.1, c + half)
          : rise * (half - s) / Math.max(0.1, half - c)
        const hAt = Math.max(0.05, h)
        addRoofBox(g, mat, ROOF_RW, hAt, ROOF_RW, end.wallX, hAt / 2, s, 0, 0, 0, 'Gable stud')
      }
    }
  }

  if (!ridgeAlongX) g.rotation.y = Math.PI / 2

  // Boxed eave overhang (four-side) — a freely-shaped ridge can have a hip or an
  // off-centre gable end, so the simple sloped rake of a plain gable no longer
  // applies; the boxed soffit wraps every edge cleanly.
  const overhangM = opts.overhangM ?? 0.4
  if (overhangM > 0) {
    const wrapper = new THREE.Group()
    wrapper.add(g)
    const eave = new THREE.Group()
    buildEaveOverhang(eave, { lenX, lenZ, overhang: overhangM, opacity })
    wrapper.add(eave)
    return wrapper
  }
  return g
}

/** True when a ridge override actually changes the roof shape (not just pitch). */
export function ridgeIsShaped(r?: { crossFrac?: number; insetA?: number; insetB?: number }): boolean {
  if (!r) return false
  return Math.abs(r.crossFrac ?? 0) > 0.02 || (r.insetA ?? 0) > 0.02 || (r.insetB ?? 0) > 0.02
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
  opts: {
    lenX: number; lenZ: number; overhang: number; opacity: number
    /** Ridge axis for gable-type roofs. Set → the two ends ALONG this axis are
     *  gable ends and get a sloped RAKE (barge) instead of a flat boxed soffit;
     *  the sides parallel to the ridge stay true (low, horizontal) eaves.
     *  Unset → all four sides boxed (hip / flat / shed / gambrel / saltbox). */
    ridgeAxis?: 'x' | 'z'
    /** Roof pitch (rise/run) — needed to slope the rake to match the ridge. */
    pitch?: number
  },
): void {
  const { lenX, lenZ, overhang, opacity, ridgeAxis, pitch = 0.5 } = opts
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

  if (ridgeAxis) {
    buildGableEaveAndRake(g, wood, soffitMat, {
      lenX, lenZ, overhang, ridgeAxis, pitch,
      FAS, FW, SOF, LOOK, hx, hz, soffitY, fasciaY,
    })
    return
  }

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
  // Lookouts — outriggers that cantilever from INSIDE the wall out to the
  // sub-fascia, so the framing visibly ties back to the house instead of
  // floating in the overhang. Each reaches back over the plate by `tie`.
  const OC = 0.6096
  const tie = 0.3
  const lkLen = overhang + tie
  for (let z = -hz + 0.2; z <= hz; z += OC) {
    addRoofBox(g, wood, lkLen, LOOK, FW, hx - tie / 2 + overhang / 2, -LOOK / 2, z, 0, 0, 0, 'Lookout')
    addRoofBox(g, wood, lkLen, LOOK, FW, -(hx - tie / 2 + overhang / 2), -LOOK / 2, z, 0, 0, 0, 'Lookout')
  }
  for (let x = -hx + 0.2; x <= hx; x += OC) {
    addRoofBox(g, wood, FW, LOOK, lkLen, x, -LOOK / 2, hz - tie / 2 + overhang / 2, 0, 0, 0, 'Lookout')
    addRoofBox(g, wood, FW, LOOK, lkLen, x, -LOOK / 2, -(hz - tie / 2 + overhang / 2), 0, 0, 0, 'Lookout')
  }
  // Frieze / ledger where the soffit returns to the house — closes the joint to
  // the wall and gives the lookouts something to bear on at the top plate.
  addRoofBox(g, wood, FW, FAS, lenZ, hx, fasciaY, 0, 0, 0, 0, 'Frieze')
  addRoofBox(g, wood, FW, FAS, lenZ, -hx, fasciaY, 0, 0, 0, 0, 'Frieze')
  addRoofBox(g, wood, lenX, FAS, FW, 0, fasciaY, hz, 0, 0, 0, 'Frieze')
  addRoofBox(g, wood, lenX, FAS, FW, 0, fasciaY, -hz, 0, 0, 0, 'Frieze')
}

/**
 * Gable-type overhang: a boxed soffit/fascia on the two true eaves (the low
 * sides parallel to the ridge) and a sloped RAKE (barge board + rake soffit
 * flying out past the gable wall) on the two gable ends. This is the "default
 * gable + small rake" termination — the roof's sheathing flies past the gable
 * by `overhang` and the barge caps it, following the roof slope up to the ridge.
 */
function buildGableEaveAndRake(
  g: THREE.Group,
  wood: THREE.Material,
  soffitMat: THREE.Material,
  o: {
    lenX: number; lenZ: number; overhang: number; ridgeAxis: 'x' | 'z'; pitch: number
    FAS: number; FW: number; SOF: number; LOOK: number
    hx: number; hz: number; soffitY: number; fasciaY: number
  },
): void {
  const { lenX, lenZ, overhang, ridgeAxis, pitch, FAS, FW, SOF, LOOK, hx, hz, soffitY, fasciaY } = o
  const rakeOnZ = ridgeAxis === 'z'   // ridge along Z → gable ends at ±z, eaves at ±x
  const OC = 0.6096
  const tie = 0.3
  const lkLen = overhang + tie

  // ── True eaves (the two low sides parallel to the ridge) ──
  // Span the eave members the FULL outer length so they tuck under the rake and
  // cover the corners.
  if (rakeOnZ) {
    const zSpan = lenZ + 2 * overhang
    for (const sx of [1, -1]) {
      addRoofBox(g, soffitMat, overhang, SOF, zSpan, sx * (hx + overhang / 2), soffitY, 0, 0, 0, 0, 'Soffit')
      addRoofBox(g, wood, FW, FAS, zSpan, sx * (hx + overhang), fasciaY, 0, 0, 0, 0, 'Fascia')
      addRoofBox(g, wood, FW, FAS, lenZ, sx * hx, fasciaY, 0, 0, 0, 0, 'Frieze')
    }
    for (let z = -hz + 0.2; z <= hz; z += OC) {
      for (const sx of [1, -1]) {
        addRoofBox(g, wood, lkLen, LOOK, FW, sx * (hx - tie / 2 + overhang / 2), -LOOK / 2, z, 0, 0, 0, 'Lookout')
      }
    }
  } else {
    const xSpan = lenX + 2 * overhang
    for (const sz of [1, -1]) {
      addRoofBox(g, soffitMat, xSpan, SOF, overhang, 0, soffitY, sz * (hz + overhang / 2), 0, 0, 0, 'Soffit')
      addRoofBox(g, wood, xSpan, FAS, FW, 0, fasciaY, sz * (hz + overhang), 0, 0, 0, 'Fascia')
      addRoofBox(g, wood, lenX, FAS, FW, 0, fasciaY, sz * hz, 0, 0, 0, 'Frieze')
    }
    for (let x = -hx + 0.2; x <= hx; x += OC) {
      for (const sz of [1, -1]) {
        addRoofBox(g, wood, FW, LOOK, lkLen, x, -LOOK / 2, sz * (hz - tie / 2 + overhang / 2), 0, 0, 0, 'Lookout')
      }
    }
  }

  // ── Gable-end rakes (barge board + sloped rake soffit, flying past the wall) ──
  const half = rakeOnZ ? hx : hz              // across-slope half-span (peak at centre)
  const rise = Math.max(0.1, half * pitch)
  const slopeLen = Math.hypot(half, rise)
  const angle = Math.atan2(rise, half)
  const out = (rakeOnZ ? hz : hx) + overhang  // outboard plane of the barge
  const slopeY = rise / 2                     // midpoint of the slope line
  for (const end of [1, -1]) {                // each gable end
    for (const side of [1, -1]) {             // each slope (left / right of ridge)
      const mid = side * (half / 2)           // along-slope midpoint
      if (rakeOnZ) {
        // Board runs along X, thin in Z; tilt about Z to follow the slope.
        addRoofBox(g, wood, slopeLen, FAS, FW, mid, slopeY + fasciaY, end * out, 0, 0, -side * angle, 'Rake fascia')
        addRoofBox(g, soffitMat, slopeLen, SOF, overhang, mid, slopeY + soffitY, end * (out - overhang / 2), 0, 0, -side * angle, 'Rake soffit')
      } else {
        // Board runs along Z, thin in X; tilt about X to follow the slope.
        addRoofBox(g, wood, FW, FAS, slopeLen, end * out, slopeY + fasciaY, mid, side * angle, 0, 0, 'Rake fascia')
        addRoofBox(g, soffitMat, overhang, SOF, slopeLen, end * (out - overhang / 2), slopeY + soffitY, mid, side * angle, 0, 0, 'Rake soffit')
      }
    }
  }
}

/** Dispatch to the right roof builder by type name (defaults to gable), then add
 *  the boxed-eave overhang (soffit/fascia/lookouts) as an axis-aligned sibling. */
export function buildRoofByType(
  type: string,
  opts: { lenX: number; lenZ: number; pitch: number; ocM: number; opacity?: number; overhangM?: number },
): THREE.Group {
  const t = (type || '').trim().toLowerCase()
  const roof = (() => {
    switch (t) {
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
    // Gable & truss roofs have two true eaves + two gable ends (sloped rakes).
    // Every other type stays a four-side boxed eave (no ridgeAxis).
    const ridged = t === 'truss' || t === 'trusses' || t === 'gable' || t === ''
      || !['gambrel', 'saltbox', 'hip', 'shed', 'lean-to', 'mono', 'mono-pitch', 'flat'].includes(t)
    const ridgeAxis = ridged ? (opts.lenX <= opts.lenZ ? 'z' : 'x') : undefined
    buildEaveOverhang(eave, {
      lenX: opts.lenX, lenZ: opts.lenZ, overhang: overhangM, opacity: opts.opacity ?? 1,
      ridgeAxis, pitch: opts.pitch,
    })
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
  /** Board both faces (interior partitions), or a single face (exterior walls,
   *  whose outside gets SHEATHING instead — see `inward`). Default both. */
  bothSides?: boolean
  /** When single-sided, which face to board: the INSIDE one. */
  inward?: 1 | -1
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
  const { length, height, thickness, orientation = 'vertical', openings = [], bothSides = true, inward = 1, opacity = 1 } = opts
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

  // An exterior wall is boarded on the INSIDE only. Its outside face takes
  // sheathing and the rest of the envelope; drywall out there would be nonsense.
  const zs = bothSides ? [faceZ, -faceZ] : [inward * faceZ]
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

/**
 * Cladding for one wall — the finish that goes over the WRB.
 *
 * Three shapes, because these materials genuinely differ:
 *
 *  COURSED (lap siding, brick)  Laid in horizontal courses with a real exposure,
 *      each course lapping the one below. Drawn as separate courses rather than
 *      one textured slab, so the shadow lines read as siding and a takeoff can
 *      count them.
 *  CONTINUOUS (stucco, adhered stone, panel)  One surface over the whole wall.
 *  NONE  the wall is left as it is.
 *
 * `standoff` is how far the BACK of the cladding sits off the wall's stud face —
 * the caller works it out from the sheathing and WRB already on the wall, plus
 * the cladding's own cavity. Brick's cavity is why a brick house's outside face
 * is a good 4" further out than a sided one, and it has to be modelled, not
 * approximated: it is the difference between a wall that fits its footprint and
 * one that does not.
 */
export function buildWallCladding(opts: {
  length: number
  height: number
  /** Distance from wall centre to the BACK of the cladding. */
  standoff: number
  outward: 1 | -1
  spec: CladdingSpec
  openings?: WallOpening[]
  opacity?: number
}): THREE.Group {
  const { length, height, standoff, outward, spec, openings = [], opacity = 1 } = opts
  const g = new THREE.Group()
  g.userData.courseCount = 0
  if (length < 0.05 || height < 0.05) return g

  const half = length / 2
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(spec.color),
    roughness: spec.exposureM ? 0.8 : 0.92,
    metalness: 0,
    transparent: opacity < 1, opacity,
  })
  const info = spec.brand ? `${spec.label} · ${spec.brand}` : spec.label
  const z = outward * (standoff + spec.thicknessM / 2)

  const rects = openings.map((o) => {
    const cx = o.centerM - half
    const isDoor = o.type === 'door'
    const sill = isDoor ? 0 : (o.sillM ?? 0.9)
    const oh = o.heightM ?? (isDoor ? 2.06 : 1.13)
    const yLo = isDoor ? 0 : Math.min(sill, height - 0.3)
    return { x0: cx - o.widthM / 2, x1: cx + o.widthM / 2, y0: yLo, y1: Math.min(yLo + oh, height) }
  })
  /** Horizontal runs of a course left after the openings are cut out of it. */
  const spansAt = (y0: number, y1: number): Array<[number, number]> => {
    let spans: Array<[number, number]> = [[-half, half]]
    for (const r of rects) {
      if (r.y1 <= y0 || r.y0 >= y1) continue
      const next: Array<[number, number]> = []
      for (const [a, b] of spans) {
        if (r.x1 <= a || r.x0 >= b) { next.push([a, b]); continue }
        if (r.x0 > a) next.push([a, r.x0])
        if (r.x1 < b) next.push([r.x1, b])
      }
      spans = next
    }
    return spans.filter(([a, b]) => b - a > 0.02)
  }

  const add = (w: number, h: number, x: number, y: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, spec.thicknessM), mat)
    m.position.set(x, y, z)
    m.castShadow = true; m.receiveShadow = true
    m.userData.layer = 'cladding'
    m.userData.info = info
    g.add(m)
  }

  if (spec.exposureM) {
    // Coursed. Each course covers its exposure; the lap behind it is implied.
    let courses = 0
    for (let y = 0; y < height - 0.005; y += spec.exposureM) {
      const h = Math.min(spec.exposureM, height - y)
      if (h < 0.01) break
      for (const [a, b] of spansAt(y, y + h)) {
        add(b - a, h * 0.96, (a + b) / 2, y + h / 2)   // small reveal between courses
      }
      courses++
    }
    g.userData.courseCount = courses
  } else {
    // Continuous: one surface, minus the openings.
    for (const [a, b] of spansAt(0, height)) {
      // Vertical splits only happen at openings, so re-cut per opening band.
      add(b - a, height, (a + b) / 2, height / 2)
    }
    // Openings leave a hole that the single full-height piece above cannot
    // express, so add the strips over and under each opening.
    for (const r of rects) {
      const w = Math.min(r.x1, half) - Math.max(r.x0, -half)
      if (w <= 0.02) continue
      const cx = (Math.max(r.x0, -half) + Math.min(r.x1, half)) / 2
      if (r.y0 > 0.02) add(w, r.y0, cx, r.y0 / 2)                       // below
      if (height - r.y1 > 0.02) add(w, height - r.y1, cx, (height + r.y1) / 2)  // above
    }
  }
  return g
}

/**
 * Temporary 2x4 guardrail along the top of a wall — jobsite fall protection.
 *
 * How it actually gets built: posts and rail are nailed to the wall panel while
 * it is still lying flat on the deck, then once the walls are stood the sections
 * are linked with more 2x4 into one continuous run around the perimeter. So the
 * rail belongs to the WALL, not to the floor, which is why it is built here in
 * wall-local space and simply inherits the wall's position and angle — abutting
 * sections then line up into a continuous rail for free.
 *
 * `y = 0` is the wall's base; the rail sits above `wallHeight`, measured off the
 * deck that lands on the wall's top plate (see GUARDRAIL_TOP_M).
 *
 * Posts run to the INBOARD face, which is the side you can fall from.
 */
export function buildTemporaryGuardrail(opts: {
  length: number
  wallHeight: number
  thickness: number
  /** Which face is inboard: the side workers stand on. */
  inward: 1 | -1
  opacity?: number
}): THREE.Group {
  const { length, wallHeight, thickness, inward, opacity = 1 } = opts
  const g = new THREE.Group()
  if (length < 0.2) return g

  const { thick, wide } = GUARDRAIL_MEMBER
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#c8a465'), roughness: 0.8, metalness: 0,
    transparent: opacity < 1, opacity,
  })
  const add = (w: number, h: number, d: number, x: number, y: number, z: number, info: string) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat)
    m.position.set(x, y, z)
    m.castShadow = true
    m.userData.layer = 'guardrail'
    m.userData.info = info
    g.add(m)
  }

  const half = length / 2
  // Posts are lapped onto the inboard face of the wall, so they sit just inside it.
  const postZ = inward * (Math.max(STUD_WIDTH_M, thickness) / 2 - thick / 2)
  const topY = wallHeight + GUARDRAIL_TOP_M
  const midY = wallHeight + GUARDRAIL_TOP_M / 2
  // Posts reach from partway down the wall (where they are nailed off) to the top
  // rail — that overlap onto the studs is what makes the rail stand up.
  const postBottom = wallHeight - 0.6
  const postH = topY - postBottom

  const n = Math.max(2, Math.ceil(length / GUARDRAIL_POST_SPACING_M) + 1)
  for (let i = 0; i < n; i++) {
    const x = -half + (length * i) / (n - 1)
    add(thick, postH, wide, x, postBottom + postH / 2, postZ, 'Temp guardrail post · 2x4')
  }
  // Continuous top rail + midrail, full wall length so neighbours meet end to end.
  add(length, wide, thick, 0, topY, postZ, 'Temp guardrail · 2x4 top rail (42")')
  add(length, wide, thick, 0, midY, postZ, 'Temp guardrail · 2x4 midrail')
  return g
}

// ── Exterior envelope: sheathing + WRB ───────────────────────────────────────

export interface WallEnvelopeOpts {
  length: number
  height: number
  /** Framing thickness (stud depth) — the envelope sits outboard of this. */
  thickness: number
  /** Which face is OUTSIDE: +1 for the +Z face, -1 for the -Z face. */
  outward: 1 | -1
  sheathing: EnvelopeLayer
  wrb: EnvelopeLayer | null
  openings?: WallOpening[]
  opacity?: number
}

/**
 * The exterior skin for one wall: sheathing panels, then housewrap over them.
 *
 * Sheathing is modelled as real 4×8 panels with visible joints, like the drywall
 * and the subfloor — a sheet count is what a takeoff needs, and the joint pattern
 * is how you tell sheathing from a solid slab at a glance. Panels run VERTICALLY
 * (the long side up), which is how they go on a stud wall so each edge lands on a
 * stud.
 *
 * The housewrap is ONE continuous skin, not panels, because that is exactly what
 * it is — a roll lapped over the whole wall. It crosses window openings in reality
 * and is cut afterwards, but here it is cut with the openings so you can see
 * through a window.
 *
 * `outward` matters: sheathing on the inside face of an exterior wall would be
 * both wrong and invisible from outside, so the caller has to say which way the
 * wall faces. Sheet count lands on `group.userData.sheetCount`.
 */
export function buildWallEnvelope(opts: WallEnvelopeOpts): THREE.Group {
  const { length, height, thickness, outward, sheathing, wrb, openings = [], opacity = 1 } = opts
  const group = new THREE.Group()
  group.userData.sheetCount = 0
  if (length < 0.05 || height < 0.05) return group

  const depth = Math.max(STUD_WIDTH_M, thickness)
  const half = length / 2
  // Stack outward from the stud face: sheathing first, then the wrap on top of it.
  const sheathZ = outward * (depth / 2 + sheathing.thicknessM / 2)
  const wrbZ = outward * (depth / 2 + sheathing.thicknessM + (wrb?.thicknessM ?? 0) / 2)

  const sheathMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(sheathing.color), roughness: 0.9, metalness: 0,
    transparent: opacity < 1, opacity,
  })

  const rects = openings.map((o) => {
    const cx = o.centerM - half
    const isDoor = o.type === 'door'
    const sill = isDoor ? 0 : (o.sillM ?? 0.9)
    const oh = o.heightM ?? (isDoor ? 2.06 : 1.13)
    const yLo = isDoor ? 0 : Math.min(sill, height - 0.3)
    return { x0: cx - o.widthM / 2, x1: cx + o.widthM / 2, y0: yLo, y1: Math.min(yLo + oh, height) }
  })
  const overlapsOpening = (x0: number, x1: number, y0: number, y1: number) =>
    rects.some((r) => x0 < r.x1 && x1 > r.x0 && y0 < r.y1 && y1 > r.y0)

  // Vertical panels: 4' wide, 8' tall.
  let count = 0
  for (let x = -half; x < half - 0.02; x += SHEET_SHORT + SHEET_GAP) {
    const w = Math.min(SHEET_SHORT, half - x)
    if (w < 0.05) continue
    for (let y = 0; y < height - 0.02; y += SHEET_LONG + SHEET_GAP) {
      const h = Math.min(SHEET_LONG, height - y)
      if (h < 0.05) continue
      if (overlapsOpening(x, x + w, y, y + h)) continue
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(w - SHEET_GAP, h - SHEET_GAP, sheathing.thicknessM),
        sheathMat,
      )
      m.position.set(x + w / 2, y + h / 2, sheathZ)
      m.castShadow = true; m.receiveShadow = true
      m.userData.layer = 'sheathing'
      m.userData.info = sheathing.brand
        ? `${sheathing.label} · ${sheathing.brand}`
        : sheathing.label
      group.add(m)
      count++
    }
  }
  group.userData.sheetCount = count

  if (wrb) {
    // One continuous membrane, minus the openings so you can see through them.
    const wrbMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(wrb.color), roughness: 0.65, metalness: 0,
      transparent: true, opacity: Math.min(opacity, 0.97),
    })
    const info = wrb.brand ? `${wrb.label} · ${wrb.brand}` : wrb.label
    // Split the wall into horizontal courses and drop the pieces that fall in an
    // opening — a cheap way to get "wrapped, with the windows cut out".
    const COURSE = 1.5   // ~5' roll width
    for (let y = 0; y < height - 0.01; y += COURSE) {
      const h = Math.min(COURSE, height - y)
      const spans: Array<[number, number]> = [[-half, half]]
      for (const r of rects) {
        if (r.y1 <= y || r.y0 >= y + h) continue
        for (let i = spans.length - 1; i >= 0; i--) {
          const [a, b] = spans[i]
          if (r.x1 <= a || r.x0 >= b) continue
          spans.splice(i, 1, ...([[a, Math.min(b, r.x0)], [Math.max(a, r.x1), b]]
            .filter(([p, q]) => q - p > 0.02) as Array<[number, number]>))
        }
      }
      for (const [a, b] of spans) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(b - a, h, wrb.thicknessM), wrbMat)
        m.position.set((a + b) / 2, y + h / 2, wrbZ)
        m.userData.layer = 'sheathing'
        m.userData.info = info
        group.add(m)
      }
    }
  }
  return group
}
