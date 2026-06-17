/**
 * FloorplanOverlay — Three.js layer (renders INSIDE <Canvas>)
 *
 * Contains only R3F-compatible elements: <group>, <mesh>, <Line>, geometries,
 * and materials.  All DOM content (inputs, buttons, panels) is rendered by the
 * sibling <FloorplanPanel /> component which lives OUTSIDE the Canvas.
 *
 * Shared UI state (traceMode, calibration, drag, …) lives in the lightweight
 * useFloorplanLocalStore so both reconcilers can read/write it.
 */

import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { ThreeEvent } from '@react-three/fiber'
import { Line } from '@react-three/drei'
import * as THREE from 'three'
import { useAppStore } from '../../store/useAppStore'
import { useConfigStore } from '../../store/useConfigStore'
import { useFloorplanLocalStore } from '../../store/useFloorplanLocalStore'
import type { ParsedWall } from '../../types'
import type { WallType } from '../../services/wallTypeClassifier'

// Picker framing key → engine WallType. Masonry (CMU) maps to a non-framed
// type so the engine skips studs and it renders as a solid block instead.
const FRAMING_TO_WALLTYPE: Record<string, WallType> = {
  'wood-2x4': 'stud-2x4',
  'wood-2x6': 'stud-2x6',
  'wood-2x8': 'stud-2x8',
  'steel-3-5-8': 'stud-2x4',
  'steel-6': 'stud-2x6',
  'cmu': 'masonry-thick',
}
import {
  extendWallToNearbyWall,
  reduceStrokeToWall,
  reduceStrokeToWalls,
  snapPointToWalls,
  snapTraceWallToExisting,
} from '../../services/wallTraceReducer'
import { getCatalogItem, ELECTRICAL_TRAY_ORDER, OUTLET_TYPES, WALL_MOUNTED_DEVICES, deviceMountHeightM } from '../../data/objectCatalog'
import { deriveWorkspaceSceneConfig } from '../../services/workspaceScene'
import { validateElectrical } from '../../services/constructionCode'
import { LAYER_COLORS, plumbingColorFor, electricalColorFor, plumbingColor, electricalColor } from '../../data/traceLayers'

/** Perpendicular distance from point to segment, in pixels. */
function segDist(px: number, py: number, x1: number, y1: number, x2: number, y2: number) {
  const dx = x2 - x1, dy = y2 - y1
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return Math.hypot(px - x1, py - y1)
  let t = ((px - x1) * dx + (py - y1) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy))
}

let _objectSeq = 0
function genObjectId() {
  return `obj-${_objectSeq++}-${Math.round(performance.now())}`
}
let _lineSeq = 0
function genLineId() {
  return `line-${_lineSeq++}-${Math.round(performance.now())}`
}

// Ground plane (y=0) for projecting the pointer ray to a floor point — used by
// the placement catcher so the ghost tracks even when the 3D build is in front.
const GROUND_PLANE = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
function rayToGround(e: ThreeEvent<PointerEvent>): THREE.Vector3 | null {
  const p = new THREE.Vector3()
  return e.ray.intersectPlane(GROUND_PLANE, p) ? p : null
}

const DEFAULT_WIDTH = 12
const DEFAULT_DEPTH = 8
const GRID_SNAP = 0.25

function snap(value: number, enabled: boolean, increment: number = GRID_SNAP) {
  if (!enabled || increment <= 0) return value
  return Math.round(value / increment) * increment
}

/**
 * TraceArrow — a stretchy "rubber-band" arrow from the stroke's start to the
 * current point: a straight shaft plus a two-barb arrowhead at the live end.
 * Recomputed every frame from the latest endpoint, so it stretches as you draw.
 */
function TraceArrow({ start, end, color = '#38bdf8' }: {
  start: [number, number, number]
  end: [number, number, number]
  color?: string
}) {
  const dx = end[0] - start[0]
  const dz = end[2] - start[2]
  const len = Math.hypot(dx, dz)
  if (len < 0.05) return null

  const theta = Math.atan2(dz, dx)
  const barbLen = Math.min(0.5, len * 0.35)
  const barbAngle = (25 * Math.PI) / 180
  const back = theta + Math.PI
  const tip: [number, number, number] = [end[0], end[1], end[2]]
  const b1: [number, number, number] = [
    end[0] + Math.cos(back + barbAngle) * barbLen, end[1], end[2] + Math.sin(back + barbAngle) * barbLen,
  ]
  const b2: [number, number, number] = [
    end[0] + Math.cos(back - barbAngle) * barbLen, end[1], end[2] + Math.sin(back - barbAngle) * barbLen,
  ]

  return (
    <>
      <Line points={[start, tip]} color={color} lineWidth={4} />
      <Line points={[b1, tip, b2]} color={color} lineWidth={4} />
    </>
  )
}

export default function FloorplanOverlay() {
  const drawings = useAppStore((s) => s.drawings)
  const overlay = useAppStore((s) => s.floorplanOverlay)
  const setOverlayDrawing = useAppStore((s) => s.setFloorplanOverlayDrawing)
  const updateOverlay = useAppStore((s) => s.updateFloorplanOverlay)
  const checkpointHistory = useAppStore((s) => s.checkpointHistory)
  const addUserTracedWall = useAppStore((s) => s.addUserTracedWall)
  const addTrace = useAppStore((s) => s.addTrace)
  const addPlacedObject = useAppStore((s) => s.addPlacedObject)
  const addPlumbingLines = useAppStore((s) => s.addPlumbingLines)
  const addElectricalLines = useAppStore((s) => s.addElectricalLines)
  const plumbingLines = useAppStore((s) => s.plumbingLines)
  const electricalLines = useAppStore((s) => s.electricalLines)
  const circuits = useAppStore((s) => s.circuits)
  const placedObjects = useAppStore((s) => s.placedObjects)
  const visibleLayers = useAppStore((s) => s.visibleLayers)
  const wizardInputs = useAppStore((s) => s.wizardInputs)
  const ceilingM = deriveWorkspaceSceneConfig(wizardInputs).wallHeightM

  const gridSnapM = useConfigStore((s) => s.gridSnapM)
  const wallTraceStyle = useConfigStore((s) => s.wallTraceStyle)

  const traceMode = useFloorplanLocalStore((s) => s.traceMode)
  const traceStyle = useFloorplanLocalStore((s) => s.traceStyle)
  const traceStart = useFloorplanLocalStore((s) => s.traceStart)
  const setTraceStart = useFloorplanLocalStore((s) => s.setTraceStart)
  const traceStroke = useFloorplanLocalStore((s) => s.traceStroke)
  const setTraceStroke = useFloorplanLocalStore((s) => s.setTraceStroke)
  const pendingWalls = useFloorplanLocalStore((s) => s.pendingWalls)
  const setPendingWalls = useFloorplanLocalStore((s) => s.setPendingWalls)
  const hoverPixel = useFloorplanLocalStore((s) => s.hoverPixel)
  const setHoverPixel = useFloorplanLocalStore((s) => s.setHoverPixel)
  const calibrationA = useFloorplanLocalStore((s) => s.calibrationA)
  const setCalibrationA = useFloorplanLocalStore((s) => s.setCalibrationA)
  const calibrationB = useFloorplanLocalStore((s) => s.calibrationB)
  const setCalibrationB = useFloorplanLocalStore((s) => s.setCalibrationB)
  const drag = useFloorplanLocalStore((s) => s.drag)
  const setDrag = useFloorplanLocalStore((s) => s.setDrag)
  const selectedWallIndex = useFloorplanLocalStore((s) => s.selectedWallIndex)
  const placeObjectType = useFloorplanLocalStore((s) => s.placeObjectType)
  const setPlaceObjectType = useFloorplanLocalStore((s) => s.setPlaceObjectType)
  const selectObjectExclusive = useFloorplanLocalStore((s) => s.selectObjectExclusive)
  const selectWallExclusive = useFloorplanLocalStore((s) => s.selectWallExclusive)
  const closeAllPanels = useFloorplanLocalStore((s) => s.closeAllPanels)
  const activeTraceLayer = useFloorplanLocalStore((s) => s.activeTraceLayer)
  const activeWallType = useFloorplanLocalStore((s) => s.activeWallType)
  const activeWallRole = useFloorplanLocalStore((s) => s.activeWallRole)
  const traceBand = useFloorplanLocalStore((s) => s.traceBand)
  const plumbElement = useFloorplanLocalStore((s) => s.plumbElement)
  const plumbSize = useFloorplanLocalStore((s) => s.plumbSize)
  const plumbMaterial = useFloorplanLocalStore((s) => s.plumbMaterial)
  const plumbTemp = useFloorplanLocalStore((s) => s.plumbTemp)
  const elecElement = useFloorplanLocalStore((s) => s.elecElement)
  const elecAmp = useFloorplanLocalStore((s) => s.elecAmp)
  const elecWire = useFloorplanLocalStore((s) => s.elecWire)
  const elecRole = useFloorplanLocalStore((s) => s.elecRole)

  const drawing = drawings.find((d) => d.id === overlay.drawingId) ?? drawings[0] ?? null
  const imageUrl = drawing ? (drawing.rasterUrl ?? drawing.previewUrl) : null
  const imageWidth = drawing?.rasterWidth ?? 1400
  const imageHeight = drawing?.rasterHeight ?? 900

  const texture = useMemo(() => {
    if (!imageUrl) return null
    const t = new THREE.TextureLoader().load(imageUrl)
    t.colorSpace = THREE.SRGBColorSpace
    t.wrapS = THREE.ClampToEdgeWrapping
    t.wrapT = THREE.ClampToEdgeWrapping
    return t
  }, [imageUrl])

  useEffect(() => {
    if (!drawing || overlay.drawingId) return
    setOverlayDrawing(drawing.id)
  }, [drawing, overlay.drawingId, setOverlayDrawing])

  // Keep store in sync so ModelViewer can disable OrbitControls while tracing
  useEffect(() => {
    updateOverlay({ traceModeActive: traceMode }, false)
  }, [traceMode, updateOverlay])

  // Lock the camera whenever a gesture must own the pointer: tracing,
  // calibrating, placing an object, or dragging an overlay handle. The grid
  // never drifts while you tap points/place; zoom +/- still works (it drives
  // the controls directly). Pan/orbit resumes when you leave these modes.
  useEffect(() => {
    updateOverlay({
      orbitLocked: drag !== null || traceMode || overlay.calibrationMode || placeObjectType !== null,
    }, false)
  }, [drag, traceMode, overlay.calibrationMode, placeObjectType, updateOverlay])

  const estimatedScale = useMemo<[number, number]>(() => {
    if (!drawing) return overlay.scale
    const widthPx = drawing.rasterWidth ?? 1400
    const heightPx = drawing.rasterHeight ?? 900
    const ratio = Math.max(0.2, Math.min(5, widthPx / Math.max(1, heightPx)))
    const mmPerPx = drawing.scaleMmPerPx ?? 8
    const widthM = Math.max(2, Math.min(80, (widthPx * mmPerPx) / 1000))
    const depthM = Math.max(2, Math.min(80, widthM / ratio))
    return [widthM, depthM]
  }, [drawing, overlay.scale])

  useEffect(() => {
    if (!drawing) return
    if (overlay.scale[0] !== DEFAULT_WIDTH || overlay.scale[1] !== DEFAULT_DEPTH) return
    updateOverlay({ scale: estimatedScale }, false)
  }, [drawing, estimatedScale, overlay.scale, updateOverlay])

  const width = overlay.scale[0]
  const depth = overlay.scale[1]
  const halfW = width / 2
  const halfD = depth / 2
  const rotationRad = THREE.MathUtils.degToRad(overlay.rotationDeg)
  const canEdit = overlay.calibrationMode && !overlay.locked

  const planeLocalToWorld = useCallback((pixel: [number, number]): [number, number, number] => {
    const localX = ((pixel[0] / imageWidth) - 0.5) * width
    const localZ = ((pixel[1] / imageHeight) - 0.5) * depth
    const rotated = new THREE.Vector3(localX, 0.03, localZ).applyAxisAngle(new THREE.Vector3(0, 1, 0), rotationRad)
    return [overlay.position[0] + rotated.x, 0.03, overlay.position[1] + rotated.z]
  }, [depth, imageHeight, imageWidth, overlay.position, rotationRad, width])

  const worldToPixel = (point: THREE.Vector3): [number, number] => {
    const translated = new THREE.Vector3(point.x - overlay.position[0], 0, point.z - overlay.position[1])
      .applyAxisAngle(new THREE.Vector3(0, 1, 0), -rotationRad)
    const px = ((translated.x / width) + 0.5) * imageWidth
    const py = ((translated.z / depth) + 0.5) * imageHeight
    return [
      Math.max(0, Math.min(imageWidth, px)),
      Math.max(0, Math.min(imageHeight, py)),
    ]
  }

  const traceWorldPoints = useMemo(
    () => traceStroke.map(planeLocalToWorld),
    [traceStroke, planeLocalToWorld],
  )

  const calibrationPreviewPoints = useMemo(() => {
    const start = calibrationA ? planeLocalToWorld(calibrationA) : null
    const endPixel = calibrationB ?? (overlay.calibrationMode ? hoverPixel : null)
    const end = endPixel ? planeLocalToWorld(endPixel) : null
    if (!start || !end) return null
    return [start, end] as [[number, number, number], [number, number, number]]
  }, [calibrationA, calibrationB, hoverPixel, overlay.calibrationMode, planeLocalToWorld])

  // Rubber-band trace preview — same stretchy interaction as calibration
  const tracePreviewPoints = useMemo(() => {
    if (!traceMode || traceStyle !== 'line' || !traceStart || !hoverPixel) return null
    return [planeLocalToWorld(traceStart), planeLocalToWorld(hoverPixel)] as
      [[number, number, number], [number, number, number]]
  }, [traceMode, traceStyle, traceStart, hoverPixel, planeLocalToWorld])

  // ─── drag handlers ─────────────────────────────────────────────────────

  const applyMove = (dx: number, dz: number) => {
    updateOverlay({
      position: [
        snap(overlay.position[0] + dx, overlay.snapToGrid, gridSnapM),
        snap(overlay.position[1] + dz, overlay.snapToGrid, gridSnapM),
      ],
    }, false)
  }

  const applyScale = (dWidth: number, dDepth: number) => {
    updateOverlay({
      scale: [
        Math.max(0.5, snap(width + dWidth, overlay.snapToGrid, gridSnapM)),
        Math.max(0.5, snap(depth + dDepth, overlay.snapToGrid, gridSnapM)),
      ],
    }, false)
  }

  const onDragStart = (event: ThreeEvent<PointerEvent>, next: { kind: 'move' | 'corner' | 'edge' | 'rotate'; axis?: 'x' | 'z'; signX?: 1 | -1; signZ?: 1 | -1 }) => {
    if (!canEdit) return
    event.stopPropagation()
    checkpointHistory()
    setDrag(next)
  }

  const onDragMove = (event: ThreeEvent<PointerEvent>) => {
    if (!drag || !canEdit) return
    event.stopPropagation()
    const dx = event.movementX * 0.03
    const dz = event.movementY * 0.03
    if (drag.kind === 'move') { applyMove(dx, dz); return }
    if (drag.kind === 'rotate') { updateOverlay({ rotationDeg: overlay.rotationDeg + event.movementX * 0.5 }, false); return }
    if (drag.kind === 'corner') { applyScale((drag.signX ?? 1) * dx, (drag.signZ ?? 1) * dz); return }
    if (drag.kind === 'edge') { applyScale((drag.axis === 'x' ? dx : 0), (drag.axis === 'z' ? dz : 0)) }
  }

  const onDragEnd = (event: ThreeEvent<PointerEvent>) => {
    if (!drag) return
    event.stopPropagation()
    setDrag(null)
  }

  // ─── trace / calibration pointer handlers ──────────────────────────────

  const TAP_MOVE_PX = 9
  const pointerDownScreen = useRef<{ x: number; y: number } | null>(null)

  // Press: remember where the finger landed so pointer-up can tell a tap (place
  // a point) from a drag (the user moved the camera — OrbitControls handled it).
  // Freehand is the exception: it draws WITH the drag, so it starts on press.
  const handleWorkspacePointerDown = (event: ThreeEvent<PointerEvent>) => {
    if (!drawing || (!traceMode && !overlay.calibrationMode)) return
    pointerDownScreen.current = { x: event.nativeEvent.clientX, y: event.nativeEvent.clientY }
    if (traceMode && traceStyle === 'freehand') {
      event.stopPropagation()
      const pixel = worldToPixel(event.point)
      setTraceStroke([pixel])
      setHoverPixel(pixel)
    }
  }

  // Drop a trace/calibration point — called only on a genuine tap (pointer-up
  // with no meaningful drag), so the camera is free to move between points.
  const commitTraceOrCalibrationPoint = (event: ThreeEvent<PointerEvent>) => {
    if (!drawing || (!traceMode && !overlay.calibrationMode)) return
    const pixel = worldToPixel(event.point)

    if (traceMode) {
      // Trade layers (plumbing/electrical) trace simple lines, not walls.
      if (activeTraceLayer === 'plumbing' || activeTraceLayer === 'electrical') {
        if (!traceStart) { setTraceStart(pixel); setHoverPixel(pixel); return }
        const a = traceStart
        if (Math.hypot(pixel[0] - a[0], pixel[1] - a[1]) < 4) { setTraceStart(null); return }
        if (activeTraceLayer === 'plumbing') {
          addPlumbingLines([{
            id: genLineId(), x1: a[0], y1: a[1], x2: pixel[0], y2: pixel[1],
            elementType: plumbElement, size: plumbSize, material: plumbMaterial,
            tempType: plumbElement === 'Supply Line' ? plumbTemp : undefined,
            band: traceBand,
          }])
        } else {
          addElectricalLines([{
            id: genLineId(), x1: a[0], y1: a[1], x2: pixel[0], y2: pixel[1],
            elementType: elecElement, size: elecAmp, material: elecWire,
            wireRole: elecElement === 'Low Voltage' ? undefined : elecRole,
            band: traceBand,
          }])
        }
        setTraceStart(pixel) // chain: B becomes the next A
        return
      }

      if (traceStyle === 'freehand') {
        setTraceStroke([pixel])
        setHoverPixel(pixel)
        return
      }

      // Rubber-band: tap A anchors, tap B commits, B becomes the next A so
      // consecutive segments share an exact corner point.
      const snapped = snapPointToWalls(pixel[0], pixel[1], drawing.parsedWalls)
      if (!traceStart) {
        setTraceStart([snapped.x, snapped.y])
        setHoverPixel(pixel)
        return
      }
      const reduced = reduceStrokeToWall([
        { x: traceStart[0], y: traceStart[1] },
        { x: snapped.x, y: snapped.y },
      ])
      if (!reduced) {
        // Tap landed on the anchor — treat as "end this wall run"
        setTraceStart(null)
        return
      }
      const snappedWall = snapTraceWallToExisting(reduced, drawing.parsedWalls)
      const base = extendWallToNearbyWall(snappedWall, drawing.parsedWalls)
      // Stamp the picked framing/role/material onto the wall so the build frames
      // (or, for CMU, leaves solid) and renders it as chosen — not always wood.
      const isMasonry = activeWallType === 'cmu'
      const wall: ParsedWall = {
        ...base,
        framingType: activeWallType,
        wallRole: activeWallRole,
        wallType: FRAMING_TO_WALLTYPE[activeWallType] ?? base.wallType,
        exteriorMaterial: isMasonry ? 'concrete' : base.exteriorMaterial,
      }
      addUserTracedWall(drawing.id, wall)
      addTrace({ points: [traceStart, [wall.x2, wall.y2]], timestamp: Date.now() })
      setTraceStart([wall.x2, wall.y2])
      return
    }

    if (!calibrationA || (calibrationA && calibrationB)) {
      setCalibrationA(pixel)
      setCalibrationB(null)
      useFloorplanLocalStore.getState().setDistanceInput('')
      updateOverlay({ guidedStep: 2 }, false)
      return
    }

    setCalibrationB(pixel)
    updateOverlay({ guidedStep: 3 }, false)
  }

  const handleWorkspacePointerMove = (event: ThreeEvent<PointerEvent>) => {
    if (!drawing || (!traceMode && !overlay.calibrationMode)) return
    event.stopPropagation()
    const pixel = worldToPixel(event.point)
    setHoverPixel(pixel)
    if (!traceMode || traceStyle !== 'freehand') return
    setTraceStroke((prev) => (prev.length === 0 ? prev : [...prev, pixel]))
  }

  // Snap and tie in only the FREE ends of a wall chain — interior corners
  // must keep their exact shared points.
  const tieInChainEnds = (walls: ParsedWall[], existing: ParsedWall[]): ParsedWall[] => {
    if (walls.length === 0) return walls
    const out = walls.map((w) => ({ ...w }))
    const first = out[0]
    const last = out[out.length - 1]
    // Snap the two FREE ends of the chain onto nearby existing endpoints/lines.
    const s = snapPointToWalls(first.x1, first.y1, existing)
    first.x1 = s.x; first.y1 = s.y
    const e = snapPointToWalls(last.x2, last.y2, existing)
    last.x2 = e.x; last.y2 = e.y
    // Extend EVERY segment toward nearby existing walls so any endpoint that
    // nearly meets a detected line auto-extends to touch it. `existing` excludes
    // the chain's own siblings, so interior corners aren't pulled apart here…
    for (const w of out) {
      const ext = extendWallToNearbyWall(w, existing)
      w.x1 = ext.x1; w.y1 = ext.y1; w.x2 = ext.x2; w.y2 = ext.y2
    }
    // …then re-stitch interior corners so consecutive segments keep an exact
    // shared point even if one side happened to extend.
    for (let i = 1; i < out.length; i++) {
      out[i].x1 = out[i - 1].x2
      out[i].y1 = out[i - 1].y2
    }
    return out
  }

  const commitFreehandStroke = (event: ThreeEvent<PointerEvent>) => {
    if (!drawing) return
    const pixel = worldToPixel(event.point)
    setTraceStroke((prev) => {
      if (prev.length === 0) return prev
      const points = [...prev, pixel]
      // Multi-segment reduction: corners in the stroke become connected walls.
      // Nothing commits yet — walls go to a keep/discard preview so an
      // accidental lift of the pointer never creates geometry by surprise.
      const walls = reduceStrokeToWalls(points.map(([x, y]) => ({ x, y })))
      if (walls.length > 0) {
        setPendingWalls(tieInChainEnds(walls, drawing.parsedWalls))
        addTrace({ points, timestamp: Date.now() })
      }
      return []
    })
    setHoverPixel(null)
  }

  const handleWorkspacePointerUp = (event: ThreeEvent<PointerEvent>) => {
    if (!drawing || (!traceMode && !overlay.calibrationMode)) return
    // Freehand commits its stroke on release.
    if (traceMode && traceStyle === 'freehand') {
      event.stopPropagation()
      commitFreehandStroke(event)
      pointerDownScreen.current = null
      return
    }
    // Tap vs drag: if the pointer travelled, it was a camera orbit/pan — the
    // user is moving the view mid-trace/calibration, so don't drop a point.
    const down = pointerDownScreen.current
    pointerDownScreen.current = null
    if (down) {
      const moved = Math.hypot(event.nativeEvent.clientX - down.x, event.nativeEvent.clientY - down.y)
      if (moved > TAP_MOVE_PX) return
    }
    event.stopPropagation()
    commitTraceOrCalibrationPoint(event)
  }

  // Pointer left/cancelled: never place a point (the finger didn't lift on the
  // print); just reset, and let freehand commit whatever it had.
  const handleWorkspacePointerCancel = (event: ThreeEvent<PointerEvent>) => {
    pointerDownScreen.current = null
    if (drawing && traceMode && traceStyle === 'freehand') commitFreehandStroke(event)
  }

  // ─── object placement + wall selection (non-trace edit mode) ────────────
  const userWalls = useMemo(
    () => (drawing ? drawing.parsedWalls.filter((w) => w.source === 'user') : []),
    [drawing],
  )
  // Edit mode = not tracing, not calibrating, not dragging the overlay handles.
  const editMode = !traceMode && !overlay.calibrationMode && !drag
  // Click-target half-width for walls, ~20px of the print mapped to metres.
  const wallPickWidthM = Math.max(0.25, 20 * (width / imageWidth))

  // Entering trace/calibration auto-dismisses every panel/card/selection so the
  // workspace is clear — only the bottom-left trace badge remains.
  useEffect(() => {
    if (traceMode || overlay.calibrationMode) closeAllPanels()
  }, [traceMode, overlay.calibrationMode, closeAllPanels])

  // Ghost preview mesh — positioned by DIRECT REF MUTATION on pointermove (no
  // React state, so no per-move re-render). Visible only after the first move
  // over the print so it tracks the pointer immediately.
  const ghostRef = useRef<THREE.Mesh>(null)
  const hideGhost = () => { if (ghostRef.current) ghostRef.current.visible = false }

  // Escape cancels placement.
  useEffect(() => {
    if (!placeObjectType) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPlaceObjectType(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [placeObjectType, setPlaceObjectType])

  // Yaw that aligns an object with the nearest user wall (so it sits IN/along
  // the wall). Returns 0 when no wall is close enough to snap to.
  const autoOrientYaw = (x: number, z: number): number => {
    let best = Infinity, yaw = 0
    for (const w of userWalls) {
      const a = planeLocalToWorld([w.x1, w.y1])
      const b = planeLocalToWorld([w.x2, w.y2])
      const d = segDist(x, z, a[0], a[2], b[0], b[2])
      if (d < best) { best = d; yaw = -Math.atan2(b[2] - a[2], b[0] - a[0]) }
    }
    return best < 1.2 ? yaw : 0
  }

  // Snap a point onto the nearest user wall (projected onto the wall centreline)
  // so wall devices sit IN the wall — boxes attach to the studs. Returns the tap
  // point unchanged when no wall is within reach.
  const snapToWall = (x: number, z: number): { x: number; z: number } => {
    let best = 1.2, sx = x, sz = z
    for (const w of userWalls) {
      const a = planeLocalToWorld([w.x1, w.y1])
      const b = planeLocalToWorld([w.x2, w.y2])
      const ax = a[0], az = a[2], bx = b[0], bz = b[2]
      const dx = bx - ax, dz = bz - az
      const len2 = dx * dx + dz * dz
      if (len2 < 1e-6) continue
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len2))
      const px = ax + t * dx, pz = az + t * dz
      const d = Math.hypot(x - px, z - pz)
      if (d < best) { best = d; sx = px; sz = pz }
    }
    return { x: sx, z: sz }
  }

  // Final pose for a device tap: wall devices snap onto the wall; everything else
  // drops where tapped. Both auto-orient to the nearest wall.
  const devicePose = (x: number, z: number) => {
    const snapped = WALL_MOUNTED_DEVICES.has(placeObjectType ?? '') ? snapToWall(x, z) : { x, z }
    return { x: snapped.x, z: snapped.z, rotationY: autoOrientYaw(snapped.x, snapped.z) }
  }

  // Standing height for the placement ghost, so it previews at the real mount
  // height (wall devices / ceiling fixtures) instead of on the floor.
  const ghostY = (type: string, fallbackH: number) =>
    deviceMountHeightM(type, ceilingM) ?? fallbackH / 2

  // Hover/drag moves the ghost (imperative — no re-render, so the ghost stays
  // visible). The camera is locked while placing, so the print never drifts.
  const moveGhost = (event: ThreeEvent<PointerEvent>) => {
    if (!placeObjectType || !ghostItem) return
    event.stopPropagation()
    const p = rayToGround(event)
    if (!p || !ghostRef.current) return
    ghostRef.current.visible = true
    const pose = devicePose(p.x, p.z)
    ghostRef.current.position.set(pose.x, ghostY(placeObjectType, ghostItem.defaultH), pose.z)
    ghostRef.current.rotation.y = pose.rotationY
  }

  // Tap on the print places the object right there (map is locked → precise),
  // auto-oriented to the nearest wall. No separate Place button to chase.
  const placeAtPointer = (event: ThreeEvent<PointerEvent>) => {
    if (!placeObjectType || !ghostItem) return
    event.stopPropagation()
    const p = rayToGround(event)
    if (!p) return
    commitPlacement(devicePose(p.x, p.z))
  }

  const commitPlacement = (pose: { x: number; z: number; rotationY: number }) => {
    if (!placeObjectType || !drawing) return
    const item = getCatalogItem(placeObjectType)
    const id = genObjectId()

    // Electrical fixtures auto-connect to the nearest circuit line within 3 ft.
    let circuitId: string | undefined
    if (ELECTRICAL_TRAY_ORDER.includes(placeObjectType) && electricalLines.length > 0) {
      const [px, py] = worldToPixel(new THREE.Vector3(pose.x, 0, pose.z))
      const maxPx = (3 * 304.8) / (drawing.scaleMmPerPx ?? 8)
      let best = maxPx
      let nearestLineId: string | undefined
      for (const l of electricalLines) {
        const d = segDist(px, py, l.x1, l.y1, l.x2, l.y2)
        if (d < best) { best = d; nearestLineId = l.id }
      }
      if (nearestLineId) circuitId = circuits.find((c) => c.lineIds.includes(nearestLineId!))?.id
    }

    const [opx, opy] = worldToPixel(new THREE.Vector3(pose.x, 0, pose.z))
    addPlacedObject({
      id,
      type: placeObjectType,
      x: pose.x,
      z: pose.z,
      rotationY: pose.rotationY,
      scaleX: 1,
      scaleZ: 1,
      scaleY: 1,
      label: item?.label ?? placeObjectType,
      circuitId,
      pxX: opx,
      pxY: opy,
    })
    setPlaceObjectType(null)
    hideGhost()
    selectObjectExclusive(id)
  }

  const ghostItem = placeObjectType ? getCatalogItem(placeObjectType) : null

  // Colour of the line currently being traced, by active discipline/selection.
  const activeLineColor =
    activeTraceLayer === 'plumbing' ? plumbingColorFor(plumbElement, plumbTemp)
    : activeTraceLayer === 'electrical' ? electricalColorFor(elecElement, elecRole)
    : LAYER_COLORS.framing

  // Electrical code violations (shown as red markers while the layer is on).
  const violations = (drawing && visibleLayers.has('electrical'))
    ? validateElectrical({
        userWalls: userWalls,
        outlets: placedObjects
          .filter((o) => OUTLET_TYPES.has(o.type))
          .map((o) => { const [px, py] = worldToPixel(new THREE.Vector3(o.x, 0, o.z)); return { x: px, y: py, type: o.type, circuitId: o.circuitId } }),
        circuits,
        electricalLines,
        mmPerPx: drawing.scaleMmPerPx,
      })
    : []

  // ─── render (Three.js only) ────────────────────────────────────────────

  return (
    <>
      {drawing && overlay.visible && texture && (
        <group
          position={[overlay.position[0], 0.01, overlay.position[1]]}
          rotation={[0, rotationRad, 0]}
        >
          <mesh rotation={[-Math.PI / 2, 0, 0]} userData={{ layer: 'floors' }}>
            <planeGeometry args={[width, depth]} />
            <meshBasicMaterial
              map={texture}
              transparent
              opacity={overlay.opacity}
              depthWrite={false}
              side={THREE.DoubleSide}
            />
          </mesh>

          {(traceMode || overlay.calibrationMode) && (
            <mesh
              rotation={[-Math.PI / 2, 0, 0]}
              position={[0, 0.02, 0]}
              onPointerDown={handleWorkspacePointerDown}
              onPointerMove={handleWorkspacePointerMove}
              onPointerUp={handleWorkspacePointerUp}
              onPointerLeave={handleWorkspacePointerCancel}
              onPointerCancel={handleWorkspacePointerCancel}
            >
              <planeGeometry args={[width, depth]} />
              <meshBasicMaterial transparent opacity={0.02} color="#ffffff" side={THREE.DoubleSide} />
            </mesh>
          )}

          {canEdit && (
            <>
              <mesh
                position={[0, 0.02, 0]}
                onPointerDown={(e) => onDragStart(e, { kind: 'move' })}
                onPointerMove={onDragMove}
                onPointerUp={onDragEnd}
              >
                <circleGeometry args={[0.22, 24]} />
                <meshBasicMaterial color="#facc15" />
              </mesh>

              {[
                { x: -halfW, z: -halfD, sx: -1 as const, sz: -1 as const },
                { x: halfW, z: -halfD, sx: 1 as const, sz: -1 as const },
                { x: halfW, z: halfD, sx: 1 as const, sz: 1 as const },
                { x: -halfW, z: halfD, sx: -1 as const, sz: 1 as const },
              ].map((corner, idx) => (
                <mesh
                  key={`corner-${idx}`}
                  position={[corner.x, 0.03, corner.z]}
                  onPointerDown={(e) => onDragStart(e, { kind: 'corner', signX: corner.sx, signZ: corner.sz })}
                  onPointerMove={onDragMove}
                  onPointerUp={onDragEnd}
                >
                  <sphereGeometry args={[0.16, 16, 16]} />
                  <meshBasicMaterial color="#38bdf8" />
                </mesh>
              ))}

              {[
                { x: -halfW, z: 0, axis: 'x' as const },
                { x: halfW, z: 0, axis: 'x' as const },
                { x: 0, z: -halfD, axis: 'z' as const },
                { x: 0, z: halfD, axis: 'z' as const },
              ].map((edge, idx) => (
                <mesh
                  key={`edge-${idx}`}
                  position={[edge.x, 0.03, edge.z]}
                  onPointerDown={(e) => onDragStart(e, { kind: 'edge', axis: edge.axis })}
                  onPointerMove={onDragMove}
                  onPointerUp={onDragEnd}
                >
                  <boxGeometry args={[0.22, 0.08, 0.22]} />
                  <meshBasicMaterial color="#22d3ee" />
                </mesh>
              ))}

              <mesh
                position={[0, 0.03, halfD + 0.9]}
                onPointerDown={(e) => onDragStart(e, { kind: 'rotate' })}
                onPointerMove={onDragMove}
                onPointerUp={onDragEnd}
              >
                <torusGeometry args={[0.2, 0.05, 12, 24]} />
                <meshBasicMaterial color="#f472b6" />
              </mesh>
            </>
          )}
        </group>
      )}

      {traceWorldPoints.length > 1 && (wallTraceStyle === 'dotted' || wallTraceStyle === 'both') && (
        <Line points={traceWorldPoints} color="#38bdf8" lineWidth={4} dashed dashScale={1.5} dashSize={0.3} gapSize={0.18} />
      )}

      {traceWorldPoints.length > 1 && (wallTraceStyle === 'arrow' || wallTraceStyle === 'both') && (
        <TraceArrow start={traceWorldPoints[0]} end={traceWorldPoints[traceWorldPoints.length - 1]} />
      )}

      {tracePreviewPoints && (
        <Line points={tracePreviewPoints} color={activeLineColor} lineWidth={4} />
      )}

      {/* Committed trade lines drawn on the print, coloured by field convention. */}
      {visibleLayers.has('plumbing') && plumbingLines.map((l) => (
        <Line
          key={l.id}
          points={[planeLocalToWorld([l.x1, l.y1]), planeLocalToWorld([l.x2, l.y2])]}
          color={plumbingColor(l)}
          lineWidth={4}
        />
      ))}
      {visibleLayers.has('electrical') && electricalLines.map((l) => (
        <Line
          key={l.id}
          points={[planeLocalToWorld([l.x1, l.y1]), planeLocalToWorld([l.x2, l.y2])]}
          color={electricalColor(l)}
          lineWidth={4}
        />
      ))}

      {/* Electrical code violations — red markers on the print. */}
      {violations.map((v) => {
        const p = planeLocalToWorld([v.x, v.y])
        return (
          <mesh key={v.id} position={[p[0], 0.12, p[2]]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[0.18, 0.3, 20]} />
            <meshBasicMaterial color="#ef4444" side={THREE.DoubleSide} transparent opacity={0.9} />
          </mesh>
        )
      })}

      {pendingWalls?.map((w, i) => (
        <Line
          key={`pending-${i}`}
          points={[planeLocalToWorld([w.x1, w.y1]), planeLocalToWorld([w.x2, w.y2])]}
          color="#4ade80"
          lineWidth={5}
          dashed
          dashScale={1.4}
          dashSize={0.26}
          gapSize={0.14}
        />
      ))}

      {traceMode && traceStyle === 'line' && traceStart && (
        <mesh position={planeLocalToWorld(traceStart)}>
          <sphereGeometry args={[0.09, 16, 16]} />
          <meshBasicMaterial color={activeLineColor} />
        </mesh>
      )}

      {/* Placement catcher — a large invisible plane ABOVE the scene so the
          pointer always hits it (never occluded by the 3D build); the ray is
          projected to the y=0 ground for the true floor point. */}
      {placeObjectType && (
        <mesh
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, 6, 0]}
          onPointerDown={placeAtPointer}
          onPointerMove={moveGhost}
        >
          <planeGeometry args={[4000, 4000]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
      )}

      {/* Ghost preview — translucent box following the pointer while placing.
          Mounted (hidden) the moment a tray item is armed; positioned by direct
          ref mutation on pointermove. position prop is only the mount default —
          no re-render happens during a placement session, so imperative moves stick. */}
      {placeObjectType && ghostItem && (
        <mesh ref={ghostRef} visible={false} position={[0, ghostItem.defaultH / 2, 0]}>
          <boxGeometry args={[ghostItem.defaultW, ghostItem.defaultH, (placeObjectType === 'door' || placeObjectType === 'window') ? 0.06 : ghostItem.defaultD]} />
          <meshStandardMaterial color={ghostItem.color} transparent opacity={0.5} depthWrite={false} />
        </mesh>
      )}

      {/* Wall select: thin invisible click targets along each user wall. */}
      {editMode && !placeObjectType && userWalls.map((w, i) => {
        const a = planeLocalToWorld([w.x1, w.y1])
        const b = planeLocalToWorld([w.x2, w.y2])
        const len = Math.hypot(b[0] - a[0], b[2] - a[2])
        if (len < 0.05) return null
        const ang = Math.atan2(b[2] - a[2], b[0] - a[0])
        return (
          <mesh
            key={`wall-pick-${i}`}
            position={[(a[0] + b[0]) / 2, 0.06, (a[2] + b[2]) / 2]}
            rotation={[0, -ang, 0]}
            onPointerDown={(e) => {
              e.stopPropagation()
              selectWallExclusive(i)
            }}
          >
            <boxGeometry args={[len, 0.08, wallPickWidthM]} />
            <meshBasicMaterial transparent opacity={0} depthWrite={false} />
          </mesh>
        )
      })}

      {/* Highlight the selected wall. */}
      {editMode && selectedWallIndex != null && userWalls[selectedWallIndex] && (
        <Line
          points={[
            planeLocalToWorld([userWalls[selectedWallIndex].x1, userWalls[selectedWallIndex].y1]),
            planeLocalToWorld([userWalls[selectedWallIndex].x2, userWalls[selectedWallIndex].y2]),
          ]}
          color="#facc15"
          lineWidth={7}
        />
      )}

      {calibrationPreviewPoints && (
        <TraceArrow start={calibrationPreviewPoints[0]} end={calibrationPreviewPoints[1]} color="#f59e0b" />
      )}
    </>
  )
}
