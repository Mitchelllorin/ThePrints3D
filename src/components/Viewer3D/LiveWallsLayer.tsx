/**
 * LiveWallsLayer — renders user-traced walls as semi-transparent 3D blocks
 * in real time as the user traces on the 2D print overlay.
 *
 * Coordinate system: walls are stored in image-pixel space. We apply the
 * same transform as FloorplanOverlay (overlay position/scale/rotation) to
 * place them correctly in the world.
 */
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { Billboard, Text } from '@react-three/drei'
import { useAppStore } from '../../store/useAppStore'
import { useConfigStore } from '../../store/useConfigStore'
import { deriveWorkspaceSceneConfig } from '../../services/workspaceScene'
import { buildWallFraming } from '../../services/framingGeometry'
import { formatMeasureMm, type LengthFormat } from '../../services/unitConverter'
import type { ActiveUnit } from '../../store/useConfigStore'
import type { ParsedWall } from '../../types'

const MIN_THICKNESS = 0.1     // metres — minimum visible thickness
const DEFAULT_THICKNESS_MM = 140  // 2×4 stud + drywall both sides

interface WallMeshProps {
  wall: ParsedWall
  pixelToWorld: (px: number, py: number) => THREE.Vector3
  scaleMmPerPx: number | null
  wallHeight: number
  material: 'wood' | 'steel'
  activeUnit: ActiveUnit
  lengthFormat: LengthFormat
}

function WallMesh({ wall, pixelToWorld, scaleMmPerPx, wallHeight, material, activeUnit, lengthFormat }: WallMeshProps) {
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
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(length, wallHeight, thicknessM),
        new THREE.MeshStandardMaterial({ color: '#a8a8a8', roughness: 1, metalness: 0, transparent: true, opacity: 0.7 }),
      )
      m.position.set(0, wallHeight / 2, 0)
      g.add(m)
      return g
    }
    return buildWallFraming({ length, height: wallHeight, thickness: thicknessM, material, opacity: 0.7 })
  }, [length, wallHeight, thicknessM, material, isMasonry])

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
      {/* Nameplate — the wall's real length, always facing the camera. */}
      <Billboard position={[cx, wallHeight + 0.28, cz]}>
        <Text fontSize={0.32} color="#ffffff" anchorX="center" anchorY="middle" outlineWidth={0.025} outlineColor="#0b1120">
          {formatMeasureMm(length * 1000, activeUnit, lengthFormat)}
        </Text>
      </Billboard>
    </>
  )
}

export default function LiveWallsLayer() {
  const drawings  = useAppStore((s) => s.drawings)
  const overlay   = useAppStore((s) => s.floorplanOverlay)
  const model     = useAppStore((s) => s.model)
  const buildResult = useAppStore((s) => s.buildResult)
  const wizardInputs = useAppStore((s) => s.wizardInputs)
  const framingMaterial = useConfigStore((s) => s.framingMaterial)
  const activeUnit = useConfigStore((s) => s.activeUnit)
  const lengthFormat = useConfigStore((s) => s.lengthFormat)

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

  // Once a build exists, BuildingModel exclusively owns the 3D wall volume —
  // the live preview boxes must disappear entirely (no double geometry / z-fight).
  // buildResult covers "Build for me"; model status covers the "Build 3D" path.
  const modelOwnsWalls = buildResult !== null || model.status === 'ready' || model.status === 'building'

  if (userWalls.length === 0 || modelOwnsWalls) return null

  return (
    <group name="live-walls">
      {userWalls.map(({ wall, scaleMmPerPx }, i) => (
        <WallMesh
          key={i}
          wall={wall}
          pixelToWorld={pixelToWorld}
          scaleMmPerPx={scaleMmPerPx}
          wallHeight={wallHeight}
          material={framingMaterial}
          activeUnit={activeUnit}
          lengthFormat={lengthFormat}
        />
      ))}
    </group>
  )
}
