import { useRef, useEffect, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, Grid } from '@react-three/drei'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { cameraControls } from './cameraControls'
import * as THREE from 'three'
import { useAppStore } from '../../store/useAppStore'
import { useUISettingsStore } from '../../store/useUISettingsStore'
import { useConfigStore } from '../../store/useConfigStore'
import { useFloorplanLocalStore } from '../../store/useFloorplanLocalStore'
import { formatMeasureMm } from '../../services/unitConverter'
/** Ground-floor assembly depth below y=0 (mirrors FLOOR_ASSEMBLY_H in
 *  framingGeometry). Kept as a literal rather than imported: ModelViewer is the
 *  Canvas host, and pulling the geometry module in at this level is a needless
 *  import edge for one number. */
const FLOOR_ASSEMBLY_DEPTH = 0.32
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
import FloorJoistsLayer from './FloorJoistsLayer'
import CeilingLayer from './CeilingLayer'
import RoofLayer from './RoofLayer'
import HoverNameplate from './HoverNameplate'
import ExplodeDriver from './ExplodeDriver'
import DrywallLayer from './DrywallLayer'
import PlacedObjectsLayer from './PlacedObjectsLayer'
import TradeLayersRenderer from './TradeLayersRenderer'
import styles from './ModelViewer.module.css'

function CameraRig() {
  const { camera } = useThree()
  const initialized = useRef(false)
  useEffect(() => {
    if (!initialized.current) {
      // On phones start closer AND steeper (more top-down) so the print on the
      // ground is clearly visible instead of edge-on/flat.
      const mobile = typeof window !== 'undefined' && window.innerWidth < 768
      if (mobile) camera.position.set(6, 12, 6)
      else camera.position.set(12, 10, 12)
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

/**
 * Keeps OrbitControls' ENABLED flag honest.
 *
 * drei's TransformControls writes straight to the controls instance
 * (`controls.enabled = false` while a handle is dragged, `true` on release).
 * That mutation desyncs the instance from our `enabled={orbitEnabled}` prop, and
 * because React then sees no prop CHANGE it never re-applies it — so after any
 * gizmo drag the camera stayed live even while tracing, and the workspace moved
 * under you mid-pull. Reasserting each frame costs one boolean compare and makes
 * our intent the last word.
 */
function OrbitEnabledGuard({ controlsRef, enabled }: {
  controlsRef: React.MutableRefObject<OrbitControlsImpl | null>
  enabled: boolean
}) {
  useFrame(() => {
    const ctrl = controlsRef.current
    if (ctrl && ctrl.enabled !== enabled) ctrl.enabled = enabled
  })
  return null
}

/**
 * Camera tether — you cannot fling the model off into space.
 *
 * OrbitControls pans the TARGET with nothing bounding it, so one stray
 * two-finger drag walks the point-of-interest away and the print sails out of
 * frame with no way back short of hunting for a camera preset. This clamps the
 * target to a leash around the plan's centre every frame.
 *
 * A leash rather than locking the target to dead centre: you still need to pan
 * across a big drawing to work a far corner, you just can't pan PAST the
 * drawing. Leash length is half the plan's diagonal, so the whole print is
 * always reachable and nothing beyond it is. Height is clamped too — the target
 * can't sink under the site or float above the roof.
 */
function CameraTether({ controlsRef }: { controlsRef: React.MutableRefObject<OrbitControlsImpl | null> }) {
  const overlay = useAppStore((s) => s.floorplanOverlay)
  useFrame(() => {
    const ctrl = controlsRef.current
    if (!ctrl) return
    const cx = overlay.position[0]
    const cz = overlay.position[1]
    const [w, d] = overlay.scale
    const leash = Math.max(4, 0.5 * Math.hypot(w, d))
    const dx = ctrl.target.x - cx
    const dz = ctrl.target.z - cz
    const dist = Math.hypot(dx, dz)
    let clamped = false
    if (dist > leash) {
      const k = leash / dist
      ctrl.target.x = cx + dx * k
      ctrl.target.z = cz + dz * k
      clamped = true
    }
    if (ctrl.target.y < -1) { ctrl.target.y = -1; clamped = true }
    else if (ctrl.target.y > 20) { ctrl.target.y = 20; clamped = true }
    // Only re-sync when we actually pulled it back, so normal orbiting keeps
    // its damping untouched and this costs nothing on a free camera.
    if (clamped) ctrl.update()
  })
  return null
}

/**
 * Camera pose that frames the whole print: target = the print's centre on the
 * ground, distance sized to fit the plan's bounding CIRCLE inside the FOV (so
 * it's rotation- and aspect-proof — portrait phones use the tighter horizontal
 * FOV), viewed from a near-top-down angle on phones / a friendly iso angle on
 * desktop. Lands the plan centred and full, ready to trace with zero manual
 * panning or zooming.
 */
function framePrintPreset(
  width: number, depth: number, position: [number, number],
  aspect: number, fovDeg: number, mobile: boolean,
) {
  const target: [number, number, number] = [position[0], 0, position[1]]
  const vfov = (fovDeg * Math.PI) / 180
  const hfov = 2 * Math.atan(Math.tan(vfov / 2) * Math.max(0.0001, aspect))
  const minFov = Math.min(vfov, hfov)
  const radius = 0.5 * Math.hypot(width, depth)
  const dist = (radius / Math.sin(minFov / 2)) * 1.15   // 15% breathing room
  const dx = mobile ? 0.32 : 0.8
  const dy = mobile ? 1.0 : 0.85
  const dz = mobile ? 0.32 : 0.8
  const len = Math.hypot(dx, dy, dz)
  return {
    position: [
      target[0] + (dx / len) * dist,
      (dy / len) * dist,
      target[2] + (dz / len) * dist,
    ] as [number, number, number],
    target,
  }
}

/**
 * Auto-frames the print the moment a drawing loads — and re-fits once when its
 * footprint settles (after the scale estimate / calibration) — so the plan
 * lands centred and full and the user never has to position it. Edge-triggered
 * per drawing+footprint so it doesn't fight manual camera moves afterwards.
 */
function PrintAutoFrame() {
  const { size } = useThree()
  const drawingId = useAppStore((s) => s.floorplanOverlay.drawingId)
  const scale = useAppStore((s) => s.floorplanOverlay.scale)
  const position = useAppStore((s) => s.floorplanOverlay.position)
  const setCameraPreset = useAppStore((s) => s.setCameraPreset)
  const lastKey = useRef<string | null>(null)

  useEffect(() => {
    if (!drawingId) { lastKey.current = null; return }
    const [w, d] = scale
    if (!w || !d) return
    // Reframe on a new drawing OR when its rounded footprint changes (scale
    // estimate / calibration) — not on every tiny jitter, so we don't yank the
    // camera while the user works.
    const key = `${drawingId}:${Math.round(w)}x${Math.round(d)}`
    if (lastKey.current === key) return
    lastKey.current = key
    const mobile = typeof window !== 'undefined' && window.innerWidth < 768
    setCameraPreset(framePrintPreset(w, d, position, size.width / size.height, 55, mobile))
  }, [drawingId, scale, position, size.width, size.height, setCameraPreset])

  return null
}

/**
 * Recenters the print into the VISIBLE area whenever a side drawer is open, so
 * the user never has to pan to re-center. Uses a camera view-offset — it shifts
 * the rendered framing without moving the camera/target, so orbit and zoom are
 * untouched — and clears it when the drawer closes. The left (Build) drawer
 * pushes content right into the space beside it; the right (Settings) drawer
 * pushes it left. The bottom (Place) drawer's height is content-driven, so
 * vertical recentering is left alone.
 */
/** Width of the permanent left edge rail (Build/Ask/Settings/Place). The plan is
 *  framed clear of it so nothing traceable ever sits under the tabs. */
const RAIL_CLEAR_PX = 48

function DrawerRecenter() {
  const { camera, size } = useThree()
  const buildOpen = useFloorplanLocalStore((s) => s.buildDrawerOpen)
  const settingsOpen = useFloorplanLocalStore((s) => s.settingsDrawerOpen)
  const placeOpen = useFloorplanLocalStore((s) => s.placeDrawerOpen)
  // While TRACING or CALIBRATING, never apply a view-offset: shifting the
  // rendered plan under the pointer makes taps feel like the cursor is "pulled
  // away" and can drop a point at the wrong spot (a stray wall). Taps must map
  // 1:1 to what the user sees during a run.
  const traceMode = useFloorplanLocalStore((s) => s.traceMode)
  const placeObjectType = useFloorplanLocalStore((s) => s.placeObjectType)
  const calibrationMode = useAppStore((s) => s.floorplanOverlay.calibrationMode)
  useEffect(() => {
    const cam = camera as THREE.PerspectiveCamera
    const w = size.width, h = size.height
    const drawerW = Math.min(248, 0.72 * w)   // matches the EdgeDrawer CSS width
    // No view-offset while an ACTION owns the pointer (tracing, calibrating, or
    // PLACING) — shifting the plan makes the tap land off where you aimed, so a
    // placed object appears to "disappear" (lands elsewhere / the view jumps).
    // …but the RAIL offset is constant, so it still applies. The left edge rail
    // (Build/Ask/Settings/Place) permanently covers ~48px of the workspace, and
    // with the plan dead-centre a wall corner underneath it cannot be tapped —
    // so a wall run could not be closed. Nudging the framing right clears the
    // rail. A CONSTANT offset is safe during a run: what breaks taps is the
    // offset CHANGING mid-action (the plan slides under your finger). This one
    // is identical before, during and after, and the raycaster reads the same
    // projection matrix it modifies, so taps still land 1:1.
    if (traceMode || calibrationMode || placeObjectType) {
      cam.setViewOffset(w, h, -RAIL_CLEAR_PX / 2, 0, w, h)
      cam.updateProjectionMatrix()
      return
    }
    // Shift the RENDERED framing (not the camera) so the plan re-centres in the
    // area the open drawer leaves visible — the plan must stay centred in the
    // workspace AT ALL TIMES, even on a phone where a drawer covers most of the
    // width. Shifting by half the drawer size lands the plan dead-centre of the
    // remaining sliver, so it's always fully on-screen (just smaller) rather
    // than hidden behind the menu. Negative offsetX shifts content RIGHT (into
    // the space beside a left drawer); positive offsetX shifts LEFT (beside a
    // right drawer); positive offsetY shifts content UP (above the bottom Place
    // drawer, whose height is ~40dvh of catalog).
    // Build and Settings both open from the LEFT now (beside the rail), so both
    // shift the plan RIGHT into the visible sliver.
    const offsetX = (buildOpen || settingsOpen ? -drawerW / 2 : 0) - RAIL_CLEAR_PX / 2
    const offsetY = placeOpen ? h * 0.2 : 0
    if (offsetX === 0 && offsetY === 0) cam.clearViewOffset()
    else cam.setViewOffset(w, h, offsetX, offsetY, w, h)
    cam.updateProjectionMatrix()
  }, [camera, size.width, size.height, buildOpen, settingsOpen, placeOpen, traceMode, calibrationMode, placeObjectType])
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
            Add Pin
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
    opacity: s.gridOpacity,
    color: s.gridColor,
    cellSize: s.gridCellSize,
  })))
  const scene = useUISettingsStore(useShallow((s) => ({
    bg: s.bgColor,
    lightColor: s.lightColor,
    dir: s.dirIntensity,
    ambient: s.ambientIntensity,
  })))

  // drei's Grid has no opacity prop — dim the line colour by the grid's OWN
  // opacity (toward black), independent of the background. So the Background
  // colour drives only the backdrop, and the grid's colour/brightness is its
  // own separate control.
  const gridColor = new THREE.Color(gridSettings.color).multiplyScalar(
    Math.max(0.05, gridSettings.opacity),
  )
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
  const explodeAmount  = useAppStore((s) => s.explodeAmount)
  const setExplodeAmount = useAppStore((s) => s.setExplodeAmount)
  const activeUnit     = useConfigStore((s) => s.activeUnit)
  const lengthFormat   = useConfigStore((s) => s.lengthFormat)
  const controlsRef    = useRef<OrbitControlsImpl | null>(null)
  const gestureLock    = useFloorplanLocalStore((s) => s.gestureLock)
  const [measurementsPanelCollapsed, setMeasurementsPanelCollapsed] = useState(false)
  const [pendingForm, setPendingForm]   = useState<FormState | null>(null)
  // Construction wizard is opened from Settings → "Re-run Wizard" via the store.
  const wizardOpen     = useFloorplanLocalStore((s) => s.wizardOpen)
  const setWizardOpen  = useFloorplanLocalStore((s) => s.setWizardOpen)
  const traceMode      = useFloorplanLocalStore((s) => s.traceMode)
  const tracePaused    = useFloorplanLocalStore((s) => s.tracePaused)
  const placeObjectType = useFloorplanLocalStore((s) => s.placeObjectType)
  const [exportOpen, setExportOpen]     = useState(false)
  const [isDragOver, setIsDragOver]     = useState(false)
  const hasWalls      = drawings.some((d) => d.parsedWalls.length > 0)

  // UI reset: the old top toolbar + camera HUD are retired. Their actions live
  // in the top-right icons (Rebuild/Trace/Layers/Settings/Undo) and the Settings
  // panel (Annotate/Share/Measure/Recalibrate). Flag kept for quick reference.
  const SHOW_LEGACY_TOOLBAR = false

  // Zoom is driven from TopIcons (DOM) via the cameraControls singleton, which
  // mirrors the OrbitControls ref above — so the +/- sat inline with Undo/Redo.

  // The camera stays free to orbit even mid-trace — it's only locked while a
  // gesture must own the pointer (dragging an overlay handle or freehand-drawing).
  // Pan is disabled while actively tracing (not paused) so accidental two-finger
  // swipes don't shift the camera target while tapping trace points. When trace
  // is paused (double-tap to look around) pan is re-enabled so users can
  // re-center the print if it has drifted out of view.
  // LOCK the workspace while an object is armed for placement — the action owns
  // the pointer, so a tap/drag places precisely instead of orbiting the camera
  // (fighting the workspace). Same "action locks, idle unlocks" model as tracing.
  const placing = !!placeObjectType
  // gestureLock is raised by ANY layer that has grabbed the pointer for a drag
  // (roof ridge/body, floor deck, placed object). Without it the camera orbited
  // underneath the drag and you fought the workspace the entire time you were
  // editing. Same "action locks, idle unlocks" model as tracing and placing.
  const orbitEnabled = !overlay.orbitLocked && !placing && !gestureLock
  const panEnabled = (!traceMode || tracePaused) && !placing

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
      {/* Toolbar overlay — retired in the UI reset (see SHOW_LEGACY_TOOLBAR). */}
      {SHOW_LEGACY_TOOLBAR && model.status === 'ready' && (
        <div className={styles.toolbar}>
          <button
            className={`${styles.toolBtn} ${overlay.calibrationMode ? styles.toolBtnActive : ''}`}
            onClick={handleRecalibrate}
            title="Re-set the real-world scale — pick two points and confirm the distance"
            data-testid="recalibrate-btn"
          >
            {overlay.calibrationMode ? 'Calibrating…' : 'Recalibrate'}
          </button>
          <button
            className={`${styles.toolBtn} ${measureMode ? styles.toolBtnActive : ''}`}
            onClick={() => setMeasureMode(!measureMode)}
            title="Measure distances (click two points)"
          >
            {measureMode ? 'Measuring…' : 'Measure'}
          </button>
          {measurements.length > 0 && (
            <button
              className={styles.toolBtn}
              onClick={clearMeasurements}
              title="Clear all measurements"
            >
              Clear ({measurements.length})
            </button>
          )}
          {/* Export menu — collapses Annotate + Share PNG to save toolbar space. */}
          <div className={styles.exportWrap}>
            <button
              className={`${styles.toolBtn} ${exportOpen || annotateMode ? styles.toolBtnActive : ''}`}
              onClick={() => setExportOpen((v) => !v)}
              title="Annotate or export the view"
            >
              Export ▾
            </button>
            {exportOpen && (
              <div className={styles.exportMenu}>
                <button
                  className={styles.toolBtn}
                  onClick={() => { setAnnotateMode(!annotateMode); setPendingForm(null); setExportOpen(false) }}
                >
                  {annotateMode ? 'Stop annotating' : 'Annotate'}
                  {annotations.length > 0 && !annotateMode && <span className={styles.toolBadge}>{annotations.length}</span>}
                </button>
                <button
                  className={styles.toolBtn}
                  onClick={() => {
                    setExportOpen(false)
                    const canvas = document.querySelector('canvas') as HTMLCanvasElement | null
                    if (!canvas) return
                    try {
                      const dataUrl = canvas.toDataURL('image/png')
                      const a = document.createElement('a')
                      a.href = dataUrl
                      a.download = `theprints3d-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`
                      a.click()
                    } catch (err) {
                      console.error('Snapshot failed:', err)
                      alert('Snapshot failed — try again after orbiting the view once.')
                    }
                  }}
                  data-testid="share-png-btn"
                >
                  Share PNG
                </button>
              </div>
            )}
          </div>
          {hasWalls && (
            <>
              {!buildResult && (
                <button
                  className={styles.toolBtn}
                  onClick={() => { buildForMe(); setWizardOpen(false) }}
                  title="Auto-build framing from detected walls — takes all defaults"
                  data-testid="build-for-me-btn"
                >
                  Build for me
                </button>
              )}
              {/* Wizard only while setup is incomplete (before a build exists). */}
              {!buildResult && (
                <button
                  className={`${styles.toolBtn} ${wizardOpen ? styles.toolBtnActive : ''}`}
                  onClick={() => {
                    if (!buildResult) buildForMe()
                    setWizardOpen(!wizardOpen)
                  }}
                  title="Walk construction decisions step by step"
                  data-testid="wizard-btn"
                >
                  Wizard
                </button>
              )}
            </>
          )}
          <label className={styles.explodeControl} title="Separate every component outward from the model centre">
            <span>Explode</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={explodeAmount}
              onChange={(e) => setExplodeAmount(Number(e.target.value))}
              className={styles.explodeSlider}
              data-testid="explode-slider"
            />
          </label>
          {(measureMode || annotateMode) && (
            <span className={styles.toolHint}>
              {measureMode ? 'Click a surface to place point A, then point B' : 'Click a surface to place an annotation pin'}
            </span>
          )}
        </div>
      )}

      {/* Camera preset HUD — retired in the UI reset. */}
      {SHOW_LEGACY_TOOLBAR && (model.status === 'ready' || model.status === 'building') && <CameraHud />}

      {/* Zoom moved to TopIcons (top-right, inline with Undo/Redo, same style). */}

      {measureMode && model.status === 'ready' && (
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
                  // Same formatter as the live trace readout — one source of truth.
                  const value = formatMeasureMm(m.distanceM * 1000, activeUnit, lengthFormat)
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

      {/* Construction Wizard — step-through decisions panel (opened from Settings).
          Wrapped with a fixed close button so it's dismissable in the 5-button model. */}
      {wizardOpen && (
        <>
          <button className={styles.wizardClose} onClick={() => setWizardOpen(false)} aria-label="Close wizard">✕</button>
          <ConstructionWizard />
        </>
      )}

      {/* FloorplanPanel renders DOM controls (inputs, buttons) outside the
         Canvas so they stay in the react-dom reconciler. */}
      <div className={styles.floorplanPanelRoot}>
        <FloorplanPanel />
      </div>

      <Canvas
        shadows
        dpr={[1, 2]}
        gl={{ antialias: true, preserveDrawingBuffer: true }}
        camera={{ fov: 55, near: 0.1, far: 1000 }}
        style={{ touchAction: 'none', cursor: annotateMode ? 'crosshair' : 'default' }}
        onPointerMissed={() => {
          const local = useFloorplanLocalStore.getState()
          // A tap that hit nothing must NOT cancel an armed placement.
          // MEASURED: the placement catcher is occasionally missed on pointer-
          // down (a frame-timing artefact), and cancelling here disarmed the
          // tray item silently — so that tap placed nothing AND the next tap
          // placed nothing either, because the catcher unmounts along with the
          // arming. That is the whole "placement is intermittent, no rhyme nor
          // reason" report: 4 of 5 identical clicks placed nothing.
          // Staying armed makes a missed frame cost one retry instead of
          // silently dropping the tool. Placement still ends deliberately —
          // Escape, re-tapping the tray item, or actually placing.
          if (local.placeObjectType) return
          // Tap on empty canvas (not a wall/object) dismisses every open
          // card/picker/panel and clears the active selection.
          local.closeAllPanels()
        }}
      >
        <CameraRig />
        <PrintAutoFrame />
        <DrawerRecenter />
        {/* Live workspace background — drives the canvas clear colour. */}
        <color attach="background" args={[scene.bg]} />
        {/* Lighting for FORM, so a stud cage reads as studs (not a flat block):
            a hemisphere gradient + a shadow-casting key + a soft opposite fill.
            Key shadows give the gaps between studs real contrast. */}
        <ambientLight intensity={scene.ambient} color={scene.lightColor} />
        <hemisphereLight args={['#dbeafe', '#1b2430', 0.45]} />
        <directionalLight
          position={[14, 26, 12]}
          intensity={scene.dir}
          color={scene.lightColor}
          castShadow
          shadow-mapSize={[2048, 2048]}
          shadow-bias={-0.0004}
          shadow-camera-near={0.5}
          shadow-camera-far={150}
          shadow-camera-left={-45}
          shadow-camera-right={45}
          shadow-camera-top={45}
          shadow-camera-bottom={-45}
        />
        <directionalLight position={[-12, 10, -8]} intensity={scene.dir * 0.3} color={scene.lightColor} />

        {gridSettings.visible && (
          <Grid
            args={[200, 200]}
            cellSize={gridSettings.cellSize}
            cellThickness={0.5}
            cellColor={gridColor}
            sectionSize={gridSettings.cellSize * 5}
            sectionThickness={1.2}
            sectionColor={gridColor}
            fadeDistance={120}
            fadeStrength={1.5}
            /* GRADE sits below the floor assembly, not inside it.
               This was -0.01, which put the grid plane 10mm under the finished
               floor — straight through the middle of the 19mm subfloor sheets
               (they hang from y=0 down to -SUBFLOOR_T). Two coplanar-ish surfaces
               fighting for the same depth is what made the floor sheeting flash
               and crawl as the camera moved: grid lines popping through the
               plywood, then losing, then winning again.
               The ground-floor assembly is FLOOR_ASSEMBLY_H deep below y=0, so
               grade goes just under that and nothing shares its depth. */
            position={[0, -(FLOOR_ASSEMBLY_DEPTH + 0.02), 0]}
          />
        )}

        <FloorplanOverlay />
        <ExplodeDriver />
        <LiveWallsLayer />
        <FloorJoistsLayer />
        <CeilingLayer />
        <RoofLayer />
        <HoverNameplate />
        <DrywallLayer />
        <PlacedObjectsLayer />
        <TradeLayersRenderer />

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
          ref={(r) => { controlsRef.current = r; cameraControls.current = r }}
          makeDefault
          enabled={orbitEnabled}
          enableDamping
          dampingFactor={0.12}
          rotateSpeed={0.6}
          panSpeed={0.7}
          zoomSpeed={0.7}
          minDistance={1}
          maxDistance={200}
          enablePan={panEnabled}
          screenSpacePanning
        />
        <OrbitEnabledGuard controlsRef={controlsRef} enabled={orbitEnabled} />
        <CameraPresetApplier controlsRef={controlsRef} />
        <CameraTether controlsRef={controlsRef} />


      </Canvas>

      {/* No "Building 3D model…" popup — the 3D just updates as you trace; a
          flashing build banner on every rebuild is noise. */}

      {/* Drag-over border — only a thin ring, never blocks the workspace */}
      {isDragOver && (
        <div className={styles.dragRing} />
      )}
    </div>
  )
}
