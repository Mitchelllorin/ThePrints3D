/**
 * TradeLayersRenderer — draws traced trade runs in the 3D scene:
 *   • plumbing as thin cylinders (radius 0.01m), coloured by field convention
 *   • electrical as thin coloured lines
 * Visibility is gated per layer by the store's visibleLayers set. Lines are
 * stored in image-pixel space and placed with the same overlay transform as
 * the walls so they sit exactly on the print.
 */
import { useMemo } from 'react'
import * as THREE from 'three'
import { Line } from '@react-three/drei'
import { useAppStore } from '../../store/useAppStore'
import { plumbingColor, electricalColor } from '../../data/traceLayers'
import type { TracedLine } from '../../types'

const PLUMB_Y = 0.08
const ELEC_Y = 0.14
const UP = new THREE.Vector3(0, 1, 0)

function PlumbCylinder({ a, b, color }: { a: THREE.Vector3; b: THREE.Vector3; color: string }) {
  const dir = new THREE.Vector3().subVectors(b, a)
  const len = dir.length()
  if (len < 0.02) return null
  const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5)
  const quat = new THREE.Quaternion().setFromUnitVectors(UP, dir.clone().normalize())
  return (
    <mesh position={mid} quaternion={quat} castShadow>
      <cylinderGeometry args={[0.01, 0.01, len, 8]} />
      <meshStandardMaterial color={color} roughness={0.5} metalness={0.1} />
    </mesh>
  )
}

export default function TradeLayersRenderer() {
  const drawings = useAppStore((s) => s.drawings)
  const overlay = useAppStore((s) => s.floorplanOverlay)
  const plumbingLines = useAppStore((s) => s.plumbingLines)
  const electricalLines = useAppStore((s) => s.electricalLines)
  const visibleLayers = useAppStore((s) => s.visibleLayers)

  const drawing = drawings.find((d) => d.id === overlay.drawingId) ?? drawings[0] ?? null
  const imageWidth = drawing?.rasterWidth ?? 1400
  const imageHeight = drawing?.rasterHeight ?? 900
  const [overlayW, overlayD] = overlay.scale
  const rotRad = THREE.MathUtils.degToRad(overlay.rotationDeg)

  // Same transform as FloorplanOverlay/LiveWallsLayer so lines land on the print.
  const toWorld = useMemo(() => (px: number, py: number, y: number): THREE.Vector3 => {
    const localX = ((px / imageWidth) - 0.5) * overlayW
    const localZ = ((py / imageHeight) - 0.5) * overlayD
    const v = new THREE.Vector3(localX, 0, localZ).applyAxisAngle(UP, rotRad)
    return new THREE.Vector3(overlay.position[0] + v.x, y, overlay.position[1] + v.z)
  }, [imageWidth, imageHeight, overlayW, overlayD, rotRad, overlay.position])

  const showPlumb = visibleLayers.has('plumbing')
  const showElec = visibleLayers.has('electrical')
  if (!drawing || (!showPlumb && !showElec)) return null
  if (plumbingLines.length === 0 && electricalLines.length === 0) return null

  return (
    <group name="trade-layers">
      {showPlumb && plumbingLines.map((l: TracedLine) => (
        <PlumbCylinder
          key={l.id}
          a={toWorld(l.x1, l.y1, PLUMB_Y)}
          b={toWorld(l.x2, l.y2, PLUMB_Y)}
          color={plumbingColor(l)}
        />
      ))}
      {showElec && electricalLines.map((l: TracedLine) => (
        <Line
          key={l.id}
          points={[toWorld(l.x1, l.y1, ELEC_Y), toWorld(l.x2, l.y2, ELEC_Y)]}
          color={electricalColor(l)}
          lineWidth={3}
        />
      ))}
    </group>
  )
}
