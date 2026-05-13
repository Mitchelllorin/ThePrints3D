import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { useAppStore } from '../../store/useAppStore'
import type { Drawing, FloorLevel, Layer, ParsedWall } from '../../types'
import { logEvent } from '../../services/logger'
import glossaryData from '../../symbols/glossary.json'
import type { SymbolEntry } from '../../symbols/types'

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

interface Footprint { minX: number; maxX: number; minZ: number; maxZ: number }

function footprintOf(walls: ParsedWall[], mmPerPx: number, cx: number, cy: number): Footprint {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
  const s = mmPerPx / 1000
  for (const w of walls) {
    const x1 = (w.x1 - cx) * s, x2 = (w.x2 - cx) * s
    const z1 = (w.y1 - cy) * s, z2 = (w.y2 - cy) * s
    minX = Math.min(minX, x1, x2); maxX = Math.max(maxX, x1, x2)
    minZ = Math.min(minZ, z1, z2); maxZ = Math.max(maxZ, z1, z2)
  }
  return { minX, maxX, minZ, maxZ }
}

function centerOfWalls(walls: ParsedWall[]): [number, number] {
  if (walls.length === 0) return [0, 0]
  let sx = 0, sy = 0
  for (const w of walls) { sx += (w.x1 + w.x2) / 2; sy += (w.y1 + w.y2) / 2 }
  return [sx / walls.length, sy / walls.length]
}

// ─── Real geometry from detected walls ────────────────────────────────────────

function buildRealWalls(
  group: THREE.Group,
  walls: ParsedWall[],
  mmPerPx: number,
  cx: number,
  cy: number,
  elevation: number,
  floorHeight: number,
  wallMat: THREE.MeshStandardMaterial,
  layerId: string
) {
  const s = mmPerPx / 1000  // px → metres
  const DEFAULT_THICK = 0.2  // metres

  for (const w of walls) {
    const wx1 = (w.x1 - cx) * s
    const wz1 = (w.y1 - cy) * s
    const wx2 = (w.x2 - cx) * s
    const wz2 = (w.y2 - cy) * s

    const len = Math.sqrt((wx2 - wx1) ** 2 + (wz2 - wz1) ** 2)
    if (len < 0.1) continue  // skip tiny segments (<10cm)

    const thick = w.thickness > 1 ? w.thickness * s : DEFAULT_THICK
    const angle = Math.atan2(wz2 - wz1, wx2 - wx1)

    const geo = new THREE.BoxGeometry(len, floorHeight - 0.15, Math.max(thick, 0.05))
    const mesh = new THREE.Mesh(geo, wallMat)

    mesh.position.set(
      (wx1 + wx2) / 2,
      elevation + floorHeight / 2,
      (wz1 + wz2) / 2
    )
    mesh.rotation.y = -angle
    mesh.castShadow = true
    mesh.receiveShadow = true
    mesh.userData.layer = layerId
    group.add(mesh)
  }
}

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

// ─── LOD component factories ──────────────────────────────────────────────────

const SLOT_MAT = new THREE.MeshStandardMaterial({ color: '#0a0a0a' })

/** Electrical outlet (duplex receptacle) LOD */
function makeOutletLOD(baseMat: THREE.MeshStandardMaterial): THREE.LOD {
  const lod = new THREE.LOD()

  // Near level — detailed faceplate with slots (<0.2 m)
  const nearGroup = new THREE.Group()
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.14, 0.015), baseMat)
  nearGroup.add(plate)
  const slotGeo = new THREE.BoxGeometry(0.011, 0.022, 0.02)
  const slot1 = new THREE.Mesh(slotGeo, SLOT_MAT)
  slot1.position.set(0.018, 0.022, 0)
  const slot2 = new THREE.Mesh(slotGeo, SLOT_MAT)
  slot2.position.set(-0.018, 0.022, 0)
  const gndGeo = new THREE.CylinderGeometry(0.007, 0.007, 0.02, 6)
  const gnd = new THREE.Mesh(gndGeo, SLOT_MAT)
  gnd.rotation.x = Math.PI / 2
  gnd.position.set(0, -0.02, 0)
  nearGroup.add(slot1, slot2, gnd)
  lod.addLevel(nearGroup, 0)

  // Mid level — simple rectangle (0.2 m – 2 m)
  lod.addLevel(new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.14, 0.015), baseMat), 0.2)

  // Far level — tiny marker (> 2 m)
  lod.addLevel(new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.05, 0.01), baseMat), 2)

  return lod
}

/** Single-pole switch LOD */
function makeSwitchLOD(baseMat: THREE.MeshStandardMaterial): THREE.LOD {
  const lod = new THREE.LOD()

  // Near — rocker plate with paddle
  const nearGroup = new THREE.Group()
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.12, 0.015), baseMat)
  nearGroup.add(plate)
  const paddle = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.075, 0.02), baseMat)
  paddle.position.set(0, 0.005, 0.005)
  nearGroup.add(paddle)
  lod.addLevel(nearGroup, 0)

  // Mid — flat rectangle
  lod.addLevel(new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.12, 0.015), baseMat), 0.2)

  // Far — tiny marker
  lod.addLevel(new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.04, 0.01), baseMat), 2)

  return lod
}

/** Recessed pot light LOD */
function makePotLightLOD(baseMat: THREE.MeshStandardMaterial): THREE.LOD {
  const lod = new THREE.LOD()

  // Near — trim ring + inner bulb housing
  const nearGroup = new THREE.Group()
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.012, 8, 24), baseMat)
  ring.rotation.x = Math.PI / 2
  nearGroup.add(ring)
  const bulbMat = new THREE.MeshStandardMaterial({
    color: '#fffde7',
    emissive: new THREE.Color('#fffde7'),
    emissiveIntensity: 0.6,
  })
  const bulb = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 0.04, 16), bulbMat)
  bulb.position.y = 0.02
  nearGroup.add(bulb)
  lod.addLevel(nearGroup, 0)

  // Mid — flat disc
  lod.addLevel(new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.01, 16), baseMat), 0.2)

  // Far — tiny disc
  lod.addLevel(new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.005, 8), baseMat), 2)

  return lod
}

/** Pipe collar / riser LOD */
function makePipeCollarLOD(baseMat: THREE.MeshStandardMaterial): THREE.LOD {
  const lod = new THREE.LOD()

  // Near — collar ring with bolt heads
  const nearGroup = new THREE.Group()
  const collar = new THREE.Mesh(
    new THREE.TorusGeometry(0.055, 0.018, 8, 24),
    baseMat,
  )
  collar.rotation.x = Math.PI / 2
  nearGroup.add(collar)
  const boltGeo = new THREE.CylinderGeometry(0.008, 0.008, 0.015, 6)
  for (let i = 0; i < 4; i++) {
    const bolt = new THREE.Mesh(boltGeo, baseMat)
    const angle = (i / 4) * Math.PI * 2
    bolt.position.set(Math.cos(angle) * 0.055, 0, Math.sin(angle) * 0.055)
    nearGroup.add(bolt)
  }
  lod.addLevel(nearGroup, 0)

  // Mid — simple torus
  lod.addLevel(new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.018, 6, 16), baseMat), 0.2)

  // Far — tiny disc
  lod.addLevel(new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.005, 8), baseMat), 2)

  return lod
}

// ─── LOD component placement ──────────────────────────────────────────────────

const INCHES_TO_M = 0.0254
const OUTLET_HEIGHT_M = 18 * INCHES_TO_M   // 18″ AFF
const SWITCH_HEIGHT_M = 48 * INCHES_TO_M   // 48″ AFF

/**
 * Place LOD components (outlets, switches, pot lights, pipe collars) into the
 * building group. Components are spaced along detected wall segments and on a
 * ceiling grid. Each LOD object carries `userData.symbolId` + `userData.layer`
 * so the double-click raycaster can identify it.
 */
function buildComponentsLOD(
  group: THREE.Group,
  walls: ParsedWall[],
  mmPerPx: number,
  cx: number,
  cy: number,
  fp: Footprint,
  elevation: number,
  floorHeight: number,
  elecMat: THREE.MeshStandardMaterial,
  plumbMat: THREE.MeshStandardMaterial,
  hasElec: boolean,
  hasPlumb: boolean,
) {
  const glossary = (glossaryData as { entries: SymbolEntry[] }).entries
  const outletEntry = glossary.find((e) => e.id === 'elec_outlet_duplex')
  const switchEntry = glossary.find((e) => e.id === 'elec_switch_1way')
  const lightEntry  = glossary.find((e) => e.id === 'elec_fixture_recessed')
  const pipeEntry   = glossary.find((e) => e.id === 'plumb_sink')

  const s = mmPerPx / 1000  // px → metres

  if (hasElec) {
    // Place outlets every ~2.5 m along detected horizontal walls
    const outletSpacing = 2.5
    for (const w of walls) {
      const wx1 = (w.x1 - cx) * s
      const wz1 = (w.y1 - cy) * s
      const wx2 = (w.x2 - cx) * s
      const wz2 = (w.y2 - cy) * s
      const len = Math.sqrt((wx2 - wx1) ** 2 + (wz2 - wz1) ** 2)
      if (len < outletSpacing) continue

      const steps = Math.floor(len / outletSpacing)
      for (let i = 1; i <= steps; i++) {
        const t = i / (steps + 1)
        const ox = wx1 + t * (wx2 - wx1)
        const oz = wz1 + t * (wz2 - wz1)
        const outletLod = makeOutletLOD(elecMat)
        outletLod.position.set(ox, elevation + OUTLET_HEIGHT_M, oz)
        outletLod.userData.layer = 'electrical'
        outletLod.userData.symbolId = outletEntry?.id ?? 'elec_outlet_duplex'
        group.add(outletLod)
      }
    }

    // Place switches near wall endpoints (wall corners) at switch height
    const placed = new Set<string>()
    for (const w of walls) {
      for (const [ex, ey] of [[w.x1, w.y1], [w.x2, w.y2]] as [number, number][]) {
        const sx = (ex - cx) * s
        const sz = (ey - cy) * s
        const key = `${Math.round(sx * 4)},${Math.round(sz * 4)}`
        if (placed.has(key)) continue
        placed.add(key)
        const swLod = makeSwitchLOD(elecMat)
        swLod.position.set(sx, elevation + SWITCH_HEIGHT_M, sz)
        swLod.userData.layer = 'electrical'
        swLod.userData.symbolId = switchEntry?.id ?? 'elec_switch_1way'
        group.add(swLod)
      }
    }

    // Place pot lights in a ceiling grid
    const W = fp.maxX - fp.minX
    const D = fp.maxZ - fp.minZ
    const cols = Math.max(1, Math.round(W / 2.5))
    const rows = Math.max(1, Math.round(D / 2.5))
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const lx = fp.minX + (W / cols) * (c + 0.5)
        const lz = fp.minZ + (D / rows) * (r + 0.5)
        const potLod = makePotLightLOD(elecMat)
        potLod.position.set(lx, elevation + floorHeight - 0.05, lz)
        potLod.userData.layer = 'electrical'
        potLod.userData.symbolId = lightEntry?.id ?? 'elec_fixture_recessed'
        group.add(potLod)
      }
    }
  }

  if (hasPlumb) {
    // Place pipe collars at short vertical wall segments (riser candidates)
    for (const w of walls) {
      const wx1 = (w.x1 - cx) * s
      const wz1 = (w.y1 - cy) * s
      const wx2 = (w.x2 - cx) * s
      const wz2 = (w.y2 - cy) * s
      const isVert = Math.abs(wz2 - wz1) > Math.abs(wx2 - wx1)
      const len = Math.sqrt((wx2 - wx1) ** 2 + (wz2 - wz1) ** 2)
      if (!isVert || len < 0.3 || len > 2.0) continue
      const collarLod = makePipeCollarLOD(plumbMat)
      collarLod.position.set((wx1 + wx2) / 2, elevation + 0.3, (wz1 + wz2) / 2)
      collarLod.userData.layer = 'plumbing'
      collarLod.userData.symbolId = pipeEntry?.id ?? 'plumb_sink'
      group.add(collarLod)
    }
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function BuildingModel({ layers }: Props) {
  const groupRef = useRef<THREE.Group>(null)
  const drawings = useAppStore((s) => s.drawings)
  const model = useAppStore((s) => s.model)
  const setModelStatus = useAppStore((s) => s.setModelStatus)

  useEffect(() => {
    if (!groupRef.current) return
    const group = groupRef.current
    while (group.children.length > 0) group.remove(group.children[0])

    const layerMap = new Map(layers.map((l) => [l.id, l]))
    const floorHeight = 3.2

    // Determine floor levels to render
    const floorLevels: FloorLevel[] =
      model.floorLevels.length > 0
        ? model.floorLevels
        : [{ id: 'floor-0', label: 'Ground Floor', elevation: 0, height: floorHeight, drawingIds: drawings.map((d) => d.id) }]

    // Determine building footprint — use all walls across all levels
    const allParsed = drawings.filter((d) => d.parsedWalls.length > 0)
    let globalCx = 0, globalCy = 0, globalMmPerPx = DEFAULT_SCALE_MM_PER_PX

    if (allParsed.length > 0) {
      // Use the drawing with the most walls as reference
      const ref = allParsed.reduce((a, b) => (a.parsedWalls.length > b.parsedWalls.length ? a : b))
      const [rcx, rcy] = centerOfWalls(ref.parsedWalls)
      globalCx = rcx
      globalCy = rcy
      globalMmPerPx = ref.scaleMmPerPx ?? DEFAULT_SCALE_MM_PER_PX
    }
    const fallbackScaleUsages = drawings.filter((d) => d.parsedWalls.length > 0 && !d.scaleMmPerPx).length
    if (fallbackScaleUsages > 0) {
      logEvent('model.scale.fallback_used', {
        fallbackScaleMmPerPx: DEFAULT_SCALE_MM_PER_PX,
        drawingCount: fallbackScaleUsages,
      }, 'warn')
    }

    // Compute global footprint
    let globalFp: Footprint | null = null
    for (const d of allParsed) {
      const mmPx = d.scaleMmPerPx ?? globalMmPerPx
      const fp = footprintOf(d.parsedWalls, mmPx, globalCx, globalCy)
      if (!globalFp) {
        globalFp = fp
      } else {
        globalFp.minX = Math.min(globalFp.minX, fp.minX)
        globalFp.maxX = Math.max(globalFp.maxX, fp.maxX)
        globalFp.minZ = Math.min(globalFp.minZ, fp.minZ)
        globalFp.maxZ = Math.max(globalFp.maxZ, fp.maxZ)
      }
    }
    const defaultFp: Footprint = { minX: -7.5, maxX: 7.5, minZ: -5, maxZ: 5 }
    const fp = globalFp ?? defaultFp

    // Build each floor
    for (const level of floorLevels) {
      const elev = level.elevation
      const fh = level.height

      // Collect parsed drawings for this floor
      const floorDrawings: Drawing[] = level.drawingIds
        .map((id) => drawings.find((d) => d.id === id))
        .filter(Boolean) as Drawing[]

      const wallDrawings = floorDrawings.filter(
        (d) => (d.type === 'floor-plan' || d.type === 'architectural') && d.parsedWalls.length > 0
      )

      // ── Floors ────────────────────────────────────────────────────────────
      const floorLayer = layerMap.get('floors')
      if (floorLayer?.visible) {
        buildFloorSlab(group, fp, elev, floorLayer.color, floorLayer.opacity)
      }

      // ── Walls ─────────────────────────────────────────────────────────────
      const wallLayer = layerMap.get('walls')
      if (wallLayer?.visible) {
        const wMat = mat(wallLayer.color, wallLayer.opacity, { roughness: 0.7 })
        if (wallDrawings.length > 0) {
          // Real geometry from detected walls
          for (const d of wallDrawings) {
            const mmPx = d.scaleMmPerPx ?? globalMmPerPx
            buildRealWalls(group, d.parsedWalls, mmPx, globalCx, globalCy, elev, fh, wMat, 'walls')
          }
        } else {
          buildProceduralWalls(group, fp, elev, fh, wMat)
        }
      }

      // ── Ceiling / RCP ─────────────────────────────────────────────────────
      const ceilLayer = layerMap.get('ceiling')
      const hasRCP = floorDrawings.some((d) => d.type === 'rcp')
      if (ceilLayer?.visible && hasRCP) {
        buildCeiling(group, fp, elev, fh, ceilLayer.color, ceilLayer.opacity)
      }

      // ── Structure ─────────────────────────────────────────────────────────
      const structLayer = layerMap.get('structure')
      if (structLayer?.visible) {
        const sMat = mat(structLayer.color, structLayer.opacity, { roughness: 0.5 })
        buildStructure(group, fp, elev, fh, sMat)
      }

      // ── MEP Systems ────────────────────────────────────────────────────────
      const hasElec = floorDrawings.some((d) => d.type === 'electrical')
      const hasPlumb = floorDrawings.some((d) => d.type === 'plumbing')
      const hasMech = floorDrawings.some((d) => d.type === 'mechanical')
      buildMEP(group, fp, elev, fh, layers, hasElec, hasPlumb, hasMech)

      // ── LOD Components (outlets, switches, pot lights, pipe collars) ────────
      const elecLayer = layerMap.get('electrical')
      const plumbLayer = layerMap.get('plumbing')
      if ((elecLayer?.visible && hasElec) || (plumbLayer?.visible && hasPlumb)) {
        const allFloorWalls = wallDrawings.flatMap((d) => d.parsedWalls)
        const eMat = elecLayer
          ? mat(elecLayer.color, elecLayer.opacity, {
              emissive: new THREE.Color(elecLayer.color),
              emissiveIntensity: 0.2,
            })
          : mat('#fbbf24', 1)
        const pMat = plumbLayer
          ? mat(plumbLayer.color, plumbLayer.opacity, { metalness: 0.5, roughness: 0.4 })
          : mat('#38bdf8', 1)
        buildComponentsLOD(
          group,
          allFloorWalls,
          globalMmPerPx,
          globalCx,
          globalCy,
          fp,
          elev,
          fh,
          eMat,
          pMat,
          !!(elecLayer?.visible && hasElec),
          !!(plumbLayer?.visible && hasPlumb),
        )
      }
    }

    const timer = setTimeout(() => {
      setModelStatus('ready')
      logEvent('model.build.completed', {
        floorCount: floorLevels.length,
        renderedObjects: group.children.length,
      })
    }, 1500)
    return () => clearTimeout(timer)
  }, [drawings, model.floorLevels, layers, setModelStatus])

  return <group ref={groupRef} />
}
