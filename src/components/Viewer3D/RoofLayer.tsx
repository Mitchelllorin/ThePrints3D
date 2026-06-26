/**
 * RoofLayer — renders traced roof areas as 3D gable roofs.
 *
 * Mirrors FloorJoistsLayer: roof areas are stored as pixel-space rectangles.
 * We apply the SAME overlay transform, build a gable roof with buildGableRoof,
 * and seat it on top of the walls (eaves at wall-top height) so it sits where a
 * roof actually goes.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import type { ThreeEvent } from '@react-three/fiber'
import { useExplodeChildren } from './explodeRuntime'
import { useAppStore } from '../../store/useAppStore'
import { useConfigStore } from '../../store/useConfigStore'
import { useFloorplanLocalStore } from '../../store/useFloorplanLocalStore'
import { deriveWorkspaceSceneConfig } from '../../services/workspaceScene'
import { buildRoofByType, FLOOR_ASSEMBLY_H } from '../../services/framingGeometry'
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
  selected: boolean
  offset: [number, number]
  onDown: (e: ThreeEvent<PointerEvent>) => void
}

function RoofAreaMesh({ area, pixelToWorld, imageWidth, imageHeight, overlayW, overlayD, rotRad, wallHeight, selected, offset, onDown }: RoofAreaMeshProps) {
  const lenX = (Math.abs(area.x2 - area.x1) / imageWidth) * overlayW
  const lenZ = (Math.abs(area.y2 - area.y1) / imageHeight) * overlayD
  const centre = pixelToWorld((area.x1 + area.x2) / 2, (area.y1 + area.y2) / 2)

  // Eave/soffit overhang the roof auto-extends past the wall line (config default
  // 16"). Because lenX/lenZ are the wall footprint, the overhang lands OUTSIDE
  // the walls automatically — no manual sizing.
  const overhangM = useConfigStore((s) => s.roofOverhangIn) * 0.0254
  const roof = useMemo(() => {
    const r = buildRoofByType(area.elementType, { lenX, lenZ, pitch: pitchToRatio(area.size), ocM: RAFTER_OC_M, overhangM })
    r.userData.level = area.level ?? 0  // so the shared explode lifts it floor-by-floor
    return r
  }, [lenX, lenZ, area.size, area.elementType, area.level, overhangM])

  useEffect(() => () => {
    roof.traverse((o) => {
      if (o instanceof THREE.Mesh) { o.geometry.dispose(); (o.material as THREE.Material).dispose() }
    })
  }, [roof])

  if (lenX < 0.2 || lenZ < 0.2) return null

  // Seat the eaves on the top plate of this storey's walls (level-aware).
  const eaveY = wallHeight + (area.level ?? 0) * (wallHeight + FLOOR_ASSEMBLY_H)
  return (
    <primitive
      object={roof}
      position={[centre.x + offset[0], eaveY, centre.z + offset[1]]}
      rotation={[0, rotRad, 0]}
      onPointerDown={onDown}
    >
      {selected && (
        <mesh position={[0, 0.2, 0]}>
          <boxGeometry args={[lenX, 0.05, lenZ]} />
          <meshBasicMaterial color="#facc15" transparent opacity={0.18} depthWrite={false} />
        </mesh>
      )}
    </primitive>
  )
}

export default function RoofLayer() {
  const drawings = useAppStore((s) => s.drawings)
  const overlay = useAppStore((s) => s.floorplanOverlay)
  const roofAreas = useAppStore((s) => s.roofAreas)
  const visibleLayers = useAppStore((s) => s.visibleLayers)
  const wizardInputs = useAppStore((s) => s.wizardInputs)
  const translateRoofArea = useAppStore((s) => s.translateRoofArea)
  // Locked from dragging once built (same as floors) — no accidental flinging.
  const modelReady = useAppStore((s) => s.model.status === 'ready')
  const selectedArea = useFloorplanLocalStore((s) => s.selectedArea)
  const selectArea = useFloorplanLocalStore((s) => s.selectAreaExclusive)

  const groupRef = useRef<THREE.Group>(null)
  useExplodeChildren(groupRef, 'roof')

  // Drag-move a selected roof area: select on first tap, drag on the next press.
  // sx/sz captured on the first move over the catcher plane (not from the mesh),
  // so a tap can't translate and there's no mesh-vs-ground plane mismatch.
  const [drag, setDrag] = useState<{ id: string; sx: number | null; sz: number | null; dx: number; dz: number } | null>(null)

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

  // World drag delta → pixel delta (un-rotate by the overlay rotation, scale).
  const worldDeltaToPixel = (dx: number, dz: number): [number, number] => {
    const c = Math.cos(-rotRad), s = Math.sin(-rotRad)
    const lx = dx * c - dz * s
    const lz = dx * s + dz * c
    return [(lx / overlayW) * imageWidth, (lz / overlayD) * imageHeight]
  }
  const onDown = (area: TracedLine) => (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    if (modelReady) { selectArea('roof', area.id); return }   // locked after build — select only
    if (selectedArea?.kind === 'roof' && selectedArea.id === area.id) {
      // Arm the drag; capture the reference on the first catcher-plane move (not
      // from e.point on the roof mesh up at wall height, which made it "shoot out").
      setDrag({ id: area.id, sx: null, sz: null, dx: 0, dz: 0 })
    } else {
      selectArea('roof', area.id)
    }
  }
  const onMove = (e: ThreeEvent<PointerEvent>) => {
    if (!drag) return
    e.stopPropagation()
    if (drag.sx == null || drag.sz == null) {
      setDrag({ ...drag, sx: e.point.x, sz: e.point.z, dx: 0, dz: 0 })   // first move = reference
      return
    }
    setDrag({ ...drag, dx: e.point.x - drag.sx, dz: e.point.z - drag.sz })
  }
  const onUp = (e: ThreeEvent<PointerEvent>) => {
    if (!drag) return
    e.stopPropagation()
    const [dpx, dpy] = worldDeltaToPixel(drag.dx, drag.dz)
    if (Math.hypot(dpx, dpy) > 0.5) translateRoofArea(drag.id, dpx, dpy)
    setDrag(null)
  }

  if (!visibleLayers.has('roof') || roofAreas.length === 0) return null

  return (
    <group name="roof" ref={groupRef}>
      {/* Ground catcher while dragging, so the move keeps tracking off the area. */}
      {drag && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp}>
          <planeGeometry args={[4000, 4000]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
      )}
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
          selected={selectedArea?.kind === 'roof' && selectedArea.id === area.id}
          offset={drag && drag.id === area.id ? [drag.dx, drag.dz] : [0, 0]}
          onDown={onDown(area)}
        />
      ))}
    </group>
  )
}
