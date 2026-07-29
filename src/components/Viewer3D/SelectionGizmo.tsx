/**
 * SelectionGizmo — ONE gizmo for whatever is selected.
 *
 * There used to be two systems: a full translate/rotate/scale gizmo living
 * inside PlacedObjectsLayer that read `selectedObjectId`, and nothing at all for
 * floors, roofs and walls — they recorded picks on a different channel, so
 * selecting a roof and hunting for handles found none. This replaces both.
 *
 * The unifying idea: a selection resolves to a TARGET that declares
 *   • where the handles sit,
 *   • which modes its data can actually express, and
 *   • how to write a transform back.
 * The gizmo itself knows nothing about floors or doors. Adding a component type
 * means adding one resolver, not another gizmo.
 *
 * MODES ARE DATA-DRIVEN, because the stores genuinely differ:
 *   object   move · rotate · stretch — world metres, has every field
 *   wall     move · rotate · stretch — pixel endpoints, so rotate swings them
 *                                      about the midpoint and stretch changes
 *                                      length; both are representable
 *   floor    move · stretch          — an axis-aligned pixel rect. Stretch
 *   roof                               resizes it. There is NO rotation field,
 *                                      so a rotate ring would spin and change
 *                                      nothing — it is hidden rather than lying.
 *
 * LIVE PREVIEW goes to `gizmoLive` in the local store while dragging, and the
 * real write happens ONCE on release: the model follows your hand, and you get
 * one undo step per edit instead of one per frame.
 */
import { useMemo, useRef, useState, useEffect, useLayoutEffect } from 'react'
import * as THREE from 'three'
import { TransformControls, Html } from '@react-three/drei'
import { useAppStore } from '../../store/useAppStore'
import { useFloorplanLocalStore } from '../../store/useFloorplanLocalStore'
import { deriveWorkspaceSceneConfig } from '../../services/workspaceScene'
import { FLOOR_ASSEMBLY_H } from '../../services/framingGeometry'
import { worldDeltaToPixel } from './editHelpers'
import { getCatalogItem, deviceMountHeightM } from '../../data/objectCatalog'

type Mode = 'translate' | 'rotate' | 'scale'
const MODE_LABEL: Record<Mode, string> = { translate: 'Move', rotate: 'Rotate', scale: 'Stretch' }

/** One gizmo drag, in the units the gizmo works in (world metres / radians). */
interface Live { dx: number; dz: number; rotationY: number; sx: number; sy: number; sz: number }

export default function SelectionGizmo() {
  const editSelected = useFloorplanLocalStore((s) => s.editSelected)
  const traceMode = useFloorplanLocalStore((s) => s.traceMode)
  const placeObjectType = useFloorplanLocalStore((s) => s.placeObjectType)
  const mode = useFloorplanLocalStore((s) => s.gizmoMode)
  const setMode = useFloorplanLocalStore((s) => s.setGizmoMode)
  const setGizmoLive = useFloorplanLocalStore((s) => s.setGizmoLive)
  const overlay = useAppStore((s) => s.floorplanOverlay)
  const drawings = useAppStore((s) => s.drawings)
  const floorsAreas = useAppStore((s) => s.floorsAreas)
  const roofAreas = useAppStore((s) => s.roofAreas)
  const placedObjects = useAppStore((s) => s.placedObjects)
  const wizardInputs = useAppStore((s) => s.wizardInputs)
  const translateFloorsArea = useAppStore((s) => s.translateFloorsArea)
  const translateRoofArea = useAppStore((s) => s.translateRoofArea)
  const updateFloorsArea = useAppStore((s) => s.updateFloorsArea)
  const updateRoofArea = useAppStore((s) => s.updateRoofArea)
  const updateUserWall = useAppStore((s) => s.updateUserWall)
  const updatePlacedObject = useAppStore((s) => s.updatePlacedObject)

  const proxy = useMemo(() => new THREE.Object3D(), [])
  const [ready, setReady] = useState(false)
  const dragging = useRef(false)
  const anchor = useRef(new THREE.Vector3())
  useEffect(() => setReady(true), [])

  const drawing = drawings.find((d) => d.id === overlay.drawingId) ?? drawings[0] ?? null
  const imageWidth = drawing?.rasterWidth ?? 1400
  const imageHeight = drawing?.rasterHeight ?? 900
  const [overlayW, overlayD] = overlay.scale
  const rotRad = THREE.MathUtils.degToRad(overlay.rotationDeg)
  const ceilingM = deriveWorkspaceSceneConfig(wizardInputs).wallHeightM
  const storeyHeight = ceilingM + FLOOR_ASSEMBLY_H

  const pixelToWorld = (px: number, py: number) => {
    const lx = ((px / imageWidth) - 0.5) * overlayW
    const lz = ((py / imageHeight) - 0.5) * overlayD
    const v = new THREE.Vector3(lx, 0, lz).applyAxisAngle(new THREE.Vector3(0, 1, 0), rotRad)
    return new THREE.Vector3(overlay.position[0] + v.x, 0, overlay.position[1] + v.z)
  }
  const toPx = (dx: number, dz: number) =>
    worldDeltaToPixel(dx, dz, rotRad, overlayW, overlayD, imageWidth, imageHeight)

  const target = useMemo(() => {
    if (!editSelected || traceMode || placeObjectType) return null
    const { kind, id } = editSelected

    if (kind === 'object') {
      const o = placedObjects.find((x) => x.id === id)
      if (!o) return null
      const item = getCatalogItem(o.type)
      const h = (item?.defaultH ?? 1) * o.scaleY
      const mountY = o.type === 'window'
        ? (o.sillM ?? 0.9) + h / 2
        : deviceMountHeightM(o.type, ceilingM) ?? h / 2
      return {
        modes: ['translate', 'rotate', 'scale'] as Mode[],
        pos: new THREE.Vector3(o.x, (o.level ?? 0) * storeyHeight + mountY, o.z),
        rot: o.rotationY,
        scl: new THREE.Vector3(o.scaleX, o.scaleY, o.scaleZ),
        commit: (v: Live) => updatePlacedObject(o.id, {
          x: o.x + v.dx, z: o.z + v.dz, rotationY: v.rotationY,
          scaleX: v.sx, scaleY: v.sy, scaleZ: v.sz,
        }),
      }
    }

    if (kind === 'floor' || kind === 'roof') {
      const a = (kind === 'roof' ? roofAreas : floorsAreas).find((x) => x.id === id)
      if (!a) return null
      const c = pixelToWorld((a.x1 + a.x2) / 2, (a.y1 + a.y2) / 2)
      const lift = (a.level ?? 0) * storeyHeight + (kind === 'roof' ? ceilingM + 0.6 : 0.5)
      return {
        modes: ['translate', 'scale'] as Mode[],
        pos: new THREE.Vector3(c.x, lift, c.z),
        rot: 0,
        scl: new THREE.Vector3(1, 1, 1),
        commit: (v: Live) => {
          const scaled = Math.abs(v.sx - 1) > 0.001 || Math.abs(v.sz - 1) > 0.001
          if (scaled) {
            // Stretch about the centre: grow/shrink the rect's half-extents.
            const cx = (a.x1 + a.x2) / 2, cy = (a.y1 + a.y2) / 2
            const hx = Math.abs(a.x2 - a.x1) / 2 * v.sx
            const hy = Math.abs(a.y2 - a.y1) / 2 * v.sz
            const patch = { x1: cx - hx, y1: cy - hy, x2: cx + hx, y2: cy + hy }
            if (kind === 'roof') updateRoofArea(a.id, patch)
            else updateFloorsArea(a.id, patch)
            return
          }
          const [dpx, dpy] = toPx(v.dx, v.dz)
          if (kind === 'roof') translateRoofArea(a.id, dpx, dpy)
          else translateFloorsArea(a.id, dpx, dpy)
        },
      }
    }

    if (kind === 'wall' && drawing) {
      const idx = Number(id)
      const w = drawing.parsedWalls.filter((x) => x.source === 'user')[idx]
      if (!w) return null
      const c = pixelToWorld((w.x1 + w.x2) / 2, (w.y1 + w.y2) / 2)
      const mx = (w.x1 + w.x2) / 2, my = (w.y1 + w.y2) / 2
      const baseAng = Math.atan2(w.y2 - w.y1, w.x2 - w.x1)
      const halfLen = Math.hypot(w.x2 - w.x1, w.y2 - w.y1) / 2
      return {
        modes: ['translate', 'rotate', 'scale'] as Mode[],
        // ABOVE the wall, not inside it — handles buried in the studs are
        // handles you cannot find.
        pos: new THREE.Vector3(c.x, (w.level ?? 0) * storeyHeight + ceilingM + 0.5, c.z),
        rot: 0,
        scl: new THREE.Vector3(1, 1, 1),
        commit: (v: Live) => {
          const [dpx, dpy] = toPx(v.dx, v.dz)
          const ang = baseAng - v.rotationY     // screen yaw runs opposite plan yaw
          const len = halfLen * (v.sx || 1)
          const ncx = mx + dpx, ncy = my + dpy
          updateUserWall(drawing.id, idx, {
            x1: ncx - Math.cos(ang) * len, y1: ncy - Math.sin(ang) * len,
            x2: ncx + Math.cos(ang) * len, y2: ncy + Math.sin(ang) * len,
          })
        },
      }
    }
    return null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editSelected?.kind, editSelected?.id, traceMode, placeObjectType,
      placedObjects, floorsAreas, roofAreas, drawing?.id,
      overlay.position[0], overlay.position[1], overlayW, overlayD, rotRad,
      imageWidth, imageHeight, storeyHeight, ceilingM])

  // Park the handles on the selection. Guarded on the anchor ACTUALLY moving —
  // writing to the proxy every render fed TransformControls a change it reacted
  // to, which re-rendered us, which wrote again. That loop froze the renderer.
  const ax = target?.pos.x ?? 0, ay = target?.pos.y ?? 0, az = target?.pos.z ?? 0
  const arot = target?.rot ?? 0
  useLayoutEffect(() => {
    if (!target || dragging.current) return
    if (anchor.current.distanceToSquared(target.pos) < 1e-10 && proxy.rotation.y === arot) return
    anchor.current.copy(target.pos)
    proxy.position.copy(target.pos)
    proxy.rotation.set(0, arot, 0)
    proxy.scale.copy(target.scl)
    proxy.updateMatrixWorld()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ax, ay, az, arot, proxy])

  if (!target) return null
  // A mode the selection can't express is never offered.
  const activeMode: Mode = target.modes.includes(mode) ? mode : 'translate'

  const read = (): Live => ({
    dx: proxy.position.x - anchor.current.x,
    dz: proxy.position.z - anchor.current.z,
    rotationY: proxy.rotation.y - arot,
    sx: Math.max(0.05, proxy.scale.x),
    sy: Math.max(0.05, proxy.scale.y),
    sz: Math.max(0.05, proxy.scale.z),
  })

  return (
    <>
      <primitive object={proxy} />
      {ready && (
        <TransformControls
          object={proxy}
          mode={activeMode}
          size={0.8}
          showY={activeMode !== 'translate'}   /* moves stay on the floor plane */
          onMouseDown={() => { dragging.current = true }}
          onObjectChange={() => {
            if (!dragging.current || !editSelected) return
            const v = read()
            setGizmoLive({
              kind: editSelected.kind, id: editSelected.id,
              dx: v.dx, dz: v.dz, rotationY: v.rotationY, scaleX: v.sx, scaleY: v.sy, scaleZ: v.sz,
            })
          }}
          onMouseUp={() => {
            dragging.current = false
            const v = read()
            setGizmoLive(null)
            const moved = Math.hypot(v.dx, v.dz) > 0.001
            const turned = Math.abs(v.rotationY) > 0.001
            const scaled = Math.abs(v.sx - 1) > 0.001 || Math.abs(v.sy - 1) > 0.001 || Math.abs(v.sz - 1) > 0.001
            if (moved || turned || scaled) target.commit(v)
          }}
        />
      )}
      {/* Mode palette — only the modes this selection can express. Small floating
          pills over the model, never a panel. */}
      <Html position={[target.pos.x, target.pos.y + 0.9, target.pos.z]} center distanceFactor={9}
            zIndexRange={[20, 0]} style={{ pointerEvents: 'auto', userSelect: 'none' }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {target.modes.map((m) => (
            <button
              key={m}
              onPointerDown={(e) => { e.stopPropagation(); setMode(m) }}
              style={{
                padding: '3px 9px', fontSize: 11, fontWeight: 700, borderRadius: 999,
                cursor: 'pointer', whiteSpace: 'nowrap',
                color: activeMode === m ? '#0b0f17' : '#e2e8f0',
                background: activeMode === m ? '#38bdf8' : 'rgba(10,16,30,0.75)',
                border: '1px solid rgba(56,189,248,0.5)',
              }}
            >{MODE_LABEL[m]}</button>
          ))}
        </div>
      </Html>
    </>
  )
}
