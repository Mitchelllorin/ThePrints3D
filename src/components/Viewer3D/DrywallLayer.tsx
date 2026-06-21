/**
 * DrywallLayer — boards the user-traced framed walls with real 4×8 drywall
 * sheets. Toggleable + orientation-aware (Settings → Drywall). Uses the SAME
 * overlay transform as LiveWallsLayer / the built framing, so the board sits on
 * the walls whether or not the model has been built (drywall is a finish over
 * the studs). Openings (doors/windows) are left unboarded.
 */
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useAppStore } from '../../store/useAppStore'
import { useUISettingsStore } from '../../store/useUISettingsStore'
import { deriveWorkspaceSceneConfig } from '../../services/workspaceScene'
import { buildWallDrywall, FLOOR_ASSEMBLY_H, type WallOpening } from '../../services/framingGeometry'
import { useExplodeChildren } from './explodeRuntime'
import { getCatalogItem } from '../../data/objectCatalog'
import type { ParsedWall, PlacedObject } from '../../types'

const MIN_THICKNESS = 0.1
const DEFAULT_THICKNESS_MM = 140

interface WallBoardProps {
  wall: ParsedWall
  pixelToWorld: (px: number, py: number) => THREE.Vector3
  scaleMmPerPx: number | null
  wallHeight: number
  orientation: 'vertical' | 'horizontal'
  openings: Array<{ t: number; widthM: number; type: 'door' | 'window'; sillM?: number; heightM?: number }>
  /** Storey-to-storey rise, so upper-floor boards stack on the floor below. */
  storeyHeight: number
}

function WallBoard({ wall, pixelToWorld, scaleMmPerPx, wallHeight, orientation, openings, storeyHeight }: WallBoardProps) {
  const p1 = pixelToWorld(wall.x1, wall.y1)
  const p2 = pixelToWorld(wall.x2, wall.y2)
  const dx = p2.x - p1.x
  const dz = p2.z - p1.z
  const length = Math.hypot(dx, dz)
  const cx = (p1.x + p2.x) / 2
  const cz = (p1.z + p2.z) / 2
  const angle = Math.atan2(dz, dx)
  const mmPerPx = scaleMmPerPx ?? DEFAULT_THICKNESS_MM / (wall.thickness || 8)
  const thicknessM = Math.max(MIN_THICKNESS, ((wall.thickness || 8) * mmPerPx) / 1000)

  // Masonry walls are solid — no drywall boarding.
  const isMasonry = wall.wallType === 'masonry-thick' || wall.framingType === 'cmu'

  const board = useMemo(() => {
    if (isMasonry) return new THREE.Group()
    const wallOpenings: WallOpening[] = openings.map((o) => ({ centerM: o.t * length, widthM: o.widthM, type: o.type, sillM: o.sillM, heightM: o.heightM }))
    const g = buildWallDrywall({ length, height: wallHeight, thickness: thicknessM, orientation, openings: wallOpenings, opacity: 0.96 })
    g.userData.level = wall.level ?? 0  // so the shared explode peels boards floor-by-floor
    return g
  }, [length, wallHeight, thicknessM, orientation, isMasonry, openings, wall.level])

  useEffect(() => () => {
    board.traverse((o) => { if (o instanceof THREE.Mesh) { o.geometry.dispose(); (o.material as THREE.Material).dispose() } })
  }, [board])

  if (length < 0.05 || isMasonry) return null
  // Upper-floor boards stand on the floor below — same lift as the framing they
  // clad (LiveWallsLayer), so 2nd-floor walls get their sheeting up where the
  // studs actually are instead of dropping to the ground floor.
  const baseY = (wall.level ?? 0) * storeyHeight
  return <primitive object={board} position={[cx, baseY, cz]} rotation={[0, -angle, 0]} />
}

export default function DrywallLayer() {
  const drawings = useAppStore((s) => s.drawings)
  const overlay = useAppStore((s) => s.floorplanOverlay)
  const placedObjects = useAppStore((s) => s.placedObjects)
  const wizardInputs = useAppStore((s) => s.wizardInputs)
  const visible = useUISettingsStore((s) => s.drywallVisible)
  const orientation = useUISettingsStore((s) => s.drywallOrientation)

  const groupRef = useRef<THREE.Group>(null)
  useExplodeChildren(groupRef, 'walls')

  const wallHeight = useMemo(() => deriveWorkspaceSceneConfig(wizardInputs).wallHeightM, [wizardInputs])
  // Storey-to-storey rise so level-1 boards stand on the 2nd-floor deck, etc.
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

  // Assign placed doors/windows to their nearest wall (pixel space) so the board
  // is cut around them — same logic the framing uses.
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
    return out
  }, [userWalls, placedObjects])

  if (!visible || userWalls.length === 0) return null

  return (
    <group name="drywall" ref={groupRef}>
      {userWalls.map(({ wall, scaleMmPerPx }, i) => (
        <WallBoard
          key={i}
          wall={wall}
          pixelToWorld={pixelToWorld}
          scaleMmPerPx={scaleMmPerPx}
          wallHeight={wallHeight}
          orientation={orientation}
          openings={openingsByWall[i] ?? []}
          storeyHeight={storeyHeight}
        />
      ))}
    </group>
  )
}
