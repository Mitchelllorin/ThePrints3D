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
/** Scratch plane for a floor above grade — reused so this allocates nothing. */
const LEVEL_PLANE = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)

/**
 * World point where the pointer ray meets a horizontal floor, or null.
 *
 * `y` is the elevation of the floor you are working on, and it matters more than
 * it looks: the camera looks DOWN, so a ray hits y=0 at a completely different
 * x/z than it hits the second-floor deck. Casting everything at grade meant that
 * on an upper storey the thing you were placing landed away from your cursor,
 * and the higher the storey the further off it drifted. Defaults to 0, so every
 * ground-floor caller is unchanged.
 */
export function rayToGround(e: ThreeEvent<PointerEvent>, y = 0): THREE.Vector3 | null {
  const p = new THREE.Vector3()
  if (y === 0) return e.ray.intersectPlane(GROUND, p) ? p : null
  // Plane constant is the NEGATIVE offset along the normal.
  LEVEL_PLANE.constant = -y
  return e.ray.intersectPlane(LEVEL_PLANE, p) ? p : null
}

/** Movement under this (screen px, summed) counts as a tap, not a drag. */
export const EDIT_TAP_PX = 5

/**
 * How see-through an X-rayed element is — ONE number, because an element is not
 * one mesh.
 *
 * A wall is studs, sheathing, housewrap, cladding and board. X-ray used to reach
 * only the studs, which are the part already hidden inside the other four: you
 * pressed the button, the rail said it was on, and the wall looked exactly the
 * same. Every layer that draws part of an element reads this, so "X-ray" means
 * the whole element goes see-through, not one hidden slice of it.
 */
export const XRAY_OPACITY = 0.16

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
