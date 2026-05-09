import { useCallback, useState, useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import { Html, Line } from '@react-three/drei'
import * as THREE from 'three'
import { useAppStore } from '../../store/useAppStore'
import type { Measurement } from '../../types'

// ─── Single measurement line + label ─────────────────────────────────────────

function MeasurementLine({ m }: { m: Measurement }) {
  const mid: [number, number, number] = [
    (m.pointA[0] + m.pointB[0]) / 2,
    (m.pointA[1] + m.pointB[1]) / 2 + 0.15,
    (m.pointA[2] + m.pointB[2]) / 2,
  ]
  const removeMeasurement = useAppStore((s) => s.removeMeasurement)
  const dist = m.distanceM >= 1 ? `${m.distanceM.toFixed(2)} m` : `${(m.distanceM * 1000).toFixed(0)} mm`

  return (
    <group>
      <Line
        points={[m.pointA, m.pointB]}
        color="#f59e0b"
        lineWidth={2}
        dashed={false}
      />
      {/* End point markers */}
      <mesh position={m.pointA}>
        <sphereGeometry args={[0.06, 8, 8]} />
        <meshBasicMaterial color="#38bdf8" />
      </mesh>
      <mesh position={m.pointB}>
        <sphereGeometry args={[0.06, 8, 8]} />
        <meshBasicMaterial color="#f59e0b" />
      </mesh>
      <Html position={mid} center distanceFactor={10}>
        <div
          style={{
            background: 'rgba(15,23,42,0.92)',
            border: '1px solid #f59e0b',
            borderRadius: 6,
            padding: '3px 8px',
            color: '#fde68a',
            fontSize: 12,
            fontWeight: 700,
            whiteSpace: 'nowrap',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            cursor: 'pointer',
            userSelect: 'none',
          }}
        >
          {dist}
          <span
            style={{ color: '#94a3b8', fontSize: 11, cursor: 'pointer' }}
            onClick={() => removeMeasurement(m.id)}
          >
            ✕
          </span>
        </div>
      </Html>
    </group>
  )
}

// ─── Pending point marker ─────────────────────────────────────────────────────

function PendingMarker({ point }: { point: [number, number, number] }) {
  return (
    <mesh position={point}>
      <sphereGeometry args={[0.08, 10, 10]} />
      <meshBasicMaterial color="#38bdf8" />
    </mesh>
  )
}

// ─── Main tool ────────────────────────────────────────────────────────────────

export default function MeasureTool() {
  const { raycaster, camera, scene, gl } = useThree()
  const measureMode = useAppStore((s) => s.measureMode)
  const measurements = useAppStore((s) => s.measurements)
  const addMeasurement = useAppStore((s) => s.addMeasurement)

  const [pendingA, setPendingA] = useState<[number, number, number] | null>(null)

  const handleCanvasClick = useCallback(
    (e: MouseEvent) => {
      if (!measureMode) return

      const canvas = gl.domElement
      const rect = canvas.getBoundingClientRect()
      const ndc = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
      )
      raycaster.setFromCamera(ndc, camera)

      // Intersect against all visible mesh children in the scene
      const meshes: THREE.Mesh[] = []
      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh && obj.visible) meshes.push(obj)
      })

      const hits = raycaster.intersectObjects(meshes, false)
      if (hits.length === 0) return

      const pt = hits[0].point
      const coord: [number, number, number] = [pt.x, pt.y, pt.z]

      if (!pendingA) {
        setPendingA(coord)
      } else {
        const dx = coord[0] - pendingA[0]
        const dy = coord[1] - pendingA[1]
        const dz = coord[2] - pendingA[2]
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)
        addMeasurement({ label: null, pointA: pendingA, pointB: coord, distanceM: dist })
        setPendingA(null)
      }
    },
    [measureMode, pendingA, raycaster, camera, scene, gl, addMeasurement]
  )

  // Attach/detach click listener on the canvas
  useEffect(() => {
    if (!measureMode) {
      setPendingA(null)
      return
    }
    gl.domElement.addEventListener('click', handleCanvasClick)
    return () => {
      gl.domElement.removeEventListener('click', handleCanvasClick)
    }
  }, [measureMode, handleCanvasClick, gl])

  return (
    <>
      {measurements.map((m) => (
        <MeasurementLine key={m.id} m={m} />
      ))}
      {pendingA && <PendingMarker point={pendingA} />}
    </>
  )
}
