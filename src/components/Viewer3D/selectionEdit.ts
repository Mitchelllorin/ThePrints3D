/**
 * selectionEdit — what you can DO to the current selection, and how to do it.
 *
 * This is the surviving half of the old SelectionGizmo. The gizmo itself (drei
 * TransformControls: R/G/B arrows and rings floating on the model) is gone — it
 * was fiddly to hit on a phone, it covered the very thing you were editing, and
 * the handles were forever buried in geometry or off screen. What was actually
 * good about it was the resolver underneath: the idea that a selection declares
 *
 *   • which verbs its data can honestly express, and
 *   • how to write a transform back to the store.
 *
 * That idea is kept, and now it feeds BUTTONS instead of handles. A button says
 * "Rotate" and rotating is what it does — no dragging a ring you can't see.
 *
 * VERBS ARE DATA-DRIVEN, because the stores genuinely differ:
 *   object   move · rotate · stretch — world metres, has every field
 *   wall     move · rotate · stretch — pixel endpoints, so rotate swings them
 *   line                              about the midpoint and stretch changes
 *                                     length; both are representable
 *   floor    move · stretch          — an axis-aligned pixel rect. Stretch
 *   roof                               resizes it. There is NO rotation field,
 *                                      so a Rotate button would lie — it is not
 *                                      offered at all.
 *
 * Every tap writes to the store ONCE, so each tap is exactly one undo step.
 */
import * as THREE from 'three'
import { useMemo } from 'react'
import { useAppStore } from '../../store/useAppStore'
import { useFloorplanLocalStore } from '../../store/useFloorplanLocalStore'
import { deriveWorkspaceSceneConfig } from '../../services/workspaceScene'
import { FLOOR_ASSEMBLY_H } from '../../services/framingGeometry'
import { worldDeltaToPixel } from './editHelpers'

export type EditVerb = 'move' | 'rotate' | 'stretch'

/** One tap's worth of change. Deltas, not absolutes — the resolver reads the
 *  element's current values itself, so nothing has to be mirrored anywhere. */
export interface EditStep {
  /** World-metre translation. */
  dx?: number
  dz?: number
  /** Yaw delta, radians. */
  rot?: number
  /** Size multiplier: 1.05 grows 5%, 0.95 shrinks. */
  factor?: number
}

export interface SelectionEdit {
  /** Human name of what's selected, for the rail's caption. */
  label: string
  /** Only the verbs this selection can actually express. */
  verbs: EditVerb[]
  apply: (step: EditStep) => void
}

const KIND_LABEL: Record<string, string> = {
  object: 'Object', wall: 'Wall', floor: 'Floor', roof: 'Roof', line: 'Run',
}

/**
 * Resolve the current selection into its editing capabilities, or null when
 * nothing is selected (or the workspace is busy tracing / placing, where an
 * edit control would fight the action that owns the screen).
 */
export function useSelectionEdit(): SelectionEdit | null {
  const editSelected = useFloorplanLocalStore((s) => s.editSelected)
  const traceMode = useFloorplanLocalStore((s) => s.traceMode)
  const placeObjectType = useFloorplanLocalStore((s) => s.placeObjectType)
  const overlay = useAppStore((s) => s.floorplanOverlay)
  const drawings = useAppStore((s) => s.drawings)
  const floorsAreas = useAppStore((s) => s.floorsAreas)
  const roofAreas = useAppStore((s) => s.roofAreas)
  const placedObjects = useAppStore((s) => s.placedObjects)
  const wizardInputs = useAppStore((s) => s.wizardInputs)
  const plumbingLines = useAppStore((s) => s.plumbingLines)
  const electricalLines = useAppStore((s) => s.electricalLines)
  const hvacLines = useAppStore((s) => s.hvacLines)
  const translateFloorsArea = useAppStore((s) => s.translateFloorsArea)
  const translateRoofArea = useAppStore((s) => s.translateRoofArea)
  const updateFloorsArea = useAppStore((s) => s.updateFloorsArea)
  const updateRoofArea = useAppStore((s) => s.updateRoofArea)
  const updateUserWall = useAppStore((s) => s.updateUserWall)
  const updatePlacedObject = useAppStore((s) => s.updatePlacedObject)
  const updateTradeLine = useAppStore((s) => s.updateTradeLine)

  const drawing = drawings.find((d) => d.id === overlay.drawingId) ?? drawings[0] ?? null
  const imageWidth = drawing?.rasterWidth ?? 1400
  const imageHeight = drawing?.rasterHeight ?? 900
  const [overlayW, overlayD] = overlay.scale
  const rotRad = THREE.MathUtils.degToRad(overlay.rotationDeg)
  const ceilingM = deriveWorkspaceSceneConfig(wizardInputs).wallHeightM
  const storeyHeight = ceilingM + FLOOR_ASSEMBLY_H

  return useMemo(() => {
    if (!editSelected || traceMode || placeObjectType) return null
    const { kind, id } = editSelected
    const label = KIND_LABEL[kind] ?? 'Selection'
    /** World metres → print pixels, undoing the overlay's rotation and scale. */
    const toPx = (dx: number, dz: number) =>
      worldDeltaToPixel(dx, dz, rotRad, overlayW, overlayD, imageWidth, imageHeight)

    if (kind === 'object') {
      const o = placedObjects.find((x) => x.id === id)
      if (!o) return null
      return {
        label, verbs: ['move', 'rotate', 'stretch'] as EditVerb[],
        apply: ({ dx = 0, dz = 0, rot = 0, factor = 1 }: EditStep) => updatePlacedObject(o.id, {
          x: o.x + dx, z: o.z + dz,
          rotationY: o.rotationY + rot,
          scaleX: o.scaleX * factor, scaleY: o.scaleY * factor, scaleZ: o.scaleZ * factor,
        }),
      }
    }

    if (kind === 'floor' || kind === 'roof') {
      const a = (kind === 'roof' ? roofAreas : floorsAreas).find((x) => x.id === id)
      if (!a) return null
      return {
        // No rotation field on an axis-aligned rect, so Rotate is never offered.
        label, verbs: ['move', 'stretch'] as EditVerb[],
        apply: ({ dx = 0, dz = 0, factor = 1 }: EditStep) => {
          if (factor !== 1) {
            // Stretch about the centre: grow/shrink the rect's half-extents.
            const cx = (a.x1 + a.x2) / 2, cy = (a.y1 + a.y2) / 2
            const hx = Math.abs(a.x2 - a.x1) / 2 * factor
            const hy = Math.abs(a.y2 - a.y1) / 2 * factor
            const patch = { x1: cx - hx, y1: cy - hy, x2: cx + hx, y2: cy + hy }
            if (kind === 'roof') updateRoofArea(a.id, patch)
            else updateFloorsArea(a.id, patch)
            return
          }
          const [dpx, dpy] = toPx(dx, dz)
          if (kind === 'roof') translateRoofArea(a.id, dpx, dpy)
          else translateFloorsArea(a.id, dpx, dpy)
        },
      }
    }

    // Walls and trade runs are the same shape — two pixel endpoints — so one
    // piece of maths serves both: move shifts the pair, rotate swings them about
    // the midpoint, stretch changes the length.
    const seg = kind === 'wall' && drawing
      ? drawing.parsedWalls.filter((x) => x.source === 'user')[Number(id)] ?? null
      : kind === 'line'
        ? [...plumbingLines, ...electricalLines, ...hvacLines].find((x) => x.id === id) ?? null
        : null
    if (!seg) return null

    const mx = (seg.x1 + seg.x2) / 2, my = (seg.y1 + seg.y2) / 2
    const baseAng = Math.atan2(seg.y2 - seg.y1, seg.x2 - seg.x1)
    const halfLen = Math.hypot(seg.x2 - seg.x1, seg.y2 - seg.y1) / 2
    return {
      label, verbs: ['move', 'rotate', 'stretch'] as EditVerb[],
      apply: ({ dx = 0, dz = 0, rot = 0, factor = 1 }: EditStep) => {
        const [dpx, dpy] = toPx(dx, dz)
        const ang = baseAng - rot           // screen yaw runs opposite plan yaw
        const len = Math.max(1, halfLen * factor)
        const ncx = mx + dpx, ncy = my + dpy
        const ends = {
          x1: ncx - Math.cos(ang) * len, y1: ncy - Math.sin(ang) * len,
          x2: ncx + Math.cos(ang) * len, y2: ncy + Math.sin(ang) * len,
        }
        if (kind === 'wall' && drawing) updateUserWall(drawing.id, Number(id), ends)
        else updateTradeLine(String(id), ends)
      },
    }
  }, [editSelected, traceMode, placeObjectType, placedObjects, floorsAreas, roofAreas,
      plumbingLines, electricalLines, hvacLines, drawing,
      overlayW, overlayD, rotRad, imageWidth, imageHeight, storeyHeight,
      translateFloorsArea, translateRoofArea, updateFloorsArea, updateRoofArea,
      updateUserWall, updatePlacedObject, updateTradeLine])
}
