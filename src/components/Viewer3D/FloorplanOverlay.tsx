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
import { useFloorplanLocalStore, type DragState } from '../../store/useFloorplanLocalStore'
import type { ParsedWall, TracedLine } from '../../types'
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
  snapWallToPrintLine,
  squareWallToAxis,
} from '../../services/wallTraceReducer'
import { ensureInkBuffer, getInkBuffer, snapSegmentToInk } from '../../services/inkRaster'
import { getCatalogItem, ELECTRICAL_TRAY_ORDER, OUTLET_TYPES, WALL_MOUNTED_DEVICES, VERTICAL_CIRCULATION, deviceMountHeightM } from '../../data/objectCatalog'
import { deriveWorkspaceSceneConfig } from '../../services/workspaceScene'
import { FLOOR_ASSEMBLY_H } from '../../services/framingGeometry'
import { validateElectrical } from '../../services/constructionCode'
import { LAYER_COLORS, plumbingColorFor, electricalColorFor, hvacColorFor, plumbingColor, electricalColor, hvacColor, CEILING_TYPES } from '../../data/traceLayers'

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
  const moveUserWall = useAppStore((s) => s.moveUserWall)
  const addUserTracedWall = useAppStore((s) => s.addUserTracedWall)
  const addTrace = useAppStore((s) => s.addTrace)
  const addPlacedObject = useAppStore((s) => s.addPlacedObject)
  const addPlumbingLines = useAppStore((s) => s.addPlumbingLines)
  const addElectricalLines = useAppStore((s) => s.addElectricalLines)
  const addHvacLines = useAppStore((s) => s.addHvacLines)
  const addFloorsAreas = useAppStore((s) => s.addFloorsAreas)
  const floorsAreas = useAppStore((s) => s.floorsAreas)
  const addRoofAreas = useAppStore((s) => s.addRoofAreas)
  const roofAreas = useAppStore((s) => s.roofAreas)
  const plumbingLines = useAppStore((s) => s.plumbingLines)
  const electricalLines = useAppStore((s) => s.electricalLines)
  const hvacLines = useAppStore((s) => s.hvacLines)
  const circuits = useAppStore((s) => s.circuits)
  const placedObjects = useAppStore((s) => s.placedObjects)
  const visibleLayers = useAppStore((s) => s.visibleLayers)
  const wizardInputs = useAppStore((s) => s.wizardInputs)
  const ceilingM = deriveWorkspaceSceneConfig(wizardInputs).wallHeightM

  const gridSnapM = useConfigStore((s) => s.gridSnapM)
  const wallTraceStyle = useConfigStore((s) => s.wallTraceStyle)

  const traceMode = useFloorplanLocalStore((s) => s.traceMode)
  const tracePaused = useFloorplanLocalStore((s) => s.tracePaused)
  const setTracePaused = useFloorplanLocalStore((s) => s.setTracePaused)
  const traceStyle = useFloorplanLocalStore((s) => s.traceStyle)
  const traceStart = useFloorplanLocalStore((s) => s.traceStart)
  const setTraceStart = useFloorplanLocalStore((s) => s.setTraceStart)
  const setOffPrintWarn = useFloorplanLocalStore((s) => s.setOffPrintWarn)
  const setPlumbNudge = useFloorplanLocalStore((s) => s.setPlumbNudge)
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
  const keepPlacing = useFloorplanLocalStore((s) => s.keepPlacing)
  const selectWallExclusive = useFloorplanLocalStore((s) => s.selectWallExclusive)
  const selectedLine = useFloorplanLocalStore((s) => s.selectedLine)
  const selectLineExclusive = useFloorplanLocalStore((s) => s.selectLineExclusive)
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
  const hvacElement = useFloorplanLocalStore((s) => s.hvacElement)
  const hvacSize = useFloorplanLocalStore((s) => s.hvacSize)
  const hvacMaterial = useFloorplanLocalStore((s) => s.hvacMaterial)
  const floorsElement = useFloorplanLocalStore((s) => s.floorsElement)
  const floorsSize = useFloorplanLocalStore((s) => s.floorsSize)
  const roofElement = useFloorplanLocalStore((s) => s.roofElement)
  const roofSize = useFloorplanLocalStore((s) => s.roofSize)
  const activeLevel = useFloorplanLocalStore((s) => s.activeLevel)

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

  // Make sure the trace-time ink buffer exists for this drawing. It's populated
  // during processing, but a reloaded project starts with an empty cache — this
  // rebuilds it from the raster URL so snap-to-ink works without re-analysing.
  useEffect(() => {
    if (!drawing || drawing.status !== 'ready') return
    void ensureInkBuffer(drawing.id, drawing.rasterUrl)
  }, [drawing?.id, drawing?.status, drawing?.rasterUrl])

  // Lock the camera whenever a gesture must own the pointer: tracing,
  // calibrating, placing an object, or dragging an overlay handle. The grid
  // never drifts while you tap points/place; zoom +/- still works (it drives
  // the controls directly). Pan/orbit resumes when you leave these modes.
  useEffect(() => {
    updateOverlay({
      // Click-lock model (in 3D): a tap places a point AND locks the workspace so
      // the view holds still and taps land precisely; a double-tap UNLOCKS
      // (tracePaused) so you can orbit/pan; a triple-tap ends the run. Freehand
      // locks for the whole stroke (the drag IS the line); also calibrating,
      // placing, or dragging a handle.
      orbitLocked: drag !== null
        || (traceMode && traceStyle === 'freehand')
        || (traceMode && traceStyle === 'line' && traceStart !== null && !tracePaused)
        || overlay.calibrationMode
        || placeObjectType !== null,
    }, false)
  }, [drag, traceMode, traceStyle, traceStart, tracePaused, overlay.calibrationMode, placeObjectType, updateOverlay])

  // Safety net: a drag that releases OFF its handle/catcher (fast flick, pointer
  // leaves the window) could leave `drag` set forever — which keeps the camera
  // locked ("can't orbit, even when exploded"). A window-level pointerup/cancel
  // always clears it; the geometry was already applied live during the drag.
  useEffect(() => {
    const clear = () => { if (useFloorplanLocalStore.getState().drag) setDrag(null) }
    window.addEventListener('pointerup', clear)
    window.addEventListener('pointercancel', clear)
    return () => {
      window.removeEventListener('pointerup', clear)
      window.removeEventListener('pointercancel', clear)
    }
  }, [setDrag])

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
  // Edit handles scale up so they're visible/tappable — much larger on phones,
  // and a touch larger on a big overlay so the dots don't get lost on the print.
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768
  const hScale = (isMobile ? 2.6 : 1.3) * Math.max(1, Math.min(2.5, Math.max(width, depth) / 8))

  // Multi-floor: COMMITTED floor/roof areas render at their storey elevation —
  // floors on their storey deck; roofs and ceilings up on the wall top. (The live
  // rubber-band preview stays at print level so it hugs the cursor; see below.)
  const storeyHeight = ceilingM + FLOOR_ASSEMBLY_H
  const wallTop = ceilingM
  const areaElevation = (level: number, atWallTop: boolean) =>
    level * storeyHeight + (atWallTop ? wallTop : 0)
  const raiseRect = (pts: [number, number, number][], dy: number): [number, number, number][] =>
    dy ? pts.map(([x, y, z]) => [x, y + dy, z] as [number, number, number]) : pts

  // Multi-floor tiered tracing: the ACTIVE storey's print, the tap-catcher and
  // the LIVE previews all sit at this elevation, so you trace ON the plane the
  // geometry lands on — print and catcher coplanar. Tracing while the print sat
  // on the ground made taps land offset in perspective (you aim at the floating
  // geometry, the ray hits the lower catcher shifted toward the camera); lifting
  // the whole trace surface removes that. The elevation MATCHES where each layer
  // renders: roofs + ceiling-type floors land at the WALL TOP, everything else
  // (floor deck, walls, trades) at the storey floor — so the roof/ceiling trace
  // plane must include wallTop or you get the same offset a wall-height too low.
  // storeyHeight here equals the wall/floor layers' storeyHeight. Level 0 floor
  // tracing → 0 (unchanged).
  const tracingAtWallTop = activeTraceLayer === 'roof'
    || (activeTraceLayer === 'floors' && CEILING_TYPES.has(floorsElement))
  // Trades (plumbing/electrical/HVAC) trace on the print plane — they render by
  // BAND (under-floor/in-wall/ceiling), not by storey level, so they must NOT
  // lift with the now-persistent activeLevel. Otherwise, after any multi-floor
  // work the trade catcher/preview floats up to a storey while the committed run
  // stays at ground → you tap a floating plane and the line lands elsewhere
  // ("trades tracing not working"). Walls/floors/roof still lift to where they render.
  const tradeLayer = activeTraceLayer === 'plumbing'
    || activeTraceLayer === 'electrical'
    || activeTraceLayer === 'hvac'
  const traceElevation = tradeLayer ? 0 : areaElevation(activeLevel, tracingAtWallTop)

  const planeLocalToWorld = useCallback((pixel: [number, number]): [number, number, number] => {
    const localX = ((pixel[0] / imageWidth) - 0.5) * width
    const localZ = ((pixel[1] / imageHeight) - 0.5) * depth
    const rotated = new THREE.Vector3(localX, 0.03, localZ).applyAxisAngle(new THREE.Vector3(0, 1, 0), rotationRad)
    return [overlay.position[0] + rotated.x, 0.03, overlay.position[1] + rotated.z]
  }, [depth, imageHeight, imageWidth, overlay.position, rotationRad, width])

  // Same mapping, lifted to the active storey — used ONLY for the live trace
  // surface (rubber-band previews + anchor dot). Committed overlays (trade lines,
  // selected-wall highlight, violations) keep using planeLocalToWorld at print
  // level so they don't jump storeys when you change the active floor.
  const planeLocalToTrace = useCallback((pixel: [number, number]): [number, number, number] => {
    const p = planeLocalToWorld(pixel)
    return [p[0], p[1] + traceElevation, p[2]]
  }, [planeLocalToWorld, traceElevation])

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

  // Same mapping but WITHOUT clamping to the print's raster bounds. Floors and
  // roofs can be pulled past the edge of the drawing (lay a deck "for miles"),
  // so their corners must not snap back to the image edge the way wall/trace
  // points do — that edge-clamp was building the floor short on the far side.
  const worldToPixelRaw = (point: THREE.Vector3): [number, number] => {
    const translated = new THREE.Vector3(point.x - overlay.position[0], 0, point.z - overlay.position[1])
      .applyAxisAngle(new THREE.Vector3(0, 1, 0), -rotationRad)
    return [((translated.x / width) + 0.5) * imageWidth, ((translated.z / depth) + 0.5) * imageHeight]
  }
  /** Everything pulls freely past the print — the print line is the source of
   *  truth (trace snaps ONTO it), but the user can deliberately pull past it
   *  ("miles away") when they want, and trades originate OUTSIDE the footprint
   *  (service entrance). Snapping reins you in near a line; nothing clamps you. */
  const toPixel = (point: THREE.Vector3): [number, number] => worldToPixelRaw(point)

  const traceWorldPoints = useMemo(
    () => traceStroke.map(planeLocalToTrace),
    [traceStroke, planeLocalToTrace],
  )

  const calibrationPreviewPoints = useMemo(() => {
    const start = calibrationA ? planeLocalToTrace(calibrationA) : null
    const endPixel = calibrationB ?? (overlay.calibrationMode ? hoverPixel : null)
    const end = endPixel ? planeLocalToTrace(endPixel) : null
    if (!start || !end) return null
    return [start, end] as [[number, number, number], [number, number, number]]
  }, [calibrationA, calibrationB, hoverPixel, overlay.calibrationMode, planeLocalToTrace])

  // Rubber-band trace preview — same stretchy interaction as calibration.
  // Floors preview as a rectangle (below), not a diagonal line, so it's skipped here.
  const tracePreviewPoints = useMemo(() => {
    if (!traceMode || tracePaused || traceStyle !== 'line' || activeTraceLayer === 'floors' || activeTraceLayer === 'roof' || !traceStart || !hoverPixel) return null
    return [planeLocalToTrace(traceStart), planeLocalToTrace(hoverPixel)] as
      [[number, number, number], [number, number, number]]
  }, [traceMode, tracePaused, traceStyle, activeTraceLayer, traceStart, hoverPixel, planeLocalToTrace])

  // A floor area's 4 pixel corners → a closed world-space rectangle loop.
  const floorsRectWorld = useCallback((x1: number, y1: number, x2: number, y2: number) =>
    ([[x1, y1], [x2, y1], [x2, y2], [x1, y2], [x1, y1]] as [number, number][])
      .map(planeLocalToWorld) as [number, number, number][],
  [planeLocalToWorld])

  // Live rectangle preview while pulling a floor or roof area (corner A → cursor).
  const floorsPreviewRect = useMemo(() => {
    if (!traceMode || tracePaused || (activeTraceLayer !== 'floors' && activeTraceLayer !== 'roof') || !traceStart || !hoverPixel) return null
    return floorsRectWorld(traceStart[0], traceStart[1], hoverPixel[0], hoverPixel[1])
  }, [traceMode, tracePaused, activeTraceLayer, traceStart, hoverPixel, floorsRectWorld])

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

  // Wall edit (select/nudge/drag) is allowed whenever we're not tracing,
  // calibrating, or placing — a different gate than the calibration-only canEdit.
  const canEditWalls = !traceMode && !overlay.calibrationMode && !placeObjectType && !overlay.locked

  const onDragStart = (event: ThreeEvent<PointerEvent>, next: DragState) => {
    const isWall = next.kind === 'wall' || next.kind === 'wall-end'
    if (isWall ? !canEditWalls : !canEdit) return
    event.stopPropagation()
    checkpointHistory()
    setDrag(next)
  }

  // Convert a WORLD-space delta (metres) into an image-PIXEL delta, undoing the
  // overlay rotation/scale — so a wall drag tracks the cursor on the print.
  const worldDeltaToPixel = (dx: number, dz: number): [number, number] => {
    const v = new THREE.Vector3(dx, 0, dz).applyAxisAngle(new THREE.Vector3(0, 1, 0), -rotationRad)
    return [(v.x / width) * imageWidth, (v.z / depth) * imageHeight]
  }

  const onDragMove = (event: ThreeEvent<PointerEvent>) => {
    if (!drag) return
    event.stopPropagation()
    const dx = event.movementX * 0.03
    const dz = event.movementY * 0.03
    if (drag.kind === 'move') { applyMove(dx, dz); return }
    if (drag.kind === 'rotate') { updateOverlay({ rotationDeg: overlay.rotationDeg + event.movementX * 0.5 }, false); return }
    if (drag.kind === 'corner') { applyScale((drag.signX ?? 1) * dx, (drag.signZ ?? 1) * dz); return }
    if (drag.kind === 'edge') { applyScale((drag.axis === 'x' ? dx : 0), (drag.axis === 'z' ? dz : 0)); return }
    // Wall drags: translate the whole wall, or just one endpoint, in pixel space.
    if ((drag.kind === 'wall' || drag.kind === 'wall-end') && drawing && drag.wallIndex != null) {
      const w = userWalls[drag.wallIndex]
      if (!w) return
      const [dpx, dpy] = worldDeltaToPixel(dx, dz)
      if (drag.kind === 'wall') {
        moveUserWall(drawing.id, drag.wallIndex, { x1: w.x1 + dpx, y1: w.y1 + dpy, x2: w.x2 + dpx, y2: w.y2 + dpy })
      } else if (drag.end === 'start') {
        moveUserWall(drawing.id, drag.wallIndex, { x1: w.x1 + dpx, y1: w.y1 + dpy })
      } else {
        moveUserWall(drawing.id, drag.wallIndex, { x2: w.x2 + dpx, y2: w.y2 + dpy })
      }
    }
  }

  const onDragEnd = (event: ThreeEvent<PointerEvent>) => {
    if (!drag) return
    event.stopPropagation()
    setDrag(null)
  }

  // ─── trace / calibration pointer handlers ──────────────────────────────

  // Tap-vs-drag threshold. A touch finger wanders FAR more than a mouse on a
  // "tap", so a tight 9px slop made taps read as drags and points never dropped
  // — the core "touches don't work" bug. Give touch a much larger slop.
  const TAP_MOVE_PX = 9
  const TAP_MOVE_TOUCH_PX = 22
  const pointerDownScreen = useRef<{ x: number; y: number } | null>(null)
  // Last committed tap (screen space + time) — a quick second tap nearby is a
  // double-tap that ENDS the run, so the rubber-band cursor stops trailing you.
  const lastTapRef = useRef<{ t: number; x: number; y: number; count: number } | null>(null)

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

  // Snap a fresh trade run's start onto the nearest existing node of the same
  // trade, so you can BRANCH/split off an existing run (e.g. tap by the panel or
  // a junction box and circuit a room back to it). No node nearby → tap as-is.
  const snapTradeStart = (pixel: [number, number]): [number, number] => {
    const lines = activeTraceLayer === 'plumbing' ? plumbingLines
      : activeTraceLayer === 'electrical' ? electricalLines
      : activeTraceLayer === 'hvac' ? hvacLines : []
    let best = 14, snapped = pixel   // px snap radius
    for (const l of lines) {
      for (const [nx, ny] of [[l.x1, l.y1], [l.x2, l.y2]] as const) {
        const d = Math.hypot(pixel[0] - nx, pixel[1] - ny)
        if (d < best) { best = d; snapped = [nx, ny] }
      }
    }
    return snapped
  }

  // Flag an upper-floor wall that landed near — but not lined up with — a wall
  // on the storey below. Within ~snap range it already auto-aligned; clearly far
  // is a deliberately different layout; the in-between band is the "did you mean
  // to be off?" case worth surfacing. Sets a nudge with the lined-up target.
  const maybeNudgePlumb = (wall: ParsedWall, userIndex: number) => {
    if (!drawing || activeLevel <= 0) return
    const below = drawing.parsedWalls.filter((w) => w.source === 'user' && (w.level ?? 0) === activeLevel - 1)
    if (below.length === 0) return
    const wdx = wall.x2 - wall.x1, wdy = wall.y2 - wall.y1
    if (Math.hypot(wdx, wdy) < 1) return
    const wmx = (wall.x1 + wall.x2) / 2, wmy = (wall.y1 + wall.y2) / 2
    const angleDiff = (ax: number, ay: number, bx: number, by: number) => {
      let d = Math.abs(Math.atan2(ay, ax) - Math.atan2(by, bx)) * (180 / Math.PI)
      d %= 180
      return d > 90 ? 180 - d : d
    }
    const NEAR_PX = 42 // already auto-snapped within this
    const FAR_PX = 110 // beyond this it's a genuinely different layout
    let best: { off: number; target: { x1: number; y1: number; x2: number; y2: number } } | null = null
    for (const b of below) {
      const bdx = b.x2 - b.x1, bdy = b.y2 - b.y1
      const blen2 = bdx * bdx + bdy * bdy
      if (blen2 < 1 || angleDiff(wdx, wdy, bdx, bdy) > 12) continue
      const t = ((wmx - b.x1) * bdx + (wmy - b.y1) * bdy) / blen2
      if (t < -0.1 || t > 1.1) continue // doesn't overlap the wall below
      const off = Math.hypot(wmx - (b.x1 + t * bdx), wmy - (b.y1 + t * bdy))
      if (off <= NEAR_PX || off > FAR_PX) continue
      if (!best || off < best.off) {
        const proj = (px: number, py: number) => {
          const tt = ((px - b.x1) * bdx + (py - b.y1) * bdy) / blen2
          return { x: b.x1 + tt * bdx, y: b.y1 + tt * bdy }
        }
        const a = proj(wall.x1, wall.y1), e = proj(wall.x2, wall.y2)
        best = { off, target: { x1: a.x, y1: a.y, x2: e.x, y2: e.y } }
      }
    }
    // Set when off, or clear any stale nudge when this wall is fine.
    if (best) {
      const mmPerPx = drawing.scaleMmPerPx ?? 8
      setPlumbNudge({ drawingId: drawing.id, userIndex, offMm: Math.round(best.off * mmPerPx), target: best.target })
    } else {
      setPlumbNudge(null)
    }
  }

  // Drop a trace/calibration point — called only on a genuine tap (pointer-up
  // with no meaningful drag), so the camera is free to move between points.
  const commitTraceOrCalibrationPoint = (event: ThreeEvent<PointerEvent>) => {
    if (!drawing || (!traceMode && !overlay.calibrationMode)) return
    const pixel = toPixel(event.point)

    if (traceMode) {
      // Area layers (floors / roof): tap one corner, tap the opposite corner —
      // the rectangle becomes a joist field or a gable roof. No chaining; each
      // tap-pair is a separate area.
      if (activeTraceLayer === 'floors' || activeTraceLayer === 'roof') {
        // Snap each corner to the building's wall corners (endpoints) so a floor
        // pulled along the walls lands ON the footprint — not a tap-projection
        // short when you orbit. Falls back to the raw tap when no corner is near.
        const areaRef = drawing.parsedWalls.filter(
          (w) => (w.source ?? 'auto') !== 'user' || (w.level ?? 0) === activeLevel,
        )
        // Generous tolerance: on an upper floor the trace plane is lifted, so the
        // perspective short-fall can be large — grab the building corner anyway.
        const snapCorner = (p: [number, number]): [number, number] => {
          const s = snapPointToWalls(p[0], p[1], areaRef, 70, 36)
          return [s.x, s.y]
        }
        if (!traceStart) { const s = snapCorner(pixel); setTraceStart(s); setHoverPixel(s); return }
        const a = traceStart
        const end = snapCorner(pixel)
        if (Math.hypot(end[0] - a[0], end[1] - a[1]) < 6) { setTraceStart(null); return }
        const area = { id: genLineId(), x1: a[0], y1: a[1], x2: end[0], y2: end[1], material: '', level: activeLevel }
        if (activeTraceLayer === 'floors') addFloorsAreas([{ ...area, elementType: floorsElement, size: floorsSize }])
        else addRoofAreas([{ ...area, elementType: roofElement, size: roofSize }])
        setTraceStart(null)
        return
      }

      // Trade layers (plumbing/electrical/HVAC) trace simple lines, not walls.
      if (activeTraceLayer === 'plumbing' || activeTraceLayer === 'electrical' || activeTraceLayer === 'hvac') {
        // In-wall runs follow the studs: snap taps onto the nearest wall line so
        // the run routes INSIDE the wall (through the studs) instead of floating
        // across the room. Other bands (under-floor / ceiling) tap freely.
        const inWallSnap = (p: [number, number]): [number, number] => {
          if (traceBand !== 'in-wall') return p
          const refWalls = drawing.parsedWalls.filter((w) => (w.source ?? 'auto') !== 'user' || (w.level ?? 0) === activeLevel)
          const s = snapPointToWalls(p[0], p[1], refWalls, 26, 26)
          return [s.x, s.y]
        }
        if (!traceStart) { const s = snapTradeStart(inWallSnap(pixel)); setTraceStart(s); setHoverPixel(s); return }
        const a = traceStart
        const end = inWallSnap(pixel)
        if (Math.hypot(end[0] - a[0], end[1] - a[1]) < 4) { setTraceStart(null); return }
        if (activeTraceLayer === 'plumbing') {
          addPlumbingLines([{
            id: genLineId(), x1: a[0], y1: a[1], x2: end[0], y2: end[1],
            elementType: plumbElement, size: plumbSize, material: plumbMaterial,
            tempType: plumbElement === 'Supply Line' ? plumbTemp : undefined,
            band: traceBand,
          }])
        } else if (activeTraceLayer === 'electrical') {
          addElectricalLines([{
            id: genLineId(), x1: a[0], y1: a[1], x2: end[0], y2: end[1],
            elementType: elecElement, size: elecAmp, material: elecWire,
            wireRole: elecElement === 'Low Voltage' ? undefined : elecRole,
            band: traceBand,
          }])
        } else {
          addHvacLines([{
            id: genLineId(), x1: a[0], y1: a[1], x2: end[0], y2: end[1],
            elementType: hvacElement, size: hvacSize, material: hvacMaterial,
            band: traceBand,
          }])
        }
        setTraceStart(end) // chain: B becomes the next A
        return
      }

      if (traceStyle === 'freehand') {
        setTraceStroke([pixel])
        setHoverPixel(pixel)
        return
      }

      // Snap only against the PRINT lines + walls on the SAME storey, so a
      // 2nd-floor wall snaps to the plan and to its own level — never to the
      // ground-floor wall directly beneath it (same footprint, other level).
      const refWalls = drawing.parsedWalls.filter(
        (w) => (w.source ?? 'auto') !== 'user' || (w.level ?? 0) === activeLevel,
      )
      // Walls on the storey directly below — used ONLY to align this floor plumb
      // over the one beneath (perpendicular line-snap), never corner-merged
      // across levels. So a wall traced a hair off lands plumb above its mate.
      const belowWalls = activeLevel > 0
        ? drawing.parsedWalls.filter((w) => w.source === 'user' && (w.level ?? 0) === activeLevel - 1)
        : []
      // Rubber-band: tap A anchors, tap B commits, B becomes the next A so
      // consecutive segments share an exact corner point.
      const snapped = snapPointToWalls(pixel[0], pixel[1], refWalls)
      if (!traceStart) {
        setTraceStart([snapped.x, snapped.y])
        setHoverPixel(pixel)
        return
      }
      // Prefer snapping the whole segment ONTO the nearest parallel print line
      // (so a trace a hair off the printed wall lands exactly on it, at the
      // print's real angle). Generous tolerances so you don't have to be exact;
      // only fall back to ortho squaring when nothing parallel is reasonably near.
      const printLine = snapWallToPrintLine(traceStart[0], traceStart[1], snapped.x, snapped.y, [...refWalls, ...belowWalls], 28, 42)
      const reduced = printLine
        ? { x1: printLine.x1, y1: printLine.y1, x2: printLine.x2, y2: printLine.y2, thickness: 8, source: 'user' as const, detectionConfidence: 1 }
        : reduceStrokeToWall([
            { x: traceStart[0], y: traceStart[1] },
            { x: snapped.x, y: snapped.y },
          ])
      if (!reduced || Math.hypot(reduced.x2 - reduced.x1, reduced.y2 - reduced.y1) < 12) {
        // Tap landed on the anchor — treat as "end this wall run"
        setTraceStart(null)
        return
      }
      // No detected wall to lock onto? Snap the segment onto the actual ink under
      // the stroke, so faint/dashed/undetected printed lines still trace cleanly.
      let inkSnapped = false
      if (!printLine) {
        const buf = getInkBuffer(drawing.id)
        const ink = buf && snapSegmentToInk(reduced.x1, reduced.y1, reduced.x2, reduced.y2, buf)
        if (ink) {
          reduced.x1 = ink.x1; reduced.y1 = ink.y1; reduced.x2 = ink.x2; reduced.y2 = ink.y2
          inkSnapped = true
        }
      }
      const snappedWall = snapTraceWallToExisting(reduced, refWalls)
      // Final squaring: a near-horizontal/vertical wall ends up EXACTLY square
      // even if it snapped onto a slightly-crooked print/reference line. Genuine
      // diagonals are left alone. Kills the "it drew me a crooked wall" case.
      const base = squareWallToAxis(extendWallToNearbyWall(snappedWall, refWalls))
      // Stamp the picked framing/role/material onto the wall so the build frames
      // (or, for CMU, leaves solid) and renders it as chosen — not always wood.
      const isMasonry = activeWallType === 'cmu'
      const wall: ParsedWall = {
        ...base,
        framingType: activeWallType,
        wallRole: activeWallRole,
        wallType: FRAMING_TO_WALLTYPE[activeWallType] ?? base.wallType,
        exteriorMaterial: isMasonry ? 'concrete' : base.exteriorMaterial,
        level: activeLevel,
      }
      // New wall is appended last among user walls, so its user-index is the
      // count before the add — captured for the "line it up?" nudge below.
      const newUserIndex = drawing.parsedWalls.filter((w) => w.source === 'user').length
      addUserTracedWall(drawing.id, wall)
      addTrace({ points: [traceStart, [wall.x2, wall.y2]], timestamp: Date.now() })
      // Off the print? If the wall's midpoint lands outside the plan image and it
      // didn't snap to a print line, gently ask whether that was intended.
      const rw = drawing.rasterWidth ?? 1400
      const rh = drawing.rasterHeight ?? 900
      const mx = (wall.x1 + wall.x2) / 2, my = (wall.y1 + wall.y2) / 2
      const m = 24
      if (!printLine && !inkSnapped && (mx < -m || my < -m || mx > rw + m || my > rh + m)) {
        setOffPrintWarn(true)
      } else {
        // Floors stack: if this upper-floor wall landed near — but not lined up
        // with — a wall on the storey below, surface a "line it up?" prompt. The
        // app knows floors are normally plumb and flags the drift; the user
        // decides whether to snap it or keep the offset on purpose.
        maybeNudgePlumb(wall, newUserIndex)
      }
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
    const pixel = toPixel(event.point)
    setHoverPixel(pixel)
    if (!traceMode || traceStyle !== 'freehand') return
    setTraceStroke((prev) => (prev.length === 0 ? prev : [...prev, pixel]))
  }

  // Snap and tie in only the FREE ends of a wall chain — interior corners
  // must keep their exact shared points.
  const tieInChainEnds = (walls: ParsedWall[], existing: ParsedWall[]): ParsedWall[] => {
    if (walls.length === 0) return walls
    const out = walls.map((w) => ({ ...w }))
    // Snap each freehand segment onto the printed ink under it (faint/dashed/
    // undetected lines included) before tying corners together.
    const inkBuf = drawing ? getInkBuffer(drawing.id) : null
    if (inkBuf) {
      for (const w of out) {
        const ink = snapSegmentToInk(w.x1, w.y1, w.x2, w.y2, inkBuf)
        if (ink) { w.x1 = ink.x1; w.y1 = ink.y1; w.x2 = ink.x2; w.y2 = ink.y2 }
      }
    }
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
    // While LOCKED (a run active, not paused) the camera can't orbit, so a
    // wandering finger is still a tap — place it. While UNLOCKED, a travelled
    // pointer was an orbit/pan, not a point.
    const lockedRun = traceMode && traceStyle === 'line' && traceStart !== null && !tracePaused
    const down = pointerDownScreen.current
    pointerDownScreen.current = null
    if (down && !lockedRun) {
      const moved = Math.hypot(event.nativeEvent.clientX - down.x, event.nativeEvent.clientY - down.y)
      const limit = event.nativeEvent.pointerType === 'touch' ? TAP_MOVE_TOUCH_PX : TAP_MOVE_PX
      if (moved > limit) return
    }
    event.stopPropagation()
    // Click-count model while a run is active:
    //   1 tap  → place a point + LOCK the workspace (view frozen, precise taps)
    //   2 taps → UNLOCK (free the camera to orbit/pan; the run is kept)
    //   3 taps → terminate the run
    // A tap after the window re-locks and places (resume after an unlock).
    if (traceMode && traceStart) {
      const now = performance.now()
      const sx = event.nativeEvent.clientX
      const sy = event.nativeEvent.clientY
      const lt = lastTapRef.current
      const within = lt && now - lt.t < 380 && Math.hypot(sx - lt.x, sy - lt.y) < 46
      if (within) {
        const count = (lt!.count) + 1
        lastTapRef.current = { t: now, x: sx, y: sy, count }
        if (count === 2) { setTracePaused(true); return }            // unlock — free the camera
        setTraceStart(null); setTracePaused(false); setHoverPixel(null); lastTapRef.current = null
        return                                                       // 3+ — terminate the run
      }
      lastTapRef.current = { t: now, x: sx, y: sy, count: 1 }
    }
    if (tracePaused) setTracePaused(false)   // a placing tap re-locks (resume)
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

  // Stairs/elevators snap FLUSH against the nearest wall: aligned to it, with
  // their near edge on the wall face and the run going into the room — so a
  // stairwell/shaft sits against the wall instead of floating mid-room. Returns
  // the tap point (auto-oriented) when no wall is within reach.
  const circulationPose = (x: number, z: number) => {
    let best = Infinity, foot: { x: number; z: number } | null = null, yaw = 0, nrm = { x: 0, z: 0 }
    for (const w of userWalls) {
      const a = planeLocalToWorld([w.x1, w.y1])
      const b = planeLocalToWorld([w.x2, w.y2])
      const ax = a[0], az = a[2], dx = b[0] - ax, dz = b[2] - az
      const len2 = dx * dx + dz * dz
      if (len2 < 1e-6) continue
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len2))
      const fx = ax + t * dx, fz = az + t * dz
      const d = Math.hypot(x - fx, z - fz)
      if (d < best) { best = d; foot = { x: fx, z: fz }; yaw = -Math.atan2(dz, dx); nrm = { x: x - fx, z: z - fz } }
    }
    if (!foot || best > 2.5) return { x, z, rotationY: autoOrientYaw(x, z) }
    const item = getCatalogItem(placeObjectType ?? '')
    const depth = item?.defaultD ?? 1.5
    const nl = Math.hypot(nrm.x, nrm.z) || 1
    const off = depth / 2 + 0.05   // centre out by half-depth → near edge on the wall
    return { x: foot.x + (nrm.x / nl) * off, z: foot.z + (nrm.z / nl) * off, rotationY: yaw }
  }

  // Final pose for a placement tap: wall devices snap onto the wall; stairs/
  // elevators snap flush against it; everything else drops where tapped. All
  // auto-orient to the nearest wall.
  const devicePose = (x: number, z: number) => {
    if (VERTICAL_CIRCULATION.has(placeObjectType ?? '')) return circulationPose(x, z)
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
    const placingType = placeObjectType   // captured: closeAllPanels() clears it below
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
    // Don't auto-open the editor on placement — on a phone the card covers the
    // whole scene, so the object you just placed looks like it never rendered.
    // Drop it in plain sight; tap it any time to open the editor.
    closeAllPanels()
    // Keep-placing: re-arm the same type (after closeAllPanels clears it) so the
    // user can drop a run of boxes/devices without re-picking from the tray.
    if (keepPlacing) setPlaceObjectType(placingType)
  }

  const ghostItem = placeObjectType ? getCatalogItem(placeObjectType) : null

  // Colour of the line currently being traced, by active discipline/selection.
  const activeLineColor =
    activeTraceLayer === 'plumbing' ? plumbingColorFor(plumbElement, plumbTemp)
    : activeTraceLayer === 'electrical' ? electricalColorFor(elecElement, elecRole)
    : activeTraceLayer === 'hvac' ? hvacColorFor(hvacElement)
    : activeTraceLayer === 'floors' ? LAYER_COLORS.floors
    : activeTraceLayer === 'roof' ? LAYER_COLORS.roof
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
      {/* Ghost ceiling — a faint plane at ceiling height for the WHOLE HVAC flow
          (whenever the HVAC discipline is active, not just mid-trace), so ducts
          can be run "in the ceiling" before a real ceiling exists. It tracks the
          active storey + the plan's orientation, the way a placed door orients to
          its wall; the ducts still render up at the ceiling band. */}
      {drawing && drawing.status === 'ready' && activeTraceLayer === 'hvac' && (
        <group position={[overlay.position[0], activeLevel * storeyHeight + ceilingM, overlay.position[1]]} rotation={[0, rotationRad, 0]}>
          <mesh rotation={[-Math.PI / 2, 0, 0]} userData={{ noPick: true }}>
            <planeGeometry args={[width, depth]} />
            <meshBasicMaterial color="#a78bfa" transparent opacity={0.1} depthWrite={false} side={THREE.DoubleSide} />
          </mesh>
        </group>
      )}
      {drawing && overlay.visible && texture && (
        <group
          /* Lifted to the active storey: the print image + the tap-catcher +
             the edit handles inside this group all rise together, so you trace
             on the floor you're working and the catcher stays coplanar. */
          position={[overlay.position[0], 0.01 + traceElevation, overlay.position[1]]}
          rotation={[0, rotationRad, 0]}
        >
          <mesh
            rotation={[-Math.PI / 2, 0, 0]}
            /* Optionally keep the IMAGE at ground while the group (and the
               tap-catcher) stay lifted to the active storey — so an upper floor
               isn't muddled with the ground plan floating up at it. */
            position={[0, overlay.printAtGround ? -traceElevation : 0, 0]}
            userData={{ layer: 'floors', noPick: true }}
          >
            <planeGeometry args={[width, depth]} />
            <meshBasicMaterial
              map={texture}
              transparent
              opacity={overlay.opacity}
              depthWrite={false}
              side={THREE.DoubleSide}
            />
          </mesh>

          {/* Catcher stays present throughout trace/calibration so a tap always
              registers (incl. resuming after a double-tap unlock). When unlocked
              a DRAG still orbits the camera (OrbitControls reads the DOM event);
              a TAP places + re-locks. */}
          {(traceMode || overlay.calibrationMode) && (
            <mesh
              rotation={[-Math.PI / 2, 0, 0]}
              /* Catch at PRINT level (not lifted to traceY): the user always aims
                 at the plan, so an elevated catcher made the ray land offset in
                 perspective ("short on one side unless straight overhead"). And
                 it's far larger than the print so floors/roofs can be pulled well
                 past the drawing edge ("for miles"); walls still clamp to bounds. */
              position={[0, 0.02, 0]}
              onPointerDown={handleWorkspacePointerDown}
              onPointerMove={handleWorkspacePointerMove}
              onPointerUp={handleWorkspacePointerUp}
              onPointerLeave={handleWorkspacePointerCancel}
              onPointerCancel={handleWorkspacePointerCancel}
            >
              <planeGeometry args={[Math.max(width, depth) * 12, Math.max(width, depth) * 12]} />
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
                <circleGeometry args={[0.22 * hScale, 24]} />
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
                  <sphereGeometry args={[0.16 * hScale, 16, 16]} />
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
                  <boxGeometry args={[0.22 * hScale, 0.08 * hScale, 0.22 * hScale]} />
                  <meshBasicMaterial color="#22d3ee" />
                </mesh>
              ))}

              <mesh
                position={[0, 0.03, halfD + 0.9]}
                onPointerDown={(e) => onDragStart(e, { kind: 'rotate' })}
                onPointerMove={onDragMove}
                onPointerUp={onDragEnd}
              >
                <torusGeometry args={[0.2 * hScale, 0.05 * hScale, 12, 24]} />
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

      {/* Floor/roof area being pulled — rubber-band rectangle, lifted to the
          ACTIVE storey so it hugs the cursor on the raised print/catcher (which
          now sit at the same tier). The print, catcher and this preview are all
          coplanar at traceElevation, so the outline tracks the tap exactly — no
          perspective offset. Committed areas (below) use their own per-area
          elevation. */}
      {floorsPreviewRect && (
        <Line points={raiseRect(floorsPreviewRect, traceElevation)} color={activeTraceLayer === 'roof' ? LAYER_COLORS.roof : LAYER_COLORS.floors} lineWidth={3} dashed dashSize={0.25} gapSize={0.15} />
      )}

      {/* Committed floor areas — outlines at each area's storey elevation. */}
      {visibleLayers.has('floors') && floorsAreas.map((a) => (
        <Line
          key={`floor-${a.id}`}
          points={raiseRect(floorsRectWorld(a.x1, a.y1, a.x2, a.y2), areaElevation(a.level ?? 0, CEILING_TYPES.has(a.elementType)))}
          color={LAYER_COLORS.floors}
          lineWidth={2.5}
        />
      ))}

      {/* Committed roof areas — outlines at each area's storey elevation. */}
      {visibleLayers.has('roof') && roofAreas.map((a) => (
        <Line
          key={`roof-${a.id}`}
          points={raiseRect(floorsRectWorld(a.x1, a.y1, a.x2, a.y2), areaElevation(a.level ?? 0, true))}
          color={LAYER_COLORS.roof}
          lineWidth={2.5}
        />
      ))}

      {/* Committed trade lines drawn on the print, coloured by field convention.
          When not tracing/placing, tapping a run selects it (edit-on-the-fly →
          the panel's Delete). The selected run is highlighted. */}
      {(() => {
        const editable = !traceMode && !placeObjectType
        const renderRun = (trade: 'plumbing' | 'electrical' | 'hvac', l: TracedLine, color: string) => {
          const sel = selectedLine?.trade === trade && selectedLine.id === l.id
          return (
            <Line
              key={`${trade}-${l.id}`}
              points={[planeLocalToWorld([l.x1, l.y1]), planeLocalToWorld([l.x2, l.y2])]}
              color={sel ? '#fde047' : color}
              lineWidth={sel ? 7 : 4}
              onClick={editable ? (e) => { e.stopPropagation(); selectLineExclusive(trade, l.id) } : undefined}
            />
          )
        }
        return (
          <>
            {visibleLayers.has('plumbing') && plumbingLines.map((l) => renderRun('plumbing', l, plumbingColor(l)))}
            {visibleLayers.has('electrical') && electricalLines.map((l) => renderRun('electrical', l, electricalColor(l)))}
            {visibleLayers.has('hvac') && hvacLines.map((l) => renderRun('hvac', l, hvacColor(l)))}
          </>
        )
      })()}

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
        <mesh position={planeLocalToTrace(traceStart)}>
          <sphereGeometry args={[0.09, 16, 16]} />
          <meshBasicMaterial color={activeLineColor} />
        </mesh>
      )}

      {/* Placement catcher — a huge inside-out sphere AROUND the scene so the
          pointer ray always hits it at ANY zoom/camera height (a flat overhead
          plane was missed once the camera dipped below it, so the ghost only
          showed from far away). The hit point is ignored — moveGhost/placeAtPointer
          project the event ray to the y=0 ground for the true floor point. */}
      {placeObjectType && (
        <mesh onPointerDown={placeAtPointer} onPointerMove={moveGhost}>
          <sphereGeometry args={[800, 16, 12]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} side={THREE.BackSide} />
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

      {/* Wall select: thin invisible click targets along each UNSELECTED wall.
          Under canEditWalls (not editMode) so they stay live through a drag. */}
      {canEditWalls && !placeObjectType && userWalls.map((w, i) => {
        if (i === selectedWallIndex) return null
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

      {/* Selected wall — yellow highlight + a whole-wall drag body and two
          endpoint handles. Grab the body to slide the wall; grab an end to
          re-aim it. Move/up are handled by the global catcher below so a fast
          drag never drops off the thin handle. */}
      {canEditWalls && selectedWallIndex != null && userWalls[selectedWallIndex] && (() => {
        const idx = selectedWallIndex
        const w = userWalls[idx]
        const a = planeLocalToWorld([w.x1, w.y1])
        const b = planeLocalToWorld([w.x2, w.y2])
        const len = Math.hypot(b[0] - a[0], b[2] - a[2])
        const ang = Math.atan2(b[2] - a[2], b[0] - a[0])
        return (
          <group key="wall-edit">
            <Line points={[a, b]} color="#facc15" lineWidth={7} />
            {len >= 0.05 && (
              <mesh
                position={[(a[0] + b[0]) / 2, 0.07, (a[2] + b[2]) / 2]}
                rotation={[0, -ang, 0]}
                onPointerDown={(e) => onDragStart(e, { kind: 'wall', wallIndex: idx } as DragState)}
              >
                <boxGeometry args={[len, 0.08, wallPickWidthM]} />
                <meshBasicMaterial transparent opacity={0} depthWrite={false} />
              </mesh>
            )}
            {([['start', a], ['end', b]] as const).map(([which, p]) => (
              <mesh
                key={which}
                position={[p[0], 0.1, p[2]]}
                onPointerDown={(e) => onDragStart(e, { kind: 'wall-end', wallIndex: idx, end: which } as DragState)}
              >
                <sphereGeometry args={[0.14, 16, 12]} />
                <meshBasicMaterial color="#facc15" />
              </mesh>
            ))}
          </group>
        )
      })()}

      {/* Drag catcher — only while a wall drag is live. A huge inside-out sphere
          guarantees onPointerMove/Up fire even when the cursor leaves the handle. */}
      {drag && (drag.kind === 'wall' || drag.kind === 'wall-end') && (
        <mesh onPointerMove={onDragMove} onPointerUp={onDragEnd}>
          <sphereGeometry args={[800, 8, 6]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} side={THREE.BackSide} />
        </mesh>
      )}

      {calibrationPreviewPoints && (
        <TraceArrow start={calibrationPreviewPoints[0]} end={calibrationPreviewPoints[1]} color="#f59e0b" />
      )}

      {/* Calibration point markers — you need to SEE where A and B landed, not
          just the measuring arrow between them. Amber dots at each tapped point
          (coplanar with the lifted print via planeLocalToTrace). */}
      {overlay.calibrationMode && calibrationA && (
        <mesh position={planeLocalToTrace(calibrationA)}>
          <sphereGeometry args={[0.13, 18, 18]} />
          <meshBasicMaterial color="#f59e0b" />
        </mesh>
      )}
      {overlay.calibrationMode && calibrationB && (
        <mesh position={planeLocalToTrace(calibrationB)}>
          <sphereGeometry args={[0.13, 18, 18]} />
          <meshBasicMaterial color="#f59e0b" />
        </mesh>
      )}
    </>
  )
}
