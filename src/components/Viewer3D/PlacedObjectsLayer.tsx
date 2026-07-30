/**
 * PlacedObjectsLayer — renders user-placed furniture/fixtures as coloured box
 * stand-ins in world space, with a simple move/rotate gizmo for the selected
 * one. Positions are stored in world metres, so no overlay transform is needed.
 *
 * Dragging uses transient local state and only commits to the store (one
 * undoable step) on pointer-up, so a drag doesn't flood the history stack.
 */
import { useState, useRef, useLayoutEffect } from 'react'
import * as THREE from 'three'
import type { ThreeEvent } from '@react-three/fiber'
import { Edges, Line } from '@react-three/drei'
import { useExplodeChildren } from './explodeRuntime'
import { useAppStore } from '../../store/useAppStore'
import { useFloorplanLocalStore } from '../../store/useFloorplanLocalStore'
import { getCatalogItem, deviceMountHeightM } from '../../data/objectCatalog'
import ObjectModel from './ObjectModels'
import { deriveWorkspaceSceneConfig } from '../../services/workspaceScene'
import { FLOOR_ASSEMBLY_H } from '../../services/framingGeometry'
import type { PlacedObject } from '../../types'

interface DragState {
  id: string
  kind: 'move' | 'rotate'
  x: number
  z: number
  rotationY: number
  /** True once the pointer has actually moved — distinguishes a drag (move the
   *  object) from a tap (select it). Lets a single press-drag reposition on
   *  touch, instead of needing a select-tap first. */
  moved?: boolean
}

/** X-ray wrapper — when `on`, traverses its rendered meshes and makes every
 *  material see-through (depthWrite off so it sorts cleanly). Re-applies after
 *  every render so it survives the procedural model rebuilding its materials,
 *  and restores full opacity when toggled off. The same look as the wall X-ray,
 *  applied uniformly to any object (procedural model or plain box). */
function XRay({ on, children }: { on: boolean; children: React.ReactNode }) {
  const ref = useRef<THREE.Group>(null)
  useLayoutEffect(() => {
    const g = ref.current
    if (!g) return
    const apply = (mat: THREE.Material) => {
      mat.transparent = on
      ;(mat as THREE.MeshStandardMaterial).opacity = on ? 0.18 : 1
      mat.depthWrite = !on
      mat.needsUpdate = true
    }
    g.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        const m = o.material as THREE.Material | THREE.Material[]
        if (Array.isArray(m)) m.forEach(apply)
        else apply(m)
      }
    })
  })
  return <group ref={ref}>{children}</group>
}

/** Detail explode — spreads a model's part meshes radially out from its centre
 *  so you can see the components, then snaps them back when off. Mirrors XRay's
 *  traverse-and-restore approach; base positions are cached per mesh. */
function DetailExplode({ amount, children }: { amount: number; children: React.ReactNode }) {
  const ref = useRef<THREE.Group>(null)
  useLayoutEffect(() => {
    const g = ref.current
    if (!g) return
    g.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        const base = (o.userData.basePos ??= o.position.clone()) as THREE.Vector3
        o.position.copy(base).multiplyScalar(1 + amount)
      }
    })
  })
  return <group ref={ref}>{children}</group>
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
  const detailExplodeId = useFloorplanLocalStore((s) => s.detailExplodeId)
  const selectObjectExclusive = useFloorplanLocalStore((s) => s.selectObjectExclusive)
  const setGestureLock = useFloorplanLocalStore((s) => s.setGestureLock)
  const placeObjectType = useFloorplanLocalStore((s) => s.placeObjectType)
  const editMode = useFloorplanLocalStore((s) => s.editMode)
  const editHover = useFloorplanLocalStore((s) => s.editHover)
  const setEditHover = useFloorplanLocalStore((s) => s.setEditHover)

  const ceilingM = deriveWorkspaceSceneConfig(wizardInputs).wallHeightM
  // Same storey-to-storey rise the walls/decks use, so an object placed on an
  // upper floor sits on THAT floor instead of down at grade.
  const storeyHeight = ceilingM + FLOOR_ASSEMBLY_H

  const [drag, setDrag] = useState<DragState | null>(null)
  // Precision gizmo (edit mode only) — live transform before commit, + its mode.
  const groupRef = useRef<THREE.Group>(null)
  // Double-tap an object to flip its X-ray — quick, no panel/scroll. One detector
  // for the whole layer; the per-object handler calls it. (Walls/floors next.)
  useExplodeChildren(groupRef, 'mep')

  if (placedObjects.length === 0) return null

  const select = (id: string) => {
    selectObjectExclusive(id)
  }

  // Rotate knob (only shows when selected): an explicit rotate drag.
  const startDrag = (e: ThreeEvent<PointerEvent>, obj: PlacedObject, kind: 'move' | 'rotate') => {
    e.stopPropagation()
    select(obj.id)
    setDrag({ id: obj.id, kind, x: obj.x, z: obj.z, rotationY: obj.rotationY, moved: false })
    setGestureLock(true)
  }

  // Pressing an object starts a PENDING move — no select yet. If the pointer
  // moves it becomes a drag; if it doesn't, the release selects it (tap).
  const startObjectPress = (e: ThreeEvent<PointerEvent>, obj: PlacedObject) => {
    e.stopPropagation()
    setDrag({ id: obj.id, kind: 'move', x: obj.x, z: obj.z, rotationY: obj.rotationY, moved: false })
    setGestureLock(true)
  }

  const onPlaneMove = (e: ThreeEvent<PointerEvent>) => {
    if (!drag) return
    e.stopPropagation()
    if (drag.kind === 'move') {
      setDrag({ ...drag, x: e.point.x, z: e.point.z, moved: true })
    } else {
      const obj = placedObjects.find((o) => o.id === drag.id)
      if (!obj) return
      setDrag({ ...drag, rotationY: Math.atan2(e.point.x - obj.x, e.point.z - obj.z), moved: true })
    }
  }

  const endDrag = (e: ThreeEvent<PointerEvent>) => {
    if (!drag) return
    e.stopPropagation()
    if (drag.moved) {
      updatePlacedObject(drag.id, drag.kind === 'move'
        ? { x: drag.x, z: drag.z }
        : { rotationY: drag.rotationY })
    } else {
      select(drag.id)   // a tap (no movement) just selects → opens the editor
    }
    setDrag(null)
    setGestureLock(false)
  }


  return (
    <group name="placed-objects" ref={groupRef}>
      {/* Transforms are driven by the edit rail (WorkspaceLayout) — buttons that
          do what they say, not handles floating over the model. */}

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
        const live =
          drag && drag.id === obj.id
            ? { ...obj, x: drag.x, z: drag.z, rotationY: drag.rotationY }
            : obj
        const { w, d, h, color } = dims(live)
        const selected = obj.id === selectedObjectId
        const editHovered = editMode && editHover?.kind === 'object' && editHover.id === obj.id
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
        const model = isOpening ? null : <ObjectModel type={obj.type} w={w} h={h} d={d} color={color} subtype={obj.subtype} />
        return (
          <group key={obj.id} position={[live.x, (obj.level ?? 0) * storeyHeight, live.z]} rotation={[0, live.rotationY, 0]}>
            <group
              position={[0, mountY, 0]}
              userData={{ info: obj.label ?? obj.type }}
              onPointerDown={(e) => {
                // In place mode the floorplan handles the next click — don't steal it.
                if (placeObjectType) return
                // EDIT MODE ONLY, like every other component. Objects were the one
                // type you could select and drag with edit mode off, which is why
                // the mode felt meaningless: you could shove the furniture around
                // while just looking at the model.
                if (!editMode) return
                e.stopPropagation()
                if (!selected) { select(obj.id); return }
                startObjectPress(e, obj)
              }}
              onPointerOver={editMode ? (e) => { e.stopPropagation(); setEditHover({ kind: 'object', id: obj.id }) } : undefined}
              onPointerOut={editMode ? () => setEditHover(null) : undefined}
            >
              {/* Procedural product model for any real object (ObjectModel itself
                  boxes-out types without a dedicated shape); only door/window
                  openings use the thin translucent marker box below. The X-ray
                  wrapper makes the whole model see-through when toggled. */}
              {!isOpening && model ? (
                <XRay on={!!obj.transparent}>
                  <DetailExplode amount={obj.id === detailExplodeId ? 0.7 : 0}>{model}</DetailExplode>
                </XRay>
              ) : (
                <mesh castShadow={!isOpening} receiveShadow={!isOpening}>
                  <boxGeometry args={[w, h, boxD]} />
                  <meshStandardMaterial
                    color={color}
                    roughness={0.6}
                    metalness={0.05}
                    transparent={isOpening || !!obj.transparent}
                    opacity={obj.transparent ? 0.18 : isOpening ? 0.8 : 1}
                    // Openings MUST write depth or a wall wins every depth test and
                    // hides the door/window from all but a straight-down view (the
                    // "disappears through a wall" bug). Only X-ray'd objects skip it.
                    depthWrite={!obj.transparent}
                  />
                  {/* An opening is a thin panel — edge-on from the top-down plan
                      view it collapses to a line, so a bold outline keeps it reading
                      from any angle even when the face is edge-on. */}
                  {isOpening && !obj.transparent && <Edges color={color} lineWidth={2.5} />}
                </mesh>
              )}
              {/* Selection outline — an invisible bounding box carrying the edges.
                  Amber when selected; cyan when hovered in edit mode. */}
              {(selected || editHovered) && (
                <mesh>
                  <boxGeometry args={[w, h, boxD]} />
                  <meshBasicMaterial visible={false} />
                  <Edges color={selected ? '#facc15' : '#22d3ee'} lineWidth={2} />
                </mesh>
              )}
            </group>

            {/* Door plan symbol — jambs marking the opening + the swing leaf and
                its quarter-circle arc, drawn FLAT on the floor so the door reads
                from straight overhead (the vertical panel above is edge-on and
                invisible top-down). Bold + opaque so it never looks "missing". */}
            {obj.type === 'door' && (() => {
              const swing = obj.swing ?? 'left'
              const hinge = swing === 'left' ? -w / 2 : w / 2
              const sign = swing === 'left' ? 1 : -1
              const y = 0.07
              const N = 20
              const arc: [number, number, number][] = []
              for (let i = 0; i <= N; i++) {
                const t = (i / N) * (Math.PI / 2)
                arc.push([hinge + sign * w * Math.cos(t), y, w * Math.sin(t)])
              }
              const leaf: [number, number, number][] = [[hinge, y, 0], [hinge, y, w]]
              const jambL: [number, number, number][] = [[-w / 2, y, -0.09], [-w / 2, y, 0.09]]
              const jambR: [number, number, number][] = [[w / 2, y, -0.09], [w / 2, y, 0.09]]
              return (
                <>
                  <Line points={jambL} color={color} lineWidth={4} />
                  <Line points={jambR} color={color} lineWidth={4} />
                  <Line points={leaf} color={color} lineWidth={4} />
                  <Line points={arc} color={color} lineWidth={3} />
                </>
              )
            })()}

            {/* Window plan symbol — a double bar across the opening between two
                jambs, flat on the floor so a window reads top-down just like a
                door (it has no swing to draw). */}
            {obj.type === 'window' && (() => {
              const y = 0.07
              const barA: [number, number, number][] = [[-w / 2, y, -0.05], [w / 2, y, -0.05]]
              const barB: [number, number, number][] = [[-w / 2, y, 0.05], [w / 2, y, 0.05]]
              const jambL: [number, number, number][] = [[-w / 2, y, -0.12], [-w / 2, y, 0.12]]
              const jambR: [number, number, number][] = [[w / 2, y, -0.12], [w / 2, y, 0.12]]
              return (
                <>
                  <Line points={jambL} color={color} lineWidth={4} />
                  <Line points={jambR} color={color} lineWidth={4} />
                  <Line points={barA} color={color} lineWidth={3} />
                  <Line points={barB} color={color} lineWidth={3} />
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
