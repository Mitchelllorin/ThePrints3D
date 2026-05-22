import { useRef, useEffect, useCallback, useState, Suspense } from 'react'
import { Canvas, useThree, useFrame } from '@react-three/fiber'
import { OrbitControls, Grid, Environment, GizmoHelper, GizmoViewport, Text } from '@react-three/drei'
import * as THREE from 'three'
import { useAppStore } from '../../store/useAppStore'
import SampleDrawingGallery from '../Drawings/SampleDrawingGallery'
import Wizard from '../Wizard/Wizard'
import { getWallMemory, setWallFromPreset } from '../../wizard/wallMemory'
import { completeWallsFromFloorplan } from '../../services/aiWallCompletion'
import { saveProject, loadProject as loadProjectFromDB, listProjects } from '../../services/projectStorage'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import SelectionManager from '../Viewer3D/SelectionManager'
import MeasureTool from '../Viewer3D/MeasureTool'
import AnnotationTool from '../Viewer3D/AnnotationTool'
import Toolbar from '../Viewer3D/Toolbar'
import PropertiesPanel from '../Viewer3D/PropertiesPanel'
import CameraHud from '../Viewer3D/CameraHud'
import ProductPlacements from '../Viewer3D/ProductPlacements'
import ProductPlacementPanel from '../Viewer3D/ProductPlacementPanel'
import styles from './Workspace3D.module.css'
import viewerStyles from '../Viewer3D/ModelViewer.module.css'

// ─── Helper components ──────────────────────────────────────────────────────

function SceneSetup() {
  const { scene, camera } = useThree()
  useEffect(() => {
    scene.background = new THREE.Color('#0f172a')
    camera.position.set(15, 12, 15)
    camera.lookAt(0, 0, 0)
  }, [scene, camera])
  return null
}

function CameraPresetApplier({ controlsRef }: { controlsRef: React.RefObject<OrbitControlsImpl | null> }) {
  const { camera } = useThree()
  const preset = useAppStore((s) => s.cameraPreset)
  const consume = useAppStore((s) => s.consumeCameraPreset)

  useEffect(() => {
    if (!preset) return
    camera.position.set(preset.position[0], preset.position[1], preset.position[2])
    if (controlsRef.current) {
      controlsRef.current.target.set(preset.target[0], preset.target[1], preset.target[2])
      controlsRef.current.update()
    }
    consume()
  }, [preset, camera, controlsRef, consume])
  return null
}

// ─── Grid Floor ─────────────────────────────────────────────────────────────

function GridFloor() {
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow>
        <planeGeometry args={[80, 80]} />
        <meshStandardMaterial color="#0f172a" roughness={0.9} />
      </mesh>
      <Grid
        args={[60, 60]}
        cellSize={1}
        cellThickness={0.5}
        cellColor="#1e293b"
        sectionSize={5}
        sectionThickness={1}
        sectionColor="#334155"
        fadeDistance={80}
        position={[0, 0, 0]}
      />
    </group>
  )
}

// ─── Floorplan Projection ───────────────────────────────────────────────────

function FloorplanImage({ url }: { url: string }) {
  const visible = useAppStore((s) => s.floorplan.visible)
  const scale = useAppStore((s) => s.floorplan.scale)
  const rotation = useAppStore((s) => s.floorplan.rotation)
  const offsetX = useAppStore((s) => s.floorplan.offsetX)
  const offsetZ = useAppStore((s) => s.floorplan.offsetZ)
  const opacity = useAppStore((s) => s.floorplan.opacity)
  const [texture, setTexture] = useState<THREE.Texture | null>(null)

  useEffect(() => {
    let cancelled = false
    const loader = new THREE.TextureLoader()
    loader.load(
      url,
      (t) => { if (!cancelled) setTexture(t) },
      undefined,
      () => { if (!cancelled) setTexture(null) },
    )
    return () => { cancelled = true }
  }, [url])

  if (!visible || !texture) return null

  const aspect = (texture.image as HTMLImageElement)?.height / ((texture.image as HTMLImageElement)?.width || 1) || 1

  return (
    <mesh
      rotation={[-Math.PI / 2, 0, rotation]}
      position={[offsetX, 0.001, offsetZ]}
    >
      <planeGeometry args={[10 * scale, 10 * scale * aspect]} />
      <meshBasicMaterial map={texture} transparent opacity={opacity} depthWrite={false} />
    </mesh>
  )
}

// ─── Wall3D Mesh ────────────────────────────────────────────────────────────

const WALL_COLORS: Record<string, string> = {
  structure: '#94a3b8',
  drywall: '#e2e8f0',
  framing: '#d97706',
}

interface WallMeshProps {
  id: string
  start: [number, number, number]
  end: [number, number, number]
  height: number
  thickness: number
  color: string
  layer: string
  selected: boolean
  onClick: (id: string) => void
}

function WallOpeningMesh({ opening, wallLength, wallHeight, thickness }: {
  opening: { type: string; pos: number; width: number; height: number; sillHeight?: number }
  wallLength: number
  wallHeight: number
  thickness: number
}) {
  const midPos = opening.pos * wallLength - wallLength / 2
  const openH = Math.min(opening.height, wallHeight)
  const sill = opening.sillHeight ?? 0
  const openBottom = sill
  const openCenterY = openBottom + openH / 2

  return (
    <group position={[0, 0, midPos]}>
      {/* Door: colored opening indicator */}
      {opening.type === 'door' && (
        <mesh position={[0, openCenterY, 0]}>
          <planeGeometry args={[thickness * 1.1, openH]} />
          <meshBasicMaterial color="#3b82f6" transparent opacity={0.5} side={THREE.DoubleSide} />
        </mesh>
      )}
      {/* Window: glass-like transparent plane with frame */}
      {opening.type === 'window' && (
        <group>
          <mesh position={[0, openCenterY, 0]}>
            <planeGeometry args={[thickness * 1.1, openH]} />
            <meshBasicMaterial color="#7dd3fc" transparent opacity={0.3} side={THREE.DoubleSide} />
          </mesh>
          {/* Window frame outline */}
          <lineSegments position={[0, openCenterY, 0]}>
            <edgesGeometry args={[new THREE.PlaneGeometry(thickness * 1.2, openH + 0.05)]} />
            <lineBasicMaterial color="#94a3b8" />
          </lineSegments>
        </group>
      )}
    </group>
  )
}

function WallMesh({ id, start, end, height, thickness, color, layer, selected, onClick }: WallMeshProps) {
  const ref = useRef<THREE.Mesh>(null)
  const dx = end[0] - start[0]
  const dz = end[2] - start[2]
  const length = Math.sqrt(dx * dx + dz * dz)
  if (length < 0.001) return null
  const angle = Math.atan2(dx, dz)
  const midX = (start[0] + end[0]) / 2
  const midZ = (start[2] + end[2]) / 2
  const wall = useAppStore.getState().walls.find((w) => w.id === id)
  const openings = wall?.openings

  return (
    <mesh
      ref={ref}
      position={[midX, height / 2, midZ]}
      rotation={[0, angle, 0]}
      onClick={(e) => { e.stopPropagation(); onClick(id) }}
      userData={{ wallId: id, layer, editable: true }}
    >
      <boxGeometry args={[thickness, height, length]} />
      <meshStandardMaterial
        color={selected ? '#38bdf8' : (color || WALL_COLORS[layer] || '#94a3b8')}
        transparent
        opacity={selected ? 0.6 : 0.25}
        roughness={0.7}
        metalness={layer === 'framing' ? 0.3 : 0.1}
        depthWrite={false}
      />
      {layer === 'framing' && (
        <lineSegments>
          <edgesGeometry args={[new THREE.BoxGeometry(thickness * 0.95, height * 0.95, length * 0.95)]} />
          <lineBasicMaterial color="#b45309" opacity={0.4} transparent />
        </lineSegments>
      )}
      {/* Render door/window openings */}
      {openings?.map((o) => (
        <WallOpeningMesh
          key={o.id}
          opening={o}
          wallLength={length}
          wallHeight={height}
          thickness={thickness}
        />
      ))}
    </mesh>
  )
}

// ─── 3D Walls Container ─────────────────────────────────────────────────────

function WallsContainer({ onWallClick }: { onWallClick: (id: string) => void }) {
  const walls = useAppStore((s) => s.walls)
  const selectedWallId = useAppStore((s) => s.selectedWallId)
  const tradeLayers = useAppStore((s) => s.tradeLayers)

  const visibleLayers = new Set(tradeLayers.filter((l) => l.visible).map((l) => l.id))

  return (
    <group>
      {walls.map((w) => {
        const wallLayer = w.layer || 'structure'
        if (wallLayer === 'framing' && !visibleLayers.has('studs')) return null
        if (wallLayer === 'drywall' && !visibleLayers.has('drywall')) return null
        if (wallLayer === 'structure' && !visibleLayers.has('studs') && !visibleLayers.has('drywall')) return null
        return (
          <WallMesh
            key={w.id}
            id={w.id}
            start={w.start}
            end={w.end}
            height={w.height}
            thickness={w.thickness}
            color={w.color}
            layer={w.layer}
            selected={w.id === selectedWallId}
            onClick={onWallClick}
          />
        )
      })}
    </group>
  )
}

// ─── Wall Drawing Tool (tracer style ↕) ─────────────────────────────────────

function WallDrawTool() {
  const activeTool = useAppStore((s) => s.activeTool)
  const addWall = useAppStore((s) => s.addWall)
  const drawStart = useAppStore((s) => s.drawStart)
  const setDrawStart = useAppStore((s) => s.setDrawStart)
  const { camera, gl } = useThree()
  const raycaster = useRef(new THREE.Raycaster())
  const pointer = useRef(new THREE.Vector2())
  const plane = useRef(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0))
  const [previewEnd, setPreviewEnd] = useState<[number, number, number] | null>(null)

  const snapAngle = (dx: number, dz: number): number => {
    const dist = Math.sqrt(dx * dx + dz * dz)
    if (dist < 0.3) return 0
    const angle = Math.atan2(dz, dx)
    const snapped = Math.round((angle * 180) / Math.PI / 45) * 45
    return (snapped * Math.PI) / 180
  }

  const getPointOnGround = useCallback((clientX: number, clientY: number): [number, number, number] | null => {
    const rect = gl.domElement.getBoundingClientRect()
    pointer.current.x = ((clientX - rect.left) / rect.width) * 2 - 1
    pointer.current.y = -((clientY - rect.top) / rect.height) * 2 + 1
    raycaster.current.setFromCamera(pointer.current, camera)
    const intersect = new THREE.Vector3()
    raycaster.current.ray.intersectPlane(plane.current, intersect)
    if (!intersect) return null

    let x = intersect.x
    let z = intersect.z

    if (drawStart) {
      const dx = x - drawStart[0]
      const dz = z - drawStart[2]
      const dist = Math.sqrt(dx * dx + dz * dz)
      if (dist > 0.3) {
        const rad = snapAngle(dx, dz)
        x = drawStart[0] + Math.cos(rad) * dist
        z = drawStart[2] + Math.sin(rad) * dist
      }
    }

    return [Math.round(x * 100) / 100, 0, Math.round(z * 100) / 100]
  }, [camera, gl, drawStart])

  const onPointerDown = useCallback((e: any) => {
    if (activeTool !== 'draw-wall') return
    const pt = getPointOnGround(e.clientX ?? e.nativeEvent?.clientX ?? 0, e.clientY ?? e.nativeEvent?.clientY ?? 0)
    if (!pt) return
    if (!drawStart) {
      setDrawStart(pt)
    }
  }, [activeTool, drawStart, setDrawStart, getPointOnGround])

  const onPointerUp = useCallback(() => {
    if (activeTool !== 'draw-wall' || !drawStart || !previewEnd) return
    const dist = Math.sqrt(
      (previewEnd[0] - drawStart[0]) ** 2 + (previewEnd[2] - drawStart[2]) ** 2
    )
    if (dist > 0.3) {
      addWall({
        start: drawStart,
        end: previewEnd,
        height: 2.7,
        thickness: 0.15,
        color: '#94a3b8',
        layer: 'structure',
        type: 'stud',
      })
    }
    setDrawStart(null)
    setPreviewEnd(null)
  }, [activeTool, drawStart, previewEnd, addWall, setDrawStart])

  const onPointerMove = useCallback((e: any) => {
    if (activeTool !== 'draw-wall' || !drawStart) return
    const pt = getPointOnGround(e.clientX ?? e.nativeEvent?.clientX ?? 0, e.clientY ?? e.nativeEvent?.clientY ?? 0)
    if (pt) setPreviewEnd(pt)
  }, [activeTool, drawStart, getPointOnGround])

  useEffect(() => {
    if (activeTool !== 'draw-wall') { setDrawStart(null); setPreviewEnd(null); return }
    const el = gl.domElement
    el.addEventListener('pointerdown', onPointerDown)
    el.addEventListener('pointerup', onPointerUp)
    el.addEventListener('pointermove', onPointerMove)
    return () => {
      el.removeEventListener('pointerdown', onPointerDown)
      el.removeEventListener('pointerup', onPointerUp)
      el.removeEventListener('pointermove', onPointerMove)
    }
  }, [activeTool, onPointerDown, onPointerUp, onPointerMove, gl])

  if (activeTool !== 'draw-wall') return null

  return (
    <group>
      {/* Preview line with arrowhead */}
      {drawStart && previewEnd && (() => {
        const sx = drawStart[0], sz = drawStart[2]
        const ex = previewEnd[0], ez = previewEnd[2]
        const dx = ex - sx, dz = ez - sz
        const dist = Math.sqrt(dx * dx + dz * dz)
        if (dist < 0.05) return null
        const angle = Math.atan2(dz, dx)
        const headLen = 0.3
        return (
          <group>
            <line>
              <bufferGeometry>
                <bufferAttribute
                  attach="attributes-position"
                  args={[new Float32Array([sx, 0.02, sz, ex, 0.02, ez]), 3]}
                />
              </bufferGeometry>
              <lineBasicMaterial color="#f59e0b" linewidth={2} />
            </line>
            <mesh position={[ex, 0.02, ez]} rotation={[0, -angle + Math.PI / 2, 0]}>
              <coneGeometry args={[headLen * 0.5, headLen, 4]} />
              <meshBasicMaterial color="#f59e0b" side={THREE.DoubleSide} />
            </mesh>
            <Text
              position={[(sx + ex) / 2, 0.3, (sz + ez) / 2]}
              fontSize={0.12}
              color="#fbbf24"
              anchorX="center"
              anchorY="middle"
              outlineWidth={0.02}
              outlineColor="#0f172a"
            >
              {`${(dist * 100).toFixed(0)} cm`}
            </Text>
          </group>
        )
      })()}

      {/* Anchor dot with ring */}
      {drawStart && (
        <group>
          <mesh position={[drawStart[0], 0.02, drawStart[2]]}>
            <sphereGeometry args={[0.12, 16, 16]} />
            <meshBasicMaterial color="#38bdf8" />
          </mesh>
          <mesh position={[drawStart[0], 0.02, drawStart[2]]}>
            <ringGeometry args={[0.15, 0.22, 24]} />
            <meshBasicMaterial color="#38bdf8" transparent opacity={0.4} side={THREE.DoubleSide} />
          </mesh>
        </group>
      )}

      {/* Cursor dot at preview end */}
      {previewEnd && (
        <mesh position={[previewEnd[0], 0.02, previewEnd[2]]}>
          <sphereGeometry args={[0.05, 8, 8]} />
          <meshBasicMaterial color="#f59e0b" />
        </mesh>
      )}
    </group>
  )
}

// ─── Floating 3D Wordmark ──────────────────────────────────────────────────

function FloatingWatermark() {
  const meshRef = useRef<THREE.Mesh>(null)
  const watermarkOpacity = useAppStore((s) => s.watermarkOpacity)
  const startTime = useRef(Date.now())

  useFrame((_, _delta) => {
    if (!meshRef.current) return
    const elapsed = (Date.now() - startTime.current) / 1000
    meshRef.current.position.y = 3 + Math.sin(elapsed * 0.3) * 1.5
    meshRef.current.rotation.y = elapsed * 0.15
    meshRef.current.position.x = Math.sin(elapsed * 0.1) * 4
    meshRef.current.position.z = Math.cos(elapsed * 0.12) * 4
  })

  return (
    <Text
      ref={meshRef}
      position={[0, 3, 0]}
      fontSize={1.2}
      color="#38bdf8"
      font={undefined}
      anchorX="center"
      anchorY="middle"
      fillOpacity={watermarkOpacity}
      strokeOpacity={0}
    >
      BluePrint3D
    </Text>
  )
}

// ─── Drawing Overview ───────────────────────────────────────────────────────

function DrawingOverview({ onBackToWorkspace }: { onBackToWorkspace: () => void }) {
  const drawings = useAppStore((s) => s.drawings)
  const selectDrawing = useAppStore((s) => s.selectDrawing)

  const handleSelectDrawing = (id: string) => {
    selectDrawing(id)
    onBackToWorkspace()
  }

  const handleDeleteDrawing = (id: string) => {
    useAppStore.getState().removeDrawing(id)
  }

  return (
    <div className={styles.overviewOverlay}>
      <div className={styles.overviewContainer}>
        <div className={styles.overviewHeader}>
          <h1 className={styles.overviewTitle}>
            <span style={{ color: '#38bdf8' }}>Blue</span>Print3D
          </h1>
          <p className={styles.overviewSubtitle}>Upload or select a drawing to start</p>
        </div>

        <div className={styles.overviewActions}>
          <SampleDrawingGallery />
        </div>

        {drawings.length > 0 && (
          <div className={styles.overviewList}>
            <h3 className={styles.overviewListTitle}>
              Your Drawings ({drawings.length})
            </h3>
            {drawings.map((d) => (
              <div key={d.id} className={styles.overviewItem}>
                <div className={styles.overviewItemInfo}>
                  <span className={styles.overviewItemName}>{d.name}</span>
                  <span className={styles.overviewItemStatus}>{d.status}</span>
                </div>
                <div className={styles.overviewItemActions}>
                  <button className={styles.overviewItemBtn} onClick={() => handleSelectDrawing(d.id)}>
                    Open
                  </button>
                  <button className={styles.overviewItemBtnDanger} onClick={() => handleDeleteDrawing(d.id)}>
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {drawings.length === 0 && (
          <div className={styles.overviewEmpty}>
            <div className={styles.overviewEmptyIcon}>📐</div>
            <p>No drawings loaded yet</p>
            <p className={styles.overviewEmptySub}>
              Use "Sample Drawings" above to try preset floor plans,<br />
              or upload your own from the 3D workspace.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Wall Type Prompt ────────────────────────────────────────────────────────

import type { WallTypePreset } from '../../types'

const WALL_PRESETS: (WallTypePreset & { thickness: number })[] = [
  { id: 'stud-2x4',    label: 'Stud 2x4',      description: 'Standard 2x4 stud wall',   category: 'stud',  thicknessMm: 90,  thickness: 0.09, color: '#94a3b8', defaultLoadBearing: true,  defaultInternal: false },
  { id: 'stud-2x6',    label: 'Stud 2x6',      description: 'Wider 2x6 stud wall',      category: 'stud',  thicknessMm: 140, thickness: 0.14, color: '#94a3b8', defaultLoadBearing: true,  defaultInternal: false },
  { id: 'drywall',     label: 'Drywall',       description: 'Non-structural partition', category: 'other', thicknessMm: 12.5,thickness: 0.125,color: '#e2e8f0', defaultLoadBearing: false, defaultInternal: true },
  { id: 'block',       label: 'Concrete Block',description: 'Masonry block wall',        category: 'block', thicknessMm: 200, thickness: 0.20, color: '#a78bfa', defaultLoadBearing: true,  defaultInternal: false },
  { id: 'custom',      label: 'Custom',        description: 'User-defined dimensions',  category: 'other', thicknessMm: 100, thickness: 0.10, color: '#fbbf24', defaultLoadBearing: false, defaultInternal: true },
]

function WallTypePrompt() {
  const wallId = useAppStore((s) => s.wallTypePromptWallId)
  const updateWall = useAppStore((s) => s.updateWall)
  const setWallTypePromptWallId = useAppStore((s) => s.setWallTypePromptWallId)
  const memory = getWallMemory()
  const [selected, setSelected] = useState(memory.presetId)

  if (!wallId) return null

  const handleConfirm = () => {
    const preset = WALL_PRESETS.find((p) => p.id === selected)
    if (preset) {
      updateWall(wallId, {
        thickness: preset.thickness,
        color: preset.color,
      })
      setWallFromPreset(preset, false, true)
    }
    setWallTypePromptWallId(null)
  }

  const handleDismiss = () => {
    setWallTypePromptWallId(null)
  }

  return (
    <div className={styles.wallTypeOverlay} onClick={handleDismiss}>
      <div className={styles.wallTypePrompt} onClick={(e) => e.stopPropagation()}>
        <div className={styles.wallTypeHeader}>
          <span>Wall Type</span>
          <button className={styles.panelClose} onClick={handleDismiss}>✕</button>
        </div>
        <div className={styles.wallTypeBody}>
          {WALL_PRESETS.map((p) => (
            <button
              key={p.id}
              className={`${styles.wallTypeBtn} ${selected === p.id ? styles.wallTypeBtnActive : ''}`}
              onClick={() => setSelected(p.id)}
            >
              <span className={styles.wallTypeDot} style={{ background: p.color }} />
              <span className={styles.wallTypeLabel}>{p.label}</span>
              <span className={styles.wallTypeDim}>{p.thicknessMm}mm</span>
              {p.id === memory.presetId && <span className={styles.wallTypeBadge}>last</span>}
            </button>
          ))}
        </div>
        <div className={styles.wallTypeActions}>
          <button className={styles.wallTypeSkip} onClick={handleDismiss}>Skip</button>
          <button className={styles.wallTypeConfirm} onClick={handleConfirm}>Apply</button>
        </div>
      </div>
    </div>
  )
}

// ─── 3D Calibration Tool (inside Canvas) ─────────────────────────────────────

function CalibrationTool3D() {
  const pendingId = useAppStore((s) => s.calibrationPendingDrawingId)
  const ptA = useAppStore((s) => s.calibrationPtA)
  const ptB = useAppStore((s) => s.calibrationPtB)
  const setPtA = useAppStore((s) => s.setCalibrationPtA)
  const setPtB = useAppStore((s) => s.setCalibrationPtB)
  const { camera, gl } = useThree()
  const raycaster = useRef(new THREE.Raycaster())
  const pointer = useRef(new THREE.Vector2())
  const plane = useRef(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0))
  const [hover, setHover] = useState<[number, number, number] | null>(null)

  if (!pendingId) return null

  const getPoint = (clientX: number, clientY: number): [number, number, number] | null => {
    const rect = gl.domElement.getBoundingClientRect()
    pointer.current.x = ((clientX - rect.left) / rect.width) * 2 - 1
    pointer.current.y = -((clientY - rect.top) / rect.height) * 2 + 1
    raycaster.current.setFromCamera(pointer.current, camera)
    const intersect = new THREE.Vector3()
    raycaster.current.ray.intersectPlane(plane.current, intersect)
    if (!intersect) return null
    return [Math.round(intersect.x * 100) / 100, 0, Math.round(intersect.z * 100) / 100]
  }

  const onClick = useCallback((e: any) => {
    if (!pendingId) return
    const pt = getPoint(e.clientX ?? e.nativeEvent?.clientX ?? 0, e.clientY ?? e.nativeEvent?.clientY ?? 0)
    if (!pt) return
    if (!ptA) { setPtA(pt); setHover(null); return }
    if (ptA && !ptB) { setPtB(pt); setHover(null) }
  }, [pendingId, ptA, ptB, setPtA, setPtB])

  const onMove = useCallback((e: any) => {
    if (!pendingId || !ptA || ptB) return
    const pt = getPoint(e.clientX ?? e.nativeEvent?.clientX ?? 0, e.clientY ?? e.nativeEvent?.clientY ?? 0)
    if (pt) setHover(pt)
  }, [pendingId, ptA, ptB])

  useEffect(() => {
    if (!pendingId) { setPtA(null); setPtB(null); setHover(null); return }
    const el = gl.domElement
    el.addEventListener('pointerdown', onClick)
    el.addEventListener('pointermove', onMove)
    return () => { el.removeEventListener('pointerdown', onClick); el.removeEventListener('pointermove', onMove) }
  }, [pendingId, onClick, onMove, gl, setPtA, setPtB])

  return (
    <group>
      {ptA && (hover || ptB) && (() => {
        const end = ptB || hover!
        const dx = end[0] - ptA[0], dz = end[2] - ptA[2]
        const dist = Math.sqrt(dx * dx + dz * dz)
        if (dist < 0.01) return null
        return (
          <line>
            <bufferGeometry>
              <bufferAttribute
                attach="attributes-position"
                args={[new Float32Array([ptA[0], 0.02, ptA[2], end[0], 0.02, end[2]]), 3]}
              />
            </bufferGeometry>
            <lineBasicMaterial color="#f59e0b" linewidth={2} />
          </line>
        )
      })()}
      {ptA && (
        <group>
          <mesh position={[ptA[0], 0.02, ptA[2]]}>
            <sphereGeometry args={[0.12, 16, 16]} /><meshBasicMaterial color="#38bdf8" />
          </mesh>
          <mesh position={[ptA[0], 0.02, ptA[2]]}>
            <ringGeometry args={[0.15, 0.25, 24]} /><meshBasicMaterial color="#38bdf8" transparent opacity={0.5} side={THREE.DoubleSide} />
          </mesh>
          <Text position={[ptA[0] + 0.2, 0.15, ptA[2]]} fontSize={0.15} color="#38bdf8" anchorX="left" anchorY="middle">A</Text>
        </group>
      )}
      {ptB && (
        <group>
          <mesh position={[ptB[0], 0.02, ptB[2]]}>
            <sphereGeometry args={[0.12, 16, 16]} /><meshBasicMaterial color="#f59e0b" />
          </mesh>
          <mesh position={[ptB[0], 0.02, ptB[2]]}>
            <ringGeometry args={[0.15, 0.25, 24]} /><meshBasicMaterial color="#f59e0b" transparent opacity={0.5} side={THREE.DoubleSide} />
          </mesh>
          <Text position={[ptB[0] + 0.2, 0.15, ptB[2]]} fontSize={0.15} color="#f59e0b" anchorX="left" anchorY="middle">B</Text>
        </group>
      )}
      {!ptA && !ptB && hover && (
        <mesh position={[hover[0], 0.02, hover[2]]}>
          <sphereGeometry args={[0.06, 8, 8]} /><meshBasicMaterial color="#38bdf8" transparent opacity={0.6} />
        </mesh>
      )}
    </group>
  )
}

// ─── Scale Calibration Overlay (HTML distance input) ────────────────────────

function ScaleCalibrationOverlay() {
  const drawingId = useAppStore((s) => s.calibrationPendingDrawingId)
  const ptA = useAppStore((s) => s.calibrationPtA)
  const ptB = useAppStore((s) => s.calibrationPtB)
  const floorplan = useAppStore((s) => s.floorplan)
  const drawings = useAppStore((s) => s.drawings)
  const setDrawingScale = useAppStore((s) => s.setDrawingScale)
  const setCalibrationPendingDrawingId = useAppStore((s) => s.setCalibrationPendingDrawingId)
  const clearCalibrationPoints = useAppStore((s) => s.clearCalibrationPoints)
  const [distance, setDistance] = useState('')
  const [unit, setUnit] = useState<'mm' | 'm'>('mm')

  if (!drawingId) return null

  if (!ptA || !ptB) {
    return (
      <div className={styles.calibrationHint}>
        <span className={styles.calibrationHintIcon}>📐</span>
        <div>
          <div className={styles.calibrationHintTitle}>
            Calibration — pick two points of known distance
          </div>
          <div className={styles.calibrationHintSub}>
            {!ptA
              ? 'Step 1: Left-click point A on the floorplan (e.g. start of a wall)'
              : 'Step 2: Left-click point B (e.g. end of the same wall)'}
          </div>
          <div className={styles.calibrationHintSub}>
            Right-click + drag to orbit · Scroll to zoom · Middle-click to pan
          </div>
        </div>
      </div>
    )
  }

  const dx = ptB[0] - ptA[0], dz = ptB[2] - ptA[2]
  const worldDist = Math.sqrt(dx * dx + dz * dz)

  const handleConfirm = () => {
    try {
      const val = parseFloat(distance)
      if (isNaN(val) || val <= 0) { alert('Enter a valid distance'); return }
      const realDistMm = unit === 'm' ? val * 1000 : val
      const drawing = drawings.find((d) => d.id === drawingId)
      const imgW = drawing?.rasterWidth ?? 1200
      const imgH = drawing?.rasterHeight ?? 800
      if (!imgW || !imgH) return
      const scale3d = floorplan.scale || 1
      const aspect = imgH / imgW
      const halfW = 5 * scale3d
      const halfH = 5 * scale3d * aspect
      const pxA = ((ptA[0] - floorplan.offsetX) / halfW + 1) / 2 * imgW
      const pyA = (-(ptA[2] - floorplan.offsetZ) / halfH + 1) / 2 * imgH
      const pxB = ((ptB[0] - floorplan.offsetX) / halfW + 1) / 2 * imgW
      const pyB = (-(ptB[2] - floorplan.offsetZ) / halfH + 1) / 2 * imgH
      const pixelDist = Math.sqrt((pxB - pxA) ** 2 + (pyB - pyA) ** 2)
      if (pixelDist < 1) { alert('Points too close — pick a longer distance'); return }
      const mmPerPx = realDistMm / pixelDist
      setDrawingScale(drawingId, mmPerPx, `${val} ${unit}`, 'parsed')
      setCalibrationPendingDrawingId(null)
      clearCalibrationPoints()
    } catch (err) {
      console.error('Calibration error:', err)
      alert('Calibration failed: ' + (err as Error).message)
    }
  }

  return (
    <div className={styles.modalOverlay}>
      <div className={styles.calibrationDialog}>
        <div className={styles.wallTypeHeader}>
          <span>📐 Calibrate Scale</span>
          <button className={styles.panelClose} onClick={() => { setCalibrationPendingDrawingId(null); clearCalibrationPoints() }}>✕</button>
        </div>
        <div className={styles.calibrationBody}>
          <p style={{ fontSize: 12, color: '#94a3b8', margin: '4px 0' }}>
            Points A→B 3D distance: <strong style={{ color: '#fbbf24' }}>{worldDist.toFixed(2)} m</strong>
          </p>
          <p style={{ fontSize: 12, color: '#94a3b8', margin: '8px 0' }}>
            What is the real-world distance between your two points?
          </p>
          <div className={styles.calibrationInputRow}>
            <input className={styles.calibrationInput} type="number" step="any" min="0.001"
              placeholder="e.g. 3600" value={distance}
              onChange={(e) => setDistance(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleConfirm()} autoFocus />
            <select className={styles.calibrationSelect} value={unit}
              onChange={(e) => setUnit(e.target.value as 'mm' | 'm')}>
              <option value="mm">mm</option>
              <option value="m">m</option>
            </select>
          </div>
        </div>
        <div className={styles.wallTypeActions}>
          <button className={styles.wallTypeSkip} onClick={() => { setCalibrationPendingDrawingId(null); clearCalibrationPoints() }}>Skip</button>
          <button className={styles.wallTypeConfirm} onClick={handleConfirm}
            disabled={!distance || isNaN(parseFloat(distance)) || parseFloat(distance) <= 0}>
            ✓ Apply Scale
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Placement Handler ──────────────────────────────────────────────────────

function PlacementHandler() {
  const activeTool = useAppStore((s) => s.activeTool)
  const addOpening = useAppStore((s) => s.addOpening)
  const addComponent = useAppStore((s) => s.addComponent)
  const setActiveTool = useAppStore((s) => s.setActiveTool)
  const { camera, pointer, scene } = useThree()
  const raycaster = useRef(new THREE.Raycaster())

  useFrame(() => {
    if (activeTool !== 'place-door' && activeTool !== 'place-window' && activeTool !== 'place-component') return
    document.body.style.cursor = 'crosshair'
  })

  useEffect(() => {
    const handler = (_e: MouseEvent) => {
      if (activeTool !== 'place-door' && activeTool !== 'place-window' && activeTool !== 'place-component') return

      raycaster.current.setFromCamera(pointer, camera)
      const meshes: THREE.Object3D[] = []
      scene.traverse((child) => {
        if (child instanceof THREE.Mesh && child.userData?.editable) meshes.push(child)
      })
      const hits = raycaster.current.intersectObjects(meshes)

      if (activeTool === 'place-door' || activeTool === 'place-window') {
        const wallHit = hits.length > 0 ? hits[0] : null
        if (wallHit && wallHit.object.userData?.wallId) {
          const wallId = wallHit.object.userData.wallId as string
          const local = wallHit.object.worldToLocal(new THREE.Vector3(wallHit.point.x, wallHit.point.y, wallHit.point.z))
          const box = new THREE.Box3().setFromObject(wallHit.object)
          const size = box.getSize(new THREE.Vector3())
          const pos = (local.z / size.z + 0.5)
          addOpening(wallId, {
            type: activeTool === 'place-door' ? 'door' : 'window',
            pos: Math.max(0, Math.min(1, pos)),
            width: activeTool === 'place-door' ? 0.9 : 1.2,
            height: activeTool === 'place-door' ? 2.1 : 1.0,
            sillHeight: activeTool === 'place-door' ? 0 : 0.9,
          })
          setActiveTool('select')
        }
      } else if (activeTool === 'place-component') {
        const groundHits = raycaster.current.intersectObject(scene.getObjectByName('floorGrid') ?? scene)
        if (groundHits && groundHits.length > 0) {
          const gh = groundHits[0]
          addComponent({
            type: 'furniture',
            label: 'Object',
            position: [gh.point.x, 0, gh.point.z] as [number, number, number],
            rotation: 0,
            scale: [1, 1, 1] as [number, number, number],
            color: '#94a3b8',
          })
          setActiveTool('select')
        }
      }
    }
    // Canvas element listener
    const canvas = scene.parent?.parent?.parent
    if (canvas instanceof HTMLCanvasElement) {
      canvas.addEventListener('click', handler)
      return () => canvas.removeEventListener('click', handler)
    }
  }, [activeTool, camera, pointer, scene, addOpening, addComponent, setActiveTool])

  return null
}

// ─── Annotation creation form (from ModelViewer) ───────────────────────────

const FORM_COLORS = ['#f87171','#fb923c','#facc15','#4ade80','#38bdf8','#818cf8','#e879f9','#f1f5f9']
const FORM_ICONS  = ['📌','⚠️','💡','❓','✅','🔧','📏','🔴','⭐','🏷️','💬','🚩']

interface FormState {
  position3D: [number, number, number]
  screenX: number
  screenY: number
}

interface AnnotationFormProps {
  form: FormState
  onSubmit: (text: string, icon: string, color: string) => void
  onCancel: () => void
}

function AnnotationForm({ form, onSubmit, onCancel }: AnnotationFormProps) {
  const [text, setText]   = useState('')
  const [icon, setIcon]   = useState('📌')
  const [color, setColor] = useState('#38bdf8')

  const margin = 16
  const popW = 260, popH = 260
  const left = Math.min(form.screenX + 12, window.innerWidth  - popW - margin)
  const top  = Math.min(form.screenY + 12, window.innerHeight - popH - margin)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = text.trim()
    if (!trimmed) return
    onSubmit(trimmed, icon, color)
  }

  return (
    <div
      className={viewerStyles.annotationForm}
      style={{ left, top }}
      onClick={(e) => e.stopPropagation()}
    >
      <form onSubmit={handleSubmit}>
        <textarea
          className={viewerStyles.formTextarea}
          value={text}
          autoFocus
          placeholder="Add a note…"
          rows={2}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(e as unknown as React.FormEvent) }
            if (e.key === 'Escape') onCancel()
          }}
        />

        <div className={viewerStyles.formPickerRow}>
          {FORM_ICONS.map((ic) => (
            <button
              key={ic}
              type="button"
              className={`${viewerStyles.formIconBtn} ${icon === ic ? viewerStyles.formBtnActive : ''}`}
              onClick={() => setIcon(ic)}
              title={ic}
            >
              {ic}
            </button>
          ))}
        </div>

        <div className={viewerStyles.formPickerRow}>
          {FORM_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className={`${viewerStyles.formColorBtn} ${color === c ? viewerStyles.formBtnActive : ''}`}
              style={{ background: c }}
              onClick={() => setColor(c)}
              title={c}
            />
          ))}
        </div>

        <div className={viewerStyles.formButtons}>
          <button type="submit" className={viewerStyles.formSubmit} disabled={!text.trim()}>
            📌 Add Pin
          </button>
          <button type="button" className={viewerStyles.formCancel} onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  )
}

// ─── Main Component ─────────────────────────────────────────────────────────

export default function Workspace3D() {
  const activeTool = useAppStore((s) => s.activeTool)
  const setActiveTool = useAppStore((s) => s.setActiveTool)
  const modalOpen = useAppStore((s) => s.modalOpen)
  const setModalOpen = useAppStore((s) => s.setModalOpen)
  const setCurrentMode = useAppStore((s) => s.setCurrentMode)
  const setActivePanel = useAppStore((s) => s.setActivePanel)
  const sidebarOpen = useAppStore((s) => s.sidebarOpen)
  const setSidebarOpen = useAppStore((s) => s.setSidebarOpen)
  const settingsOpen = useAppStore((s) => s.settingsOpen)
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen)
  const watermarkOpacity = useAppStore((s) => s.watermarkOpacity)
  const setWatermarkOpacity = useAppStore((s) => s.setWatermarkOpacity)
  const walls = useAppStore((s) => s.walls)
  const drawings = useAppStore((s) => s.drawings)
  const selectedWallId = useAppStore((s) => s.selectedWallId)
  const setSelectedWallId = useAppStore((s) => s.setSelectedWallId)
  const updateWall = useAppStore((s) => s.updateWall)
  const removeWall = useAppStore((s) => s.removeWall)
  const tradeLayers = useAppStore((s) => s.tradeLayers)
  const toggleTradeLayer = useAppStore((s) => s.toggleTradeLayer)
  const floorplan = useAppStore((s) => s.floorplan)
  const setFloorplanImage = useAppStore((s) => s.setFloorplanImage)
  const setFloorplanVisible = useAppStore((s) => s.setFloorplanVisible)
  const setFloorplanScale = useAppStore((s) => s.setFloorplanScale)
  const setFloorplanRotation = useAppStore((s) => s.setFloorplanRotation)
  const wizardOpen = useAppStore((s) => s.wizardOpen)
  const setWizardOpen = useAppStore((s) => s.setWizardOpen)
  const model = useAppStore((s) => s.model)
  const setModelStatus = useAppStore((s) => s.setModelStatus)
  const calibrationPendingDrawingId = useAppStore((s) => s.calibrationPendingDrawingId)
  const controlsRef = useRef<OrbitControlsImpl | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [showDrawings, setShowDrawings] = useState(drawings.length === 0)
  const [showGallery, setShowGallery] = useState(false)

  // Dynamically adjust OrbitControls mouse buttons by tool mode
  useEffect(() => {
    const c = controlsRef.current as any
    if (!c) return
    const leftDisabled = activeTool !== 'select' || !!calibrationPendingDrawingId
    c.mouseButtons = {
      LEFT: leftDisabled ? null : THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.PAN,
    }
    c.touches = {
      ONE: leftDisabled ? THREE.TOUCH.PAN : THREE.TOUCH.ROTATE,
      TWO: THREE.TOUCH.DOLLY_PAN,
    }
  }, [activeTool, calibrationPendingDrawingId])

  const selectedWall = walls.find((w) => w.id === selectedWallId)
  const drawStart = useAppStore((s) => s.drawStart)
  const undo = useAppStore((s) => s.undo)
  const redo = useAppStore((s) => s.redo)
  const undoStack = useAppStore((s) => s.undoStack)
  const redoStack = useAppStore((s) => s.redoStack)
  const measureMode = useAppStore((s) => s.measureMode)
  const annotateMode = useAppStore((s) => s.annotateMode)
  const addAnnotation = useAppStore((s) => s.addAnnotation)

  const [pendingForm, setPendingForm] = useState<{
    position3D: [number, number, number]
    screenX: number
    screenY: number
  } | null>(null)

  const handlePlaceRequest = (position: [number, number, number], screenX: number, screenY: number) => {
    setPendingForm({ position3D: position, screenX, screenY })
  }

  const handleFormSubmit = (text: string, icon: string, color: string) => {
    if (!pendingForm) return
    addAnnotation({ text, icon, color, position: pendingForm.position3D })
    setPendingForm(null)
  }

  useEffect(() => {
    if (drawings.length === 0) {
      setShowDrawings(true)
    }
  }, [drawings.length])

  const handleGoToWorkspace = () => setShowDrawings(false)

  const handleGoToDrawings = () => setShowDrawings(true)

  // ─── Wall click handler ─────────────────────────────────
  const onWallClick = useCallback((id: string) => {
    setSelectedWallId(id)
    setActiveTool('select')
  }, [setSelectedWallId, setActiveTool])

  // ─── Canvas miss handler ────────────────────────────────
  const onPointerMissed = useCallback(() => {
    if (activeTool !== 'draw-wall') {
      setSelectedWallId(null)
    }
  }, [activeTool, setSelectedWallId])

  // ─── Keyboard shortcuts ─────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (modalOpen) { setModalOpen(null); return }
        if (wizardOpen) { setWizardOpen(false); return }
        // Cancel in-progress wall draw first
        const s = useAppStore.getState()
        if (s.drawStart) { s.setDrawStart(null); return }
        if (activeTool !== 'select') { setActiveTool('select'); setCurrentMode('idle'); return }
        setSelectedWallId(null)
        setActivePanel(null)
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedWallId && !modalOpen) { removeWall(selectedWallId); setSelectedWallId(null) }
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === 'z' || e.key === 'Z') && !e.shiftKey) {
        e.preventDefault(); undo()
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault(); redo()
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === 'y' || e.key === 'Y') && !e.shiftKey) {
        e.preventDefault(); redo()
      }
      if (e.key === 'w' && !modalOpen) {
        setActiveTool(activeTool === 'draw-wall' ? 'select' : 'draw-wall')
        setCurrentMode(activeTool === 'draw-wall' ? 'idle' : 'tool-draw-wall')
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [modalOpen, wizardOpen, activeTool, selectedWallId, walls, setActiveTool, setCurrentMode, setWizardOpen, setModalOpen, setSelectedWallId, setActivePanel, removeWall, undo, redo])

  // ─── Floorplan import ───────────────────────────────────
  const handleFloorplanImport = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const url = URL.createObjectURL(file)
    setFloorplanImage(url)
  }, [setFloorplanImage])

  // ─── Save / Load ─────────────────────────────────────────
  const [projectName] = useState('')

  const saveCurrentProject = useCallback(async () => {
    const name = projectName || `Project ${new Date().toLocaleDateString()}`
    const project: import('../../services/projectStorage').SavedProject = {
      id: `proj_${Date.now()}`,
      name,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      drawings: [],
      layers: [],
      measurements: [],
      model: { status: 'ready', floorLevels: [], boundingBox: { width: 10, depth: 10, height: 3 }, scale: 1, generatedAt: Date.now() },
    }
    try {
      await saveProject(project)
      alert('Project saved!')
    } catch {
      alert('Failed to save project')
    }
  }, [projectName])

  const loadCurrentProject = useCallback(async () => {
    const list = await listProjects()
    if (list.length === 0) { alert('No saved projects'); return }
    if (list.length === 1) {
      const loaded = await loadProjectFromDB(list[0].id)
      if (loaded) {
        alert(`Loaded project: ${loaded.name} (${loaded.drawings.length} drawings)`)
      }
      return
    }
    const result = window.prompt(`Load project? Type the number:\n${list.map((p, i) => `${i + 1}. ${p.name}`).join('\n')}`)
    if (result) {
      const idx = parseInt(result) - 1
      if (idx >= 0 && idx < list.length) {
        const loaded = await loadProjectFromDB(list[idx].id)
        if (loaded) {
          alert(`Loaded project: ${loaded.name} (${loaded.drawings.length} drawings)`)
        }
      }
    }
  }, [])

  // ─── UI actions ─────────────────────────────────────────
  const handleBack = useCallback(() => {
    if (modalOpen) { setModalOpen(null); return }
    if (wizardOpen) { setWizardOpen(false); return }
    if (activeTool !== 'select') { setActiveTool('select'); setCurrentMode('idle'); return }
    setSelectedWallId(null)
    setActivePanel(null)
  }, [modalOpen, wizardOpen, activeTool, setActiveTool, setCurrentMode, setWizardOpen, setModalOpen, setSelectedWallId, setActivePanel])

  const tools = [
    { id: 'select' as const, icon: '⬆', label: 'Select' },
    { id: 'draw-wall' as const, icon: '📏', label: 'Draw Wall' },
    { id: 'place-door' as const, icon: '🚪', label: 'Place Door' },
    { id: 'place-window' as const, icon: '🪟', label: 'Place Window' },
    { id: 'place-component' as const, icon: '📦', label: 'Place Object' },
    { id: 'annotate' as const, icon: '📝', label: 'Annotate' },
    { id: 'measure' as const, icon: '📐', label: 'Measure' },
  ]

  // ─── Tool hints ─────────────────────────────────────────
  const toolHint = activeTool === 'draw-wall' ? 'Click to start wall, drag to extend, release to place'
    : activeTool === 'place-door' ? 'Click a wall to add a door opening'
    : activeTool === 'place-window' ? 'Click a wall to add a window opening'
    : activeTool === 'place-component' ? 'Click on the ground to place an object'
    : activeTool === 'annotate' ? 'Click on any surface to place an annotation'
    : activeTool === 'measure' ? 'Click two points to measure distance'
    : activeTool === 'select' && selectedWallId ? 'Wall selected — adjust properties or press Delete'
    : 'W: Draw wall  |  Click to select  |  Orbit: drag'

  const inTool = activeTool !== 'select'

  // ─── Drawing Overview Screen ────────────────────────────

  if (showDrawings) {
    return <DrawingOverview onBackToWorkspace={handleGoToWorkspace} />
  }

  // ─── 3D Workspace ───────────────────────────────────────

  return (
    <div className={styles.workspace}>
      <div className={styles.canvasArea}>
        {/* Top bar */}
        <div className={styles.topBar}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button className={styles.backBtn} onClick={handleGoToDrawings}>
              ← Drawings
            </button>
            <div className={styles.brand}>
              <span style={{ color: '#38bdf8' }}>Blue</span>Print3D
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className={styles.backBtn} onClick={() => setShowGallery(true)} title="Load a sample drawing">
              📋 Samples
            </button>
            <button className={styles.backBtn} onClick={() => setWizardOpen(!wizardOpen)} title="Building wizard">
              🧙 {wizardOpen ? 'Hide Wizard' : 'Wizard'}
            </button>
            <button className={styles.backBtn} onClick={() => setSettingsOpen(!settingsOpen)}>
              ⚙ {settingsOpen ? 'Hide' : 'Settings'}
            </button>
            <button className={styles.backBtn} onClick={() => setSidebarOpen(!sidebarOpen)}>
              {sidebarOpen ? '▶' : '◀'} Layers
            </button>
          </div>
        </div>

        {/* Toolbar (left) */}
        <div className={styles.toolbar}>
          {tools.map((tool) => (
            <button
              key={tool.id}
              className={`${styles.toolBtn} ${activeTool === tool.id ? styles.toolBtnActive : ''}`}
              onClick={() => {
                setActiveTool(activeTool === tool.id ? 'select' : tool.id)
                setCurrentMode(activeTool === tool.id ? 'idle' : `tool-${tool.id}`)
              }}
              title={tool.label}
            >
              {tool.icon}
              <span className={styles.toolLabel}>{tool.label}</span>
            </button>
          ))}
        </div>

        {/* Right panels */}
        {sidebarOpen && (
          <div className={styles.rightPanel}>
            {/* Trade Layers */}
            <div className={styles.panel}>
              <div className={styles.panelHeader}>
                Trade Layers
                <button className={styles.panelClose} onClick={() => setSidebarOpen(false)}>✕</button>
              </div>
              <div className={styles.panelBody}>
                {tradeLayers.map((layer) => (
                  <div key={layer.id}>
                    <div className={styles.layerItem}>
                      <div className={styles.layerDot} style={{ background: layer.color }} />
                      <span className={styles.layerLabel}>{layer.label}</span>
                      <button className={styles.layerLockBtn}
                        onClick={(e) => { e.stopPropagation(); useAppStore.getState().toggleTradeLayerLock(layer.id) }}
                        title={layer.locked ? 'Unlock' : 'Lock'}>
                        {layer.locked ? '🔒' : '🔓'}
                      </button>
                      <button
                        className={`${styles.layerToggle} ${layer.visible ? styles.toggleOn : styles.toggleOff}`}
                        onClick={(e) => { e.stopPropagation(); toggleTradeLayer(layer.id) }}
                      />
                    </div>
                    <div className={styles.layerOpacityRow}>
                      <input type="range" min={0} max={1} step={0.05}
                        value={layer.opacity}
                        onChange={(e) => useAppStore.getState().setTradeLayerOpacity(layer.id, parseFloat(e.target.value))}
                        className={styles.layerOpacitySlider} />
                      <span className={styles.layerOpacityVal}>{Math.round(layer.opacity * 100)}%</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Floorplan */}
            <div className={styles.panel}>
              <div className={styles.panelHeader}>
                Floorplan
                <button className={styles.panelClose} onClick={() => setSidebarOpen(false)}>✕</button>
              </div>
              <div className={styles.floorplanPanel}>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,application/pdf"
                  style={{ display: 'none' }}
                  onChange={handleFloorplanImport}
                />
                {!floorplan.imageUrl ? (
                  <button className={styles.floorplanImportBtn} onClick={() => fileInputRef.current?.click()}>
                    + Import Floorplan
                  </button>
                ) : (
                  <>
                    <div className={styles.floorplanRow}>
                      <label>Visible</label>
                      <button
                        className={`${styles.layerToggle} ${floorplan.visible ? styles.toggleOn : styles.toggleOff}`}
                        onClick={() => setFloorplanVisible(!floorplan.visible)}
                      />
                    </div>
                    <div className={styles.floorplanRow}>
                      <label>Opacity</label>
                      <input type="range" min={0} max={1} step={0.05} value={floorplan.opacity}
                        onChange={(e) => useAppStore.getState().setFloorplanOpacity(parseFloat(e.target.value))} />
                      <span>{Math.round(floorplan.opacity * 100)}%</span>
                    </div>
                    <div className={styles.floorplanRow}>
                      <label>Scale</label>
                      <input type="range" min={0.2} max={5} step={0.1} value={floorplan.scale}
                        onChange={(e) => setFloorplanScale(parseFloat(e.target.value))} />
                      <span>{floorplan.scale.toFixed(1)}x</span>
                    </div>
                    <div className={styles.floorplanRow}>
                      <label>Rotate</label>
                      <input type="range" min={-Math.PI} max={Math.PI} step={0.05} value={floorplan.rotation}
                        onChange={(e) => setFloorplanRotation(parseFloat(e.target.value))} />
                    </div>
                    <button className={styles.floorplanImportBtn} onClick={() => fileInputRef.current?.click()}>
                      Replace Image
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Settings panel */}
            {settingsOpen && (
              <div className={styles.panel}>
                <div className={styles.panelHeader}>
                  Settings
                  <button className={styles.panelClose} onClick={() => setSettingsOpen(false)}>✕</button>
                </div>
                <div className={styles.floorplanPanel}>
                  <div className={styles.floorplanRow}>
                    <label>Watermark</label>
                    <input type="range" min={0} max={1} step={0.01} value={watermarkOpacity}
                      onChange={(e) => setWatermarkOpacity(parseFloat(e.target.value))} />
                    <span>{Math.round(watermarkOpacity * 100)}%</span>
                  </div>
                  <div className={styles.floorplanRow}>
                    <label>Walls</label>
                    <span>{walls.length}</span>
                  </div>
                  <div className={styles.floorplanRow}>
                    <label>Model Status</label>
                    <span>{model.status}</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
                    <button className={styles.floorplanImportBtn} onClick={() => { completeWallsFromFloorplan(); setModelStatus('ready') }}>
                      🤖 AI Complete Walls
                    </button>
                    <button className={styles.floorplanImportBtn} onClick={() => { saveCurrentProject(); }}>
                      💾 Save Project
                    </button>
                    <button className={styles.floorplanImportBtn} onClick={() => { loadCurrentProject(); }}>
                      📂 Load Project
                    </button>
                    <button className={styles.floorplanImportBtn} onClick={() => { setModelStatus('ready') }}>
                      Mark Model Ready
                    </button>
                    <button className={styles.floorplanImportBtn} onClick={() => { setWizardOpen(true) }}>
                      Open Wizard
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Properties panel */}
            {selectedWall && (
              <div className={styles.panel}>
                <div className={styles.panelHeader}>
                  Wall Properties
                  <button className={styles.panelClose} onClick={() => setSelectedWallId(null)}>✕</button>
                </div>
                <div className={styles.propPanel}>
                  <div className={styles.propRow}>
                    <label>Start X</label>
                    <input type="number" value={selectedWall.start[0]} step={0.1}
                      onChange={(e) => updateWall(selectedWall.id, { start: [parseFloat(e.target.value) || 0, 0, selectedWall.start[2]] as [number,number,number] })} />
                  </div>
                  <div className={styles.propRow}>
                    <label>Start Z</label>
                    <input type="number" value={selectedWall.start[2]} step={0.1}
                      onChange={(e) => updateWall(selectedWall.id, { start: [selectedWall.start[0], 0, parseFloat(e.target.value) || 0] as [number,number,number] })} />
                  </div>
                  <div className={styles.propRow}>
                    <label>End X</label>
                    <input type="number" value={selectedWall.end[0]} step={0.1}
                      onChange={(e) => updateWall(selectedWall.id, { end: [parseFloat(e.target.value) || 0, 0, selectedWall.end[2]] as [number,number,number] })} />
                  </div>
                  <div className={styles.propRow}>
                    <label>End Z</label>
                    <input type="number" value={selectedWall.end[2]} step={0.1}
                      onChange={(e) => updateWall(selectedWall.id, { end: [selectedWall.end[0], 0, parseFloat(e.target.value) || 0] as [number,number,number] })} />
                  </div>
                  <div className={styles.propRow}>
                    <label>Height</label>
                    <input type="number" value={selectedWall.height} step={0.1} min={0.1} max={10}
                      onChange={(e) => updateWall(selectedWall.id, { height: parseFloat(e.target.value) || 2.7 })} />
                  </div>
                  <div className={styles.propRow}>
                    <label>Thickness</label>
                    <input type="number" value={selectedWall.thickness} step={0.01} min={0.01} max={2}
                      onChange={(e) => updateWall(selectedWall.id, { thickness: parseFloat(e.target.value) || 0.15 })} />
                  </div>
                  <div className={styles.propRow}>
                    <label>Layer</label>
                    <select value={selectedWall.layer} onChange={(e) => updateWall(selectedWall.id, { layer: e.target.value as any })}>
                      <option value="structure">Structure</option>
                      <option value="drywall">Drywall</option>
                      <option value="framing">Framing</option>
                    </select>
                  </div>
                  <div className={styles.propActions}>
                    <button className={`${styles.propBtn} ${styles.propBtnDanger}`} onClick={() => { removeWall(selectedWall.id); setSelectedWallId(null) }}>
                      ✕ Delete Wall
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Floating undo/redo + cancel */}
        <div className={styles.floatingUndo}>
          <button className={styles.floatingUndoBtn} onClick={undo} disabled={undoStack.length === 0} title="Undo last action (Ctrl+Z)">↩ Undo</button>
          <button className={styles.floatingUndoBtn} onClick={redo} disabled={redoStack.length === 0} title="Redo (Ctrl+Shift+Z)">↪ Redo</button>
          {drawStart && (
            <button className={styles.floatingCancelBtn} onClick={() => useAppStore.getState().setDrawStart(null)}>
              ✕ Cancel
            </button>
          )}
        </div>

        {/* Status bar */}
        <div className={styles.statusBar}>
          <div className={styles.statusHint}>
            <span>{toolHint}</span>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span>{walls.length} walls</span>
            <span>{drawings.length} drawings</span>
            {inTool && (
              <button className={styles.exitBtn} onClick={handleBack}>
                Exit {activeTool === 'draw-wall' ? 'Drawing' : 'Mode'}
              </button>
            )}
          </div>
        </div>

        {/* Sample Drawing Gallery Modal */}
        {showGallery && (
          <div className={styles.modalOverlay} onClick={() => setShowGallery(false)}>
            <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
              <button className={styles.modalClose} onClick={() => setShowGallery(false)}>✕</button>
              <SampleDrawingGallery />
            </div>
          </div>
        )}

        {/* Wizard */}
        {wizardOpen && <Wizard />}

        {/* Wall Type Prompt */}
        <WallTypePrompt />

        {/* Scale Calibration */}
        <ScaleCalibrationOverlay />

        {/* Modal for floorplan import */}
        {modalOpen === 'import-floorplan' && (
          <div className={styles.modalOverlay} onClick={() => setModalOpen(null)}>
            <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
              <button className={styles.modalClose} onClick={() => setModalOpen(null)}>✕</button>
              <h2>Import Floorplan</h2>
              <div className={styles.dropzone} onClick={() => fileInputRef.current?.click()}>
                Click to select a floorplan image
              </div>
            </div>
          </div>
        )}

        {/* 3D Canvas */}
        <Canvas
          shadows
          onPointerMissed={onPointerMissed}
          onError={(err: any) => {
            console.error('=== R3F Canvas Error ===', err)
            const el = document.getElementById('r3f-error-display')
            if (el) { el.style.display = 'block'; el.textContent = 'Canvas Error: ' + (err?.message || String(err)) }
          }}
          gl={{ antialias: true, preserveDrawingBuffer: true }}
          camera={{ fov: 50, near: 0.1, far: 500 }}
          style={{ touchAction: 'none', background: '#0f172a' }}
        >
          <SceneSetup />
          <ambientLight intensity={0.6} />
          <hemisphereLight args={['#87ceeb', '#3a3a3a', 0.5]} />
          <directionalLight position={[20, 30, 20]} intensity={2} castShadow shadow-mapSize={[2048, 2048]} />
          <directionalLight position={[-15, 20, -10]} intensity={0.6} />
          <Suspense fallback={null}>
            <Environment preset="city" background={false} />
          </Suspense>
          <GridFloor />
          {floorplan.imageUrl && <FloorplanImage url={floorplan.imageUrl} />}
          <WallsContainer onWallClick={onWallClick} />
          <WallDrawTool />
          <CalibrationTool3D />
          <PlacementHandler />
          <FloatingWatermark />
          <OrbitControls
            ref={controlsRef}
            makeDefault
            enabled={!drawStart}
            enableDamping
            dampingFactor={0.12}
            rotateSpeed={0.6}
            panSpeed={0.7}
            minDistance={1}
            maxDistance={200}
            screenSpacePanning
          />
          <CameraPresetApplier controlsRef={controlsRef} />
          <SelectionManager />
          {model.status === 'ready' && <ProductPlacements />}
          {measureMode && <MeasureTool key={measureMode ? 'mm-on' : 'mm-off'} />}
          {annotateMode && <AnnotationTool onPlaceRequest={handlePlaceRequest} />}
          <GizmoHelper alignment="bottom-right" margin={[80, 80]}>
            <GizmoViewport axisColors={['#f87171', '#4ade80', '#60a5fa']} labelColor="#f1f5f9" />
          </GizmoHelper>
        </Canvas>

        {/* Viewer3D overlays */}
        <CameraHud />
        <Toolbar />
        <PropertiesPanel />
        <ProductPlacementPanel />

        {/* Annotation creation form */}
        {pendingForm && (
          <AnnotationForm
            form={pendingForm}
            onSubmit={handleFormSubmit}
            onCancel={() => setPendingForm(null)}
          />
        )}

        <div id="r3f-error-display" style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 9999, background: '#7f1d1d', color: '#fca5a5', padding: 8, fontSize: 12, fontFamily: 'monospace', display: 'none' }}></div>
      </div>
    </div>
  )
}
