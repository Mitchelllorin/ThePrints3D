/**
 * PlacedObjectsLayer — renders user-placed furniture/fixtures as coloured box
 * stand-ins in world space, with a simple move/rotate gizmo for the selected
 * one. Positions are stored in world metres, so no overlay transform is needed.
 *
 * Dragging uses transient local state and only commits to the store (one
 * undoable step) on pointer-up, so a drag doesn't flood the history stack.
 */
import { useState, useRef } from 'react'
import * as THREE from 'three'
import type { ThreeEvent } from '@react-three/fiber'
import { Edges, Line } from '@react-three/drei'
import { useExplodeChildren } from './explodeRuntime'
import { useAppStore } from '../../store/useAppStore'
import { useFloorplanLocalStore } from '../../store/useFloorplanLocalStore'
import { getCatalogItem, deviceMountHeightM } from '../../data/objectCatalog'
import { deriveWorkspaceSceneConfig } from '../../services/workspaceScene'
import type { PlacedObject } from '../../types'

interface DragState {
  id: string
  kind: 'move' | 'rotate'
  x: number
  z: number
  rotationY: number
}

function dims(obj: PlacedObject) {
  const item = getCatalogItem(obj.type)
  return {
    w: (item?.defaultW ?? 1) * obj.scaleX,
    d: (item?.defaultD ?? 1) * obj.scaleZ,
    h: (item?.defaultH ?? 1) * obj.scaleY,
    color: item?.color ?? '#9ca3af',
  }
}

export default function PlacedObjectsLayer() {
  const placedObjects = useAppStore((s) => s.placedObjects)
  const updatePlacedObject = useAppStore((s) => s.updatePlacedObject)
  const wizardInputs = useAppStore((s) => s.wizardInputs)
  const selectedObjectId = useFloorplanLocalStore((s) => s.selectedObjectId)
  const selectObjectExclusive = useFloorplanLocalStore((s) => s.selectObjectExclusive)
  const placeObjectType = useFloorplanLocalStore((s) => s.placeObjectType)

  const ceilingM = deriveWorkspaceSceneConfig(wizardInputs).wallHeightM

  const [drag, setDrag] = useState<DragState | null>(null)
  const groupRef = useRef<THREE.Group>(null)
  useExplodeChildren(groupRef, 'mep')

  if (placedObjects.length === 0) return null

  const select = (id: string) => {
    selectObjectExclusive(id)
  }

  const startDrag = (e: ThreeEvent<PointerEvent>, obj: PlacedObject, kind: 'move' | 'rotate') => {
    e.stopPropagation()
    select(obj.id)
    setDrag({ id: obj.id, kind, x: obj.x, z: obj.z, rotationY: obj.rotationY })
  }

  const onPlaneMove = (e: ThreeEvent<PointerEvent>) => {
    if (!drag) return
    e.stopPropagation()
    if (drag.kind === 'move') {
      setDrag({ ...drag, x: e.point.x, z: e.point.z })
    } else {
      const obj = placedObjects.find((o) => o.id === drag.id)
      if (!obj) return
      setDrag({ ...drag, rotationY: Math.atan2(e.point.x - obj.x, e.point.z - obj.z) })
    }
  }

  const endDrag = (e: ThreeEvent<PointerEvent>) => {
    if (!drag) return
    e.stopPropagation()
    updatePlacedObject(drag.id, drag.kind === 'move'
      ? { x: drag.x, z: drag.z }
      : { rotationY: drag.rotationY })
    setDrag(null)
  }

  return (
    <group name="placed-objects" ref={groupRef}>
      {/* Invisible ground catcher — only active while dragging, so moves/rotates
          continue even when the pointer leaves the object box. */}
      {drag && (
        <mesh
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, 0.001, 0]}
          onPointerMove={onPlaneMove}
          onPointerUp={endDrag}
          onPointerLeave={endDrag}
        >
          <planeGeometry args={[2000, 2000]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      )}

      {placedObjects.map((obj) => {
        const live = drag && drag.id === obj.id ? { ...obj, x: drag.x, z: drag.z, rotationY: drag.rotationY } : obj
        const { w, d, h, color } = dims(live)
        const selected = obj.id === selectedObjectId
        // Doors/windows aren't furniture boxes — they're cut into the wall by
        // BuildingModel. Here they show only as a thin translucent opening
        // marker that stays selectable/draggable to reposition the cut.
        const isOpening = obj.type === 'door' || obj.type === 'window'
        const boxD = isOpening ? 0.06 : d
        // Windows sit at their sill height; electrical devices mount on the
        // wall/ceiling at a standard height; everything else sits on the floor.
        const mountY = obj.type === 'window'
          ? (obj.sillM ?? 0.9) + h / 2
          : deviceMountHeightM(obj.type, ceilingM) ?? h / 2
        return (
          <group key={obj.id} position={[live.x, 0, live.z]} rotation={[0, live.rotationY, 0]}>
            <mesh
              position={[0, mountY, 0]}
              userData={{ info: obj.label ?? obj.type }}
              castShadow={!isOpening}
              receiveShadow={!isOpening}
              onPointerDown={(e) => {
                // In place mode the floorplan handles the next click — don't steal it.
                if (placeObjectType) return
                if (selected) startDrag(e, obj, 'move')
                else { e.stopPropagation(); select(obj.id) }
              }}
            >
              <boxGeometry args={[w, h, boxD]} />
              <meshStandardMaterial
                color={color}
                roughness={0.6}
                metalness={0.05}
                transparent={isOpening}
                opacity={isOpening ? 0.35 : 1}
              />
              {selected && <Edges color="#facc15" lineWidth={2} />}
            </mesh>

            {/* Door swing arc — quarter circle from the hinge (LH/RH) plus the
                open leaf, drawn on the floor so it reads like a plan symbol. */}
            {obj.type === 'door' && (() => {
              const swing = obj.swing ?? 'left'
              const hinge = swing === 'left' ? -w / 2 : w / 2
              const sign = swing === 'left' ? 1 : -1
              const y = 0.06
              const N = 18
              const arc: [number, number, number][] = []
              for (let i = 0; i <= N; i++) {
                const t = (i / N) * (Math.PI / 2)
                arc.push([hinge + sign * w * Math.cos(t), y, w * Math.sin(t)])
              }
              const leaf: [number, number, number][] = [[hinge, y, 0], [hinge, y, w]]
              return (
                <>
                  <Line points={arc} color={color} lineWidth={2} />
                  <Line points={leaf} color={color} lineWidth={2.5} />
                </>
              )
            })()}

            {/* Rotate handle — a small knob in front of the object. */}
            {selected && !placeObjectType && (
              <mesh
                position={[0, mountY, d / 2 + 0.4]}
                onPointerDown={(e) => startDrag(e, obj, 'rotate')}
              >
                <sphereGeometry args={[0.14, 16, 16]} />
                <meshBasicMaterial color="#f472b6" />
              </mesh>
            )}
          </group>
        )
      })}
    </group>
  )
}
