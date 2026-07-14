/**
 * InsulationLayer — renders insulation batts in the wall cavity for every
 * user-traced stud wall. Appears once `insulationFinished` is true.
 *
 * Batts fill the wall cavity (between the inner and outer stud faces).
 * They are a soft pink/yellow tinted box using a fibrous-looking
 * MeshStandardMaterial. Openings are respected so doors and windows have
 * no batt infill.
 *
 * Mirrors DrywallLayer / ExteriorCladdingLayer: overlay transform, explode
 * integration, opening detection.
 */
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useAppStore } from '../../store/useAppStore'
import { deriveWorkspaceSceneConfig } from '../../services/workspaceScene'
import { FLOOR_ASSEMBLY_H } from '../../services/framingGeometry'
import { useExplodeChildren } from './explodeRuntime'
import { getCatalogItem, VERTICAL_CIRCULATION } from '../../data/objectCatalog'
import type { ParsedWall, PlacedObject } from '../../types'

const DEFAULT_THICKNESS_MM = 140
const MIN_THICKNESS = 0.05

// Batt colour depends on R-value (approximated by wall thickness):
// standard 2×4 → pink fibreglass, 2×6 or thicker → yellow batts.
function battColor(wallThicknessM: number): string {
  return wallThicknessM >= 0.14 ? '#f0d060' : '#f4a0a0'
}

interface BattProps {
  wall: ParsedWall
  pixelToWorld: (px: number, py: number) => THREE.Vector3
  scaleMmPerPx: number | null
  wallHeight: number
  openings: Array<{ t: number; widthM: number; type: 'door' | 'window'; sillM?: number; heightM?: number }>
  storeyHeight: number
}

function InsulationBatt({ wall, pixelToWorld, scaleMmPerPx, wallHeight, openings, storeyHeight }: BattProps) {
  const p1 = pixelToWorld(wall.x1, wall.y1)
  const p2 = pixelToWorld(wall.x2, wall.y2)
  const dx = p2.x - p1.x
  const dz = p2.z - p1.z
  const length = Math.hypot(dx, dz)
  const cx = (p1.x + p2.x) / 2
  const cz = (p1.z + p2.z) / 2
  const angle = Math.atan2(dz, dx)

  const mmPerPx = scaleMmPerPx ?? DEFAULT_THICKNESS_MM / (wall.thickness || 8)
  const wallThicknessM = Math.max(MIN_THICKNESS, ((wall.thickness || 8) * mmPerPx) / 1000)
  const battDepth = wallThicknessM * 0.7 // cavity width (inside stud faces)

  const isMasonry = wall.wallType === 'masonry-thick' || wall.framingType === 'cmu'

  const group = useMemo(() => {
    if (isMasonry || length < 0.05) return new THREE.Group()

    const g = new THREE.Group()
    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(battColor(wallThicknessM)),
      roughness: 0.85,
      metalness: 0,
      transparent: true,
      opacity: 0.88,
    })

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

    const addBox = (tCenter: number, lenAlong: number, yBot: number, h: number) => {
      if (lenAlong < 0.005 || h < 0.005) return
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(lenAlong, h, battDepth), mat)
      mesh.position.set(tCenter - length / 2, yBot + h / 2, 0)
      mesh.castShadow = false
      mesh.receiveShadow = false
      mesh.userData.layer = 'insulation'
      g.add(mesh)
    }

    // Build solid runs with openings cut.
    let cursor = 0
    const sorted = [...masks].sort((a, b) => a.lo - b.lo)
    for (const m of sorted) {
      if (m.lo - cursor > 0.01) {
        addBox(cursor + (m.lo - cursor) / 2, m.lo - cursor, 0, wallHeight)
      }
      // Inside opening height: fill above/below for windows.
      if (m.yLo > 0) {
        addBox((m.lo + m.hi) / 2, m.hi - m.lo, 0, m.yLo)
      }
      if (m.yHi < wallHeight) {
        addBox((m.lo + m.hi) / 2, m.hi - m.lo, m.yHi, wallHeight - m.yHi)
      }
      cursor = m.hi
    }
    if (length - cursor > 0.01) {
      addBox(cursor + (length - cursor) / 2, length - cursor, 0, wallHeight)
    }

    return g
  }, [length, wallHeight, battDepth, wallThicknessM, isMasonry, openings])

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

export default function InsulationLayer() {
  const drawings = useAppStore((s) => s.drawings)
  const overlay = useAppStore((s) => s.floorplanOverlay)
  const placedObjects = useAppStore((s) => s.placedObjects)
  const wizardInputs = useAppStore((s) => s.wizardInputs)
  const insulationFinished = useAppStore((s) => s.insulationFinished)

  const groupRef = useRef<THREE.Group>(null)
  useExplodeChildren(groupRef, 'insulation')

  const wallHeight = useMemo(() => deriveWorkspaceSceneConfig(wizardInputs).wallHeightM, [wizardInputs])
  const storeyHeight = wallHeight + FLOOR_ASSEMBLY_H

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

  if (!insulationFinished || userWalls.length === 0) return null

  return (
    <group name="insulation-batts" ref={groupRef}>
      {userWalls.map(({ wall, scaleMmPerPx }, i) => (
        <InsulationBatt
          key={i}
          wall={wall}
          pixelToWorld={pixelToWorld}
          scaleMmPerPx={scaleMmPerPx}
          wallHeight={wallHeight}
          openings={openingsByWall[i] ?? []}
          storeyHeight={storeyHeight}
        />
      ))}
    </group>
  )
}
