/**
 * RoofLayer — renders traced roof areas as 3D roofs and lets the user shape the
 * roof by dragging its RIDGE.
 *
 * Roof areas are stored as pixel-space rectangles. We apply the SAME overlay
 * transform as the floor joists, build the roof with buildRoofByType, and seat
 * it on top of the walls (eaves at wall-top height).
 *
 * Ridge handle: the selected gable/truss roof shows a grabbable bar along its
 * ridge. Dragging it up/down changes the pitch live (preview), committing to the
 * area's `ridge` override on release. When no override is set the roof falls back
 * to the auto `size`-derived pitch — so untouched roofs render exactly as before.
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

// Pitch the ridge handle can be dragged to — 1:12 (almost flat) to 18:12 (steep).
const MIN_PITCH = 1 / 12
const MAX_PITCH = 18 / 12
// Vertical drag sensitivity: metres of ridge rise per screen pixel dragged.
const RISE_PER_PX = 0.012

// Roof types whose ridge runs centred along the long side — the ones the ridge
// handle can pitch in Stage 1. Others (hip/shed/gambrel/saltbox/flat) come later.
const GABLE_FAMILY = new Set(['', 'gable', 'truss', 'trusses'])

const clampPitch = (p: number) => Math.min(MAX_PITCH, Math.max(MIN_PITCH, p))

interface RidgeDownInfo {
  /** half the span (m) — converts a rise delta into a pitch delta. */
  half: number
  /** pitch at grab time. */
  pitch: number
}

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
  /** Live pitch while the ridge is being dragged (overrides the stored pitch). */
  pitchPreview?: number
  onDown: (e: ThreeEvent<PointerEvent>) => void
  onRidgeDown: (e: ThreeEvent<PointerEvent>, info: RidgeDownInfo) => void
}

function RoofAreaMesh({
  area, pixelToWorld, imageWidth, imageHeight, overlayW, overlayD, rotRad,
  wallHeight, selected, offset, pitchPreview, onDown, onRidgeDown,
}: RoofAreaMeshProps) {
  const lenX = (Math.abs(area.x2 - area.x1) / imageWidth) * overlayW
  const lenZ = (Math.abs(area.y2 - area.y1) / imageHeight) * overlayD
  const centre = pixelToWorld((area.x1 + area.x2) / 2, (area.y1 + area.y2) / 2)

  // Effective pitch: live drag preview > committed ridge override > auto (size).
  const pitch = pitchPreview ?? area.ridge?.pitch ?? pitchToRatio(area.size)

  // Eave/soffit overhang the roof auto-extends past the wall line (config default
  // 16"). Because lenX/lenZ are the wall footprint, the overhang lands OUTSIDE
  // the walls automatically — no manual sizing.
  const overhangM = useConfigStore((s) => s.roofOverhangIn) * 0.0254
  const roof = useMemo(() => {
    const r = buildRoofByType(area.elementType, { lenX, lenZ, pitch, ocM: RAFTER_OC_M, overhangM })
    r.userData.level = area.level ?? 0  // so the shared explode lifts it floor-by-floor
    return r
  }, [lenX, lenZ, pitch, area.elementType, area.level, overhangM])

  useEffect(() => () => {
    roof.traverse((o) => {
      if (o instanceof THREE.Mesh) { o.geometry.dispose(); (o.material as THREE.Material).dispose() }
    })
  }, [roof])

  // Ridge geometry — must mirror buildGableRoof: the ridge runs along the LONGER
  // side, the span is across the shorter, rise = (span/2) * pitch.
  const ridge = useMemo(() => {
    const spanAlongX = lenX <= lenZ            // ridge runs along the longer side
    const span = spanAlongX ? lenX : lenZ
    const runLen = spanAlongX ? lenZ : lenX
    const half = span / 2
    const rise = Math.max(0.1, half * pitch)
    return { spanAlongX, half, runLen, rise }
  }, [lenX, lenZ, pitch])

  if (lenX < 0.2 || lenZ < 0.2) return null

  const showHandle = selected && GABLE_FAMILY.has((area.elementType || '').trim().toLowerCase())

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
      {showHandle && (
        <group position={[0, ridge.rise, 0]}>
          {/* Grabbable ridge bar — drag up/down to set the pitch. */}
          <mesh
            onPointerDown={(e) => onRidgeDown(e, { half: ridge.half, pitch })}
            onPointerOver={() => { document.body.style.cursor = 'ns-resize' }}
            onPointerOut={() => { document.body.style.cursor = '' }}
          >
            <boxGeometry
              args={ridge.spanAlongX
                ? [0.16, 0.16, ridge.runLen * 0.96]
                : [ridge.runLen * 0.96, 0.16, 0.16]}
            />
            <meshStandardMaterial color="#22d3ee" emissive="#0891b2" emissiveIntensity={0.6} roughness={0.4} />
          </mesh>
          {/* End knobs make the bar read as a draggable handle. */}
          {[-1, 1].map((s) => (
            <mesh
              key={s}
              position={ridge.spanAlongX ? [0, 0, s * ridge.runLen * 0.48] : [s * ridge.runLen * 0.48, 0, 0]}
              onPointerDown={(e) => onRidgeDown(e, { half: ridge.half, pitch })}
            >
              <sphereGeometry args={[0.14, 16, 12]} />
              <meshStandardMaterial color="#22d3ee" emissive="#0891b2" emissiveIntensity={0.7} roughness={0.35} />
            </mesh>
          ))}
        </group>
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
  const setRoofRidge = useAppStore((s) => s.setRoofRidge)
  const selectedArea = useFloorplanLocalStore((s) => s.selectedArea)
  const selectArea = useFloorplanLocalStore((s) => s.selectAreaExclusive)

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

  // LOCKED: a press on a roof body only SELECTS it (delete/info). Body drag-to-move
  // was removed — a stray press+move kept skating placed roofs across the workspace.
  const onDown = (area: TracedLine) => (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    selectArea('roof', area.id)
  }

  // ── Ridge drag: vertical drag sets pitch live, commits on release ──
  // Keep the live pitch + the half-span (to map a rise delta → pitch delta) in
  // state so the selected roof rebuilds as you drag.
  const [ridgeDrag, setRidgeDrag] = useState<{ id: string; pitch: number; half: number } | null>(null)

  const onRidgeDown = (area: TracedLine) => (e: ThreeEvent<PointerEvent>, info: RidgeDownInfo) => {
    e.stopPropagation()  // don't let the press fall through to body-select
    selectArea('roof', area.id)
    setRidgeDrag({ id: area.id, pitch: info.pitch, half: info.half })
  }

  const onRidgeMove = (e: ThreeEvent<PointerEvent>) => {
    if (!ridgeDrag) return
    e.stopPropagation()
    // Drag UP (negative screen movementY) raises the ridge → steeper pitch.
    const dRise = -e.nativeEvent.movementY * RISE_PER_PX
    const next = clampPitch(ridgeDrag.pitch + dRise / Math.max(0.3, ridgeDrag.half))
    setRidgeDrag({ ...ridgeDrag, pitch: next })
  }

  const onRidgeUp = (e: ThreeEvent<PointerEvent>) => {
    if (!ridgeDrag) return
    e.stopPropagation()
    setRoofRidge(ridgeDrag.id, { pitch: ridgeDrag.pitch })
    setRidgeDrag(null)
    document.body.style.cursor = ''
  }

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
          selected={selectedArea?.kind === 'roof' && selectedArea.id === area.id}
          offset={[0, 0]}
          pitchPreview={ridgeDrag?.id === area.id ? ridgeDrag.pitch : undefined}
          onDown={onDown(area)}
          onRidgeDown={onRidgeDown(area)}
        />
      ))}

      {/* Drag catcher — only while the ridge is being dragged. A huge inside-out
          sphere guarantees move/up keep firing even when the finger leaves the
          handle (mirrors the wall-drag catcher in FloorplanOverlay). */}
      {ridgeDrag && (
        <mesh onPointerMove={onRidgeMove} onPointerUp={onRidgeUp}>
          <sphereGeometry args={[800, 8, 6]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} side={THREE.BackSide} />
        </mesh>
      )}
    </group>
  )
}
