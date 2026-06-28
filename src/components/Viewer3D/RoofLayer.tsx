/**
 * RoofLayer — renders traced roof areas as 3D roofs and lets the user shape the
 * roof by dragging its RIDGE.
 *
 * Roof areas are stored as pixel-space rectangles. We apply the SAME overlay
 * transform as the floor joists, build the roof, and seat it on top of the walls
 * (eaves at wall-top height).
 *
 * Ridge handle (gable/truss roofs): a grabbable cyan bar along the ridge with an
 * amber knob at each end.
 *   • drag the bar UP/DOWN → pitch
 *   • drag the bar SIDEWAYS → slide the ridge off-centre (saltbox / asymmetric)
 *   • pull an end knob INWARD → hip that end
 * Pitch-only edits render with the rich legacy gable (keeps the sloped rake);
 * once the ridge is actually re-shaped we switch that roof to buildRidgeRoof.
 * Untouched roofs render exactly as before (the override is absent).
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import type { ThreeEvent } from '@react-three/fiber'
import { useExplodeChildren } from './explodeRuntime'
import { useAppStore } from '../../store/useAppStore'
import { useConfigStore } from '../../store/useConfigStore'
import { useFloorplanLocalStore } from '../../store/useFloorplanLocalStore'
import { deriveWorkspaceSceneConfig } from '../../services/workspaceScene'
import { buildRoofByType, buildRidgeRoof, ridgeIsShaped, FLOOR_ASSEMBLY_H } from '../../services/framingGeometry'
import { pitchToRatio } from '../../data/traceLayers'
import type { RoofRidge, TracedLine } from '../../types'

const RAFTER_OC_M = 0.4064   // 16" on-centre common rafters

// Pitch the ridge handle can be dragged to — 1:12 (almost flat) to 18:12 (steep).
const MIN_PITCH = 1 / 12
const MAX_PITCH = 18 / 12
// Vertical drag sensitivity: metres of ridge rise per screen pixel dragged.
const RISE_PER_PX = 0.012

// Roof types whose ridge runs centred along the long side — the ones the ridge
// handle can shape. Others (shed/flat/gambrel) come later.
const GABLE_FAMILY = new Set(['', 'gable', 'truss', 'trusses'])

const UP = new THREE.Vector3(0, 1, 0)
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const clampPitch = (p: number) => clamp(p, MIN_PITCH, MAX_PITCH)

/** Resolve the effective ridge for an area, honouring a live drag draft. */
function effectiveRidge(area: TracedLine, draft: RoofRidge | undefined): RoofRidge {
  const base = draft ?? area.ridge
  return {
    pitch: base?.pitch ?? pitchToRatio(area.size),
    crossFrac: base?.crossFrac ?? 0,
    insetA: base?.insetA ?? 0,
    insetB: base?.insetB ?? 0,
  }
}

interface RoofAreaMeshProps {
  area: TracedLine
  ridge: RoofRidge
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

function RoofAreaMesh({
  area, ridge, pixelToWorld, imageWidth, imageHeight, overlayW, overlayD, rotRad,
  wallHeight, selected, offset, onDown,
}: RoofAreaMeshProps) {
  const lenX = (Math.abs(area.x2 - area.x1) / imageWidth) * overlayW
  const lenZ = (Math.abs(area.y2 - area.y1) / imageHeight) * overlayD
  const centre = pixelToWorld((area.x1 + area.x2) / 2, (area.y1 + area.y2) / 2)

  const overhangM = useConfigStore((s) => s.roofOverhangIn) * 0.0254
  const isGable = GABLE_FAMILY.has((area.elementType || '').trim().toLowerCase())
  const shaped = isGable && ridgeIsShaped(ridge)

  const roof = useMemo(() => {
    const r = shaped
      ? buildRidgeRoof({
          lenX, lenZ, pitch: ridge.pitch, ocM: RAFTER_OC_M, overhangM,
          crossFrac: ridge.crossFrac, insetA: ridge.insetA, insetB: ridge.insetB,
        })
      : buildRoofByType(area.elementType, { lenX, lenZ, pitch: ridge.pitch, ocM: RAFTER_OC_M, overhangM })
    r.userData.level = area.level ?? 0  // so the shared explode lifts it floor-by-floor
    return r
  }, [lenX, lenZ, shaped, ridge.pitch, ridge.crossFrac, ridge.insetA, ridge.insetB, area.elementType, area.level, overhangM])

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

interface RidgeHandleProps {
  centre: THREE.Vector3
  eaveY: number
  rotRad: number
  lenX: number
  lenZ: number
  ridge: RoofRidge
  onDraft: (r: RoofRidge) => void
  onCommit: (r: RoofRidge) => void
}

/**
 * The grabbable ridge — rendered in the overlay world frame (not as a child of
 * the roof mesh) so the roof's internal rotation never throws it off. Its local
 * frame matches buildRidgeRoof's canonical: X = run (ridge direction along the
 * footprint's LONGER side), Z = span. Drags are resolved by projecting the
 * pointer onto the ridge-height plane, so they're camera-independent.
 */
function RidgeHandle({ centre, eaveY, rotRad, lenX, lenZ, ridge, onDraft, onCommit }: RidgeHandleProps) {
  const handleRotY = rotRad + (lenX >= lenZ ? 0 : Math.PI / 2)
  const L = Math.max(lenX, lenZ)
  const W = Math.min(lenX, lenZ)
  const half = W / 2
  const rise = Math.max(0.1, half * ridge.pitch)
  const c = (ridge.crossFrac ?? 0) * half
  const xA = -L / 2 + (ridge.insetA ?? 0) * L
  const xB = L / 2 - (ridge.insetB ?? 0) * L
  const ridgeLen = Math.max(0.2, xB - xA)

  const dragRef = useRef<{ kind: 'bar' | 'endA' | 'endB'; work: Required<RoofRidge> } | null>(null)
  const [dragging, setDragging] = useState(false)

  // Project the pointer ray onto the ridge-height plane, then into the handle's
  // local frame → (x = run coord, z = across coord).
  const toLocal = (e: ThreeEvent<PointerEvent>): THREE.Vector3 | null => {
    const plane = new THREE.Plane(UP, -(eaveY + rise))
    const hit = new THREE.Vector3()
    if (!e.ray.intersectPlane(plane, hit)) return null
    return new THREE.Vector3(hit.x - centre.x, 0, hit.z - centre.z).applyAxisAngle(UP, -handleRotY)
  }

  const start = (kind: 'bar' | 'endA' | 'endB') => (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    dragRef.current = {
      kind,
      work: {
        pitch: ridge.pitch,
        crossFrac: ridge.crossFrac ?? 0,
        insetA: ridge.insetA ?? 0,
        insetB: ridge.insetB ?? 0,
      },
    }
    setDragging(true)
  }

  const move = (e: ThreeEvent<PointerEvent>) => {
    const d = dragRef.current
    if (!d) return
    e.stopPropagation()
    if (d.kind === 'bar') {
      // Pitch from vertical screen motion; cross from the projected pointer.
      const dRise = -e.nativeEvent.movementY * RISE_PER_PX
      d.work.pitch = clampPitch(d.work.pitch + dRise / Math.max(0.3, half))
      const loc = toLocal(e)
      if (loc) d.work.crossFrac = clamp(loc.z / Math.max(0.1, half), -0.9, 0.9)
    } else {
      const loc = toLocal(e)
      if (loc) {
        if (d.kind === 'endA') d.work.insetA = clamp((loc.x + L / 2) / L, 0, 0.45)
        else d.work.insetB = clamp((L / 2 - loc.x) / L, 0, 0.45)
      }
    }
    onDraft({ ...d.work })
  }

  const end = (e: ThreeEvent<PointerEvent>) => {
    const d = dragRef.current
    if (!d) return
    e.stopPropagation()
    onCommit({ ...d.work })
    dragRef.current = null
    setDragging(false)
    document.body.style.cursor = ''
  }

  return (
    <group position={[centre.x, eaveY, centre.z]} rotation={[0, handleRotY, 0]}>
      {/* Ridge bar — drag up/down (pitch) or sideways (slide off-centre). */}
      <mesh
        position={[(xA + xB) / 2, rise, c]}
        onPointerDown={start('bar')}
        onPointerOver={() => { document.body.style.cursor = 'move' }}
        onPointerOut={() => { if (!dragging) document.body.style.cursor = '' }}
      >
        <boxGeometry args={[ridgeLen, 0.16, 0.16]} />
        <meshStandardMaterial color="#22d3ee" emissive="#0891b2" emissiveIntensity={0.6} roughness={0.4} />
      </mesh>
      {/* End knobs — pull inward to hip that end. */}
      {(['endA', 'endB'] as const).map((k) => (
        <mesh key={k} position={[k === 'endA' ? xA : xB, rise, c]} onPointerDown={start(k)}>
          <sphereGeometry args={[0.17, 16, 12]} />
          <meshStandardMaterial color="#f59e0b" emissive="#b45309" emissiveIntensity={0.65} roughness={0.35} />
        </mesh>
      ))}
      {/* Drag catcher — keeps move/up firing once the finger leaves the handle. */}
      {dragging && (
        <mesh onPointerMove={move} onPointerUp={end}>
          <sphereGeometry args={[800, 8, 6]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} side={THREE.BackSide} />
        </mesh>
      )}
    </group>
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

  // Live ridge draft for the area being dragged (committed to the store on release).
  const [draft, setDraft] = useState<{ id: string; ridge: RoofRidge } | null>(null)

  if (!visibleLayers.has('roof') || roofAreas.length === 0) return null

  return (
    <group name="roof" ref={groupRef}>
      {roofAreas.map((area) => {
        const isSelected = selectedArea?.kind === 'roof' && selectedArea.id === area.id
        const ridge = effectiveRidge(area, draft?.id === area.id ? draft.ridge : undefined)
        const isGable = GABLE_FAMILY.has((area.elementType || '').trim().toLowerCase())
        const lenX = (Math.abs(area.x2 - area.x1) / imageWidth) * overlayW
        const lenZ = (Math.abs(area.y2 - area.y1) / imageHeight) * overlayD
        const eaveY = wallHeight + (area.level ?? 0) * (wallHeight + FLOOR_ASSEMBLY_H)
        const centre = pixelToWorld((area.x1 + area.x2) / 2, (area.y1 + area.y2) / 2)

        return (
          <group key={area.id}>
            <RoofAreaMesh
              area={area}
              ridge={ridge}
              pixelToWorld={pixelToWorld}
              imageWidth={imageWidth}
              imageHeight={imageHeight}
              overlayW={overlayW}
              overlayD={overlayD}
              rotRad={rotRad}
              wallHeight={wallHeight}
              selected={isSelected}
              offset={[0, 0]}
              onDown={onDown(area)}
            />
            {isSelected && isGable && lenX > 0.2 && lenZ > 0.2 && (
              <RidgeHandle
                centre={centre}
                eaveY={eaveY}
                rotRad={rotRad}
                lenX={lenX}
                lenZ={lenZ}
                ridge={ridge}
                onDraft={(r) => setDraft({ id: area.id, ridge: r })}
                onCommit={(r) => { setRoofRidge(area.id, r); setDraft(null) }}
              />
            )}
          </group>
        )
      })}
    </group>
  )
}
