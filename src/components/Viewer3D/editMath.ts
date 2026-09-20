/**
 * The maths half of "Edit Everything" mode — no JSX, no components.
 *
 * These two functions used to live in `editHelpers.tsx` alongside the drag
 * catcher and the highlight box. A file that exports both components and plain
 * functions cannot be hot-reloaded: React Fast Refresh has no way to tell which
 * export changed, so it throws the whole module away and remounts every layer
 * that imported it. Mid-drag, that is the drag gone.
 *
 * Geometry here, components there. `editHelpers.tsx` keeps the two components
 * and the two constants that describe them.
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
