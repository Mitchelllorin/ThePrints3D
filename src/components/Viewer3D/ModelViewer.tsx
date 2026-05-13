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
import AnnotationTool from './AnnotationTool'
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

// ─── Preset colours/icons used in the creation form ──────────────────────────

const FORM_COLORS = ['#f87171','#fb923c','#facc15','#4ade80','#38bdf8','#818cf8','#e879f9','#f1f5f9']
const FORM_ICONS  = ['📌','⚠️','💡','❓','✅','🔧','📏','🔴','⭐','🏷️','💬','🚩']

// ─── Annotation creation form ─────────────────────────────────────────────────

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

  // keep the popover inside the viewport
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
      className={styles.annotationForm}
      style={{ left, top }}
      onClick={(e) => e.stopPropagation()}
    >
      <form onSubmit={handleSubmit}>
        <textarea
          className={styles.formTextarea}
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

        {/* Icon selector */}
        <div className={styles.formPickerRow}>
          {FORM_ICONS.map((ic) => (
            <button
              key={ic}
              type="button"
              className={`${styles.formIconBtn} ${icon === ic ? styles.formBtnActive : ''}`}
              onClick={() => setIcon(ic)}
              title={ic}
            >
              {ic}
            </button>
          ))}
        </div>

        {/* Colour selector */}
        <div className={styles.formPickerRow}>
          {FORM_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className={`${styles.formColorBtn} ${color === c ? styles.formBtnActive : ''}`}
              style={{ background: c }}
              onClick={() => setColor(c)}
              title={c}
            />
          ))}
        </div>

        <div className={styles.formButtons}>
          <button type="submit" className={styles.formSubmit} disabled={!text.trim()}>
            📌 Add Pin
          </button>
          <button type="button" className={styles.formCancel} onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </div>
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
            className={`${styles.toolBtn} ${annotateMode ? styles.toolBtnActive : ''}`}
            onClick={() => { setAnnotateMode(!annotateMode); setPendingForm(null) }}
            title={annotateMode ? 'Exit annotation mode' : 'Annotate — click the model to place pins'}
          >
            📌 {annotateMode ? 'Annotating…' : 'Annotate'}
            {annotations.length > 0 && !annotateMode && (
              <span className={styles.toolBadge}>{annotations.length}</span>
            )}
          </button>
          <button
            className={styles.toolBtn}
            onClick={() => {
              const canvas = document.querySelector('canvas') as HTMLCanvasElement | null
              if (!canvas) return
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
          {(measureMode || annotateMode) && (
            <span className={styles.toolHint}>
              {measureMode ? 'Click a surface to place point A, then point B' : 'Click a surface to place an annotation pin'}
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

      {/* Annotation creation form */}
      {pendingForm && (
        <AnnotationForm
          form={pendingForm}
          onSubmit={handleFormSubmit}
          onCancel={() => setPendingForm(null)}
        />
      )}

      <Canvas
        shadows
        gl={{ antialias: true, preserveDrawingBuffer: true }}
        camera={{ fov: 55, near: 0.1, far: 1000 }}
        style={{ touchAction: 'none', cursor: annotateMode ? 'crosshair' : 'default' }}
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
            {model.status === 'ready' && (
              <AnnotationTool onPlaceRequest={handlePlaceRequest} />
            )}
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
