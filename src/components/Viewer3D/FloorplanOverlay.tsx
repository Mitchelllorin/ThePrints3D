import { useEffect, useMemo, useState } from 'react'
import type { ThreeEvent } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import * as THREE from 'three'
import { useAppStore } from '../../store/useAppStore'
import styles from './ModelViewer.module.css'

type DragKind = 'move' | 'corner' | 'edge' | 'rotate'

interface DragState {
  kind: DragKind
  axis?: 'x' | 'z'
  signX?: 1 | -1
  signZ?: 1 | -1
}

const GRID_SNAP = 0.25

function snap(value: number, enabled: boolean) {
  if (!enabled) return value
  return Math.round(value / GRID_SNAP) * GRID_SNAP
}

export default function FloorplanOverlay() {
  const drawings = useAppStore((s) => s.drawings)
  const overlay = useAppStore((s) => s.floorplanOverlay)
  const setOverlayDrawing = useAppStore((s) => s.setFloorplanOverlayDrawing)
  const updateOverlay = useAppStore((s) => s.updateFloorplanOverlay)

  const drawing = drawings.find((d) => d.id === overlay.drawingId) ?? drawings[0] ?? null
  const imageUrl = drawing ? (drawing.rasterUrl ?? drawing.previewUrl) : null
  const texture = useMemo(() => {
    if (!imageUrl) return null
    const t = new THREE.TextureLoader().load(imageUrl)
    t.colorSpace = THREE.SRGBColorSpace
    t.wrapS = THREE.ClampToEdgeWrapping
    t.wrapT = THREE.ClampToEdgeWrapping
    return t
  }, [imageUrl])

  const [drag, setDrag] = useState<DragState | null>(null)

  useEffect(() => {
    if (!drawing || overlay.drawingId) return
    setOverlayDrawing(drawing.id)
  }, [drawing, overlay.drawingId, setOverlayDrawing])

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
    updateOverlay({ scale: estimatedScale })
  }, [drawing, estimatedScale, overlay.scale, updateOverlay])

  if (!drawing || !imageUrl || !texture) return null

  const width = overlay.scale[0]
  const depth = overlay.scale[1]
  const halfW = width / 2
  const halfD = depth / 2
  const rotationRad = THREE.MathUtils.degToRad(overlay.rotationDeg)
  const canEdit = overlay.calibrationMode && !overlay.locked

  const applyMove = (dx: number, dz: number) => {
    updateOverlay({
      position: [
        snap(overlay.position[0] + dx, overlay.snapToGrid),
        snap(overlay.position[1] + dz, overlay.snapToGrid),
      ],
    })
  }

  const applyScale = (dWidth: number, dDepth: number) => {
    updateOverlay({
      scale: [
        Math.max(0.5, snap(width + dWidth, overlay.snapToGrid)),
        Math.max(0.5, snap(depth + dDepth, overlay.snapToGrid)),
      ],
    })
  }

  const onDragStart = (event: ThreeEvent<PointerEvent>, next: DragState) => {
    if (!canEdit) return
    event.stopPropagation()
    event.target.setPointerCapture(event.pointerId)
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
      updateOverlay({ rotationDeg: overlay.rotationDeg + event.movementX * 0.5 })
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
    event.target.releasePointerCapture(event.pointerId)
    setDrag(null)
  }

  return (
    <>
      {overlay.visible && (
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

      <Html fullscreen>
      <div className={styles.floorplanPanel}>
        <div className={styles.floorplanPanelHeader}>
          <strong>2D Print on 3D Grid</strong>
          <button
            className={styles.floorplanBtn}
            onClick={() => updateOverlay({ calibrationMode: true, guidedStep: 1 })}
          >
            Calibrate now
          </button>
        </div>
        <div className={styles.floorplanRow}>
          <label>Print</label>
          <select
            className={styles.floorplanSelect}
            value={drawing.id}
            onChange={(e) => setOverlayDrawing(e.target.value)}
          >
            {drawings.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
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
        {overlay.calibrationMode && (
          <div className={styles.floorplanGuide}>
            <div>
              Step {overlay.guidedStep}/4:{' '}
              {overlay.guidedStep === 1 && 'Drag center to position print over the grid.'}
              {overlay.guidedStep === 2 && 'Drag corner handles to align print corners.'}
              {overlay.guidedStep === 3 && 'Drag edge handles to scale and rotate handle to orient.'}
              {overlay.guidedStep === 4 && 'Enable lock alignment when it matches.'}
            </div>
            <div className={styles.floorplanGuideBtns}>
              <button className={styles.floorplanBtn} onClick={() => updateOverlay({ guidedStep: Math.max(1, overlay.guidedStep - 1) })}>Back</button>
              <button className={styles.floorplanBtn} onClick={() => updateOverlay({ guidedStep: Math.min(4, overlay.guidedStep + 1) })}>Next</button>
              <button className={styles.floorplanBtn} onClick={() => updateOverlay({ calibrationMode: false })}>Done</button>
            </div>
          </div>
        )}
      </div>
      </Html>
    </>
  )
}

const DEFAULT_WIDTH = 12
const DEFAULT_DEPTH = 8
