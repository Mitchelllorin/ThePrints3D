/**
 * CeilingLayer — renders floor areas typed as "Ceiling joists" as a ceiling:
 * joists + a gypsum board, seated at the wall top of the area's storey.
 *
 * Ceilings are pulled with the same rectangle flow as floors (they're a floor
 * "type"), but they sit at wall-top height with the joist bottoms on the plate.
 */
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { Billboard, Text } from '@react-three/drei'
import { useExplodeChildren } from './explodeRuntime'
import { useAppStore } from '../../store/useAppStore'
import { useUISettingsStore } from '../../store/useUISettingsStore'
import { deriveWorkspaceSceneConfig } from '../../services/workspaceScene'
import { buildCeiling, FLOOR_ASSEMBLY_H, CEILING_JOIST_DEPTH } from '../../services/framingGeometry'
import { CEILING_TYPES, ocToM } from '../../data/traceLayers'
import type { TracedLine } from '../../types'

function disposeGroup(group: THREE.Group) {
  group.traverse((o) => {
    if (o instanceof THREE.Mesh) { o.geometry.dispose(); (o.material as THREE.Material).dispose() }
  })
}

interface CeilingMeshProps {
  area: TracedLine
  pixelToWorld: (px: number, py: number) => THREE.Vector3
  imageWidth: number; imageHeight: number; overlayW: number; overlayD: number; rotRad: number
  storeyHeight: number
  wallHeight: number
}

function CeilingMesh({ area, pixelToWorld, imageWidth, imageHeight, overlayW, overlayD, rotRad, storeyHeight, wallHeight }: CeilingMeshProps) {
  const lenX = (Math.abs(area.x2 - area.x1) / imageWidth) * overlayW
  const lenZ = (Math.abs(area.y2 - area.y1) / imageHeight) * overlayD
  const centre = pixelToWorld((area.x1 + area.x2) / 2, (area.y1 + area.y2) / 2)
  const ceiling = useMemo(() => {
    const c = buildCeiling({ lenX, lenZ, ocM: ocToM(area.size) })
    c.userData.level = area.level ?? 0  // so the shared explode lifts it floor-by-floor
    return c
  }, [lenX, lenZ, area.size, area.level])
  const labelColor = useUISettingsStore((s) => s.labelColor)
  const labelScale = useUISettingsStore((s) => s.labelScale)
  useEffect(() => () => disposeGroup(ceiling), [ceiling])
  if (lenX < 0.1 || lenZ < 0.1) return null
  // Joist bottoms rest on this storey's wall top plate.
  const wallTop = (area.level ?? 0) * storeyHeight + wallHeight
  const y = wallTop + CEILING_JOIST_DEPTH / 2
  return (
    <>
      <primitive object={ceiling} position={[centre.x, y, centre.z]} rotation={[0, rotRad, 0]} />
      <Billboard position={[centre.x, y + 0.45, centre.z]}>
        <Text fontSize={0.26 * labelScale} color={labelColor} anchorX="center" anchorY="middle" outlineWidth={0.02 * labelScale} outlineColor="#0b1120">
          Ceiling
        </Text>
      </Billboard>
    </>
  )
}

export default function CeilingLayer() {
  const drawings = useAppStore((s) => s.drawings)
  const overlay = useAppStore((s) => s.floorplanOverlay)
  const floorsAreas = useAppStore((s) => s.floorsAreas)
  const visibleLayers = useAppStore((s) => s.visibleLayers)
  const wizardInputs = useAppStore((s) => s.wizardInputs)

  const groupRef = useRef<THREE.Group>(null)
  useExplodeChildren(groupRef, 'framing')

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
    const v = new THREE.Vector3(localX, 0, localZ)
      .applyAxisAngle(new THREE.Vector3(0, 1, 0), rotRad)
    return new THREE.Vector3(overlay.position[0] + v.x, 0, overlay.position[1] + v.z)
  }, [imageWidth, imageHeight, overlayW, overlayD, rotRad, overlay.position])

  const ceilings = floorsAreas.filter((a) => CEILING_TYPES.has(a.elementType))
  if (!visibleLayers.has('floors') || ceilings.length === 0) return null

  return (
    <group name="ceilings" ref={groupRef}>
      {ceilings.map((area) => (
        <CeilingMesh
          key={area.id}
          area={area}
          pixelToWorld={pixelToWorld}
          imageWidth={imageWidth}
          imageHeight={imageHeight}
          overlayW={overlayW}
          overlayD={overlayD}
          rotRad={rotRad}
          storeyHeight={storeyHeight}
          wallHeight={wallHeight}
        />
      ))}
    </group>
  )
}
