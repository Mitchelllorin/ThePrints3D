import { useCallback, useEffect, useMemo, useState } from 'react'
import { useThree } from '@react-three/fiber'
import { Line } from '@react-three/drei'
import * as THREE from 'three'
import { useAppStore } from '../../store/useAppStore'
import type { Drawing, Measurement } from '../../types'

const DEFAULT_SCALE_MM_PER_PX = 23.5
const DEFAULT_WALL_ENDPOINT_SNAP_TOLERANCE_PX = 14
const envSnapTolerancePx = Number(import.meta.env.VITE_MEASURE_SNAP_TOLERANCE_PX)
const WALL_ENDPOINT_SNAP_TOLERANCE_PX =
  Number.isFinite(envSnapTolerancePx) && envSnapTolerancePx > 0
    ? envSnapTolerancePx
    : DEFAULT_WALL_ENDPOINT_SNAP_TOLERANCE_PX

interface WallEndpointCandidate {
  x: number
  z: number
  toleranceM: number
}

function centerOfWalls(walls: Drawing['parsedWalls']): [number, number] {
  if (walls.length === 0) return [0, 0]
  let sx = 0
  let sy = 0
  for (const w of walls) {
    sx += (w.x1 + w.x2) / 2
    sy += (w.y1 + w.y2) / 2
  }
  return [sx / walls.length, sy / walls.length]
}

function buildWallEndpointCandidates(drawings: Drawing[]): WallEndpointCandidate[] {
  const parsedDrawings = drawings.filter((d) => d.parsedWalls.length > 0)
  if (parsedDrawings.length === 0) return []

  const ref = parsedDrawings.reduce((a, b) => (a.parsedWalls.length > b.parsedWalls.length ? a : b))
  const [globalCx, globalCy] = centerOfWalls(ref.parsedWalls)
  const globalMmPerPx = ref.scaleMmPerPx ?? DEFAULT_SCALE_MM_PER_PX

  const out: WallEndpointCandidate[] = []
  for (const d of parsedDrawings) {
    const mmPerPx = d.scaleMmPerPx ?? globalMmPerPx
    const worldPerPx = mmPerPx / 1000
    const toleranceM = WALL_ENDPOINT_SNAP_TOLERANCE_PX * worldPerPx
    for (const w of d.parsedWalls) {
      out.push(
        { x: (w.x1 - globalCx) * worldPerPx, z: (w.y1 - globalCy) * worldPerPx, toleranceM },
        { x: (w.x2 - globalCx) * worldPerPx, z: (w.y2 - globalCy) * worldPerPx, toleranceM }
      )
    }
  }
  return out
}

function snapToWallEndpoint(
  point: [number, number, number],
  candidates: WallEndpointCandidate[]
): [number, number, number] {
  let best: WallEndpointCandidate | null = null
  let bestDistSq = Infinity
  for (const c of candidates) {
    const dx = c.x - point[0]
    const dz = c.z - point[2]
    const distSq = dx * dx + dz * dz
    if (distSq <= c.toleranceM * c.toleranceM && distSq < bestDistSq) {
      best = c
      bestDistSq = distSq
    }
  }
  if (!best) return point
  return [best.x, point[1], best.z]
}

// ─── Single measurement line ──────────────────────────────────────────────────

function MeasurementLine({ m }: { m: Measurement }) {
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
  const drawings = useAppStore((s) => s.drawings)

  const [pendingA, setPendingA] = useState<[number, number, number] | null>(null)
  const wallEndpointCandidates = useMemo(() => buildWallEndpointCandidates(drawings), [drawings])

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
      const snappedCoord = snapToWallEndpoint(coord, wallEndpointCandidates)

      if (!pendingA) {
        setPendingA(snappedCoord)
      } else {
        const dx = snappedCoord[0] - pendingA[0]
        const dy = snappedCoord[1] - pendingA[1]
        const dz = snappedCoord[2] - pendingA[2]
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)
        addMeasurement({ label: null, pointA: pendingA, pointB: snappedCoord, distanceM: dist })
        setPendingA(null)
      }
    },
    [measureMode, pendingA, raycaster, camera, scene, gl, addMeasurement, wallEndpointCandidates]
  )

  // Attach/detach click listener on the canvas
  useEffect(() => {
    if (!measureMode) return
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
      {measureMode && pendingA && <PendingMarker point={pendingA} />}
    </>
  )
}
