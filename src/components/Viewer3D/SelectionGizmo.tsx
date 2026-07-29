/**
 * SelectionGizmo — the move gizmo for WHATEVER is selected.
 *
 * The gizmo used to live inside PlacedObjectsLayer and read `selectedObjectId`,
 * so it only ever existed for placed objects. Floors and roofs recorded their
 * pick on a different channel entirely and walls had no edit-selection at all,
 * which is why selecting a roof and looking for handles found nothing. Pass 2
 * unified the selection channel; this attaches the gizmo to it, so every
 * component type gets the same precise handles.
 *
 * Each type stores its geometry differently — objects in world metres, floors,
 * roofs and walls in PRINT PIXELS — so the gizmo works in world space and each
 * type converts the delta on commit. That is the whole trick.
 *
 * TRANSLATE ONLY for now, deliberately:
 *   • rotate  — floors and roofs are axis-aligned rectangles with no rotation
 *               field, so a ring would silently do nothing. Objects keep their
 *               own rotate handle in PlacedObjectsLayer.
 *   • stretch — resizing an area means moving its corners, which is a different
 *               edit from moving the whole thing; it wants edge handles, not a
 *               scale gizmo that would also scale a wall's thickness.
 * Both are follow-ups; see docs/INTERACTIONS.md.
 *
 * The drag commits ON RELEASE. The gizmo itself tracks the pointer the whole
 * time, so there is feedback, but the geometry lands in one step — which also
 * means one history entry per move rather than one per frame.
 */
import { useMemo, useRef, useState, useEffect, useLayoutEffect } from 'react'
import * as THREE from 'three'
import { TransformControls } from '@react-three/drei'
import { useAppStore } from '../../store/useAppStore'
import { useFloorplanLocalStore } from '../../store/useFloorplanLocalStore'
import { deriveWorkspaceSceneConfig } from '../../services/workspaceScene'
import { FLOOR_ASSEMBLY_H } from '../../services/framingGeometry'
import { worldDeltaToPixel } from './editHelpers'

export default function SelectionGizmo() {
  const editSelected = useFloorplanLocalStore((s) => s.editSelected)
  const traceMode = useFloorplanLocalStore((s) => s.traceMode)
  const placeObjectType = useFloorplanLocalStore((s) => s.placeObjectType)
  const overlay = useAppStore((s) => s.floorplanOverlay)
  const drawings = useAppStore((s) => s.drawings)
  const floorsAreas = useAppStore((s) => s.floorsAreas)
  const roofAreas = useAppStore((s) => s.roofAreas)
  const wizardInputs = useAppStore((s) => s.wizardInputs)
  const translateFloorsArea = useAppStore((s) => s.translateFloorsArea)
  const translateRoofArea = useAppStore((s) => s.translateRoofArea)
  const updateUserWall = useAppStore((s) => s.updateUserWall)

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
  const storeyHeight = deriveWorkspaceSceneConfig(wizardInputs).wallHeightM + FLOOR_ASSEMBLY_H

  const pixelToWorld = (px: number, py: number) => {
    const lx = ((px / imageWidth) - 0.5) * overlayW
    const lz = ((py / imageHeight) - 0.5) * overlayD
    const v = new THREE.Vector3(lx, 0, lz).applyAxisAngle(new THREE.Vector3(0, 1, 0), rotRad)
    return new THREE.Vector3(overlay.position[0] + v.x, 0, overlay.position[1] + v.z)
  }

  // Resolve the selection into: where the gizmo sits, and how to commit a move.
  const target = useMemo(() => {
    if (!editSelected || traceMode || placeObjectType) return null
    const { kind, id } = editSelected

    // Objects keep PlacedObjectsLayer's own gizmo: it already does translate,
    // rotate AND scale with a live preview, so taking it over with a
    // translate-only one would LOSE function. Folding the two together is a
    // follow-up — this one exists to cover the types that had no gizmo at all.
    if (kind === 'object') return null

    if (kind === 'floor' || kind === 'roof') {
      const a = (kind === 'roof' ? roofAreas : floorsAreas).find((x) => x.id === id)
      if (!a) return null
      const c = pixelToWorld((a.x1 + a.x2) / 2, (a.y1 + a.y2) / 2)
      const lift = (a.level ?? 0) * storeyHeight + (kind === 'roof' ? storeyHeight * 0.9 : 0.4)
      return {
        pos: new THREE.Vector3(c.x, lift, c.z),
        commit: (dx: number, dz: number) => {
          const [dpx, dpy] = worldDeltaToPixel(dx, dz, rotRad, overlayW, overlayD, imageWidth, imageHeight)
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
      return {
        pos: new THREE.Vector3(c.x, (w.level ?? 0) * storeyHeight + 1.2, c.z),
        commit: (dx: number, dz: number) => {
          const [dpx, dpy] = worldDeltaToPixel(dx, dz, rotRad, overlayW, overlayD, imageWidth, imageHeight)
          updateUserWall(drawing.id, idx, {
            x1: w.x1 + dpx, y1: w.y1 + dpy, x2: w.x2 + dpx, y2: w.y2 + dpy,
          })
        },
      }
    }
    return null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editSelected?.kind, editSelected?.id, traceMode, placeObjectType, floorsAreas, roofAreas,
      drawing?.id, overlay.position[0], overlay.position[1], overlayW, overlayD, rotRad,
      imageWidth, imageHeight, storeyHeight])

  // Park the proxy on the selection whenever it moves and we aren't mid-drag, so
  // a re-render can't yank the handles out from under a live edit.
  const ax = target?.pos.x ?? 0, ay = target?.pos.y ?? 0, az = target?.pos.z ?? 0
  useLayoutEffect(() => {
    if (!target || dragging.current) return
    if (anchor.current.distanceToSquared(target.pos) < 1e-10) return
    anchor.current.copy(target.pos)
    proxy.position.copy(target.pos)
    proxy.updateMatrixWorld()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ax, ay, az, proxy])

  if (!target) return null

  return (
    <>
      <primitive object={proxy} />
      {ready && (
        <TransformControls
          object={proxy}
          mode="translate"
          size={0.8}
          showY={false}          /* everything here moves on the floor plane */
          onMouseDown={() => { dragging.current = true }}
          onMouseUp={() => {
            dragging.current = false
            const dx = proxy.position.x - anchor.current.x
            const dz = proxy.position.z - anchor.current.z
            if (Math.hypot(dx, dz) > 0.001) target.commit(dx, dz)
          }}
        />
      )}
    </>
  )
}
