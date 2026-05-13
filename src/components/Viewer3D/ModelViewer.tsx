import { useRef, useEffect, Suspense, useState } from 'react'
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
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { useAppStore } from '../../store/useAppStore'
import BuildingModel from './BuildingModel'
import MeasureTool from './MeasureTool'
import CameraHud from './CameraHud'
import ProductPlacementPanel from './ProductPlacementPanel'
import ProductPlacements from './ProductPlacements'
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

export default function ModelViewer() {
  const model = useAppStore((s) => s.model)
  const layers = useAppStore((s) => s.layers)
  const measureMode = useAppStore((s) => s.measureMode)
  const setMeasureMode = useAppStore((s) => s.setMeasureMode)
  const clearMeasurements = useAppStore((s) => s.clearMeasurements)
  const removeMeasurement = useAppStore((s) => s.removeMeasurement)
  const measurements = useAppStore((s) => s.measurements)
  const controlsRef = useRef<{ target: THREE.Vector3; update: () => void } | null>(null)
  const [measurementsPanelCollapsed, setMeasurementsPanelCollapsed] = useState(false)

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
        </div>
      )}

      {/* Camera preset HUD — visible whenever the model exists */}
      {(model.status === 'ready' || model.status === 'building') && <CameraHud />}
      {model.status === 'ready' && <ProductPlacementPanel />}

      {model.status === 'ready' && (
        <aside
          className={`${styles.measurementsPanel} ${
            measurementsPanelCollapsed ? styles.measurementsPanelCollapsed : ''
          }`}
        >
          <div className={styles.measurementsPanelHeader}>
            <h3 className={styles.measurementsPanelTitle}>Measurements ({measurements.length})</h3>
            <button
              className={styles.measurementsPanelToggle}
              onClick={() => setMeasurementsPanelCollapsed((v) => !v)}
              title={measurementsPanelCollapsed ? 'Expand measurements panel' : 'Collapse measurements panel'}
              aria-label={measurementsPanelCollapsed ? 'Expand measurements panel' : 'Collapse measurements panel'}
            >
              {measurementsPanelCollapsed ? '◀' : '▶'}
            </button>
          </div>
          {!measurementsPanelCollapsed && (
            <div className={styles.measurementsPanelBody}>
              {measurements.length === 0 ? (
                <div className={styles.measurementEmpty}>No measurements yet.</div>
              ) : (
                measurements.map((m) => {
                  const isMeters = m.distanceM >= 1
                  const value = isMeters ? m.distanceM.toFixed(2) : (m.distanceM * 1000).toFixed(0)
                  const unit = isMeters ? 'm' : 'mm'
                  return (
                    <div key={m.id} className={styles.measurementEntry}>
                      <div className={styles.measurementValueRow}>
                        <span className={styles.measurementValue}>{value}</span>
                        <span className={styles.measurementUnit}>{unit}</span>
                      </div>
                      <div className={styles.measurementMeta}>
                        {typeof m.createdAt === 'number'
                          ? new Date(m.createdAt).toLocaleString()
                          : 'Unknown'}
                      </div>
                      <button
                        className={styles.measurementDelete}
                        onClick={() => removeMeasurement(m.id)}
                        aria-label="Delete measurement"
                        title="Delete measurement"
                      >
                        ✕
                      </button>
                    </div>
                  )
                })
              )}
            </div>
          )}
        </aside>
      )}

      <Canvas
        shadows
        gl={{ antialias: true, preserveDrawingBuffer: true }}
        camera={{ fov: 55, near: 0.1, far: 1000 }}
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
            <ProductPlacements />
            {model.status === 'ready' && <MeasureTool key={measureMode ? 'measure-on' : 'measure-off'} />}
          </>
        )}

        <OrbitControls
          ref={controlsRef as unknown as React.RefObject<OrbitControlsImpl>}
          makeDefault
          enableDamping
          dampingFactor={0.12}
          rotateSpeed={0.6}
          panSpeed={0.7}
          zoomSpeed={0.7}
          minDistance={1}
          maxDistance={200}
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
