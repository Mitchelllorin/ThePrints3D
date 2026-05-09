import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { useAppStore } from '../../store/useAppStore'
import type { Drawing, FloorLevel, Layer, ParsedWall } from '../../types'

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
  if (elecLayer && hasElec) {
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
  if (plumbLayer && hasPlumb) {
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
  if (mechLayer && hasMech) {
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
      buildMEP(
        group, fp, elev, fh, layers,
        floorDrawings.some((d) => d.type === 'electrical'),
        floorDrawings.some((d) => d.type === 'plumbing'),
        floorDrawings.some((d) => d.type === 'mechanical')
      )
    }

    const timer = setTimeout(() => setModelStatus('ready'), 1500)
    return () => clearTimeout(timer)
  }, [drawings, model.floorLevels, setModelStatus])

  // Live layer visibility + opacity updates (no geometry rebuild)
  useEffect(() => {
    if (!groupRef.current) return
    for (const obj of groupRef.current.children) {
      const layerId = obj.userData.layer as string
      if (!layerId) continue
      const layer = layers.find((l) => l.id === layerId)
      if (layer) {
        obj.visible = layer.visible
        const mesh = obj as THREE.Mesh
        if (Array.isArray(mesh.material)) {
          for (const m of mesh.material as THREE.MeshStandardMaterial[]) {
            m.opacity = layer.opacity
            m.transparent = layer.opacity < 1
          }
        } else if (mesh.material) {
          const m = mesh.material as THREE.MeshStandardMaterial
          m.opacity = layer.opacity
          m.transparent = layer.opacity < 1
        }
      }
    }
  }, [layers])

  return <group ref={groupRef} />
}
