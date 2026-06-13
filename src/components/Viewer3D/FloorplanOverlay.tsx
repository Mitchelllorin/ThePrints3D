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

import { useCallback, useEffect, useMemo } from 'react'
import type { ThreeEvent } from '@react-three/fiber'
import { Line } from '@react-three/drei'
import * as THREE from 'three'
import { useAppStore } from '../../store/useAppStore'
import { useConfigStore } from '../../store/useConfigStore'
import { useFloorplanLocalStore } from '../../store/useFloorplanLocalStore'
import { reduceStrokeToWall, snapTraceWallToExisting } from '../../services/wallTraceReducer'

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
function TraceArrow({ start, end }: {
  start: [number, number, number]
  end: [number, number, number]
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
      <Line points={[start, tip]} color="#38bdf8" lineWidth={4} />
      <Line points={[b1, tip, b2]} color="#38bdf8" lineWidth={4} />
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

  const gridSnapM = useConfigStore((s) => s.gridSnapM)
  const wallTraceThicknessPx = useConfigStore((s) => s.wallTraceThicknessPx)
  const wallTraceMinLengthPx = useConfigStore((s) => s.wallTraceMinLengthPx)
  const wallTraceSnapEndpointPx = useConfigStore((s) => s.wallTraceSnapEndpointPx)
  const wallTraceSnapLinePx = useConfigStore((s) => s.wallTraceSnapLinePx)
  const wallTraceStyle = useConfigStore((s) => s.wallTraceStyle)

  const traceMode = useFloorplanLocalStore((s) => s.traceMode)
  const traceStroke = useFloorplanLocalStore((s) => s.traceStroke)
  const setTraceStroke = useFloorplanLocalStore((s) => s.setTraceStroke)
  const hoverPixel = useFloorplanLocalStore((s) => s.hoverPixel)
  const setHoverPixel = useFloorplanLocalStore((s) => s.setHoverPixel)
  const calibrationA = useFloorplanLocalStore((s) => s.calibrationA)
  const setCalibrationA = useFloorplanLocalStore((s) => s.setCalibrationA)
  const calibrationB = useFloorplanLocalStore((s) => s.calibrationB)
  const setCalibrationB = useFloorplanLocalStore((s) => s.setCalibrationB)
  const drag = useFloorplanLocalStore((s) => s.drag)
  const setDrag = useFloorplanLocalStore((s) => s.setDrag)

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

  const handleWorkspacePointerDown = (event: ThreeEvent<PointerEvent>) => {
    if (!drawing || (!traceMode && !overlay.calibrationMode)) return
    event.stopPropagation()
    const pixel = worldToPixel(event.point)

    if (traceMode) {
      setTraceStroke([pixel])
      setHoverPixel(pixel)
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
    if (!traceMode) return
    setTraceStroke((prev) => (prev.length === 0 ? prev : [...prev, pixel]))
  }

  const handleWorkspacePointerUp = (event: ThreeEvent<PointerEvent>) => {
    if (!drawing || !traceMode) return
    event.stopPropagation()
    const pixel = worldToPixel(event.point)
    setTraceStroke((prev) => {
      const points = [...prev, pixel]
      const reduced = reduceStrokeToWall(points.map(([x, y]) => ({ x, y })), {
        defaultThicknessPx: wallTraceThicknessPx,
        minLengthPx: wallTraceMinLengthPx,
      })
      if (reduced) {
        const snapped = snapTraceWallToExisting(
          reduced,
          drawing.parsedWalls,
          wallTraceSnapEndpointPx,
          wallTraceSnapLinePx,
        )
        addUserTracedWall(drawing.id, snapped)
        addTrace({ points, timestamp: Date.now() })
      }
      return []
    })
    setHoverPixel(null)
  }

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
              onPointerLeave={handleWorkspacePointerUp}
              onPointerCancel={handleWorkspacePointerUp}
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

      {calibrationPreviewPoints && (
        <Line points={calibrationPreviewPoints} color="#f59e0b" lineWidth={4} dashed={Boolean(calibrationB)} dashScale={1.2} dashSize={0.28} gapSize={0.18} />
      )}
    </>
  )
}
