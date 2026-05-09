import { useRef, useEffect, Suspense } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import {
  OrbitControls,
  Grid,
  Environment,
  GizmoHelper,
  GizmoViewport,
  Stats,
} from '@react-three/drei'
import * as THREE from 'three'
import { useAppStore } from '../../store/useAppStore'
import BuildingModel from './BuildingModel'
import MeasureTool from './MeasureTool'
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
  const measurements = useAppStore((s) => s.measurements)

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
          {measureMode && (
            <span className={styles.toolHint}>
              Click a surface to place point A, then point B
            </span>
          )}
        </div>
      )}

      <Canvas
        shadows
        gl={{ antialias: true, preserveDrawingBuffer: false }}
        camera={{ fov: 55, near: 0.1, far: 1000 }}
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
            {model.status === 'ready' && <MeasureTool />}
          </>
        )}

        <OrbitControls
          makeDefault
          enableDamping
          dampingFactor={0.05}
          minDistance={1}
          maxDistance={200}
        />

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
