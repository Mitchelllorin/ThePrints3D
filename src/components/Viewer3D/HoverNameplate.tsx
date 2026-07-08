/**
 * HoverNameplate — point at (hover on desktop / drag-touch on mobile) ANY built
 * element and a nameplate pops up saying what it is + its metrics.
 *
 * One raycaster reads the mesh under the pointer and shows `userData.info` (rich
 * metrics, set by the geometry builders) or a humanised `userData.layer`
 * fallback — so it identifies everything in the model, not just a few things.
 */
import { useRef, useState } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { Billboard, Text } from '@react-three/drei'
import { useUISettingsStore } from '../../store/useUISettingsStore'

interface Plate {
  pos: [number, number, number]
  text: string
  /** World-AABB of the hovered element, so we can draw a highlight box on it. */
  center: [number, number, number]
  size: [number, number, number]
}

const LAYER_NAMES: Record<string, string> = {
  floors: 'Floor joist',
  'floor-sheeting': 'Subfloor sheet',
  walls: 'Wall',
  framing: 'Stud framing',
  roof: 'Roof rafter',
  structure: 'Structure',
  ceiling: 'Ceiling',
  mep: 'MEP run',
  electrical: 'Electrical',
  plumbing: 'Plumbing',
  mechanical: 'HVAC',
}

function describe(ud: Record<string, unknown> | undefined): string | null {
  if (!ud || ud.noPick) return null
  if (typeof ud.info === 'string') return ud.info
  if (typeof ud.layer === 'string') return LAYER_NAMES[ud.layer] ?? ud.layer
  return null
}

export default function HoverNameplate() {
  const { camera, scene, raycaster, pointer } = useThree()
  const labelColor = useUISettingsStore((s) => s.labelColor)
  const labelScale = useUISettingsStore((s) => s.labelScale)
  const [plate, setPlate] = useState<Plate | null>(null)
  const lastObj = useRef<THREE.Object3D | null>(null)
  const lastPtr = useRef({ x: 2, y: 2 })

  useFrame(() => {
    // Only raycast when the pointer actually moved — cheap when idle.
    if (pointer.x === lastPtr.current.x && pointer.y === lastPtr.current.y) return
    lastPtr.current = { x: pointer.x, y: pointer.y }

    raycaster.setFromCamera(pointer, camera)
    const hits = raycaster.intersectObjects(scene.children, true)
    let obj: THREE.Object3D | null = null
    let text: string | null = null
    for (const h of hits) {
      const d = describe(h.object.userData)
      if (d) { obj = h.object; text = d; break }
    }
    if (obj === lastObj.current) return
    lastObj.current = obj
    if (!obj || !text) { setPlate(null); return }
    const box = new THREE.Box3().setFromObject(obj)
    const c = box.getCenter(new THREE.Vector3())
    const s = box.getSize(new THREE.Vector3())
    setPlate({
      pos: [c.x, box.max.y + 0.22, c.z],
      text,
      center: [c.x, c.y, c.z],
      size: [s.x, s.y, s.z],
    })
  })

  if (!plate) return null
  // A small padding so the highlight box reads as a halo around the element
  // rather than z-fighting its own faces.
  const pad = 0.06
  return (
    <>
      {/* Hover highlight — a translucent cyan box on the element under the
          pointer, so pointing at anything shows what you'd select. Works for
          every built element (walls/floors/roof/objects/MEP) because it reads the
          same userData the nameplate does. Non-destructive: no material edits. */}
      <mesh position={plate.center} renderOrder={997}>
        <boxGeometry args={[plate.size[0] + pad, plate.size[1] + pad, plate.size[2] + pad]} />
        <meshBasicMaterial color="#22d3ee" transparent opacity={0.22} depthWrite={false} depthTest={false} />
      </mesh>
      <Billboard position={plate.pos}>
        <Text fontSize={0.24 * labelScale} color={labelColor} anchorX="center" anchorY="middle" outlineWidth={0.024 * labelScale} outlineColor="#0b1120">
          {plate.text}
        </Text>
      </Billboard>
    </>
  )
}
