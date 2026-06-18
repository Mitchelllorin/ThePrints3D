/**
 * LiveWallsLayer — renders user-traced walls as semi-transparent 3D blocks
 * in real time as the user traces on the 2D print overlay.
 *
 * Coordinate system: walls are stored in image-pixel space. We apply the
 * same transform as FloorplanOverlay (overlay position/scale/rotation) to
 * place them correctly in the world.
 */
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { Billboard, Text } from '@react-three/drei'
import { useExplodeChildren } from './explodeRuntime'
import { useAppStore } from '../../store/useAppStore'
import { useConfigStore } from '../../store/useConfigStore'
import { deriveWorkspaceSceneConfig } from '../../services/workspaceScene'
import { buildWallFraming, blockMaterial, type WallOpening } from '../../services/framingGeometry'
import { formatMeasureMm, type LengthFormat } from '../../services/unitConverter'
import { getCatalogItem } from '../../data/objectCatalog'
import type { ActiveUnit } from '../../store/useConfigStore'
import type { ParsedWall, PlacedObject } from '../../types'

const MIN_THICKNESS = 0.1     // metres — minimum visible thickness
const DEFAULT_THICKNESS_MM = 140  // 2×4 stud + drywall both sides

interface WallMeshProps {
  wall: ParsedWall
  pixelToWorld: (px: number, py: number) => THREE.Vector3
  scaleMmPerPx: number | null
  wallHeight: number
  material: 'wood' | 'steel'
  steelGauge: string
  topTrackStyle: 'shallow' | 'deep' | 'slotted' | 'double'
  deflectionGapMm: number
  /** Door/window openings on this wall, as {t along wall 0..1, width m, type}. */
  openings: Array<{ t: number; widthM: number; type: 'door' | 'window' }>
  /** 0.7 while tracing (ghost), 1 once built (solid/real). */
  opacity: number
  /** True once the model is built — hides the tracing nameplate. */
  built: boolean
  activeUnit: ActiveUnit
  lengthFormat: LengthFormat
}

function WallMesh({ wall, pixelToWorld, scaleMmPerPx, wallHeight, material, steelGauge, topTrackStyle, deflectionGapMm, openings, opacity, built, activeUnit, lengthFormat }: WallMeshProps) {
  const p1 = pixelToWorld(wall.x1, wall.y1)
  const p2 = pixelToWorld(wall.x2, wall.y2)

  const dx = p2.x - p1.x
  const dz = p2.z - p1.z
  const length = Math.hypot(dx, dz)

  const cx = (p1.x + p2.x) / 2
  const cz = (p1.z + p2.z) / 2
  const angle = Math.atan2(dz, dx)

  // Thickness: use scale if known, otherwise fall back to standard 140mm
  const mmPerPx = scaleMmPerPx ?? DEFAULT_THICKNESS_MM / (wall.thickness || 8)
  const thicknessM = Math.max(MIN_THICKNESS, ((wall.thickness || 8) * mmPerPx) / 1000)

  // Masonry (CMU/brick/concrete) is a solid block; framed walls get studs.
  const isMasonry = wall.wallType === 'masonry-thick' || wall.framingType === 'cmu'
  const framing = useMemo(() => {
    if (isMasonry) {
      const g = new THREE.Group()
      const m = new THREE.Mesh(new THREE.BoxGeometry(length, wallHeight, thicknessM), blockMaterial(length, wallHeight, opacity))
      m.position.set(0, wallHeight / 2, 0)
      g.add(m)
      return g
    }
    const heavyDuty = wall.wallRole === 'exterior-bearing' || wall.wallRole === 'interior-bearing'
    const wallOpenings: WallOpening[] = openings.map((o) => ({ centerM: o.t * length, widthM: o.widthM, type: o.type }))
    return buildWallFraming({ length, height: wallHeight, thickness: thicknessM, material, heavyDuty, steelGauge, topTrackStyle, deflectionGapMm, openings: wallOpenings, opacity })
  }, [length, wallHeight, thicknessM, material, isMasonry, wall.wallRole, steelGauge, topTrackStyle, deflectionGapMm, openings, opacity])

  // Free the GPU geometry/material when this segment changes or unmounts.
  useEffect(() => () => {
    framing.traverse((o) => {
      if (o instanceof THREE.Mesh) { o.geometry.dispose(); (o.material as THREE.Material).dispose() }
    })
  }, [framing])

  if (length < 0.05) return null

  return (
    <>
      <primitive object={framing} position={[cx, 0, cz]} rotation={[0, -angle, 0]} />
      {/* Nameplate — the wall's real length while tracing; hidden once built. */}
      {!built && (
        <Billboard position={[cx, wallHeight + 0.28, cz]}>
          <Text fontSize={0.32} color="#ffffff" anchorX="center" anchorY="middle" outlineWidth={0.025} outlineColor="#0b1120">
            {formatMeasureMm(length * 1000, activeUnit, lengthFormat)}
          </Text>
        </Billboard>
      )}
    </>
  )
}

export default function LiveWallsLayer() {
  const drawings  = useAppStore((s) => s.drawings)
  const overlay   = useAppStore((s) => s.floorplanOverlay)
  const model     = useAppStore((s) => s.model)
  const placedObjects = useAppStore((s) => s.placedObjects)
  const buildResult = useAppStore((s) => s.buildResult)
  const wizardInputs = useAppStore((s) => s.wizardInputs)
  const framingMaterial = useConfigStore((s) => s.framingMaterial)
  const steelGauge = useConfigStore((s) => s.steelGauge)
  const steelTrackTop = useConfigStore((s) => s.steelTrackTop)
  const steelDeflectionGapMm = useConfigStore((s) => s.steelDeflectionGapMm)
  const activeUnit = useConfigStore((s) => s.activeUnit)
  const lengthFormat = useConfigStore((s) => s.lengthFormat)

  const groupRef = useRef<THREE.Group>(null)
  useExplodeChildren(groupRef, 'framing')

  const wallHeight = useMemo(
    () => deriveWorkspaceSceneConfig(wizardInputs).wallHeightM,
    [wizardInputs],
  )

  const drawing = drawings.find((d) => d.id === overlay.drawingId) ?? drawings[0] ?? null
  const imageWidth  = drawing?.rasterWidth  ?? 1400
  const imageHeight = drawing?.rasterHeight ?? 900
  const [overlayW, overlayD] = overlay.scale
  const rotRad = THREE.MathUtils.degToRad(overlay.rotationDeg)

  // Same transform used by FloorplanOverlay so walls sit exactly on the print
  const pixelToWorld = useMemo(() => (px: number, py: number): THREE.Vector3 => {
    const localX = ((px / imageWidth)  - 0.5) * overlayW
    const localZ = ((py / imageHeight) - 0.5) * overlayD
    const v = new THREE.Vector3(localX, 0, localZ)
      .applyAxisAngle(new THREE.Vector3(0, 1, 0), rotRad)
    return new THREE.Vector3(
      overlay.position[0] + v.x,
      0,
      overlay.position[1] + v.z,
    )
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

  // Assign each placed door/window to its nearest wall (in pixel space) and
  // record its position (t, 0..1) and rough-opening width — so the live framing
  // frames the opening exactly where the door/window sits, just like on site.
  const openingsByWall = useMemo(() => {
    const out: Array<Array<{ t: number; widthM: number; type: 'door' | 'window' }>> = userWalls.map(() => [])
    const doors = placedObjects.filter(
      (o: PlacedObject) => (o.type === 'door' || o.type === 'window') && o.pxX != null && o.pxY != null,
    )
    for (const o of doors) {
      const px = o.pxX as number, py = o.pxY as number
      let best = -1, bestPerp = Infinity, bestT = 0
      userWalls.forEach(({ wall: w }, i) => {
        const dx = w.x2 - w.x1, dy = w.y2 - w.y1
        const len2 = dx * dx + dy * dy
        if (len2 < 1e-6) return
        const t = ((px - w.x1) * dx + (py - w.y1) * dy) / len2
        if (t < -0.02 || t > 1.02) return
        const perp = Math.hypot(px - (w.x1 + t * dx), py - (w.y1 + t * dy))
        const threshPx = Math.max((w.thickness || 8) * 2.5, 28)
        if (perp < threshPx && perp < bestPerp) { best = i; bestPerp = perp; bestT = Math.max(0, Math.min(1, t)) }
      })
      if (best < 0) continue
      const item = getCatalogItem(o.type)
      const widthM = (item?.defaultW ?? 0.9) * o.scaleX
      out[best].push({ t: bestT, widthM, type: o.type as 'door' | 'window' })
    }
    return out
  }, [userWalls, placedObjects])

  // The traced walls ARE the build: instead of BuildingModel re-rendering them
  // through a different (engine) path that drops detail, the ghost walls persist
  // and simply go from semi-transparent (tracing) to solid (built). They keep
  // all their detail — steel channel/knockouts, block courses, blocking, framed
  // openings. BuildingModel skips walls when user walls exist (see there).
  const built = buildResult !== null || model.status === 'ready' || model.status === 'building'

  if (userWalls.length === 0) return null

  return (
    <group name="live-walls" ref={groupRef}>
      {userWalls.map(({ wall, scaleMmPerPx }, i) => (
        <WallMesh
          key={i}
          wall={wall}
          pixelToWorld={pixelToWorld}
          scaleMmPerPx={scaleMmPerPx}
          wallHeight={wallHeight}
          material={framingMaterial}
          steelGauge={steelGauge}
          topTrackStyle={steelTrackTop === 'double' ? 'deep' : steelTrackTop}
          deflectionGapMm={steelTrackTop === 'slotted' ? steelDeflectionGapMm : 0}
          openings={openingsByWall[i] ?? []}
          opacity={built ? 1 : 0.7}
          built={built}
          activeUnit={activeUnit}
          lengthFormat={lengthFormat}
        />
      ))}
    </group>
  )
}
