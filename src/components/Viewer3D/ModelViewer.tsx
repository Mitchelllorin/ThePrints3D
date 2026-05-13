import { useRef, useEffect, useState, useCallback, Suspense } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import {
  OrbitControls,
  Grid,
  Environment,
  GizmoHelper,
  GizmoViewport,
  Stats,
} from '@react-three/drei'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import * as THREE from 'three'
import { useAppStore } from '../../store/useAppStore'
import BuildingModel from './BuildingModel'
import MeasureTool from './MeasureTool'
import CameraHud from './CameraHud'
import glossaryData from '../../symbols/glossary.json'
import type { SymbolEntry } from '../../symbols/types'
import styles from './ModelViewer.module.css'

function CameraRig() {
  const { camera } = useThree()
  const initialized = useRef(false)
  useEffect(() => {
    if (!initialized.current) {
      camera.position.set(12, 10, 12)
      camera.lookAt(0, 0, 0)
      initialized.current = true
    }
  }, [camera])
  return null
}

/**
 * Listens for camera-preset requests from the store (set by the CameraHud).
 * Applies the requested camera pose to the active camera + OrbitControls.
 */
function CameraPresetApplier({ controlsRef }: { controlsRef: React.MutableRefObject<OrbitControlsImpl | null> }) {
  const { camera } = useThree()
  const preset = useAppStore((s) => s.cameraPreset)
  const consume = useAppStore((s) => s.consumeCameraPreset)

  useEffect(() => {
    if (!preset) return
    camera.position.set(preset.position[0], preset.position[1], preset.position[2])
    if (controlsRef.current) {
      controlsRef.current.target.set(preset.target[0], preset.target[1], preset.target[2])
      controlsRef.current.update()
    } else {
      camera.lookAt(preset.target[0], preset.target[1], preset.target[2])
    }
    consume()
  }, [preset, camera, controlsRef, consume])

  return null
}

/** Keeps the camera near-plane proportional to the distance from the scene
 *  origin so the depth buffer stays precise at all zoom levels. */
function CameraNearUpdater() {
  useFrame((state) => {
    const cam = state.camera
    const dist = cam.position.length()
    const near = Math.max(0.001, dist * 0.0001)
    if (Math.abs(cam.near - near) > near * 0.05) {
      cam.near = near
      cam.updateProjectionMatrix()
    }
  })
  return null
}

export interface ComponentInfo {
  layerId: string
  symbolId: string
  worldPosition: THREE.Vector3
}

/**
 * Listens for double-clicks on the canvas DOM element. On hit, smoothly
 * moves the OrbitControls target and camera to frame the clicked object,
 * and calls onHit with metadata for the component info HUD.
 */
function DoubleClickZoom({
  controlsRef,
  onHit,
}: {
  controlsRef: React.MutableRefObject<OrbitControlsImpl | null>
  onHit: (info: ComponentInfo | null) => void
}) {
  const { camera, scene, gl } = useThree()

  useEffect(() => {
    const canvas = gl.domElement

    const handleDblClick = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect()
      const ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1
      const ndcY = -((e.clientY - rect.top) / rect.height) * 2 + 1

      const raycaster = new THREE.Raycaster()
      raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera)

      const hits = raycaster.intersectObjects(scene.children, true)
      if (hits.length === 0) { onHit(null); return }

      const hit = hits[0]
      const obj = hit.object

      // Walk up the hierarchy looking for layer / symbolId tags
      let cur: THREE.Object3D | null = obj
      let layerId = ''
      let symbolId = ''
      while (cur) {
        if (!layerId && cur.userData.layer) layerId = cur.userData.layer as string
        if (!symbolId && cur.userData.symbolId) symbolId = cur.userData.symbolId as string
        if (layerId && symbolId) break
        cur = cur.parent
      }

      onHit({ layerId, symbolId, worldPosition: hit.point.clone() })

      // Zoom to the hit point
      const toCamera = camera.position.clone().sub(hit.point).normalize()
      const newDist = Math.max(0.05, hit.distance * 0.12)
      const newPos = hit.point.clone().add(toCamera.multiplyScalar(newDist))

      if (controlsRef.current) {
        controlsRef.current.target.copy(hit.point)
        camera.position.copy(newPos)
        controlsRef.current.update()
      }
    }

    canvas.addEventListener('dblclick', handleDblClick)
    return () => canvas.removeEventListener('dblclick', handleDblClick)
  }, [camera, scene, gl, controlsRef, onHit])

  return null
}

function BuildingProgress() {
  const mesh = useRef<THREE.Mesh>(null)
  useFrame((_, delta) => {
    if (mesh.current) mesh.current.rotation.y += delta * 0.8
  })
  return (
    <mesh ref={mesh} position={[0, 1, 0]}>
      <octahedronGeometry args={[1, 0]} />
      <meshStandardMaterial color="#38bdf8" wireframe />
    </mesh>
  )
}

/** Lookup a glossary entry by symbol ID or layer ID. */
function findGlossaryEntry(symbolId: string, layerId: string): SymbolEntry | null {
  const entries = (glossaryData as { entries: SymbolEntry[] }).entries
  if (symbolId) {
    const byId = entries.find((e) => e.id === symbolId)
    if (byId) return byId
  }
  if (layerId) {
    const byCategory = entries.find((e) => e.category === layerId || e.id.startsWith(layerId))
    if (byCategory) return byCategory
  }
  return null
}

/** Floating card that shows glossary metadata for the double-clicked component. */
function ComponentInfoCard({ info, onClose }: { info: ComponentInfo; onClose: () => void }) {
  const entry = findGlossaryEntry(info.symbolId, info.layerId)
  const label = entry ? entry.common_names[0] : info.symbolId || info.layerId || 'Component'
  const pos = info.worldPosition

  return (
    <div className={styles.componentCard}>
      <button className={styles.componentCardClose} onClick={onClose} title="Dismiss">✕</button>
      <p className={styles.componentCardTitle}>{label}</p>
      {entry && (
        <>
          <p className={styles.componentCardMeta}>
            <span className={styles.componentCardBadge}>{entry.category}</span>
            {entry.default_height_in !== undefined && (
              <span className={styles.componentCardHint}>{entry.default_height_in}″ AFF</span>
            )}
          </p>
          <p className={styles.componentCardDesc}>{entry.represents}</p>
          {entry.standards && entry.standards.length > 0 && (
            <p className={styles.componentCardHint}>{entry.standards.join(' · ')}</p>
          )}
        </>
      )}
      <p className={styles.componentCardCoords}>
        {pos.x.toFixed(2)}m, {pos.y.toFixed(2)}m, {pos.z.toFixed(2)}m
      </p>
    </div>
  )
}

export default function ModelViewer() {
  const model = useAppStore((s) => s.model)
  const layers = useAppStore((s) => s.layers)
  const measureMode = useAppStore((s) => s.measureMode)
  const setMeasureMode = useAppStore((s) => s.setMeasureMode)
  const clearMeasurements = useAppStore((s) => s.clearMeasurements)
  const measurements = useAppStore((s) => s.measurements)
  const controlsRef = useRef<OrbitControlsImpl | null>(null)
  const [focusedComponent, setFocusedComponent] = useState<ComponentInfo | null>(null)
  const handleComponentHit = useCallback((info: ComponentInfo | null) => {
    setFocusedComponent(info)
  }, [])

  return (
    <div className={styles.viewer}>
      {/* Toolbar overlay */}
      {model.status === 'ready' && (
        <div className={styles.toolbar}>
          <button
            className={`${styles.toolBtn} ${measureMode ? styles.toolBtnActive : ''}`}
            onClick={() => setMeasureMode(!measureMode)}
            title="Measure distances (click two points)"
          >
            📏 {measureMode ? 'Measuring…' : 'Measure'}
          </button>
          {measurements.length > 0 && (
            <button
              className={styles.toolBtn}
              onClick={clearMeasurements}
              title="Clear all measurements"
            >
              🗑 Clear ({measurements.length})
            </button>
          )}
          <button
            className={styles.toolBtn}
            onClick={() => {
              const canvas = document.querySelector('canvas') as HTMLCanvasElement | null
              if (!canvas) return
              // preserveDrawingBuffer is false for perf; force a render before snapshot
              try {
                const dataUrl = canvas.toDataURL('image/png')
                const a = document.createElement('a')
                a.href = dataUrl
                a.download = `blueprint3d-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`
                a.click()
              } catch (err) {
                console.error('Snapshot failed:', err)
                alert('Snapshot failed — try again after orbiting the view once.')
              }
            }}
            title="Save the current 3D view as a PNG image you can share"
            data-testid="share-png-btn"
          >
            📤 Share PNG
          </button>
          {measureMode && (
            <span className={styles.toolHint}>
              Click a surface to place point A, then point B
            </span>
          )}
          {!measureMode && (
            <span className={styles.toolHint}>
              Double-click any component to zoom in
            </span>
          )}
        </div>
      )}

      {/* Camera preset HUD — visible whenever the model exists */}
      {(model.status === 'ready' || model.status === 'building') && <CameraHud />}

      {/* Component info card — shown on double-click */}
      {focusedComponent && (
        <ComponentInfoCard
          info={focusedComponent}
          onClose={() => setFocusedComponent(null)}
        />
      )}

      <Canvas
        shadows
        gl={{ antialias: true, preserveDrawingBuffer: true }}
        camera={{ fov: 55, near: 0.001, far: 2000 }}
        style={{ touchAction: 'none' }}
      >
        <CameraRig />
        <ambientLight intensity={0.4} />
        <directionalLight
          position={[20, 30, 20]}
          intensity={1.2}
          castShadow
          shadow-mapSize={[2048, 2048]}
        />
        <directionalLight position={[-15, 20, -10]} intensity={0.4} />

        <Suspense fallback={null}>
          <Environment preset="city" />
        </Suspense>

        <Grid
          args={[50, 50]}
          cellSize={1}
          cellThickness={0.4}
          cellColor="#1e3a5f"
          sectionSize={5}
          sectionThickness={0.8}
          sectionColor="#1e4080"
          fadeDistance={60}
          position={[0, -0.01, 0]}
        />

        {model.status === 'building' && <BuildingProgress />}
        {(model.status === 'building' || model.status === 'ready') && (
          <>
            <BuildingModel layers={layers} />
            {model.status === 'ready' && <MeasureTool key={measureMode ? 'measure-on' : 'measure-off'} />}
          </>
        )}

        <OrbitControls
          ref={controlsRef as React.RefObject<OrbitControlsImpl>}
          makeDefault
          enableDamping
          dampingFactor={0.12}
          rotateSpeed={0.6}
          panSpeed={0.7}
          zoomSpeed={0.7}
          minDistance={0.001}
          maxDistance={500}
          enablePan
          screenSpacePanning
          mouseButtons={{
            LEFT: THREE.MOUSE.ROTATE,
            MIDDLE: THREE.MOUSE.DOLLY,
            RIGHT: THREE.MOUSE.PAN,
          }}
          touches={{
            ONE: THREE.TOUCH.ROTATE,
            TWO: THREE.TOUCH.DOLLY_PAN,
          }}
        />

        <CameraPresetApplier controlsRef={controlsRef} />
        <CameraNearUpdater />
        <DoubleClickZoom controlsRef={controlsRef} onHit={handleComponentHit} />

        <GizmoHelper alignment="bottom-right" margin={[80, 80]}>
          <GizmoViewport
            axisColors={['#f87171', '#4ade80', '#60a5fa']}
            labelColor="#f1f5f9"
          />
        </GizmoHelper>

        <Stats className={styles.stats} />
      </Canvas>

      {model.status === 'building' && (
        <div className={styles.overlay}>
          <div className={styles.buildingMsg}>
            <span className={styles.spinner}>⬡</span>
            Building 3D model…
          </div>
        </div>
      )}

      {model.status === 'idle' && (
        <div className={styles.overlay}>
          <div className={styles.idleMsg}>
            <p>No model built yet.</p>
            <p className={styles.hint}>Upload drawings and click "Build 3D Model"</p>
          </div>
        </div>
      )}
    </div>
  )
}
