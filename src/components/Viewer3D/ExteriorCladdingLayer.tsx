/**
 * ExteriorCladdingLayer — renders the full exterior assembly (structural
 * sheathing → weather-resistive barrier → finish cladding) on every
 * user-traced wall. Appears once `exteriorFinished` is true.
 *
 * Mirrors DrywallLayer's architecture: reads user walls from the store,
 * uses the same overlay transform, and hooks into the explode driver so
 * the cladding skin floats away from the framing on the explode view.
 *
 * Material: driven by the `exterior.cladding` decision (falls back to the
 * wall's `exteriorMaterial` property, then to stucco). Openings are cut
 * so doors and windows stay open.
 */
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useAppStore } from '../../store/useAppStore'
import { wallMaterialPreset, WALL_MATERIALS } from '../../services/constructionCode'
import { CLADDING_ASSEMBLY_DEPTH_M, type CladdingKey } from '../../services/buildingSystemsInference'
import { FLOOR_ASSEMBLY_H } from '../../services/framingGeometry'
import { deriveWorkspaceSceneConfig } from '../../services/workspaceScene'
import { useExplodeChildren } from './explodeRuntime'
import { getCatalogItem, VERTICAL_CIRCULATION } from '../../data/objectCatalog'
import type { ParsedWall, PlacedObject } from '../../types'

// Sheathing is 7/16" OSB + WRB membrane. A thin band visually represents the
// sheathing underneath the finish cladding in the exploded view.
const SHEATHING_T = 0.011 // 7/16" OSB
const WRB_T = 0.002       // housewrap / felt paper

const CLADDING_COLOR: Record<string, string> = {
  stucco:       '#cbc3a8',
  vinylSiding:  '#ddd8cc',
  woodSiding:   '#b8905a',
  brick:        '#96503a',
  stone:        '#9ca3af',
  metalPanel:   '#8fa0b0',
  fiberCement:  '#c9c5be',
  exposedBrick: '#8b4513',
  concrete:     '#a8a8a8',
}

interface CladdingPanelProps {
  wall: ParsedWall
  pixelToWorld: (px: number, py: number) => THREE.Vector3
  scaleMmPerPx: number | null
  wallHeight: number
  claddingKey: CladdingKey
  openings: Array<{ t: number; widthM: number; type: 'door' | 'window'; sillM?: number; heightM?: number }>
  storeyHeight: number
}

const DEFAULT_THICKNESS_MM = 140

function CladdingPanel({ wall, pixelToWorld, scaleMmPerPx, wallHeight, claddingKey, openings, storeyHeight }: CladdingPanelProps) {
  const p1 = pixelToWorld(wall.x1, wall.y1)
  const p2 = pixelToWorld(wall.x2, wall.y2)
  const dx = p2.x - p1.x
  const dz = p2.z - p1.z
  const length = Math.hypot(dx, dz)
  const cx = (p1.x + p2.x) / 2
  const cz = (p1.z + p2.z) / 2
  const angle = Math.atan2(dz, dx)

  const mmPerPx = scaleMmPerPx ?? DEFAULT_THICKNESS_MM / (wall.thickness || 8)
  const wallThicknessM = Math.max(0.05, ((wall.thickness || 8) * mmPerPx) / 1000)

  // Masonry walls are already solid — skip exterior cladding assembly.
  const isMasonry = wall.wallType === 'masonry-thick' || wall.framingType === 'cmu'

  // Total exterior assembly depth: sheathing + WRB + cladding panel.
  const claddingDepth = CLADDING_ASSEMBLY_DEPTH_M[claddingKey] ?? 0.025
  const assemblyDepthM = SHEATHING_T + WRB_T + claddingDepth
  // The panel is offset outward from the wall face by half the wall thickness
  // plus the sheathing+WRB, sitting the cladding at the outermost position.
  const offsetFromCenter = wallThicknessM / 2 + SHEATHING_T + WRB_T + claddingDepth / 2

  const group = useMemo(() => {
    if (isMasonry || length < 0.05) return new THREE.Group()

    const g = new THREE.Group()
    const presetKey = (claddingKey in WALL_MATERIALS) ? claddingKey : 'stucco'
    const preset = wallMaterialPreset(presetKey)
    const color = CLADDING_COLOR[claddingKey] ?? preset.color

    // Cladding panels — render as rows / sections that respect openings.
    const panelMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(color),
      roughness: preset.roughness,
      metalness: preset.metalness ?? 0,
      transparent: false,
      opacity: 1,
    })

    // Thin sheathing board (slightly lighter tone, full wall width).
    const sheathingMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#c8b882'), // OSB straw colour
      roughness: 0.9,
      metalness: 0,
    })

    // Build opening masks (fraction along wall): skip these zones.
    type Mask = { lo: number; hi: number; yLo: number; yHi: number }
    const masks: Mask[] = openings.map((o) => {
      const isDoor = o.type === 'door'
      const oH = o.heightM ?? (isDoor ? 2.06 : 1.13)
      const yLo = isDoor ? 0 : (o.sillM ?? 0.9)
      return {
        lo: Math.max(0, o.t * length - (o.widthM / 2)),
        hi: Math.min(length, o.t * length + (o.widthM / 2)),
        yLo,
        yHi: Math.min(yLo + oH, wallHeight),
      }
    })

    const addBox = (
      mat: THREE.MeshStandardMaterial,
      tCenter: number,
      lenAlong: number,
      yBot: number,
      h: number,
      depth: number,
      zOff: number,
    ) => {
      if (lenAlong < 0.005 || h < 0.005) return
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(lenAlong, h, depth), mat)
      mesh.position.set(tCenter - length / 2, yBot + h / 2, zOff)
      mesh.castShadow = true
      mesh.receiveShadow = true
      mesh.userData.layer = 'exterior'
      g.add(mesh)
    }

    // Sheathing: full width, full height (behind cladding).
    addBox(sheathingMat, length / 2, length, 0, wallHeight, SHEATHING_T, wallThicknessM / 2 + SHEATHING_T / 2)

    // Cladding: placed as contiguous sections, holes cut for openings.
    const segH = wallHeight
    let cursor = 0
    const sorted = [...masks].sort((a, b) => a.lo - b.lo)
    for (const m of sorted) {
      // Solid section before this opening.
      if (m.lo - cursor > 0.01) {
        addBox(panelMat, cursor + (m.lo - cursor) / 2, m.lo - cursor, 0, segH, claddingDepth, offsetFromCenter)
      }
      // Partial section inside the opening (above + below it for windows; just above for doors).
      if (!masks.includes(m)) continue
      if (m.yLo > 0) {
        addBox(panelMat, (m.lo + m.hi) / 2, m.hi - m.lo, 0, m.yLo, claddingDepth, offsetFromCenter)
      }
      if (m.yHi < wallHeight) {
        addBox(panelMat, (m.lo + m.hi) / 2, m.hi - m.lo, m.yHi, wallHeight - m.yHi, claddingDepth, offsetFromCenter)
      }
      cursor = m.hi
    }
    // Section after last opening.
    if (length - cursor > 0.01) {
      addBox(panelMat, cursor + (length - cursor) / 2, length - cursor, 0, segH, claddingDepth, offsetFromCenter)
    }

    g.userData.assemblyDepthM = assemblyDepthM
    return g
  }, [length, wallHeight, claddingKey, wallThicknessM, isMasonry, openings])

  useEffect(() => () => {
    group.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose()
        ;(o.material as THREE.Material).dispose()
      }
    })
  }, [group])

  if (length < 0.05 || isMasonry) return null

  const baseY = (wall.level ?? 0) * storeyHeight
  return <primitive object={group} position={[cx, baseY, cz]} rotation={[0, -angle, 0]} />
}

export default function ExteriorCladdingLayer() {
  const drawings = useAppStore((s) => s.drawings)
  const overlay = useAppStore((s) => s.floorplanOverlay)
  const placedObjects = useAppStore((s) => s.placedObjects)
  const wizardInputs = useAppStore((s) => s.wizardInputs)
  const constructionDecisions = useAppStore((s) => s.constructionDecisions)
  const exteriorFinished = useAppStore((s) => s.exteriorFinished)

  const groupRef = useRef<THREE.Group>(null)
  useExplodeChildren(groupRef, 'exterior')

  const wallHeight = useMemo(() => deriveWorkspaceSceneConfig(wizardInputs).wallHeightM, [wizardInputs])
  const storeyHeight = wallHeight + FLOOR_ASSEMBLY_H

  // Pick the chosen cladding key from construction decisions; fall back to stucco.
  const claddingKey = useMemo((): CladdingKey => {
    const d = constructionDecisions.find((d) => d.id === 'exterior.cladding')
    return (d?.chosen as CladdingKey) ?? 'stucco'
  }, [constructionDecisions])

  const drawing = drawings.find((d) => d.id === overlay.drawingId) ?? drawings[0] ?? null
  const imageWidth = drawing?.rasterWidth ?? 1400
  const imageHeight = drawing?.rasterHeight ?? 900
  const [overlayW, overlayD] = overlay.scale
  const rotRad = THREE.MathUtils.degToRad(overlay.rotationDeg)

  const pixelToWorld = useMemo(() => (px: number, py: number): THREE.Vector3 => {
    const localX = ((px / imageWidth) - 0.5) * overlayW
    const localZ = ((py / imageHeight) - 0.5) * overlayD
    const v = new THREE.Vector3(localX, 0, localZ).applyAxisAngle(new THREE.Vector3(0, 1, 0), rotRad)
    return new THREE.Vector3(overlay.position[0] + v.x, 0, overlay.position[1] + v.z)
  }, [imageWidth, imageHeight, overlayW, overlayD, rotRad, overlay.position])

  const userWalls = useMemo(() => {
    const out: Array<{ wall: ParsedWall; scaleMmPerPx: number | null }> = []
    for (const d of drawings) {
      for (const w of d.parsedWalls) {
        if (w.source === 'user') out.push({ wall: w, scaleMmPerPx: d.scaleMmPerPx })
      }
    }
    return out
  }, [drawings])

  // Assign placed doors/windows to their nearest wall (pixel space).
  const openingsByWall = useMemo(() => {
    const out: Array<Array<{ t: number; widthM: number; type: 'door' | 'window'; sillM?: number; heightM?: number }>> = userWalls.map(() => [])
    const doors = placedObjects.filter(
      (o: PlacedObject) => (o.type === 'door' || o.type === 'window') && o.pxX != null && o.pxY != null,
    )
    for (const o of doors) {
      const px = o.pxX as number, py = o.pxY as number
      let best = -1, bestPerp = Infinity, bestT = 0
      userWalls.forEach(({ wall: w }, i) => {
        const ddx = w.x2 - w.x1, ddy = w.y2 - w.y1
        const len2 = ddx * ddx + ddy * ddy
        if (len2 < 1e-6) return
        const t = ((px - w.x1) * ddx + (py - w.y1) * ddy) / len2
        if (t < -0.02 || t > 1.02) return
        const perp = Math.hypot(px - (w.x1 + t * ddx), py - (w.y1 + t * ddy))
        const threshPx = Math.max((w.thickness || 8) * 2.5, 28)
        if (perp < threshPx && perp < bestPerp) { best = i; bestPerp = perp; bestT = Math.max(0, Math.min(1, t)) }
      })
      if (best < 0) continue
      const item = getCatalogItem(o.type)
      const heightM = (item?.defaultH ?? (o.type === 'door' ? 2.06 : 1.13)) * o.scaleY
      out[best].push({ t: bestT, widthM: (item?.defaultW ?? 0.9) * o.scaleX, type: o.type as 'door' | 'window', sillM: o.sillM, heightM })
    }
    // Vertical circulation items cut a full opening.
    const pxPerM = 1000 / (userWalls[0]?.scaleMmPerPx ?? 8)
    for (const o of placedObjects) {
      if (!VERTICAL_CIRCULATION.has(o.type) || o.pxX == null || o.pxY == null) continue
      const px = o.pxX as number, py = o.pxY as number
      const item = getCatalogItem(o.type)
      const reachPx = ((item?.defaultD ?? 1) * o.scaleZ / 2) * pxPerM
      let best = -1, bestEdge = Infinity, bestT = 0
      userWalls.forEach(({ wall: w }, i) => {
        const ddx = w.x2 - w.x1, ddy = w.y2 - w.y1
        const len2 = ddx * ddx + ddy * ddy
        if (len2 < 1e-6) return
        const t = ((px - w.x1) * ddx + (py - w.y1) * ddy) / len2
        if (t < -0.02 || t > 1.02) return
        const perp = Math.hypot(px - (w.x1 + t * ddx), py - (w.y1 + t * ddy))
        const edge = Math.abs(perp - reachPx)
        const threshPx = Math.max((w.thickness || 8) * 2.5, 28) + 6
        if (edge < threshPx && edge < bestEdge) { best = i; bestEdge = edge; bestT = Math.max(0, Math.min(1, t)) }
      })
      if (best < 0) continue
      out[best].push({ t: bestT, widthM: (item?.defaultW ?? 1) * o.scaleX, type: 'door', sillM: 0, heightM: (item?.defaultH ?? 2.4) * o.scaleY })
    }
    return out
  }, [userWalls, placedObjects])

  if (!exteriorFinished || userWalls.length === 0) return null

  return (
    <group name="exterior-cladding" ref={groupRef}>
      {userWalls.map(({ wall, scaleMmPerPx }, i) => (
        <CladdingPanel
          key={i}
          wall={wall}
          pixelToWorld={pixelToWorld}
          scaleMmPerPx={scaleMmPerPx}
          wallHeight={wallHeight}
          claddingKey={claddingKey}
          openings={openingsByWall[i] ?? []}
          storeyHeight={storeyHeight}
        />
      ))}
    </group>
  )
}
