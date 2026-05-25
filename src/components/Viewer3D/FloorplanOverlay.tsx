import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ThreeEvent } from '@react-three/fiber'
import { Html, Line } from '@react-three/drei'
import * as THREE from 'three'
import { useAppStore } from '../../store/useAppStore'
import { reduceStrokeToWall, snapTraceWallToExisting } from '../../services/wallTraceReducer'
import { listPresetDefinitions } from '../../services/presetDrawings'
import styles from './ModelViewer.module.css'

type DragKind = 'move' | 'corner' | 'edge' | 'rotate'

type CalibrationUnit = 'mm' | 'm' | 'ft' | 'in'

interface DragState {
  kind: DragKind
  axis?: 'x' | 'z'
  signX?: 1 | -1
  signZ?: 1 | -1
}

const GRID_SNAP = 0.25
const DEFAULT_WIDTH = 12
const DEFAULT_DEPTH = 8
const ACCEPTED_TYPES = '.pdf,.png,.jpg,.jpeg,.tif,.tiff,.webp,.svg'

function snap(value: number, enabled: boolean) {
  if (!enabled) return value
  return Math.round(value / GRID_SNAP) * GRID_SNAP
}

function toMm(value: number, unit: CalibrationUnit): number {
  switch (unit) {
    case 'm': return value * 1000
    case 'ft': return value * 304.8
    case 'in': return value * 25.4
    default: return value
  }
}

export default function FloorplanOverlay() {
  const drawings = useAppStore((s) => s.drawings)
  const overlay = useAppStore((s) => s.floorplanOverlay)
  const setOverlayDrawing = useAppStore((s) => s.setFloorplanOverlayDrawing)
  const updateOverlay = useAppStore((s) => s.updateFloorplanOverlay)
  const checkpointHistory = useAppStore((s) => s.checkpointHistory)
  const addDrawings = useAppStore((s) => s.addDrawings)
  const buildModel = useAppStore((s) => s.buildModel)
  const processDrawing = useAppStore((s) => s.processDrawing)
  const addUserTracedWall = useAppStore((s) => s.addUserTracedWall)
  const clearTracingForDrawing = useAppStore((s) => s.clearTracingForDrawing)
  const setDrawingScale = useAppStore((s) => s.setDrawingScale)
  const userTraces = useAppStore((s) => s.userTraces)
  const addTrace = useAppStore((s) => s.addTrace)
  const processWithSeeds = useAppStore((s) => s.processWithSeeds)
  const loadPresetDrawing = useAppStore((s) => s.loadPresetDrawing)

  const drawing = drawings.find((d) => d.id === overlay.drawingId) ?? drawings[0] ?? null
  const imageUrl = drawing ? (drawing.rasterUrl ?? drawing.previewUrl) : null
  const imageWidth = drawing?.rasterWidth ?? 1400
  const imageHeight = drawing?.rasterHeight ?? 900
  const fileInputRef = useRef<HTMLInputElement>(null)

  const texture = useMemo(() => {
    if (!imageUrl) return null
    const t = new THREE.TextureLoader().load(imageUrl)
    t.colorSpace = THREE.SRGBColorSpace
    t.wrapS = THREE.ClampToEdgeWrapping
    t.wrapT = THREE.ClampToEdgeWrapping
    return t
  }, [imageUrl])

  const [drag, setDrag] = useState<DragState | null>(null)
  const [traceMode, setTraceMode] = useState(false)
  const [traceStroke, setTraceStroke] = useState<[number, number][]>([])
  const [hoverPixel, setHoverPixel] = useState<[number, number] | null>(null)
  const [calibrationA, setCalibrationA] = useState<[number, number] | null>(null)
  const [calibrationB, setCalibrationB] = useState<[number, number] | null>(null)
  const [distanceInput, setDistanceInput] = useState('')
  const [distanceUnit, setDistanceUnit] = useState<CalibrationUnit>('mm')
  const [presetOpen, setPresetOpen] = useState(false)
  const [practiceMode, setPracticeMode] = useState(true)
  const [seedProcessing, setSeedProcessing] = useState(false)

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
  const hasUsableSeedTrace = userTraces.some((trace) => trace.points.length >= 8)
  const userWallCount = drawing?.parsedWalls.filter((wall) => wall.source === 'user').length ?? 0

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

  const applyMove = (dx: number, dz: number) => {
    updateOverlay({
      position: [
        snap(overlay.position[0] + dx, overlay.snapToGrid),
        snap(overlay.position[1] + dz, overlay.snapToGrid),
      ],
    }, false)
  }

  const applyScale = (dWidth: number, dDepth: number) => {
    updateOverlay({
      scale: [
        Math.max(0.5, snap(width + dWidth, overlay.snapToGrid)),
        Math.max(0.5, snap(depth + dDepth, overlay.snapToGrid)),
      ],
    }, false)
  }

  const onDragStart = (event: ThreeEvent<PointerEvent>, next: DragState) => {
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
    if (drag.kind === 'move') {
      applyMove(dx, dz)
      return
    }
    if (drag.kind === 'rotate') {
      updateOverlay({ rotationDeg: overlay.rotationDeg + event.movementX * 0.5 }, false)
      return
    }
    if (drag.kind === 'corner') {
      applyScale((drag.signX ?? 1) * dx, (drag.signZ ?? 1) * dz)
      return
    }
    if (drag.kind === 'edge') {
      applyScale((drag.axis === 'x' ? dx : 0), (drag.axis === 'z' ? dz : 0))
    }
  }

  const onDragEnd = (event: ThreeEvent<PointerEvent>) => {
    if (!drag) return
    event.stopPropagation()
    setDrag(null)
  }

  const startCalibration = () => {
    setTraceMode(false)
    setTraceStroke([])
    setCalibrationA(null)
    setCalibrationB(null)
    setHoverPixel(null)
    setDistanceInput('')
    updateOverlay({ calibrationMode: true, guidedStep: 1, locked: false }, false)
  }

  const cancelCalibration = () => {
    setCalibrationA(null)
    setCalibrationB(null)
    setHoverPixel(null)
    setDistanceInput('')
    updateOverlay({ calibrationMode: false }, false)
  }

  const cancelTracing = () => {
    setTraceMode(false)
    setTraceStroke([])
    setHoverPixel(null)
  }

  const finalizeCalibration = () => {
    if (!drawing || !calibrationA || !calibrationB) return
    const realDistance = Number.parseFloat(distanceInput)
    if (!Number.isFinite(realDistance) || realDistance <= 0) return
    const realMm = toMm(realDistance, distanceUnit)
    const pxDistance = Math.hypot(calibrationB[0] - calibrationA[0], calibrationB[1] - calibrationA[1])
    if (pxDistance < 1) return
    const mmPerPx = realMm / pxDistance
    const notationRatio = Math.round((25.4 / 72) * (1 / mmPerPx))
    const notation = notationRatio > 0 ? `1:${notationRatio}` : 'custom'
    setDrawingScale(drawing.id, mmPerPx, notation)
    updateOverlay({ scale: estimatedScale, calibrationMode: false }, false)
    setCalibrationA(null)
    setCalibrationB(null)
    setHoverPixel(null)
    setDistanceInput('')
  }

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
      setDistanceInput('')
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
      const reduced = reduceStrokeToWall(points.map(([x, y]) => ({ x, y })))
      if (reduced) {
        const snapped = snapTraceWallToExisting(reduced, drawing.parsedWalls)
        addUserTracedWall(drawing.id, snapped)
        addTrace({ points, timestamp: Date.now() })
      }
      return []
    })
    setHoverPixel(null)
  }

  const handleUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    if (files.length > 0) addDrawings(files)
    event.target.value = ''
  }

  const handleSmartRefine = async () => {
    if (!drawing) return
    setSeedProcessing(true)
    await processWithSeeds(drawing.id)
    setSeedProcessing(false)
  }

  const clearTracingResults = () => {
    if (!drawing) return
    clearTracingForDrawing(drawing.id)
    cancelTracing()
  }

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

      {traceWorldPoints.length > 1 && (
        <Line points={traceWorldPoints} color="#38bdf8" lineWidth={4} dashed dashScale={1.5} dashSize={0.3} gapSize={0.18} />
      )}

      {calibrationPreviewPoints && (
        <Line points={calibrationPreviewPoints} color="#f59e0b" lineWidth={4} dashed={Boolean(calibrationB)} dashScale={1.2} dashSize={0.28} gapSize={0.18} />
      )}

      <Html fullscreen>
        <div className={styles.floorplanPanel}>
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED_TYPES}
            multiple
            style={{ display: 'none' }}
            onChange={handleUpload}
          />

          <div className={styles.floorplanPanelHeader}>
            <strong>3D Workspace Print Overlay</strong>
            <div className={styles.floorplanActionRow}>
              <button className={styles.floorplanBtn} onClick={() => fileInputRef.current?.click()}>
                Upload print
              </button>
              <button className={styles.floorplanBtn} onClick={() => setPresetOpen(true)}>
                Presets
              </button>
            </div>
          </div>

          {!drawing ? (
            <div className={styles.floorplanGuide}>
              <div>Start in 3D by uploading a print or loading an Easy / Medium / Hard preset directly onto the grid.</div>
              <div className={styles.floorplanGuideBtns}>
                <button className={styles.floorplanBtn} onClick={() => fileInputRef.current?.click()}>Upload</button>
                <button className={styles.floorplanBtn} onClick={() => setPresetOpen(true)}>Load preset</button>
              </div>
            </div>
          ) : (
            <>
              <div className={styles.floorplanRow}>
                <label>Print</label>
                <select
                  className={styles.floorplanSelect}
                  value={drawing.id}
                  onChange={(e) => setOverlayDrawing(e.target.value)}
                >
                  {drawings.map((item) => (
                    <option key={item.id} value={item.id}>{item.name}</option>
                  ))}
                </select>
              </div>

              <div className={styles.floorplanActionGrid}>
                <button className={styles.floorplanBtn} onClick={() => processDrawing(drawing.id)} disabled={drawing.status === 'processing'}>
                  {drawing.status === 'processing' ? 'Analysing…' : 'Analyse'}
                </button>
                <button className={styles.floorplanBtn} onClick={buildModel}>
                  Build 3D
                </button>
                {!traceMode ? (
                  <button className={styles.floorplanBtn} onClick={() => { cancelCalibration(); setTraceMode(true) }}>
                    Start trace
                  </button>
                ) : (
                  <button className={styles.floorplanBtn} onClick={cancelTracing}>
                    Cancel trace
                  </button>
                )}
                {!overlay.calibrationMode ? (
                  <button className={styles.floorplanBtn} onClick={startCalibration}>
                    Calibrate in 3D
                  </button>
                ) : (
                  <button className={styles.floorplanBtn} onClick={cancelCalibration}>
                    Cancel calibration
                  </button>
                )}
              </div>

              <div className={styles.floorplanRow}>
                <label>Opacity</label>
                <input
                  type="range"
                  min={0.1}
                  max={1}
                  step={0.05}
                  value={overlay.opacity}
                  onChange={(e) => updateOverlay({ opacity: Number(e.target.value) })}
                />
              </div>

              <div className={styles.floorplanChecks}>
                <label><input type="checkbox" checked={overlay.visible} onChange={(e) => updateOverlay({ visible: e.target.checked })} /> Visible</label>
                <label><input type="checkbox" checked={overlay.snapToGrid} onChange={(e) => updateOverlay({ snapToGrid: e.target.checked })} /> Snap to grid</label>
                <label><input type="checkbox" checked={overlay.locked} onChange={(e) => updateOverlay({ locked: e.target.checked })} /> Lock alignment</label>
              </div>

              <div className={styles.floorplanMeta}>
                <span>Position {overlay.position[0].toFixed(2)}, {overlay.position[1].toFixed(2)}</span>
                <span>Scale {overlay.scale[0].toFixed(1)}m × {overlay.scale[1].toFixed(1)}m</span>
                <span>Rotation {overlay.rotationDeg.toFixed(1)}°</span>
              </div>

              {traceMode && (
                <div className={styles.floorplanGuide}>
                  <div>Trace directly on the 3D grid with your finger or mouse. Each stroke snaps to nearby wall endpoints and extrudes into a wall.</div>
                  <div className={styles.floorplanGuideBtns}>
                    <button className={styles.floorplanBtn} onClick={cancelTracing}>Cancel trace</button>
                    <button className={styles.floorplanBtn} onClick={clearTracingResults} disabled={userWallCount === 0 && userTraces.length === 0}>Clear traced walls</button>
                    <button className={styles.floorplanBtn} onClick={handleSmartRefine} disabled={!hasUsableSeedTrace || seedProcessing}>
                      {seedProcessing ? 'Refining…' : 'Smart refine'}
                    </button>
                  </div>
                  <div>{userWallCount} traced wall{userWallCount !== 1 ? 's' : ''} · {userTraces.length} seed stroke{userTraces.length !== 1 ? 's' : ''}</div>
                </div>
              )}

              {overlay.calibrationMode && (
                <div className={styles.floorplanGuide}>
                  <div>
                    Step {overlay.guidedStep}/4:{' '}
                    {overlay.guidedStep === 1 && 'Unlock and position the print over the grid.'}
                    {overlay.guidedStep === 2 && 'Tap the first and second calibration points on the print.'}
                    {overlay.guidedStep === 3 && 'Enter the real-world distance to solve scale.'}
                    {overlay.guidedStep === 4 && 'Lock the aligned print and start tracing.'}
                  </div>
                  <div className={styles.floorplanGuideBtns}>
                    <button className={styles.floorplanBtn} onClick={() => updateOverlay({ guidedStep: Math.max(1, overlay.guidedStep - 1) }, false)}>Back</button>
                    <button className={styles.floorplanBtn} onClick={() => updateOverlay({ guidedStep: Math.min(4, overlay.guidedStep + 1) }, false)}>Next</button>
                    <button className={styles.floorplanBtn} onClick={cancelCalibration}>Cancel</button>
                  </div>
                  <div className={styles.floorplanCalibrationRow}>
                    <input
                      className={styles.floorplanInput}
                      type="number"
                      min="0.001"
                      step="any"
                      placeholder="Known distance"
                      value={distanceInput}
                      onChange={(e) => setDistanceInput(e.target.value)}
                    />
                    <select
                      className={styles.floorplanSelect}
                      value={distanceUnit}
                      onChange={(e) => setDistanceUnit(e.target.value as CalibrationUnit)}
                    >
                      <option value="mm">mm</option>
                      <option value="m">m</option>
                      <option value="ft">ft</option>
                      <option value="in">in</option>
                    </select>
                    <button className={styles.floorplanBtn} onClick={finalizeCalibration} disabled={!calibrationA || !calibrationB || !distanceInput.trim()}>
                      Apply
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {presetOpen && (
          <div className={styles.floorplanModalBackdrop} onClick={() => setPresetOpen(false)}>
            <div className={styles.floorplanModal} onClick={(event) => event.stopPropagation()}>
              <div className={styles.floorplanPanelHeader}>
                <strong>Preset drawings</strong>
                <button className={styles.floorplanBtn} onClick={() => setPresetOpen(false)}>Cancel</button>
              </div>
              <div className={styles.floorplanGuide}>
                <div>Choose a preset difficulty. Practice mode loads the print ready for tracing; turning it off auto-builds the 3D walls immediately.</div>
                <label><input type="checkbox" checked={practiceMode} onChange={(e) => setPracticeMode(e.target.checked)} /> Practice mode (disable auto-build)</label>
              </div>
              <div className={styles.floorplanPresetGrid}>
                {listPresetDefinitions().map((preset) => (
                  <button
                    key={preset.id}
                    className={styles.floorplanPresetCard}
                    onClick={() => {
                      loadPresetDrawing(preset.id, practiceMode)
                      setPresetOpen(false)
                    }}
                  >
                    <strong>{preset.name}</strong>
                    <span>{preset.id.toUpperCase()}</span>
                    <span>{practiceMode ? 'Trace-ready overlay' : 'Auto-build 3D now'}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </Html>
    </>
  )
}
