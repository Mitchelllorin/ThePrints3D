import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { useAppStore } from '../../store/useAppStore'
import type { Drawing, FloorLevel, Layer, ParsedOpening, ParsedRoom, ParsedWall } from '../../types'
import { logEvent } from '../../services/logger'
import { generateModelFromWizardAnswers, generateSingleRoomPreset } from '../../services/modelGenerator'

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

let _idCounter = 0
function uid(): string {
  return `obj-${Date.now().toString(36)}-${(_idCounter++).toString(36)}`
}

function applyMeta(
  mesh: THREE.Mesh,
  type: string,
  layer: string,
  trade: string,
  material: string,
  dimensions?: { x: number; y: number; z: number },
) {
  const geo = mesh.geometry
  if (!dimensions && geo) {
    if ('parameters' in geo && (geo as any).parameters) {
      const p = (geo as any).parameters as Record<string, number>
      dimensions = { x: p.width ?? 0, y: p.height ?? 0, z: p.depth ?? 0 }
    }
  }
  mesh.userData.id = uid()
  mesh.userData.type = type
  mesh.userData.layer = layer
  mesh.userData.editable = true
  mesh.userData.metadata = {
    dimensions: dimensions ?? { x: 0, y: 0, z: 0 },
    material,
    trade,
    connections: [],
  }
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
    const mesh = new THREE.Mesh(geo, w.source === 'user' ? userWallMat : wallMat)

    mesh.position.set(
      (wx1 + wx2) / 2,
      elevation + floorHeight / 2,
      (wz1 + wz2) / 2
    )
    mesh.rotation.y = -angle
    mesh.castShadow = true
    mesh.receiveShadow = true
    applyMeta(mesh, 'wall', layerId, 'framing', 'gypsum', { x: len, y: floorHeight - 0.15, z: Math.max(thick, 0.05) })
    group.add(mesh)
  }
}

// ─── Procedural footprint geometry (fallback) — DEPRECATED, kept for legacy ──
// Use modelGenerator.ts instead. This function is no longer called.

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
  applyMeta(mesh, 'floor', 'floors', 'structure', 'concrete')
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
  applyMeta(mesh, 'ceiling', 'ceiling', 'structure', 'gypsum')
  group.add(mesh)
}

// ─── MEP from parsed symbols ──────────────────────────────────────────────────

function buildMEPFromSymbols(
  group: THREE.Group,
  drawings: Drawing[],
  mmPerPx: number,
  cx: number,
  cy: number,
  elevation: number,
  floorHeight: number,
  layers: Layer[]
) {
  const s = mmPerPx / 1000
  const allSymbols = drawings.flatMap((d) => d.parsedSymbols ?? [])

  // Electrical symbols
  const elecSymbols = allSymbols.filter((sym) => sym.category === 'electrical')
  const elecLayer = layers.find((l) => l.id === 'electrical')
  if (elecLayer?.visible && elecSymbols.length > 0) {
    const eMat = mat(elecLayer.color, elecLayer.opacity, {
      emissive: new THREE.Color(elecLayer.color),
      emissiveIntensity: 0.3,
    })
    for (const sym of elecSymbols) {
      const ex = (sym.x - cx) * s
      const ez = (sym.y - cy) * s
      const isLight = /light|fixture/i.test(sym.label)
      if (isLight) {
        const geo = new THREE.SphereGeometry(0.1, 8, 8)
        const mesh = new THREE.Mesh(geo, eMat)
        mesh.position.set(ex, elevation + floorHeight - 0.15, ez)
        mesh.userData.layer = 'electrical'
        applyMeta(mesh, 'fixture', 'electrical', 'electrical', 'copper', { x: 0.1, y: 0.1, z: 0.1 })
        group.add(mesh)
      } else {
        const geo = new THREE.BoxGeometry(0.08, 0.15, 0.05)
        const mesh = new THREE.Mesh(geo, eMat)
        mesh.position.set(ex, elevation + 1.1, ez)
        mesh.userData.layer = 'electrical'
        applyMeta(mesh, 'fixture', 'electrical', 'electrical', 'copper', { x: 0.08, y: 0.15, z: 0.05 })
        group.add(mesh)
      }
    }
  }

  // Plumbing / fixture symbols
  const plumbSymbols = allSymbols.filter(
    (sym) => sym.category === 'plumbing' || sym.category === 'fixture'
  )
  const plumbLayer = layers.find((l) => l.id === 'plumbing')
  if (plumbLayer?.visible && plumbSymbols.length > 0) {
    const pMat = mat(plumbLayer.color, plumbLayer.opacity, { metalness: 0.5, roughness: 0.4 })
    for (const sym of plumbSymbols) {
      const px = (sym.x - cx) * s
      const pz = (sym.y - cy) * s
      const geo = new THREE.CylinderGeometry(0.06, 0.08, 0.5, 8)
      const mesh = new THREE.Mesh(geo, pMat)
      mesh.position.set(px, elevation + 0.25, pz)
      mesh.userData.layer = 'plumbing'
      applyMeta(mesh, 'pipe', 'plumbing', 'plumbing', 'copper', { x: 0.12, y: 0.5, z: 0.12 })
      group.add(mesh)
    }
  }

  // HVAC symbols
  const hvacSymbols = allSymbols.filter((sym) => sym.category === 'hvac')
  const mechLayer = layers.find((l) => l.id === 'mechanical')
  if (mechLayer?.visible && hvacSymbols.length > 0) {
    const mMat = mat(mechLayer.color, mechLayer.opacity, { metalness: 0.3 })
    for (const sym of hvacSymbols) {
      const mx = (sym.x - cx) * s
      const mz = (sym.y - cy) * s
      const geo = new THREE.BoxGeometry(0.3, 0.12, 0.3)
      const mesh = new THREE.Mesh(geo, mMat)
      mesh.position.set(mx, elevation + floorHeight - 0.25, mz)
      mesh.userData.layer = 'mechanical'
      applyMeta(mesh, 'duct', 'mechanical', 'hvac', 'sheet-metal', { x: 0.3, y: 0.12, z: 0.3 })
      group.add(mesh)
    }
  }
}

// ─── Procedural MEP (fallback when no symbols) ────────────────────────────────

function buildMEPProcedural(
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

  const elecLayer = layers.find((l) => l.id === 'electrical')
  if (elecLayer?.visible && hasElec) {
    const eMat = mat(elecLayer.color, elecLayer.opacity, {
      emissive: new THREE.Color(elecLayer.color),
      emissiveIntensity: 0.25,
    })
    for (const [ex, ez] of [[cx - W * 0.3, cz - D * 0.3], [cx + W * 0.3, cz + D * 0.3]]) {
      const geo = new THREE.CylinderGeometry(0.04, 0.04, floorHeight, 6)
      const c = new THREE.Mesh(geo, eMat)
      c.position.set(ex, elevation + floorHeight / 2, ez)
      c.userData.layer = 'electrical'
      applyMeta(c, 'conduit', 'electrical', 'electrical', 'copper', { x: 0.08, y: floorHeight, z: 0.08 })
      group.add(c)
      const pGeo = new THREE.BoxGeometry(0.25, 0.35, 0.08)
      const p = new THREE.Mesh(pGeo, eMat)
      p.position.set(ex, elevation + 1.4, ez + 0.15)
      p.userData.layer = 'electrical'
      applyMeta(p, 'fixture', 'electrical', 'electrical', 'copper', { x: 0.25, y: 0.35, z: 0.08 })
      group.add(p)
    }
  }

  const plumbLayer = layers.find((l) => l.id === 'plumbing')
  if (plumbLayer?.visible && hasPlumb) {
    const pMat = mat(plumbLayer.color, plumbLayer.opacity, { metalness: 0.5, roughness: 0.4 })
    const pts = [[cx - W * 0.25, cz - D * 0.25], [cx + W * 0.25, cz + D * 0.25]]
    for (const [rx, rz] of pts) {
      const rGeo = new THREE.CylinderGeometry(0.07, 0.07, floorHeight, 8)
      const r = new THREE.Mesh(rGeo, pMat)
      r.position.set(rx, elevation + floorHeight / 2, rz)
      r.userData.layer = 'plumbing'
      applyMeta(r, 'pipe', 'plumbing', 'plumbing', 'copper', { x: 0.14, y: floorHeight, z: 0.14 })
      group.add(r)
    }
    const hGeo = new THREE.CylinderGeometry(0.05, 0.05, W * 0.5, 8)
    const h = new THREE.Mesh(hGeo, pMat)
    h.rotation.z = Math.PI / 2
    h.position.set(cx, elevation + 0.35, cz)
    h.userData.layer = 'plumbing'
    applyMeta(h, 'pipe', 'plumbing', 'plumbing', 'copper', { x: 0.1, y: W * 0.5, z: 0.1 })
    group.add(h)
  }

  const mechLayer = layers.find((l) => l.id === 'mechanical')
  if (mechLayer?.visible && hasMech) {
    const mMat = mat(mechLayer.color, mechLayer.opacity, { metalness: 0.3 })
    const dGeo = new THREE.BoxGeometry(W * 0.5, 0.28, 0.45)
    const duct = new THREE.Mesh(dGeo, mMat)
    duct.position.set(cx, elevation + floorHeight - 0.45, cz)
    duct.userData.layer = 'mechanical'
    applyMeta(duct, 'duct', 'mechanical', 'hvac', 'sheet-metal', { x: W * 0.5, y: 0.28, z: 0.45 })
    group.add(duct)
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
    applyMeta(mesh, 'floor-finish', layerId, 'finishes', 'vinyl', { x: rw, y: 0.01, z: rd })
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
    applyMeta(mesh, isDoor ? 'door' : 'window', layerId, 'framing', 'wood', { x: geoW, y: markerH, z: geoD })
    group.add(mesh)
  }
}

function addLayerGroup(group: THREE.Group, layers: Layer[]): Map<string, THREE.Group> {
  const layerGroups = new Map<string, THREE.Group>()
  const toMove: Array<{ child: THREE.Object3D; layerId: string }> = []
  for (const child of group.children) {
    const lid: string | undefined = (child as any).userData?.layer
    if (lid) toMove.push({ child, layerId: lid })
  }
  for (const { child, layerId } of toMove) {
    let lg = layerGroups.get(layerId)
    if (!lg) {
      lg = new THREE.Group()
      lg.name = `layer-${layerId}`
      layerGroups.set(layerId, lg)
    }
    group.remove(child)
    lg.add(child)
  }
  for (const [, lg] of layerGroups) {
    group.add(lg)
  }
  for (const l of layers) {
    const lg = layerGroups.get(l.id)
    if (lg) lg.visible = l.visible
  }
  return layerGroups
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function BuildingModel({ layers }: Props) {
  const groupRef = useRef<THREE.Group>(null)
  const drawings = useAppStore((s) => s.drawings)
  const model = useAppStore((s) => s.model)
  const setModelStatus = useAppStore((s) => s.setModelStatus)
  const layerGroupRef = useRef<Map<string, THREE.Group> | null>(null)

  // Runtime visibility sync — no rebuild
  useEffect(() => {
    const lg = layerGroupRef.current
    if (!lg) return
    for (const l of layers) {
      const g = lg.get(l.id)
      if (g) g.visible = l.visible
    }
  }, [layers])

  useEffect(() => {
    if (!groupRef.current) return
    const group = groupRef.current
    while (group.children.length > 0) group.remove(group.children[0])
    layerGroupRef.current = null

    try {
    const layerMap = new Map(layers.map((l) => [l.id, l]))
    const floorHeight = 3.2

    // If NO drawing has parsed walls, generate synthetic geometry from wizard answers
    const wizardAnswers = useAppStore.getState().wizardAnswers
    const hasRealWalls = drawings.some((d) => d.parsedWalls.length > 0)

    if (!hasRealWalls && drawings.length === 0) {
      const synth = Object.keys(wizardAnswers).length > 0
        ? generateModelFromWizardAnswers(wizardAnswers)
        : generateSingleRoomPreset()
      synth.walls.forEach((w) => {
        ;(w as any)._synth = true
      })
      const synths: Drawing[] = [{
        id: '_synthetic',
        name: 'Generated Model',
        type: 'floor-plan',
        file: new File([], '_synthetic'),
        pageCount: 1, currentPage: 1,
        previewUrl: null, rasterUrl: null,
        rasterWidth: null, rasterHeight: null,
        parsedWalls: synth.walls,
        parsedRooms: synth.rooms,
        parsedOpenings: synth.openings,
        parsedSymbols: synth.symbols,
        parsedText: [], parsedAnnotationCandidates: [],
        parseProgress: 100, floorNumber: 0,
        status: 'ready',
        scaleMmPerPx: synth.scaleMmPerPx,
        scaleNotation: null,
        scaleConfidence: 'fallback',
        lineClassificationStats: undefined,
        errorMessage: undefined,
        uploadedAt: Date.now(),
      }]
      drawings.push(...synths)
    }

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
      if (floorLayer) {
        buildFloorSlab(group, fp, elev, floorLayer.color, floorLayer.opacity)
      }

      // ── Walls ─────────────────────────────────────────────────────────────
      const wallLayer = layerMap.get('walls')
      if (wallLayer) {
        const wMat = mat(wallLayer.color, wallLayer.opacity, { roughness: 0.7 })
        const userWMat = mat('#60a5fa', wallLayer.opacity, { roughness: 0.45, metalness: 0.15 })
        if (wallDrawings.length > 0) {
          for (const d of wallDrawings) {
            const mmPx = d.scaleMmPerPx ?? globalMmPerPx
            buildRealWalls(group, d.parsedWalls, mmPx, globalCx, globalCy, elev, fh, wMat, userWMat, 'walls')
          }
        }
      }

      // ── Rooms ─────────────────────────────────────────────────────────────
      const floorLayer2 = layerMap.get('floors')
      if (floorLayer2) {
        for (const d of wallDrawings) {
          if (d.parsedRooms.length > 0) {
            const mmPx = d.scaleMmPerPx ?? globalMmPerPx
            buildRoomPlates(group, d.parsedRooms, mmPx, globalCx, globalCy, elev, 'floors')
          }
        }
      }

      // ── Openings (doors & windows) ─────────────────────────────────────────
      const dwLayer = layerMap.get('doors-windows')
      if (dwLayer) {
        for (const d of wallDrawings) {
          if (d.parsedOpenings.length > 0) {
            buildOpeningMarkers(
              group,
              d.parsedOpenings,
              d.scaleMmPerPx ?? globalMmPerPx,
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
      }

      // ── Ceiling / RCP ─────────────────────────────────────────────────────
      const ceilLayer = layerMap.get('ceiling')
      const hasRCP = floorDrawings.some((d) => d.type === 'rcp')
      if (ceilLayer && hasRCP) {
        buildCeiling(group, fp, elev, fh, ceilLayer.color, ceilLayer.opacity)
      }

      // ── MEP Systems ────────────────────────────────────────────────────────
      const hasMepSymbols = floorDrawings.some((d) =>
        (d.parsedSymbols ?? []).some((s) =>
          s.category === 'electrical' || s.category === 'plumbing' || s.category === 'fixture' || s.category === 'hvac'
        )
      )
      if (hasMepSymbols) {
        const mmPx = floorDrawings[0]?.scaleMmPerPx ?? globalMmPerPx
        buildMEPFromSymbols(group, floorDrawings, mmPx, globalCx, globalCy, elev, fh, layers)
      } else {
        buildMEPProcedural(
          group, fp, elev, fh, layers,
          floorDrawings.some((d) => d.type === 'electrical'),
          floorDrawings.some((d) => d.type === 'plumbing'),
          floorDrawings.some((d) => d.type === 'mechanical')
        )
      }
    }

    // Organize all meshes into layer-specific groups for runtime toggle
    layerGroupRef.current = addLayerGroup(group, layers)

    const timer = setTimeout(() => {
      setModelStatus('ready')
      logEvent('model.build.completed', {
        floorCount: floorLevels.length,
        renderedObjects: group.children.length,
      })
    }, 1500)
    return () => clearTimeout(timer)
    } catch (err) {
      logEvent('model.build.error', { error: String(err) }, 'error')
      setModelStatus('error')
    }
  }, [drawings, model.floorLevels, setModelStatus])

  return <group ref={groupRef} />
}
