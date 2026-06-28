/**
 * Shared helpers for "Edit Everything" mode — the post-build state where hovering
 * highlights any element and pressing drags it. Kept tiny and framework-plain so
 * every layer (floors, roofs, objects, walls, MEP) drives the SAME interaction.
 *
 * Drag model: project the pointer ray onto the ground plane (y=0) so the element
 * tracks the finger exactly (the "follows your finger, drop it" feel), and keep a
 * live WORLD offset during the drag — the store is written ONCE on release so the
 * undo history gets a single entry, not one per frame.
 */
import * as THREE from 'three'
import type { ThreeEvent } from '@react-three/fiber'

const GROUND = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
const UP = new THREE.Vector3(0, 1, 0)

/** World point where the pointer ray meets the ground (y=0), or null. */
export function rayToGround(e: ThreeEvent<PointerEvent>): THREE.Vector3 | null {
  const p = new THREE.Vector3()
  return e.ray.intersectPlane(GROUND, p) ? p : null
}

/** Movement under this (screen px, summed) counts as a tap, not a drag. */
export const EDIT_TAP_PX = 5

/**
 * Convert a WORLD-space delta (metres) into an image-PIXEL delta, undoing the
 * overlay rotation + scale — so an area drag tracks the cursor on the print and
 * the stored pixel rect moves the right amount.
 */
export function worldDeltaToPixel(
  dx: number, dz: number,
  rotRad: number, overlayW: number, overlayD: number, imageWidth: number, imageHeight: number,
): [number, number] {
  const v = new THREE.Vector3(dx, 0, dz).applyAxisAngle(UP, -rotRad)
  return [(v.x / overlayW) * imageWidth, (v.z / overlayD) * imageHeight]
}

/** Inside-out catcher sphere — keeps pointer move/up firing once the finger
 *  leaves the grabbed element. Render only while a drag is live. */
export function EditDragCatcher({
  onMove, onUp,
}: {
  onMove: (e: ThreeEvent<PointerEvent>) => void
  onUp: (e: ThreeEvent<PointerEvent>) => void
}) {
  return (
    <mesh onPointerMove={onMove} onPointerUp={onUp} renderOrder={999}>
      <sphereGeometry args={[800, 8, 6]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} side={THREE.BackSide} />
    </mesh>
  )
}

/**
 * Flat translucent highlight box for an area-style element (floor/roof). Drawn at
 * the element's footprint so a hover/selection reads instantly. `hovered` is a
 * brighter cyan; otherwise a soft amber "selected" wash.
 */
export function AreaHighlight({
  lenX, lenZ, position, rotRad, hovered,
}: {
  lenX: number; lenZ: number; position: [number, number, number]; rotRad: number; hovered: boolean
}) {
  return (
    <mesh position={position} rotation={[0, rotRad, 0]} renderOrder={998}>
      <boxGeometry args={[lenX + 0.08, 0.08, lenZ + 0.08]} />
      <meshBasicMaterial
        color={hovered ? '#22d3ee' : '#facc15'}
        transparent
        opacity={hovered ? 0.32 : 0.2}
        depthWrite={false}
      />
    </mesh>
  )
}
