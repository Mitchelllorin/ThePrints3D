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
  const [plate, setPlate] = useState<{ pos: [number, number, number]; text: string } | null>(null)
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
    setPlate({ pos: [c.x, box.max.y + 0.22, c.z], text })
  })

  if (!plate) return null
  return (
    <Billboard position={plate.pos}>
      <Text fontSize={0.24 * labelScale} color={labelColor} anchorX="center" anchorY="middle" outlineWidth={0.024 * labelScale} outlineColor="#0b1120">
        {plate.text}
      </Text>
    </Billboard>
  )
}
