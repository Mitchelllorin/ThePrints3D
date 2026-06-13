import { useRef, useEffect, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, Grid } from '@react-three/drei'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import * as THREE from 'three'
import { useAppStore } from '../../store/useAppStore'
import { useUISettingsStore } from '../../store/useUISettingsStore'
import { useConfigStore } from '../../store/useConfigStore'
import { useFloorplanLocalStore } from '../../store/useFloorplanLocalStore'
import { formatLengthFromMm } from '../../services/unitConverter'
import { useShallow } from 'zustand/react/shallow'
import BuildingModel from './BuildingModel'
import MeasureTool from './MeasureTool'
import AnnotationTool from './AnnotationTool'
import CameraHud from './CameraHud'
import ProductPlacements from './ProductPlacements'
import ConstructionWizard from '../ConstructionWizard/ConstructionWizard'
import FloorplanOverlay from './FloorplanOverlay'
import FloorplanPanel from './FloorplanPanel'
import LiveWallsLayer from './LiveWallsLayer'
import FloatingLogo3D from './FloatingLogo3D'
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
 * Applies the requested camera pose inside useFrame so the jump happens in
 * the same Three.js tick that renders it — no one-frame stutter.
 * Damping is temporarily disabled when applying the preset so that any
 * residual OrbitControls velocity is cleared and the camera doesn't drift.
 */
function CameraPresetApplier({ controlsRef }: { controlsRef: React.MutableRefObject<OrbitControlsImpl | null> }) {
  const { camera } = useThree()

  useFrame(() => {
    const { cameraPreset, consumeCameraPreset } = useAppStore.getState()
    if (!cameraPreset) return
    camera.position.set(cameraPreset.position[0], cameraPreset.position[1], cameraPreset.position[2])
    if (controlsRef.current) {
      const ctrl = controlsRef.current
      ctrl.target.set(cameraPreset.target[0], cameraPreset.target[1], cameraPreset.target[2])
      // Disable damping for one update so accumulated velocity is zeroed out
      const wasDamping = ctrl.enableDamping
      ctrl.enableDamping = false
      ctrl.update()
      ctrl.enableDamping = wasDamping
    } else {
      camera.lookAt(cameraPreset.target[0], cameraPreset.target[1], cameraPreset.target[2])
    }
    consumeCameraPreset()
  })

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
  const gridSettings = useUISettingsStore(useShallow((s) => ({
    visible: s.gridVisible,
    color: s.gridColor,
    cellSize: s.gridCellSize,
  })))
  const model      = useAppStore((s) => s.model)
  const drawings   = useAppStore((s) => s.drawings)
  const addDrawings = useAppStore((s) => s.addDrawings)
  const layers     = useAppStore((s) => s.layers)
  const measureMode    = useAppStore((s) => s.measureMode)
  const setMeasureMode = useAppStore((s) => s.setMeasureMode)
  const annotateMode    = useAppStore((s) => s.annotateMode)
  const setAnnotateMode = useAppStore((s) => s.setAnnotateMode)
  const annotations    = useAppStore((s) => s.annotations)
  const addAnnotation  = useAppStore((s) => s.addAnnotation)
  const clearMeasurements = useAppStore((s) => s.clearMeasurements)
  const removeMeasurement = useAppStore((s) => s.removeMeasurement)
  const measurements   = useAppStore((s) => s.measurements)
  const buildResult    = useAppStore((s) => s.buildResult)
  const buildForMe     = useAppStore((s) => s.buildForMe)
  const overlay        = useAppStore((s) => s.floorplanOverlay)
  const updateOverlay  = useAppStore((s) => s.updateFloorplanOverlay)
  const activeUnit     = useConfigStore((s) => s.activeUnit)
  const controlsRef    = useRef<OrbitControlsImpl | null>(null)
  const [measurementsPanelCollapsed, setMeasurementsPanelCollapsed] = useState(false)
  const [pendingForm, setPendingForm]   = useState<FormState | null>(null)
  const [showWizard, setShowWizard]     = useState(false)
  const [isDragOver, setIsDragOver]     = useState(false)
  const hasWalls      = drawings.some((d) => d.parsedWalls.length > 0)

  // Disable orbit while the user is actively tracing or calibrating on the overlay
  const orbitEnabled = !overlay.traceModeActive && !overlay.calibrationMode

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault()
    setIsDragOver(true)
  }
  function handleDragLeave() { setIsDragOver(false) }
  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setIsDragOver(false)
    const files = Array.from(e.dataTransfer.files).filter((f) =>
      /\.(pdf|png|jpe?g|tiff?|webp)$/i.test(f.name)
    )
    if (files.length > 0) addDrawings(files)
  }

  function handlePlaceRequest(position: [number, number, number], screenX: number, screenY: number) {
    setPendingForm({ position3D: position, screenX, screenY })
  }

  // Re-calibrate at any time from the toolbar — resets the picked points and
  // re-enters calibration mode; the ambient guide drives the rest of the flow.
  function handleRecalibrate() {
    const fp = useFloorplanLocalStore.getState()
    fp.setTraceMode(false)
    fp.setTraceStroke([])
    fp.setCalibrationA(null)
    fp.setCalibrationB(null)
    fp.setHoverPixel(null)
    fp.setDistanceInput('')
    updateOverlay({ calibrationMode: true, guidedStep: 1, locked: false }, false)
  }

  function handleFormSubmit(text: string, icon: string, color: string) {
    if (!pendingForm) return
    addAnnotation({
      position: pendingForm.position3D,
      text,
      icon,
      color,
    })
    setPendingForm(null)
  }

  return (
    <div
      className={styles.viewer}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Toolbar overlay */}
      {model.status === 'ready' && (
        <div className={styles.toolbar}>
          <button
            className={`${styles.toolBtn} ${overlay.calibrationMode ? styles.toolBtnActive : ''}`}
            onClick={handleRecalibrate}
            title="Re-set the real-world scale — pick two points and confirm the distance"
            data-testid="recalibrate-btn"
          >
            📐 {overlay.calibrationMode ? 'Calibrating…' : 'Recalibrate'}
          </button>
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
          {hasWalls && (
            <>
              <button
                className={styles.toolBtn}
                onClick={() => { buildForMe(); setShowWizard(false) }}
                title="Auto-build framing from detected walls — takes all defaults"
                data-testid="build-for-me-btn"
              >
                {buildResult ? 'Rebuild' : 'Build for me'}
              </button>
              <button
                className={`${styles.toolBtn} ${showWizard ? styles.toolBtnActive : ''}`}
                onClick={() => {
                  if (!buildResult) buildForMe()
                  setShowWizard(!showWizard)
                }}
                title="Walk construction decisions step by step"
                data-testid="wizard-btn"
              >
                Wizard
              </button>
            </>
          )}
          {(measureMode || annotateMode) && (
            <span className={styles.toolHint}>
              {measureMode ? 'Click a surface to place point A, then point B' : 'Click a surface to place an annotation pin'}
            </span>
          )}
        </div>
      )}

      {/* Camera preset HUD — visible whenever the model exists */}
      {(model.status === 'ready' || model.status === 'building') && <CameraHud />}
      {/* ProductPlacementPanel hidden by default — access via Layers panel */}

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
                  // Same active unit as calibration — one source of truth.
                  const value = formatLengthFromMm(m.distanceM * 1000, activeUnit)
                  const unit = ''
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

      {/* Construction Wizard — step-through decisions panel */}
      {showWizard && <ConstructionWizard />}

      {/* FloorplanPanel renders DOM controls (inputs, buttons) outside the
         Canvas so they stay in the react-dom reconciler. */}
      <div className={styles.floorplanPanelRoot}>
        <FloorplanPanel />
      </div>

      <Canvas
        shadows
        gl={{ antialias: true, preserveDrawingBuffer: true }}
        camera={{ fov: 55, near: 0.1, far: 1000 }}
        style={{ touchAction: 'none', cursor: annotateMode ? 'crosshair' : 'default' }}
        onCreated={({ gl }) => { gl.setClearColor('#060d1a') }}
      >
        <CameraRig />
        <ambientLight intensity={0.6} />
        <directionalLight position={[10, 20, 10]} intensity={1.0} />

        {gridSettings.visible && (
          <Grid
            args={[200, 200]}
            cellSize={gridSettings.cellSize}
            cellThickness={0.5}
            cellColor={gridSettings.color}
            sectionSize={gridSettings.cellSize * 5}
            sectionThickness={1.2}
            sectionColor={gridSettings.color}
            fadeDistance={120}
            fadeStrength={1.5}
            position={[0, -0.01, 0]}
          />
        )}

        <FloatingLogo3D />
        <FloorplanOverlay />
        <LiveWallsLayer />

        {model.status === 'building' && <BuildingProgress />}
        {(model.status === 'building' || model.status === 'ready') && (
          <>
            <BuildingModel layers={layers} />
            <ProductPlacements />
            {model.status === 'ready' && <MeasureTool key={measureMode ? 'measure-on' : 'measure-off'} />}
            {model.status === 'ready' && <AnnotationTool onPlaceRequest={handlePlaceRequest} />}
          </>
        )}

        <OrbitControls
          ref={controlsRef}
          makeDefault
          enabled={orbitEnabled}
          enableDamping
          dampingFactor={0.12}
          rotateSpeed={0.6}
          panSpeed={0.7}
          zoomSpeed={0.7}
          minDistance={1}
          maxDistance={200}
          enablePan
          screenSpacePanning
        />
        <CameraPresetApplier controlsRef={controlsRef} />


      </Canvas>

      {model.status === 'building' && (
        <div className={styles.overlay}>
          <div className={styles.buildingMsg}>
            <span className={styles.spinner}>⬡</span>
            Building 3D model…
          </div>
        </div>
      )}

      {/* Drag-over border — only a thin ring, never blocks the workspace */}
      {isDragOver && (
        <div className={styles.dragRing} />
      )}
    </div>
  )
}
