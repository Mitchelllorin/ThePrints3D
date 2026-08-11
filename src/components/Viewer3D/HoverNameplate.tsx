/**
 * HoverNameplate — IN EDIT MODE, point at (hover on desktop / drag-touch on
 * mobile) any built element and a nameplate pops up saying what it is + its
 * metrics, with a cyan halo on the thing you would select.
 *
 * One raycaster reads the mesh under the pointer and shows `userData.info` (rich
 * metrics, set by the geometry builders) or a humanised `userData.layer`
 * fallback — so it identifies everything in the model, not just a few things.
 *
 * EDIT MODE ONLY. This used to run all the time, and because it highlights
 * whatever is under the pointer it read as selecting things while you were only
 * looking: sweeping across a floor lit up subfloor sheets one after another, each
 * with its own name card. On a deck of 30-odd sheets that is a strobe of cyan
 * boxes — the "flashy, glitchy floor sheeting". It is also wasted work, since a
 * raycast ran on every pointer move whether or not anything could be picked.
 */
import { useRef, useState } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { Billboard, Text } from '@react-three/drei'
import { labelText } from './labelStyle'
import { useUISettingsStore } from '../../store/useUISettingsStore'
import { useFloorplanLocalStore } from '../../store/useFloorplanLocalStore'

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
  const editMode = useFloorplanLocalStore((s) => s.editMode)
  const [plate, setPlate] = useState<Plate | null>(null)
  const lastObj = useRef<THREE.Object3D | null>(null)
  const lastPtr = useRef({ x: 2, y: 2 })

  useFrame(() => {
    // Nothing is pickable outside edit mode, so nothing should light up either.
    if (!editMode) {
      if (lastObj.current || plate) { lastObj.current = null; setPlate(null) }
      return
    }
    // Only raycast when the pointer actually moved — cheap when idle.
    if (pointer.x === lastPtr.current.x && pointer.y === lastPtr.current.y) return
    lastPtr.current = { x: pointer.x, y: pointer.y }

    raycaster.setFromCamera(pointer, camera)
    const hits = raycaster.intersectObjects(scene.children, true)
    let obj: THREE.Object3D | null = null
    let text: string | null = null
    for (const h of hits) {
      // LOOK UP THE CHAIN, not just at the mesh that was hit.
      //
      // Most builders stamp every mesh, but a placed object tags its WRAPPER
      // GROUP once and fills it with untagged meshes — so a door, a window or a
      // garage door had nothing to describe at the point of contact and the
      // loop walked straight past them to whatever was behind. Hovering them
      // produced no nameplate and no halo, which reads exactly like the pick
      // being dead even though the group's own pointer handlers were fine.
      // Bounded, because past a few levels the only thing left to find is a
      // whole-scene container, and naming that would be worse than naming
      // nothing.
      let node: THREE.Object3D | null = h.object
      let d: string | null = null
      for (let up = 0; node && !d && up < 4; up++) {
        if (node.userData?.noPick) { node = null; break }
        d = describe(node.userData)
        if (!d) node = node.parent
      }
      if (d && node) { obj = node; text = d; break }
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

  if (!plate || !editMode) return null
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
        <Text {...labelText(0.24 * labelScale, labelColor)}>
          {plate.text}
        </Text>
      </Billboard>
    </>
  )
}
