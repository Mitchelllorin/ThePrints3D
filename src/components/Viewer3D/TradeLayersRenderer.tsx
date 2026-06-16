/**
 * TradeLayersRenderer — draws traced trade runs in the 3D scene as real pipe/
 * cable: plumbing & electrical render as 3D cylinders coloured by field
 * convention, and straight runs get a coupling at every stock-length joint
 * (10' or 12', per the pipe-stick setting). Visibility is gated per layer by
 * the store's visibleLayers set; runs are placed with the same overlay
 * transform as the walls so they sit exactly on the print.
 */
import { useMemo } from 'react'
import * as THREE from 'three'
import { useAppStore } from '../../store/useAppStore'
import { useConfigStore } from '../../store/useConfigStore'
import { plumbingColor, electricalColor } from '../../data/traceLayers'
import type { TracedLine } from '../../types'

const PLUMB_Y = 0.08
const ELEC_Y = 0.14
const UP = new THREE.Vector3(0, 1, 0)

/** A straight run rendered as a single pipe with couplings at each stock joint. */
function PipeRun({ a, b, color, radius, stickM, coupling }: {
  a: THREE.Vector3; b: THREE.Vector3; color: string
  radius: number; stickM: number; coupling: boolean
}) {
  const dir = new THREE.Vector3().subVectors(b, a)
  const len = dir.length()
  if (len < 0.02) return null
  const quat = new THREE.Quaternion().setFromUnitVectors(UP, dir.clone().normalize())
  const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5)
  const joints = coupling ? Math.max(0, Math.ceil(len / stickM) - 1) : 0
  return (
    <group>
      <mesh position={mid} quaternion={quat} castShadow>
        <cylinderGeometry args={[radius, radius, len, 10]} />
        <meshStandardMaterial color={color} roughness={0.5} metalness={0.15} />
      </mesh>
      {Array.from({ length: joints }, (_, i) => {
        const t = Math.min(1, ((i + 1) * stickM) / len)
        const p = new THREE.Vector3().lerpVectors(a, b, t)
        return (
          <mesh key={i} position={p} quaternion={quat}>
            <cylinderGeometry args={[radius * 1.6, radius * 1.6, radius * 3.2, 10]} />
            <meshStandardMaterial color={color} roughness={0.4} metalness={0.25} />
          </mesh>
        )
      })}
    </group>
  )
}

export default function TradeLayersRenderer() {
  const drawings = useAppStore((s) => s.drawings)
  const overlay = useAppStore((s) => s.floorplanOverlay)
  const plumbingLines = useAppStore((s) => s.plumbingLines)
  const electricalLines = useAppStore((s) => s.electricalLines)
  const visibleLayers = useAppStore((s) => s.visibleLayers)
  const pipeStickLengthFt = useConfigStore((s) => s.pipeStickLengthFt)
  const stickM = pipeStickLengthFt * 0.3048

  const drawing = drawings.find((d) => d.id === overlay.drawingId) ?? drawings[0] ?? null
  const imageWidth = drawing?.rasterWidth ?? 1400
  const imageHeight = drawing?.rasterHeight ?? 900
  const [overlayW, overlayD] = overlay.scale
  const rotRad = THREE.MathUtils.degToRad(overlay.rotationDeg)

  // Same transform as FloorplanOverlay/LiveWallsLayer so runs land on the print.
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
        <PipeRun
          key={l.id}
          a={toWorld(l.x1, l.y1, PLUMB_Y)}
          b={toWorld(l.x2, l.y2, PLUMB_Y)}
          color={plumbingColor(l)}
          radius={0.013}
          stickM={stickM}
          coupling
        />
      ))}
      {showElec && electricalLines.map((l: TracedLine) => (
        <PipeRun
          key={l.id}
          a={toWorld(l.x1, l.y1, ELEC_Y)}
          b={toWorld(l.x2, l.y2, ELEC_Y)}
          color={electricalColor(l)}
          radius={0.007}
          stickM={stickM}
          coupling={false}
        />
      ))}
    </group>
  )
}
