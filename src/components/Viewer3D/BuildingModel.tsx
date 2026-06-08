import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { useAppStore } from '../../store/useAppStore'
import type { Drawing, FloorLevel, Layer, ParsedOpening, ParsedRoom, ParsedWall } from '../../types'
import { logEvent } from '../../services/logger'
import { deriveWorkspaceSceneConfig } from '../../services/workspaceScene'

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
  userWallMat: THREE.MeshStandardMaterial,
   layerId: string,
   defaultThicknessM: number,
) {
  const s = mmPerPx / 1000  // px → metres

  for (const w of walls) {
    const wx1 = (w.x1 - cx) * s
    const wz1 = (w.y1 - cy) * s
    const wx2 = (w.x2 - cx) * s
    const wz2 = (w.y2 - cy) * s

    const len = Math.sqrt((wx2 - wx1) ** 2 + (wz2 - wz1) ** 2)
    if (len < 0.1) continue  // skip tiny segments (<10cm)

    const thick = w.thickness > 1 ? w.thickness * s : defaultThicknessM
    const angle = Math.atan2(wz2 - wz1, wx2 - wx1)

    const geo = new THREE.BoxGeometry(len, floorHeight - 0.15, Math.max(thick, 0.05))
    const mesh = new THREE.Mesh(geo, w.source === 'user' ? userWallMat : wallMat)

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
  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#334155'),
    metalness: 0.08,
    roughness: 0.92,
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
  'openings',
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
  mmPerPx: number,
  cx: number,
  cy: number,
  elevation: number,
  layerId: string
) {
  const s = mmPerPx / 1000  // px → metres
  rooms.forEach((room, i) => {
    const rx1 = (room.x1 - cx) * s
    const rz1 = (room.y1 - cy) * s
    const rx2 = (room.x2 - cx) * s
    const rz2 = (room.y2 - cy) * s

    const rw = rx2 - rx1
    const rd = rz2 - rz1
    if (rw <= 0 || rd <= 0) return

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
    mesh.position.set(
      (rx1 + rx2) / 2,
      elevation + 0.02,
      (rz1 + rz2) / 2,
    )
    mesh.receiveShadow = true
    mesh.userData.layer = layerId
    group.add(mesh)
  })
}

// ─── Opening markers ──────────────────────────────────────────────────────────

function buildOpeningMarkers(
  group: THREE.Group,
  openings: ParsedOpening[],
  mmPerPx: number,
  cx: number,
  cy: number,
  elevation: number,
  floorHeight: number,
  doorColor: string,
  windowColor: string,
  layerId: string
) {
  const s = mmPerPx / 1000

  for (const op of openings) {
    const ox = (op.x - cx) * s
    const oz = (op.y - cy) * s
    const widthM = Math.max(op.widthPx * s, 0.05)

    const isDoor = op.type === 'door'
    const markerH = isDoor ? floorHeight * 0.85 : floorHeight * 0.45
    const markerY = isDoor ? elevation + markerH / 2 : elevation + floorHeight * 0.35 + markerH / 2
    const color = isDoor ? doorColor : windowColor

    const markerW = widthM
    const markerD = 0.05  // thin slab

    const geoW = op.orientation === 'horizontal' ? markerW : markerD
    const geoD = op.orientation === 'horizontal' ? markerD : markerW

    const geo = new THREE.BoxGeometry(geoW, markerH, geoD)
    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(color),
        transparent: true,
        opacity: 0.6,
        roughness: 0.4,
      }),
    )
    mesh.position.set(ox, markerY, oz)
    mesh.userData.layer = layerId
    group.add(mesh)
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function BuildingModel({ layers }: Props) {
  const groupRef = useRef<THREE.Group>(null)
  const drawings = useAppStore((s) => s.drawings)
  const model = useAppStore((s) => s.model)
  const wizardInputs = useAppStore((s) => s.wizardInputs)
  const setModelStatus = useAppStore((s) => s.setModelStatus)

  useEffect(() => {
    if (!groupRef.current) return
    const group = groupRef.current
    while (group.children.length > 0) group.remove(group.children[0])

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
    let globalCx = 0
    let globalCy = 0
    let globalMmPerPx = DEFAULT_SCALE_MM_PER_PX

    if (allParsed.length > 0) {
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

    const defaultFp: Footprint = {
      minX: -sceneConfig.footprintWidthM / 2,
      maxX: sceneConfig.footprintWidthM / 2,
      minZ: -sceneConfig.footprintDepthM / 2,
      maxZ: sceneConfig.footprintDepthM / 2,
    }
    const fp = globalFp ?? defaultFp
    const baseWallDrawings = drawings.filter(
      (d) => (d.type === 'floor-plan' || d.type === 'architectural') && d.parsedWalls.length > 0,
    )

    buildFoundation(group, fp, sceneConfig.foundationType)

    for (const level of floorLevels) {
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
            if (floorLayer?.visible) {
              buildFloorSlab(group, fp, elev, floorLayer.color, floorLayer.opacity)
            }
            break
          }
          case 'walls': {
            const wallLayer = layerMap.get('walls')
            if (!wallLayer?.visible) break
            const wMat = mat(wallLayer.color, wallLayer.opacity, { roughness: 0.7 })
            const userWMat = mat('#60a5fa', wallLayer.opacity, { roughness: 0.45, metalness: 0.15 })
            if (wallDrawings.length > 0) {
              for (const d of wallDrawings) {
                const mmPx = d.scaleMmPerPx ?? globalMmPerPx
                buildRealWalls(
                  group,
                  d.parsedWalls,
                  mmPx,
                  globalCx,
                  globalCy,
                  elev,
                  fh,
                  wMat,
                  userWMat,
                  'walls',
                  sceneConfig.defaultWallThicknessM,
                )
              }
            } else {
              buildProceduralWalls(group, fp, elev, fh, wMat)
            }
            break
          }
          case 'rooms': {
            const floorLayer = layerMap.get('floors')
            if (!floorLayer?.visible) break
            for (const d of wallDrawings) {
              if (d.parsedRooms.length > 0) {
                const mmPx = d.scaleMmPerPx ?? globalMmPerPx
                buildRoomPlates(group, d.parsedRooms, mmPx, globalCx, globalCy, elev, 'floors')
              }
            }
            break
          }
          case 'openings': {
            const dwLayer = layerMap.get('doors-windows')
            if (!dwLayer?.visible) break
            for (const d of wallDrawings) {
              if (d.parsedOpenings.length > 0) {
                const mmPx = d.scaleMmPerPx ?? globalMmPerPx
                buildOpeningMarkers(
                  group,
                  d.parsedOpenings,
                  mmPx,
                  globalCx,
                  globalCy,
                  elev,
                  fh,
                  '#7dd3fc',
                  '#a5b4fc',
                  'doors-windows',
                )
              }
            }
            break
          }
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
            // Only render procedural columns/beam when NO real walls exist (fallback mode)
            if (structLayer?.visible && wallDrawings.length === 0 && sceneConfig.hasLoadBearingWalls) {
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
    }

    const timer = setTimeout(() => {
      setModelStatus('ready')
      logEvent('model.build.completed', {
        floorCount: floorLevels.length,
        renderedObjects: group.children.length,
      })
    }, 1500)
    return () => clearTimeout(timer)
  }, [drawings, layers, model.floorLevels, setModelStatus, wizardInputs])

  return <group ref={groupRef} />
}
