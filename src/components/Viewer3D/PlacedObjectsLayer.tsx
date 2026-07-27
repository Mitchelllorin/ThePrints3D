/**
 * PlacedObjectsLayer — renders user-placed furniture/fixtures as coloured box
 * stand-ins in world space, with a simple move/rotate gizmo for the selected
 * one. Positions are stored in world metres, so no overlay transform is needed.
 *
 * Dragging uses transient local state and only commits to the store (one
 * undoable step) on pointer-up, so a drag doesn't flood the history stack.
 */
import { useState, useRef, useLayoutEffect, useEffect, useMemo } from 'react'
import * as THREE from 'three'
import type { ThreeEvent } from '@react-three/fiber'
import { Edges, Line, TransformControls, Html } from '@react-three/drei'
import { useExplodeChildren } from './explodeRuntime'
import { createDoubleTapState, detectDoubleTap } from './doubleTap'
import { useAppStore } from '../../store/useAppStore'
import { useFloorplanLocalStore } from '../../store/useFloorplanLocalStore'
import { getCatalogItem, deviceMountHeightM } from '../../data/objectCatalog'
import ObjectModel from './ObjectModels'
import { deriveWorkspaceSceneConfig } from '../../services/workspaceScene'
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

/** The transform the gizmo is writing live (before it's committed to the store). */
type GizmoLive = {
  id: string
  x: number
  z: number
  rotationY: number
  scaleX: number
  scaleY: number
  scaleZ: number
}
type GizmoMode = 'translate' | 'rotate' | 'scale'

/**
 * ObjectGizmo — the R/G/B axis gizmo (drei TransformControls) for the selected
 * object in edit mode. It drives an invisible proxy that mirrors the object's
 * stored transform; on drag it reports live values up (rendered transiently) and
 * commits once on release. OrbitControls is `makeDefault`, so drei suspends
 * orbit automatically while a handle is dragged.
 *
 *  • Move   → X/Z arrows (objects live on the floor; Y-translate has no store
 *             field yet — arrives when this extends to walls/multi-floor).
 *  • Rotate → the yaw ring (rotationY).
 *  • Stretch→ X/Y/Z scale (scaleY taller = the "extrude / extend" the user wants).
 */
function ObjectGizmo({
  obj,
  mountY,
  mode,
  onLive,
  onCommit,
}: {
  obj: PlacedObject
  mountY: number
  mode: GizmoMode
  onLive: (v: GizmoLive) => void
  onCommit: (v: GizmoLive) => void
}) {
  const proxy = useMemo(() => new THREE.Object3D(), [])
  const [ready, setReady] = useState(false)
  const dragging = useRef(false)

  useEffect(() => setReady(true), [])

  // Seed the proxy from the store whenever the stored transform changes and we
  // aren't mid-drag (so a live edit isn't clobbered by a re-render).
  useLayoutEffect(() => {
    if (dragging.current) return
    proxy.position.set(obj.x, mountY, obj.z)
    proxy.rotation.set(0, obj.rotationY, 0)
    proxy.scale.set(obj.scaleX, obj.scaleY, obj.scaleZ)
    proxy.updateMatrixWorld()
  }, [obj.x, obj.z, obj.rotationY, obj.scaleX, obj.scaleY, obj.scaleZ, mountY, proxy])

  const read = (): GizmoLive => ({
    id: obj.id,
    x: proxy.position.x,
    z: proxy.position.z,
    rotationY: proxy.rotation.y,
    scaleX: Math.max(0.05, proxy.scale.x),
    scaleY: Math.max(0.05, proxy.scale.y),
    scaleZ: Math.max(0.05, proxy.scale.z),
  })

  return (
    <>
      <primitive object={proxy} />
      {ready && (
        <TransformControls
          object={proxy}
          mode={mode}
          size={0.75}
          showY={mode !== 'translate'}
          onMouseDown={() => { dragging.current = true }}
          onObjectChange={() => onLive(read())}
          onMouseUp={() => { dragging.current = false; onCommit(read()) }}
        />
      )}
    </>
  )
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
  const placeObjectType = useFloorplanLocalStore((s) => s.placeObjectType)
  const editMode = useFloorplanLocalStore((s) => s.editMode)
  const editHover = useFloorplanLocalStore((s) => s.editHover)
  const setEditHover = useFloorplanLocalStore((s) => s.setEditHover)

  const ceilingM = deriveWorkspaceSceneConfig(wizardInputs).wallHeightM

  const [drag, setDrag] = useState<DragState | null>(null)
  // Precision gizmo (edit mode only) — live transform before commit, + its mode.
  const [gizmoLive, setGizmoLive] = useState<GizmoLive | null>(null)
  const [gizmoMode, setGizmoMode] = useState<GizmoMode>('translate')
  const groupRef = useRef<THREE.Group>(null)
  // Double-tap an object to flip its X-ray — quick, no panel/scroll. One detector
  // for the whole layer; the per-object handler calls it. (Walls/floors next.)
  const dtap = useRef(createDoubleTapState())
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
  }

  // Pressing an object starts a PENDING move — no select yet. If the pointer
  // moves it becomes a drag; if it doesn't, the release selects it (tap).
  const startObjectPress = (e: ThreeEvent<PointerEvent>, obj: PlacedObject) => {
    e.stopPropagation()
    setDrag({ id: obj.id, kind: 'move', x: obj.x, z: obj.z, rotationY: obj.rotationY, moved: false })
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
  }

  // The object the precision gizmo attaches to: the selected one, in edit mode.
  const gizmoObj =
    editMode && selectedObjectId && !placeObjectType
      ? placedObjects.find((o) => o.id === selectedObjectId) ?? null
      : null
  const gizmoMountY = gizmoObj
    ? (gizmoObj.type === 'window'
        ? (gizmoObj.sillM ?? 0.9) + (dims(gizmoObj).h) / 2
        : deviceMountHeightM(gizmoObj.type, ceilingM) ?? dims(gizmoObj).h / 2)
    : 0

  return (
    <group name="placed-objects" ref={groupRef}>
      {/* Precision transform gizmo (edit mode) — R/G/B axis handles on the
          selected object, with a Move/Rotate/Stretch mode toggle floating above. */}
      {gizmoObj && (
        <ObjectGizmo
          key={gizmoObj.id}
          obj={gizmoObj}
          mountY={gizmoMountY}
          mode={gizmoMode}
          onLive={setGizmoLive}
          onCommit={(v) => {
            updatePlacedObject(v.id, {
              x: v.x, z: v.z, rotationY: v.rotationY,
              scaleX: v.scaleX, scaleY: v.scaleY, scaleZ: v.scaleZ,
            })
            setGizmoLive(null)
          }}
        />
      )}
      {gizmoObj && (
        <Html
          position={[gizmoObj.x, gizmoMountY + dims(gizmoObj).h / 2 + 0.6, gizmoObj.z]}
          center
          distanceFactor={8}
          zIndexRange={[20, 0]}
          style={{ pointerEvents: 'auto', userSelect: 'none' }}
        >
          <div style={{ display: 'flex', gap: 4 }}>
            {(['translate', 'rotate', 'scale'] as GizmoMode[]).map((m) => (
              <button
                key={m}
                onPointerDown={(e) => { e.stopPropagation(); setGizmoMode(m) }}
                style={{
                  padding: '3px 9px',
                  fontSize: 11,
                  fontWeight: 700,
                  borderRadius: 999,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  color: gizmoMode === m ? '#0b0f17' : '#e2e8f0',
                  background: gizmoMode === m ? '#38bdf8' : 'rgba(10,16,30,0.75)',
                  border: '1px solid rgba(56,189,248,0.5)',
                  textShadow: gizmoMode === m ? 'none' : '0 1px 2px rgba(0,0,0,0.8)',
                }}
              >
                {m === 'translate' ? 'Move' : m === 'rotate' ? 'Rotate' : 'Stretch'}
              </button>
            ))}
          </div>
        </Html>
      )}

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
          gizmoLive && gizmoLive.id === obj.id
            ? { ...obj, x: gizmoLive.x, z: gizmoLive.z, rotationY: gizmoLive.rotationY, scaleX: gizmoLive.scaleX, scaleY: gizmoLive.scaleY, scaleZ: gizmoLive.scaleZ }
            : drag && drag.id === obj.id
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
          <group key={obj.id} position={[live.x, 0, live.z]} rotation={[0, live.rotationY, 0]}>
            <group
              position={[0, mountY, 0]}
              userData={{ info: obj.label ?? obj.type }}
              onPointerDown={(e) => {
                // In place mode the floorplan handles the next click — don't steal it.
                if (placeObjectType) return
                // Double-tap → toggle X-ray, and don't also start a drag/select.
                if (detectDoubleTap(dtap.current, obj.id, e)) {
                  e.stopPropagation()
                  updatePlacedObject(obj.id, { transparent: !obj.transparent })
                  return
                }
                // Press-drag to move, tap to select — one gesture either way.
                startObjectPress(e, obj)
              }}
              onPointerUp={(e) => {
                // Tap with no drag, and the catcher didn't catch the release →
                // select here so the editor still opens on a plain tap.
                if (drag && drag.id === obj.id && !drag.moved) { e.stopPropagation(); select(obj.id); setDrag(null) }
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
