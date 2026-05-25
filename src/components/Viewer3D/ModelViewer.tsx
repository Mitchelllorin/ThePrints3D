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
import { useAppStore } from '../../store/useAppStore'
import BuildingModel from './BuildingModel'
import SelectionManager from './SelectionManager'
import Toolbar from './Toolbar'
import PropertiesPanel from './PropertiesPanel'
import MeasureTool from './MeasureTool'
import AnnotationTool from './AnnotationTool'
import CameraHud from './CameraHud'
import ProductPlacementPanel from './ProductPlacementPanel'
import ProductPlacements from './ProductPlacements'
import { clearSelection } from '../../services/editing/selectionSystem'
import styles from './ModelViewer.module.css'
import LiveWallsLayer from './LiveWallsLayer'

function SceneBackground() {
  const { scene } = useThree()
  useEffect(() => {
    scene.background = new THREE.Color('#1e293b')
  }, [scene])
  return null
}

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

// â”€â”€â”€ Preset colours/icons used in the creation form â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const FORM_COLORS = ['#f87171','#fb923c','#facc15','#4ade80','#38bdf8','#818cf8','#e879f9','#f1f5f9']
const FORM_ICONS  = ['ðŸ“Œ','âš ï¸','ðŸ’¡','â“','âœ…','ðŸ”§','ðŸ“','ðŸ”´','â­','ðŸ·ï¸','ðŸ’¬','ðŸš©']

// â”€â”€â”€ Annotation creation form â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
  const [icon, setIcon]   = useState('ðŸ“Œ')
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
          placeholder="Add a noteâ€¦"
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
            ðŸ“Œ Add Pin
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
  const annotateMode = useAppStore((s) => s.annotateMode)
  const setAnnotateMode = useAppStore((s) => s.setAnnotateMode)
  const annotations = useAppStore((s) => s.annotations)
  const addAnnotation = useAppStore((s) => s.addAnnotation)
  const setView = useAppStore((s) => s.setView)
  const setModelStatus = useAppStore((s) => s.setModelStatus)
  const controlsRef = useRef<OrbitControlsImpl | null>(null)
  const seedMode = useAppStore((s) => s.seedMode)
  const [showProductPanel, setShowProductPanel] = useState(false)

  useEffect(() => {
    if (!controlsRef.current) return
    controlsRef.current.touches.ONE = seedMode ? -1 as any : THREE.TOUCH.ROTATE

  useEffect(() => {
    function onEscape(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      useAppStore.setState({ seedMode: false })
      setShowProductPanel(false)
      clearSelection()
    }
    window.addEventListener('keydown', onEscape)
    return () => window.removeEventListener('keydown', onEscape)
  }, [])
  }, [seedMode])
  const [measurementsPanelCollapsed, setMeasurementsPanelCollapsed] = useState(false)
  const [pendingForm, setPendingForm] = useState<FormState | null>(null)

  const handlePlaceRequest = (position: [number, number, number], screenX: number, screenY: number) => {
    setPendingForm({ position3D: position, screenX, screenY })
  }

  const handleFormSubmit = (text: string, icon: string, color: string) => {
    if (!pendingForm) return
    addAnnotation({ text, icon, color, position: pendingForm.position3D })
    setPendingForm(null)
  }

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
            ðŸ“ {measureMode ? 'Measuringâ€¦' : 'Measure'}
          </button>
          {measurements.length > 0 && (
            <button
              className={styles.toolBtn}
              onClick={clearMeasurements}
              title="Clear all measurements"
            >
              ðŸ—‘ Clear ({measurements.length})
            </button>
          )}
          <button
            className={`${styles.toolBtn} ${annotateMode ? styles.toolBtnActive : ''}`}
            onClick={() => { setAnnotateMode(!annotateMode); setPendingForm(null) }}
            title={annotateMode ? 'Exit annotation mode' : 'Annotate â€” click the model to place pins'}
          >
            ðŸ“Œ {annotateMode ? 'Annotatingâ€¦' : 'Annotate'}
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
                alert('Snapshot failed â€” try again after orbiting the view once.')
              }
            }}
            title="Save the current 3D view as a PNG image you can share"
            data-testid="share-png-btn"
          >
            ðŸ“¤ Share PNG
          </button>
          {(measureMode || annotateMode) && (
            <>
            <span className={styles.toolHint}>
              {measureMode ? 'Click a surface to place point A, then point B' : 'Click a surface to place an annotation pin'}
            </span>
            <button style={{ marginLeft: 8, padding: '4px 10px', background: '#ef4444', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 12 }} onClick={() => useAppStore.setState({ measureMode: false, annotateMode: false })}>X Exit</button>
            </>
          )}
        </div>
      )}

      {/* Editing toolbar (left) */}
      {model.status === 'ready' && <Toolbar />}

      {/* Properties panel (right) */}
      {model.status === 'ready' && <PropertiesPanel />}

      {/* Camera preset HUD */}
      {(model.status === 'ready' || model.status === 'building') && <CameraHud />}
      {model.status === 'ready' && showProductPanel && (
        <ProductPlacementPanel onClose={() => setShowProductPanel(false)} />
      )}

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
              {measurementsPanelCollapsed ? 'â—€' : 'â–¶'}
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
                        âœ•
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
        onPointerMissed={() => clearSelection()}
        gl={{ antialias: true, preserveDrawingBuffer: true }}
        camera={{ fov: 55, near: 0.1, far: 1000 }}
        style={{ touchAction: 'none', background: '#1e293b', cursor: annotateMode ? 'crosshair' : 'default' }}
      >
        <CameraRig />
        <SceneBackground />
        <ambientLight intensity={0.7} />
        <hemisphereLight args={['#87ceeb', '#3a3a3a', 0.6]} />
        <directionalLight
          position={[20, 30, 20]}
          intensity={2}
          castShadow
          shadow-mapSize={[2048, 2048]}
        />
        <directionalLight position={[-15, 20, -10]} intensity={0.8} />

        <Suspense fallback={null}>
          <Environment preset="city" background={false} />
        </Suspense>

        {/* Ground plane â€” always visible, gives spatial reference */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.05, 0]} receiveShadow>
          <planeGeometry args={[60, 60]} />
          <meshStandardMaterial color="#1e293b" roughness={0.9} />
        </mesh>

        <Grid
          args={[50, 50]}
          cellSize={1}
          cellThickness={0.6}
          cellColor="#334155"
          sectionSize={5}
          sectionThickness={1.2}
          sectionColor="#475569"
          fadeDistance={80}
          position={[0, -0.01, 0]}
        />

        {model.status === 'building' && <BuildingProgress />}
        {(model.status === 'building' || model.status === 'ready') && (
          <>
            <BuildingModel layers={layers} />
            <ProductPlacements />
            {model.status === 'ready' && <SelectionManager />}
            {model.status === 'ready' && <MeasureTool key={measureMode ? 'measure-on' : 'measure-off'} />}
            {model.status === 'ready' && (
              <AnnotationTool onPlaceRequest={handlePlaceRequest} />
            )}
          </>
        )}

        <OrbitControls
          ref={controlsRef}
            enabled={!seedMode}
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
        <LiveWallsLayer />

        <GizmoHelper alignment="bottom-right" margin={[80, 80]}>
          <GizmoViewport
            axisColors={['#f87171', '#4ade80', '#60a5fa']}
            labelColor="#f1f5f9"
          />
        </GizmoHelper>

        <Stats className={styles.stats} />
      </Canvas>

      {model.status === 'error' && (
        <div className={styles.overlay}>
          <div className={styles.errorMsg}>
            <p>âš ï¸ Could not build 3D model</p>
            <p className={styles.hint}>Try analysing the drawings first, then click Build 3D again</p>
            <button className={styles.dismissBtn} onClick={() => { setView('drawings'); setModelStatus('idle') }}>
              Back to Drawings
            </button>
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




