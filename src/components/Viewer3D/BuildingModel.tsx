import { useEffect, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useAppStore } from '../../store/useAppStore'
import { useConfigStore } from '../../store/useConfigStore'
import { useFloorplanLocalStore } from '../../store/useFloorplanLocalStore'
import type { Drawing, FloorLevel, FloorplanOverlayState, Layer, ParsedRoom, ParsedWall } from '../../types'
import type { PlacedComponent } from '../../services/decisions'
import { logEvent } from '../../services/logger'
import { deriveWorkspaceSceneConfig } from '../../services/workspaceScene'
import { getCatalogItem } from '../../data/objectCatalog'
import { WALL_THICKNESS_M, wallMaterialPreset } from '../../services/constructionCode'
import { blockMaterial } from '../../services/framingGeometry'
import { explodeRuntime, FLOOR_SEP, systemOffset } from './explodeRuntime'

/** Reused scratch vector for the per-system explode offset (one per frame). */
const explodeOffsetTmp = new THREE.Vector3()

/** Wall finishes that should render as block courses, not a flat colour. */
const MASONRY_FINISHES = new Set(['brick', 'exposedBrick', 'stone', 'concrete'])

interface Props {
  layers: Layer[]
}

// Default scale when no calibration exists: 1:100 metric floor plan at 108 DPI
const DEFAULT_SCALE_MM_PER_PX = 23.5

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mat(color: string, opacity: number, extra?: Partial<THREE.MeshStandardMaterialParameters>) {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    transparent: opacity < 1,
    opacity,
    ...extra,
  })
}

/** Map a scene layer to its explode system key (MEP disciplines collapse to one). */
function explodeSystemKey(layer: unknown): string {
  if (layer === 'electrical' || layer === 'plumbing' || layer === 'mechanical') return 'mep'
  return typeof layer === 'string' ? layer : 'walls'
}

/** Free the GPU resources held by a scene object and any descendants. */
function disposeObject(obj: THREE.Object3D) {
  obj.traverse((node) => {
    const mesh = node as Partial<THREE.Mesh>
    mesh.geometry?.dispose()
    const material = mesh.material
    if (Array.isArray(material)) material.forEach((m) => m.dispose())
    else material?.dispose()
  })
}

interface Footprint { minX: number; maxX: number; minZ: number; maxZ: number }

function centerOfWalls(walls: ParsedWall[]): [number, number] {
  if (walls.length === 0) return [0, 0]
  let sx = 0, sy = 0
  for (const w of walls) { sx += (w.x1 + w.x2) / 2; sy += (w.y1 + w.y2) / 2 }
  return [sx / walls.length, sy / walls.length]
}

// ─── Pixel → world transforms ─────────────────────────────────────────────────
//
// Geometry parsed from a drawing lives in image-pixel space. To appear in the
// right place in the 3D world it must use the SAME mapping as the floorplan
// overlay the user positioned/calibrated — otherwise walls render offset from
// the print they were traced on.

interface DrawingTransform {
  /** Map an image-pixel coordinate to world [x, z] metres */
  toWorld: (px: number, py: number) => [number, number]
  /** Average metres-per-pixel — for thickness/width scalars */
  mPerPx: number
  /** World yaw applied by this transform (for axis-aligned plates/markers) */
  yawRad: number
}

/** Transform matching FloorplanOverlay/LiveWallsLayer: overlay position+scale+rotation. */
function makeOverlayTransform(
  overlay: FloorplanOverlayState,
  imageWidth: number,
  imageHeight: number,
): DrawingTransform {
  const rot = THREE.MathUtils.degToRad(overlay.rotationDeg)
  const cos = Math.cos(rot)
  const sin = Math.sin(rot)
  const [w, d] = overlay.scale
  return {
    toWorld: (px, py) => {
      const lx = ((px / imageWidth) - 0.5) * w
      const lz = ((py / imageHeight) - 0.5) * d
      return [
        overlay.position[0] + lx * cos + lz * sin,
        overlay.position[1] - lx * sin + lz * cos,
      ]
    },
    mPerPx: (w / imageWidth + d / imageHeight) / 2,
    yawRad: rot,
  }
}

/** Legacy transform for sheets not bound to the overlay: centred at the wall centroid. */
function makeCenteredTransform(cx: number, cy: number, mmPerPx: number): DrawingTransform {
  const s = mmPerPx / 1000
  return {
    toWorld: (px, py) => [(px - cx) * s, (py - cy) * s],
    mPerPx: s,
    yawRad: 0,
  }
}

function footprintOfTransformed(walls: ParsedWall[], t: DrawingTransform): Footprint {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
  for (const w of walls) {
    const [x1, z1] = t.toWorld(w.x1, w.y1)
    const [x2, z2] = t.toWorld(w.x2, w.y2)
    minX = Math.min(minX, x1, x2); maxX = Math.max(maxX, x1, x2)
    minZ = Math.min(minZ, z1, z2); maxZ = Math.max(maxZ, z1, z2)
  }
  return { minX, maxX, minZ, maxZ }
}

// ─── Real geometry from detected walls ────────────────────────────────────────

/** A user-placed door/window in world space, to be cut into a wall. */
interface OpeningSpec {
  x: number
  z: number
  /** Clear opening width along the wall, metres */
  width: number
  /** Clear opening height from the floor, metres */
  height: number
  type: 'door' | 'window'
}

function buildRealWalls(
  group: THREE.Group,
  walls: ParsedWall[],
  transform: DrawingTransform,
  elevation: number,
  floorHeight: number,
  wallMat: THREE.MeshStandardMaterial,
  layerId: string,
  defaultThicknessM: number,
  openings: OpeningSpec[] = [],
) {
  // Pre-compute metric geometry for every wall so we can clean up corners.
  // Coordinates come from the drawing's transform so the build lands exactly
  // where the floor-plan overlay is placed (overlay or centred transform).
  const segs = walls.map((w) => {
    const [x1, z1] = transform.toWorld(w.x1, w.y1)
    const [x2, z2] = transform.toWorld(w.x2, w.y2)
    // A stamped framing type (2×4 / 2×6 / steel / CMU) sets a real nominal
    // thickness so different framing reads as visibly different walls; auto
    // walls without one fall back to the pixel-derived/default thickness.
    const framingThick = w.framingType ? WALL_THICKNESS_M[w.framingType] : undefined
    return {
      w, x1, z1, x2, z2,
      len: Math.hypot(x2 - x1, z2 - z1),
      thick: framingThick ?? Math.max(w.thickness > 1 ? w.thickness * transform.mPerPx : defaultThicknessM, 0.05),
    }
  })

  const JOIN_TOL = 0.06  // metres — endpoints this close are treated as one corner
  const wallTop = floorHeight - 0.15

  // Trim a wall end back to its neighbour's face so corners read clean: at a
  // shared corner the lowest-index wall runs through and the others butt into
  // it (no overlap, no gap). Returns how far to pull this end in (metres).
  const trimAt = (selfIdx: number, px: number, pz: number): number => {
    let trim = 0
    for (let j = 0; j < selfIdx; j++) {  // only lower-index walls run through
      const o = segs[j]
      const near = Math.min(Math.hypot(o.x1 - px, o.z1 - pz), Math.hypot(o.x2 - px, o.z2 - pz))
      if (near < JOIN_TOL) trim = Math.max(trim, o.thick / 2)
    }
    return trim
  }

  // Assign each placed opening to the nearest wall segment it sits on. A door
  // dropped within ~20px (of the print) of a wall line snaps onto it.
  const perpTol = Math.max(0.4, 20 * transform.mPerPx)
  const openingsBySeg = new Map<number, Array<{ t: number; width: number; height: number }>>()
  for (const op of openings) {
    let bestI = -1, bestPerp = Infinity, bestT = 0
    segs.forEach((s, i) => {
      if (s.len < 0.1) return
      const ux = (s.x2 - s.x1) / s.len, uz = (s.z2 - s.z1) / s.len
      const dx = op.x - s.x1, dz = op.z - s.z1
      const t = dx * ux + dz * uz
      if (t < 0 || t > s.len) return
      const perp = Math.abs(-dx * uz + dz * ux)
      if (perp < bestPerp) { bestPerp = perp; bestI = i; bestT = t }
    })
    if (bestI >= 0 && bestPerp <= perpTol + segs[bestI].thick) {
      const arr = openingsBySeg.get(bestI) ?? []
      arr.push({ t: bestT, width: op.width, height: op.height })
      openingsBySeg.set(bestI, arr)
    }
  }

  const headerMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(FRAMING_COLORS['header']), roughness: 0.7 })
  const studMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(FRAMING_COLORS['king-stud']), roughness: 0.7 })
  const STUD_W = 0.05
  const HEADER_THK = 0.2

  segs.forEach((seg, i) => {
    if (seg.len < 0.1) return  // skip tiny segments (<10cm)
    const ux = (seg.x2 - seg.x1) / seg.len
    const uz = (seg.z2 - seg.z1) / seg.len
    const trimA = trimAt(i, seg.x1, seg.z1)
    const trimB = trimAt(i, seg.x2, seg.z2)
    const len = seg.len - trimA - trimB
    if (len < 0.05) return  // consumed by trims

    const ax = seg.x1 + ux * trimA, az = seg.z1 + uz * trimA
    const angle = Math.atan2(seg.z2 - seg.z1, seg.x2 - seg.x1)
    const thick = seg.thick

    // Two-material wall body: interior finish on one broad face, exterior
    // cladding on the other. Materials come from the wall's chosen presets,
    // inheriting the wall layer's opacity.
    const masonryKind = (key: string): 'brick' | 'cmu' | 'stone' =>
      key === 'brick' || key === 'exposedBrick' ? 'brick' : key === 'stone' ? 'stone' : 'cmu'
    const finishMaterial = (key: string) => {
      // Masonry finishes get the tiled block/mortar texture sized to this face.
      if (MASONRY_FINISHES.has(key)) return blockMaterial(len, floorHeight, wallMat.opacity, masonryKind(key))
      const p = wallMaterialPreset(key)
      return new THREE.MeshStandardMaterial({
        color: new THREE.Color(p.color),
        roughness: p.roughness,
        metalness: p.metalness ?? 0,
        transparent: wallMat.opacity < 1,
        opacity: wallMat.opacity,
      })
    }
    // Masonry walls (CMU/brick) are solid block through-and-through — force the
    // block/mortar texture on BOTH faces (not via finish-key lookup, so it can't
    // fall back to a flat/blank material), matching the ghost. Everything else
    // uses its chosen interior/exterior finish presets.
    const masonryWall = seg.w.wallType === 'masonry-thick' || seg.w.framingType === 'cmu'
    const extKey = seg.w.exteriorMaterial ?? (seg.w.wallRole === 'exterior-bearing' ? 'stucco' : 'drywall')
    const mKind = masonryKind(seg.w.exteriorMaterial ?? 'concrete')
    const bodyMats: THREE.MeshStandardMaterial[] = masonryWall
      ? [blockMaterial(len, floorHeight, wallMat.opacity, mKind), blockMaterial(len, floorHeight, wallMat.opacity, mKind)]
      : [
          finishMaterial(seg.w.interiorMaterial ?? 'drywall'), // index 0 — interior
          finishMaterial(extKey),                              // index 1 — exterior
        ]

    // Place a box oriented along this wall. `tCenter` is the distance along the
    // wall from `a`; the box spans `lengthAlong` and rises `height` from `yBottom`.
    // A material array drives the two-face wall body; a single material is used
    // for framing members (studs/header).
    const placeAlong = (
      tCenter: number, lengthAlong: number, yBottom: number, height: number,
      depthAcross: number, material: THREE.MeshStandardMaterial | THREE.MeshStandardMaterial[],
    ) => {
      if (lengthAlong <= 0.001 || height <= 0.001) return
      const wx = ax + ux * tCenter
      const wz = az + uz * tCenter
      const geo = new THREE.BoxGeometry(lengthAlong, height, depthAcross)
      if (Array.isArray(material)) {
        // BoxGeometry groups are ordered +x,−x,+y,−y,+z,−z (matIndex 0..5). The
        // two broad faces are ±Z: +Z → exterior (1), everything else → interior (0).
        for (const g of geo.groups) g.materialIndex = g.materialIndex === 4 ? 1 : 0
      }
      const m = new THREE.Mesh(geo, material)
      m.position.set(wx, elevation + yBottom + height / 2, wz)
      m.rotation.y = -angle
      m.castShadow = true
      m.receiveShadow = true
      m.userData.layer = layerId
      group.add(m)
    }

    // Openings on this wall, mapped to trimmed-wall distance, clamped & sorted.
    const ops = (openingsBySeg.get(i) ?? [])
      .map((o) => {
        const c = o.t - trimA
        const w = Math.min(o.width, len - 0.1)
        const h = Math.min(o.height, wallTop - HEADER_THK - 0.05)
        return { c, w, h, s0: c - w / 2, s1: c + w / 2 }
      })
      .filter((o) => o.w > 0.05 && o.h > 0.1 && o.s1 > 0.05 && o.s0 < len - 0.05)
      .map((o) => ({ ...o, s0: Math.max(0, o.s0), s1: Math.min(len, o.s1) }))
      .sort((a, b) => a.s0 - b.s0)

    if (ops.length === 0) {
      placeAlong(len / 2, len, 0, wallTop, thick, bodyMats)
      return
    }

    let cursor = 0
    for (const o of ops) {
      // Solid full-height wall up to the opening.
      if (o.s0 - cursor > 0.02) placeAlong((cursor + o.s0) / 2, o.s0 - cursor, 0, wallTop, thick, bodyMats)
      // "Header above" — the wall piece spanning the opening above the header.
      placeAlong(o.c, o.w, o.h, wallTop - o.h, thick, bodyMats)
      // Header beam at the top of the clear opening (proud so it reads as framing).
      placeAlong(o.c, o.w + STUD_W * 2, o.h, HEADER_THK, thick + 0.04, headerMat)
      // Jack studs carry the header — full opening height, just inside the edges.
      placeAlong(o.s0 + STUD_W / 2, STUD_W, 0, o.h, thick + 0.04, studMat)
      placeAlong(o.s1 - STUD_W / 2, STUD_W, 0, o.h, thick + 0.04, studMat)
      // King studs beside the jacks — full wall height.
      placeAlong(o.s0 - STUD_W / 2, STUD_W, 0, wallTop, thick + 0.04, studMat)
      placeAlong(o.s1 + STUD_W / 2, STUD_W, 0, wallTop, thick + 0.04, studMat)
      cursor = o.s1
    }
    // Remaining solid wall after the last opening.
    if (len - cursor > 0.02) placeAlong((cursor + len) / 2, len - cursor, 0, wallTop, thick, bodyMats)
  })
}

function buildFoundation(
  group: THREE.Group,
  fp: Footprint,
  foundationType: string,
) {
  const W = fp.maxX - fp.minX + 0.8
  const D = fp.maxZ - fp.minZ + 0.8
  const cx = (fp.minX + fp.maxX) / 2
  const cz = (fp.minZ + fp.maxZ) / 2
  const depth = /basement/i.test(foundationType) ? 1.2 : /pier|pile/i.test(foundationType) ? 0.5 : 0.35
  // Concrete grey so it reads as a poured foundation, not a mystery black slab.
  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#aab0b8'),
    metalness: 0.02,
    roughness: 0.96,
  })
  const slab = new THREE.Mesh(new THREE.BoxGeometry(W, depth, D), material)
  slab.position.set(cx, -depth / 2, cz)
  slab.receiveShadow = true
  slab.userData.layer = 'structure'
  group.add(slab)
}

function buildSpecialFeatures(
  group: THREE.Group,
  fp: Footprint,
  elevation: number,
  floorHeight: number,
  features: string[],
) {
  if (features.length === 0) return
  const cx = (fp.minX + fp.maxX) / 2
  const cz = (fp.minZ + fp.maxZ) / 2
  const featureMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#f59e0b'),
    transparent: true,
    opacity: 0.45,
    roughness: 0.5,
  })
  if (features.includes('soffit') || features.includes('bulkhead')) {
    const soffit = new THREE.Mesh(new THREE.BoxGeometry((fp.maxX - fp.minX) * 0.35, 0.28, 0.6), featureMat)
    soffit.position.set(cx, elevation + floorHeight - 0.25, fp.minZ + 0.8)
    soffit.userData.layer = 'ceiling'
    group.add(soffit)
  }
  if (features.includes('niche') || features.includes('reveal')) {
    const niche = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.4, 0.2), featureMat)
    niche.position.set(fp.maxX - 0.5, elevation + 1, cz)
    niche.userData.layer = 'walls'
    group.add(niche)
  }
}

const SCENE_MODULE_ORDER = [
  'foundation',
  'floors',
  'walls',
  'rooms',
  'ceiling',
  'structure',
  'mep',
  'special-features',
  'excavation',
] as const

// ─── Procedural footprint geometry (fallback) ─────────────────────────────────

function buildProceduralWalls(
  group: THREE.Group,
  fp: Footprint,
  elevation: number,
  floorHeight: number,
  wallMat: THREE.MeshStandardMaterial
) {
  const W = fp.maxX - fp.minX
  const D = fp.maxZ - fp.minZ
  const cx = (fp.minX + fp.maxX) / 2
  const cz = (fp.minZ + fp.maxZ) / 2

  const configs: Array<[number, number, number, number]> = [
    [cx, fp.minZ, W, 0.25],
    [cx, fp.maxZ, W, 0.25],
    [fp.minX, cz, 0.25, D],
    [fp.maxX, cz, 0.25, D],
  ]
  for (const [wx, wz, ww, wd] of configs) {
    const geo = new THREE.BoxGeometry(ww, floorHeight - 0.15, wd)
    const mesh = new THREE.Mesh(geo, wallMat)
    mesh.position.set(wx, elevation + floorHeight / 2, wz)
    mesh.castShadow = true
    mesh.receiveShadow = true
    mesh.userData.layer = 'walls'
    group.add(mesh)
  }

  // Interior partition
  const partGeo = new THREE.BoxGeometry(0.2, floorHeight - 0.15, D * 0.55)
  const part = new THREE.Mesh(partGeo, wallMat)
  part.position.set(cx - W * 0.15, elevation + floorHeight / 2, cz)
  part.userData.layer = 'walls'
  group.add(part)
}

// ─── Floor slab ───────────────────────────────────────────────────────────────

function buildFloorSlab(
  group: THREE.Group,
  fp: Footprint,
  elevation: number,
  color: string,
  opacity: number
) {
  const W = fp.maxX - fp.minX
  const D = fp.maxZ - fp.minZ
  const geo = new THREE.BoxGeometry(W, 0.2, D)
  const mesh = new THREE.Mesh(geo, mat(color, opacity, { roughness: 0.8 }))
  mesh.position.set((fp.minX + fp.maxX) / 2, elevation, (fp.minZ + fp.maxZ) / 2)
  mesh.receiveShadow = true
  mesh.userData.layer = 'floors'
  group.add(mesh)
}

// ─── Ceiling / RCP ────────────────────────────────────────────────────────────

function buildCeiling(
  group: THREE.Group,
  fp: Footprint,
  elevation: number,
  floorHeight: number,
  color: string,
  opacity: number
) {
  const W = fp.maxX - fp.minX - 0.3
  const D = fp.maxZ - fp.minZ - 0.3
  const geo = new THREE.BoxGeometry(W, 0.08, D)
  const mesh = new THREE.Mesh(
    geo,
    mat(color, opacity * 0.5, { side: THREE.DoubleSide })
  )
  mesh.position.set(
    (fp.minX + fp.maxX) / 2,
    elevation + floorHeight - 0.1,
    (fp.minZ + fp.maxZ) / 2
  )
  mesh.userData.layer = 'ceiling'
  group.add(mesh)
}

// ─── Structure (columns + beams) ─────────────────────────────────────────────

function buildStructure(
  group: THREE.Group,
  fp: Footprint,
  elevation: number,
  floorHeight: number,
  colMat: THREE.MeshStandardMaterial
) {
  const W = fp.maxX - fp.minX
  const cx = (fp.minX + fp.maxX) / 2
  const cz = (fp.minZ + fp.maxZ) / 2

  const cols = [
    [fp.minX + 0.3, fp.minZ + 0.3],
    [fp.maxX - 0.3, fp.minZ + 0.3],
    [fp.minX + 0.3, fp.maxZ - 0.3],
    [fp.maxX - 0.3, fp.maxZ - 0.3],
    [cx, fp.minZ + 0.3],
    [cx, fp.maxZ - 0.3],
  ]
  for (const [sx, sz] of cols) {
    const geo = new THREE.BoxGeometry(0.4, floorHeight, 0.4)
    const mesh = new THREE.Mesh(geo, colMat)
    mesh.position.set(sx, elevation + floorHeight / 2, sz)
    mesh.castShadow = true
    mesh.userData.layer = 'structure'
    group.add(mesh)
  }
  const beamGeo = new THREE.BoxGeometry(W, 0.3, 0.25)
  const beam = new THREE.Mesh(beamGeo, colMat)
  beam.position.set(cx, elevation + floorHeight - 0.15, cz)
  beam.userData.layer = 'structure'
  group.add(beam)
}

// ─── MEP systems ──────────────────────────────────────────────────────────────

function buildMEP(
  group: THREE.Group,
  fp: Footprint,
  elevation: number,
  floorHeight: number,
  layers: Layer[],
  hasElec: boolean,
  hasPlumb: boolean,
  hasMech: boolean
) {
  const W = fp.maxX - fp.minX
  const D = fp.maxZ - fp.minZ
  const cx = (fp.minX + fp.maxX) / 2
  const cz = (fp.minZ + fp.maxZ) / 2

  // Electrical conduits & panels
  const elecLayer = layers.find((l) => l.id === 'electrical')
  if (elecLayer && elecLayer.visible && hasElec) {
    const eMat = mat(elecLayer.color, elecLayer.opacity, {
      emissive: new THREE.Color(elecLayer.color),
      emissiveIntensity: 0.25,
    })
    const pts = [
      [cx - W * 0.3, cz - D * 0.3],
      [cx, cz - D * 0.3],
      [cx + W * 0.3, cz - D * 0.3],
      [cx - W * 0.3, cz + D * 0.3],
      [cx + W * 0.3, cz + D * 0.3],
    ]
    for (const [ex, ez] of pts) {
      const cGeo = new THREE.CylinderGeometry(0.04, 0.04, floorHeight, 6)
      const c = new THREE.Mesh(cGeo, eMat)
      c.position.set(ex, elevation + floorHeight / 2, ez)
      c.userData.layer = 'electrical'
      group.add(c)
      // Panel
      const pGeo = new THREE.BoxGeometry(0.25, 0.35, 0.08)
      const p = new THREE.Mesh(pGeo, eMat)
      p.position.set(ex, elevation + 1.4, ez + 0.15)
      p.userData.layer = 'electrical'
      group.add(p)
    }
  }

  // Plumbing risers + horizontal run
  const plumbLayer = layers.find((l) => l.id === 'plumbing')
  if (plumbLayer && plumbLayer.visible && hasPlumb) {
    const pMat = mat(plumbLayer.color, plumbLayer.opacity, { metalness: 0.5, roughness: 0.4 })
    const riserPts = [
      [cx - W * 0.25, cz - D * 0.25],
      [cx + W * 0.25, cz - D * 0.25],
      [cx, cz + D * 0.25],
    ]
    for (const [rx, rz] of riserPts) {
      const rGeo = new THREE.CylinderGeometry(0.07, 0.07, floorHeight, 8)
      const r = new THREE.Mesh(rGeo, pMat)
      r.position.set(rx, elevation + floorHeight / 2, rz)
      r.userData.layer = 'plumbing'
      group.add(r)
    }
    const hGeo = new THREE.CylinderGeometry(0.05, 0.05, W * 0.7, 8)
    const h = new THREE.Mesh(hGeo, pMat)
    h.rotation.z = Math.PI / 2
    h.position.set(cx, elevation + 0.35, cz - D * 0.25)
    h.userData.layer = 'plumbing'
    group.add(h)
  }

  // Mechanical ducts + AHU
  const mechLayer = layers.find((l) => l.id === 'mechanical')
  if (mechLayer && mechLayer.visible && hasMech) {
    const mMat = mat(mechLayer.color, mechLayer.opacity, { metalness: 0.3 })
    const dGeo = new THREE.BoxGeometry(W * 0.75, 0.28, 0.45)
    const duct = new THREE.Mesh(dGeo, mMat)
    duct.position.set(cx, elevation + floorHeight - 0.45, cz)
    duct.userData.layer = 'mechanical'
    group.add(duct)
    const aGeo = new THREE.BoxGeometry(1.1, 0.75, 0.75)
    const ahu = new THREE.Mesh(aGeo, mMat)
    ahu.position.set(fp.minX + 0.8, elevation + floorHeight - 0.6, cz)
    ahu.userData.layer = 'mechanical'
    group.add(ahu)
  }
}

// ─── Room floor plates ────────────────────────────────────────────────────────

/** Cycle of muted, semi-transparent tints for individual room floor plates. */
const ROOM_TINTS = [
  '#bfdbfe', // blue-200
  '#bbf7d0', // green-200
  '#fde68a', // amber-200
  '#fecaca', // red-200
  '#e9d5ff', // purple-200
  '#fed7aa', // orange-200
  '#a5f3fc', // cyan-200
  '#d9f99d', // lime-200
]

function buildRoomPlates(
  group: THREE.Group,
  rooms: ParsedRoom[],
  transform: DrawingTransform,
  elevation: number,
  layerId: string
) {
  rooms.forEach((room, i) => {
    const rw = (room.x2 - room.x1) * transform.mPerPx
    const rd = (room.y2 - room.y1) * transform.mPerPx
    if (rw <= 0 || rd <= 0) return

    const [cx, cz] = transform.toWorld((room.x1 + room.x2) / 2, (room.y1 + room.y2) / 2)

    const geo = new THREE.BoxGeometry(rw, 0.01, rd)
    const color = ROOM_TINTS[i % ROOM_TINTS.length]
    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(color),
        transparent: true,
        opacity: 0.35,
        roughness: 0.9,
        side: THREE.DoubleSide,
      }),
    )
    mesh.position.set(cx, elevation + 0.02, cz)
    mesh.rotation.y = transform.yawRad
    mesh.receiveShadow = true
    mesh.userData.layer = layerId
    group.add(mesh)
  })
}

// ─── Framing from Construction Engine ─────────────────────────────────────────

const FRAMING_COLORS: Record<string, string> = {
  'stud': '#c9a56c',
  'top-plate': '#b8944f',
  'bottom-plate': '#b8944f',
  'king-stud': '#d4a574',
  'jack-stud': '#d4a574',
  'header': '#a67b3d',
  'cripple-stud': '#dbb98a',
  'corner-assembly': '#c9a56c',
  'blocking': '#b8944f',
}

/**
 * Build a cold-formed-steel C-channel as a group of three thin boxes (web +
 * two flanges) — robust orientation from plain box maths, no extrude-axis
 * guesswork. C-studs open along the wall; track webs sit at the top/bottom.
 */
function buildCChannel(comp: PlacedComponent, material: THREE.MeshStandardMaterial): THREE.Group {
  const [w, h, d] = comp.dimensions
  const t = Math.min(0.005, w * 0.35, h * 0.35, d * 0.35) // sheet thickness (render)
  const g = new THREE.Group()
  const add = (dims: [number, number, number], pos: [number, number, number]) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(...dims), material)
    m.position.set(...pos)
    m.castShadow = true
    m.receiveShadow = true
    g.add(m)
  }
  if (comp.profile === 'track') {
    // x = run along wall, y = leg height, z = web depth across wall.
    const top = comp.componentType === 'top-plate'
    add([w, t, d], [0, top ? h / 2 - t / 2 : -(h / 2 - t / 2), 0]) // web
    add([w, h, t], [0, 0, d / 2 - t / 2]) // flange
    add([w, h, t], [0, 0, -(d / 2 - t / 2)]) // flange
  } else {
    // C-stud: x = flange run along wall, y = length, z = web depth across wall.
    add([t, h, d], [-(w / 2 - t / 2), 0, 0]) // web
    add([w, h, t], [0, 0, d / 2 - t / 2]) // flange
    add([w, h, t], [0, 0, -(d / 2 - t / 2)]) // flange
  }
  return g
}

/**
 * Maps the engine's centroid-based framing coordinates onto the SAME overlay
 * space the traced walls/ghost use, so the built framing lands exactly on the
 * trace. Reproduces makeOverlayTransform.toWorld per component (positions stay
 * direct children of the explode group, so explode still fans them).
 */
interface FramingAlign {
  cos: number; sin: number
  px: number; pz: number     // overlay world origin
  lx0: number; lz0: number   // local offset of the engine centroid
  kx: number; kz: number     // engine-metre → overlay-metre scale
  yaw: number                // overlay rotation added to each component
}

function buildFramingGeometry(
  group: THREE.Group,
  components: PlacedComponent[],
  opacity: number,
  align?: FramingAlign,
) {
  // Shared steel material — silvery, metallic — reused across all C-channels.
  const steelMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#9aa6b2'),
    transparent: opacity < 1,
    opacity,
    roughness: 0.35,
    metalness: 0.85,
  })

  for (const comp of components) {
    const [w, h, d] = comp.dimensions
    if (w < 0.001 || h < 0.001 || d < 0.001) continue

    const isSteel = comp.profile === 'c-stud' || comp.profile === 'track'
    const obj: THREE.Object3D = isSteel
      ? buildCChannel(comp, steelMat)
      : new THREE.Mesh(
          new THREE.BoxGeometry(w, h, d),
          new THREE.MeshStandardMaterial({
            color: new THREE.Color(FRAMING_COLORS[comp.componentType] ?? '#c9a56c'),
            transparent: opacity < 1,
            opacity,
            roughness: 0.75,
            metalness: 0.05,
          }),
        )

    if (obj instanceof THREE.Mesh) {
      obj.castShadow = true
      obj.receiveShadow = true
    }
    if (align) {
      const lx = align.lx0 + comp.position[0] * align.kx
      const lz = align.lz0 + comp.position[2] * align.kz
      obj.position.set(
        align.px + lx * align.cos + lz * align.sin,
        comp.position[1],
        align.pz - lx * align.sin + lz * align.cos,
      )
      obj.rotation.set(comp.rotation[0], comp.rotation[1] + align.yaw, comp.rotation[2])
    } else {
      obj.position.set(comp.position[0], comp.position[1], comp.position[2])
      obj.rotation.set(comp.rotation[0], comp.rotation[1], comp.rotation[2])
    }
    obj.userData.layer = 'framing'
    obj.userData.id = comp.id
    obj.userData.componentType = comp.componentType
    obj.userData.label = comp.label
    group.add(obj)
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function BuildingModel({ layers }: Props) {
  const groupRef = useRef<THREE.Group>(null)
  const drawings = useAppStore((s) => s.drawings)
  const model = useAppStore((s) => s.model)
  const buildResult = useAppStore((s) => s.buildResult)
  const wizardInputs = useAppStore((s) => s.wizardInputs)
  const overlay = useAppStore((s) => s.floorplanOverlay)
  const placedObjects = useAppStore((s) => s.placedObjects)
  const floorsAreas = useAppStore((s) => s.floorsAreas)
  const setModelStatus = useAppStore((s) => s.setModelStatus)
  const explodeAmountRaw = useAppStore((s) => s.explodeAmount)
  const traceModeExplode = useFloorplanLocalStore((s) => s.traceMode)
  // Tracing forces the model ASSEMBLED — an exploded scene during a trace stacks
  // per-level content into "layered prints" and ruins tapping.
  const explodeAmount = traceModeExplode ? 0 : explodeAmountRaw
  const explodeSpeed = useConfigStore((s) => s.explodeSpeed)
  const explodeSpread = useConfigStore((s) => s.explodeSpread)
  const explodeMults = useConfigStore((s) => s.explodeSystemMultipliers)
  const isolatedFloor = useFloorplanLocalStore((s) => s.isolatedFloor)
  const ghostedLevels = useFloorplanLocalStore((s) => s.ghostedLevels)

  // Explode animation state that must persist across frames (not re-rendered).
  const explodeCurrentRef = useRef(0)
  const explodeCenterRef = useRef(new THREE.Vector3())

  useEffect(() => {
    if (!groupRef.current) return
    const group = groupRef.current
    // Tear down the previous build, freeing GPU resources (e.g. the preview
    // room's meshes when a real build replaces it).
    while (group.children.length > 0) {
      const child = group.children[0]
      group.remove(child)
      disposeObject(child)
    }

    const layerMap = new Map(layers.map((l) => [l.id, l]))
    const sceneConfig = deriveWorkspaceSceneConfig(wizardInputs)
    const floorHeight = sceneConfig.wallHeightM

    const seededLevels = model.floorLevels.length > 0
      ? model.floorLevels
      : [{ id: 'floor-0', label: 'Ground Floor', elevation: 0, height: floorHeight, drawingIds: drawings.map((d) => d.id) }]

    const floorLevels: FloorLevel[] = Array.from(
      { length: Math.max(sceneConfig.floorCount, seededLevels.length) },
      (_, index) => seededLevels[index] ?? {
        id: `floor-${index}`,
        label: index === 0 ? 'Ground Floor' : `Level ${index}`,
        elevation: index * floorHeight,
        height: floorHeight,
        drawingIds: index === 0 ? drawings.map((d) => d.id) : [],
      },
    ).map((level, index) => ({
      ...level,
      elevation: index * floorHeight,
      height: floorHeight,
    }))

    const allParsed = drawings.filter((d) => d.parsedWalls.length > 0)

    const fallbackScaleUsages = drawings.filter((d) => d.parsedWalls.length > 0 && !d.scaleMmPerPx).length
    if (fallbackScaleUsages > 0) {
      logEvent('model.scale.fallback_used', {
        fallbackScaleMmPerPx: DEFAULT_SCALE_MM_PER_PX,
        drawingCount: fallbackScaleUsages,
      }, 'warn')
    }

    // Per-drawing pixel→world transform. The drawing bound to the floorplan
    // overlay uses the overlay's position/scale/rotation so the 3D geometry
    // lands exactly on the print the user calibrated. Other sheets fall back
    // to the centred transform.
    const overlayDrawingId = overlay.drawingId ?? drawings[0]?.id ?? null
    const transformFor = (d: Drawing): DrawingTransform => {
      if (d.id === overlayDrawingId && d.rasterWidth && d.rasterHeight) {
        return makeOverlayTransform(overlay, d.rasterWidth, d.rasterHeight)
      }
      const [cx, cy] = centerOfWalls(d.parsedWalls)
      return makeCenteredTransform(cx, cy, d.scaleMmPerPx ?? DEFAULT_SCALE_MM_PER_PX)
    }
    const transforms = new Map<string, DrawingTransform>(
      drawings.map((d) => [d.id, transformFor(d)]),
    )

    // Footprint: union of transformed wall extents → fall back to the overlay
    // rectangle (drawing loaded, nothing parsed yet) → wizard concept size.
    let globalFp: Footprint | null = null
    for (const d of allParsed) {
      const fp = footprintOfTransformed(d.parsedWalls, transforms.get(d.id)!)
      if (!globalFp) {
        globalFp = fp
      } else {
        globalFp.minX = Math.min(globalFp.minX, fp.minX)
        globalFp.maxX = Math.max(globalFp.maxX, fp.maxX)
        globalFp.minZ = Math.min(globalFp.minZ, fp.minZ)
        globalFp.maxZ = Math.max(globalFp.maxZ, fp.maxZ)
      }
    }

    const overlayDrawing = drawings.find((d) => d.id === overlayDrawingId)
    if (!globalFp && overlayDrawing?.rasterWidth && overlayDrawing.rasterHeight) {
      const t = transforms.get(overlayDrawing.id)!
      const corners = [
        t.toWorld(0, 0),
        t.toWorld(overlayDrawing.rasterWidth, 0),
        t.toWorld(overlayDrawing.rasterWidth, overlayDrawing.rasterHeight),
        t.toWorld(0, overlayDrawing.rasterHeight),
      ]
      globalFp = {
        minX: Math.min(...corners.map((c) => c[0])),
        maxX: Math.max(...corners.map((c) => c[0])),
        minZ: Math.min(...corners.map((c) => c[1])),
        maxZ: Math.max(...corners.map((c) => c[1])),
      }
    }

    const defaultFp: Footprint = {
      minX: -sceneConfig.footprintWidthM / 2,
      maxX: sceneConfig.footprintWidthM / 2,
      minZ: -sceneConfig.footprintDepthM / 2,
      maxZ: sceneConfig.footprintDepthM / 2,
    }
    const fp = globalFp ?? defaultFp

    // Procedural "concept massing" (perimeter box, columns, beam) is ONLY for
    // the empty workspace driven by wizard text. The moment a real drawing
    // exists it must never render — fake walls/posts on top of a real plan.
    const conceptMode = drawings.length === 0

    const baseWallDrawings = drawings.filter(
      (d) => (d.type === 'floor-plan' || d.type === 'architectural') && d.parsedWalls.length > 0,
    )

    // When the user has traced walls, the live wall layer persists them as the
    // built walls (ghost → solid) with full detail — steel channel/knockouts,
    // block courses, framed openings. So the engine wall/framing rendering is
    // skipped to avoid a duplicate, lower-detail version. Auto-only plans (no
    // traced walls) still build through the engine path below.
    const hasUserWalls = drawings.some((d) => d.parsedWalls.some((w) => w.source === 'user'))

    // User-placed doors/windows become real openings cut into the wall meshes.
    const openingSpecs: OpeningSpec[] = placedObjects
      .filter((o) => o.type === 'door' || o.type === 'window')
      .map((o) => {
        const item = getCatalogItem(o.type)
        return {
          x: o.x,
          z: o.z,
          width: (item?.defaultW ?? 0.9) * o.scaleX,
          height: (item?.defaultH ?? 2) * o.scaleY,
          type: o.type as 'door' | 'window',
        }
      })

    // Skip the auto foundation slab when the user traced their own floor — it
    // sits in the joist zone and reads as a redundant slab under the joists.
    if (floorsAreas.length === 0) {
      buildFoundation(group, fp, sceneConfig.foundationType)
    }

    let levelIndex = 0
    for (const level of floorLevels) {
      const levelChildStart = group.children.length
      const elev = level.elevation
      const fh = floorHeight
      const floorDrawings: Drawing[] = level.drawingIds
        .map((id) => drawings.find((d) => d.id === id))
        .filter(Boolean) as Drawing[]
      const floorWallDrawings = floorDrawings.filter(
        (d) => (d.type === 'floor-plan' || d.type === 'architectural') && d.parsedWalls.length > 0,
      )
      const wallDrawings = floorWallDrawings.length > 0 ? floorWallDrawings : baseWallDrawings

      for (const module of SCENE_MODULE_ORDER) {
        switch (module) {
          case 'foundation':
          case 'excavation':
            break
          case 'floors': {
            const floorLayer = layerMap.get('floors')
            // Skip the auto slab when the user traced their own floors — the
            // traced joist/slab floor (FloorJoistsLayer) IS the real floor, so
            // the slab must not cover it (it was turning wood floors to slab).
            if (floorLayer?.visible && floorsAreas.length === 0) {
              buildFloorSlab(group, fp, elev, floorLayer.color, floorLayer.opacity)
            }
            break
          }
          case 'walls': {
            // The persisted ghost owns user-traced walls (ghost → solid). Only
            // build engine walls for auto-only plans.
            if (hasUserWalls) break
            const wallLayer = layerMap.get('walls')
            const wMat = mat(wallLayer?.color ?? '#e2e8f0', wallLayer?.opacity ?? 1, { roughness: 0.7 })
            if (wallDrawings.length > 0) {
              for (const d of wallDrawings) {
                // Masonry (CMU/brick/concrete) has no framing, so it always
                // renders as a solid volume — even when the Walls layer is off
                // (which hides only the framed walls in favour of their studs).
                const wallsToRender = wallLayer?.visible
                  ? d.parsedWalls
                  : d.parsedWalls.filter((w) => w.wallType === 'masonry-thick')
                if (wallsToRender.length === 0) continue
                buildRealWalls(
                  group,
                  wallsToRender,
                  transforms.get(d.id)!,
                  elev,
                  fh,
                  wMat,
                  'walls',
                  sceneConfig.defaultWallThicknessM,
                  openingSpecs,
                )
              }
            } else if (conceptMode && wallLayer?.visible) {
              buildProceduralWalls(group, fp, elev, fh, wMat)
            }
            break
          }
          case 'rooms': {
            const floorLayer = layerMap.get('floors')
            if (!floorLayer?.visible) break
            for (const d of wallDrawings) {
              if (d.parsedRooms.length > 0) {
                buildRoomPlates(group, d.parsedRooms, transforms.get(d.id)!, elev, 'floors')
              }
            }
            break
          }
          // Openings are no longer separate markers — user-placed doors/windows
          // are cut directly into the wall meshes (see buildRealWalls).
          case 'ceiling': {
            const ceilLayer = layerMap.get('ceiling')
            const hasRCP = floorDrawings.some((d) => d.type === 'rcp') || sceneConfig.specialFeatures.length > 0
            if (ceilLayer?.visible && hasRCP) {
              buildCeiling(group, fp, elev, fh, ceilLayer.color, ceilLayer.opacity)
            }
            break
          }
          case 'structure': {
            const structLayer = layerMap.get('structure')
            // Procedural columns/beam are concept-massing only — never render
            // them when the user has loaded a real drawing.
            if (structLayer?.visible && conceptMode && sceneConfig.hasLoadBearingWalls) {
              const sMat = mat(structLayer.color, structLayer.opacity, { roughness: 0.5 })
              buildStructure(group, fp, elev, fh, sMat)
            }
            break
          }
          case 'mep':
            buildMEP(
              group,
              fp,
              elev,
              fh,
              layers,
              floorDrawings.some((d) => d.type === 'electrical'),
              floorDrawings.some((d) => d.type === 'plumbing'),
              floorDrawings.some((d) => d.type === 'mechanical'),
            )
            break
          case 'special-features':
            buildSpecialFeatures(group, fp, elev, fh, sceneConfig.specialFeatures)
            break
        }
      }
      // Tag everything this storey added with its level so the explode driver
      // peels the floors apart (level 0 = ground stays put, each level lifts).
      for (let i = levelChildStart; i < group.children.length; i++) {
        if (group.children[i].userData.level === undefined) group.children[i].userData.level = levelIndex
      }
      levelIndex++
    }

    // Framing from construction engine. Skipped when user walls exist — the
    // persisted ghost framing (with steel channel/knockouts, blocking, framed
    // openings) is the built framing. Auto-only plans still use the engine.
    const framingLayer = layerMap.get('framing')
    if (!hasUserWalls && framingLayer?.visible && buildResult && buildResult.components.length > 0) {
      let align: FramingAlign | undefined
      const od = drawings.find((d) => d.id === overlayDrawingId)
      // Use the EXACT centroid + scale the engine placed components in — never
      // recompute, or the framing drifts offset as walls are added/rebuilt.
      const [ocx, ocy] = buildResult.frameOriginPx ?? (od ? centerOfWalls(od.parsedWalls) : [0, 0])
      const engineMmPerPx = buildResult.frameScaleMmPerPx ?? od?.scaleMmPerPx ?? DEFAULT_SCALE_MM_PER_PX
      if (od && od.rasterWidth && od.rasterHeight) {
        const s = engineMmPerPx / 1000
        const [w, d] = overlay.scale
        const rot = THREE.MathUtils.degToRad(overlay.rotationDeg)
        align = {
          cos: Math.cos(rot), sin: Math.sin(rot),
          px: overlay.position[0], pz: overlay.position[1],
          lx0: (ocx / od.rasterWidth - 0.5) * w,
          lz0: (ocy / od.rasterHeight - 0.5) * d,
          kx: w / (s * od.rasterWidth),
          kz: d / (s * od.rasterHeight),
          yaw: rot,
        }
      }
      buildFramingGeometry(group, buildResult.components, framingLayer.opacity, align)
    }

    // Snapshot each mesh's assembled position + the model centre, so the explode
    // view can fan components out from where they really are (not fixed offsets).
    const box = new THREE.Box3()
    for (const child of group.children) {
      child.userData.basePos = child.position.clone()
      box.expandByPoint(child.position)
    }
    // When the engine group is (near) empty — the common traced-walls path,
    // where engine walls/slab are skipped — fall back to the PRINT position, not
    // world origin. The traced walls/floors live around overlay.position, so
    // origin would fan the explode off-centre (worse now the print is offset).
    if (!box.isEmpty()) box.getCenter(explodeCenterRef.current)
    else explodeCenterRef.current.set(overlay.position[0], 1.5, overlay.position[1])
    explodeCurrentRef.current = 0

    const timer = setTimeout(() => {
      setModelStatus('ready')
      logEvent('model.build.completed', {
        floorCount: floorLevels.length,
        renderedObjects: group.children.length,
      })
    }, 1500)
    return () => clearTimeout(timer)
  }, [drawings, layers, model.floorLevels, setModelStatus, wizardInputs, buildResult, overlay, placedObjects, floorsAreas])

  // Apply floor isolation and ghost transparency whenever those states change.
  // Isolation hides all levels except the focused one. Ghost makes a level
  // semi-transparent so you can see through it to the one below.
  useEffect(() => {
    const group = groupRef.current
    if (!group) return
    for (const child of group.children) {
      const level = (child.userData.level as number) ?? 0
      const hidden = isolatedFloor !== null && level !== isolatedFloor
      const ghosted = !hidden && ghostedLevels.includes(level)
      child.visible = !hidden
      child.traverse((node) => {
        const mesh = node as Partial<THREE.Mesh>
        if (!mesh.material) return
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
        for (const m of mats) {
          const sm = m as THREE.MeshStandardMaterial
          sm.transparent = ghosted || sm.opacity < 1
          sm.opacity = ghosted ? 0.15 : sm.userData.baseOpacity ?? sm.opacity
          // Store original opacity the first time we touch it so we can restore it.
          if (sm.userData.baseOpacity === undefined && !ghosted) sm.userData.baseOpacity = sm.opacity
        }
      })
    }
  }, [isolatedFloor, ghostedLevels])

  // Explode driver: each frame, ease the current progress toward the slider
  // target and fan every component out along its vector from the model centre,
  // scaled per system. Eased with smoothstep for a smooth in/out feel.
  useFrame((_, delta) => {
    const group = groupRef.current
    if (!group) return

    // Settle to exactly assembled once the slider returns to zero.
    if (explodeAmount === 0 && explodeCurrentRef.current < 1e-3) {
      if (explodeCurrentRef.current !== 0) {
        explodeCurrentRef.current = 0
        for (const child of group.children) {
          const base = child.userData.basePos as THREE.Vector3 | undefined
          if (base) child.position.copy(base)
        }
      }
      explodeRuntime.eased = 0   // let the other layers settle too
      return
    }

    explodeCurrentRef.current = THREE.MathUtils.damp(
      explodeCurrentRef.current, explodeAmount, Math.max(0.1, explodeSpeed), delta,
    )
    const t = explodeCurrentRef.current
    const eased = t * t * (3 - 2 * t) // smoothstep
    const center = explodeCenterRef.current

    // Publish so MEP runs, ducts, devices and drywall fan from the same centre.
    explodeRuntime.eased = eased
    explodeRuntime.spread = explodeSpread
    explodeRuntime.center.copy(center)

    // Per-storey vertical separation so the floors peel apart floor-by-floor,
    // matching the shared layer runtime. Independent of the radial multiplier so
    // storeys split even when a system's spread is low.
    const sep = explodeSpread * eased * FLOOR_SEP
    const off = explodeOffsetTmp
    for (const child of group.children) {
      const base = child.userData.basePos as THREE.Vector3 | undefined
      if (!base) continue
      const sysKey = explodeSystemKey(child.userData.layer)
      const mult = (explodeMults[sysKey] ?? 1) * explodeSpread * eased
      const level = (child.userData.level as number) ?? 0
      // Distinct per-system push so each system separates into its own zone —
      // nothing runs through anything (the whole point of exploding).
      systemOffset(sysKey, off)
      child.position.set(
        base.x + (base.x - center.x) * mult + off.x,
        base.y + (base.y - center.y) * mult + level * sep + off.y,
        base.z + (base.z - center.z) * mult + off.z,
      )
    }
  })

  return <group ref={groupRef} />
}
