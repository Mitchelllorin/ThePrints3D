/**
 * RoofLayer — renders traced roof areas as 3D gable roofs.
 *
 * Mirrors FloorJoistsLayer: roof areas are stored as pixel-space rectangles.
 * We apply the SAME overlay transform, build a gable roof with buildGableRoof,
 * and seat it on top of the walls (eaves at wall-top height) so it sits where a
 * roof actually goes.
 */
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useExplodeChildren } from './explodeRuntime'
import { useAppStore } from '../../store/useAppStore'
import { deriveWorkspaceSceneConfig } from '../../services/workspaceScene'
import { buildGableRoof, FLOOR_ASSEMBLY_H } from '../../services/framingGeometry'
import { pitchToRatio } from '../../data/traceLayers'
import type { TracedLine } from '../../types'

const RAFTER_OC_M = 0.4064   // 16" on-centre common rafters

interface RoofAreaMeshProps {
  area: TracedLine
  pixelToWorld: (px: number, py: number) => THREE.Vector3
  imageWidth: number
  imageHeight: number
  overlayW: number
  overlayD: number
  rotRad: number
  wallHeight: number
}

function RoofAreaMesh({ area, pixelToWorld, imageWidth, imageHeight, overlayW, overlayD, rotRad, wallHeight }: RoofAreaMeshProps) {
  const lenX = (Math.abs(area.x2 - area.x1) / imageWidth) * overlayW
  const lenZ = (Math.abs(area.y2 - area.y1) / imageHeight) * overlayD
  const centre = pixelToWorld((area.x1 + area.x2) / 2, (area.y1 + area.y2) / 2)

  const roof = useMemo(() => {
    const r = buildGableRoof({ lenX, lenZ, pitch: pitchToRatio(area.size), ocM: RAFTER_OC_M })
    r.userData.level = area.level ?? 0  // so the shared explode lifts it floor-by-floor
    return r
  }, [lenX, lenZ, area.size, area.level])

  useEffect(() => () => {
    roof.traverse((o) => {
      if (o instanceof THREE.Mesh) { o.geometry.dispose(); (o.material as THREE.Material).dispose() }
    })
  }, [roof])

  if (lenX < 0.2 || lenZ < 0.2) return null

  // Seat the eaves on the top plate of this storey's walls (level-aware).
  const eaveY = wallHeight + (area.level ?? 0) * (wallHeight + FLOOR_ASSEMBLY_H)
  return <primitive object={roof} position={[centre.x, eaveY, centre.z]} rotation={[0, rotRad, 0]} />
}

export default function RoofLayer() {
  const drawings = useAppStore((s) => s.drawings)
  const overlay = useAppStore((s) => s.floorplanOverlay)
  const roofAreas = useAppStore((s) => s.roofAreas)
  const visibleLayers = useAppStore((s) => s.visibleLayers)
  const wizardInputs = useAppStore((s) => s.wizardInputs)

  const groupRef = useRef<THREE.Group>(null)
  useExplodeChildren(groupRef, 'roof')

  const wallHeight = useMemo(() => deriveWorkspaceSceneConfig(wizardInputs).wallHeightM, [wizardInputs])

  const drawing = drawings.find((d) => d.id === overlay.drawingId) ?? drawings[0] ?? null
  const imageWidth = drawing?.rasterWidth ?? 1400
  const imageHeight = drawing?.rasterHeight ?? 900
  const [overlayW, overlayD] = overlay.scale
  const rotRad = THREE.MathUtils.degToRad(overlay.rotationDeg)

  const pixelToWorld = useMemo(() => (px: number, py: number): THREE.Vector3 => {
    const localX = ((px / imageWidth) - 0.5) * overlayW
    const localZ = ((py / imageHeight) - 0.5) * overlayD
    const v = new THREE.Vector3(localX, 0, localZ)
      .applyAxisAngle(new THREE.Vector3(0, 1, 0), rotRad)
    return new THREE.Vector3(overlay.position[0] + v.x, 0, overlay.position[1] + v.z)
  }, [imageWidth, imageHeight, overlayW, overlayD, rotRad, overlay.position])

  if (!visibleLayers.has('roof') || roofAreas.length === 0) return null

  return (
    <group name="roof" ref={groupRef}>
      {roofAreas.map((area) => (
        <RoofAreaMesh
          key={area.id}
          area={area}
          pixelToWorld={pixelToWorld}
          imageWidth={imageWidth}
          imageHeight={imageHeight}
          overlayW={overlayW}
          overlayD={overlayD}
          rotRad={rotRad}
          wallHeight={wallHeight}
        />
      ))}
    </group>
  )
}
