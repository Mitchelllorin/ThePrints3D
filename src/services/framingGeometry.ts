/**
 * framingGeometry — shared stud-framing geometry so the live trace preview and
 * the built model draw the SAME studs and plates (never solid boxes).
 *
 * Produces a wall's stud cage centred on the origin along X (−L/2 … +L/2),
 * sitting on the floor (Y 0 … height). The caller positions/rotates the group
 * to seat it on the traced wall — exactly where the solid box used to go.
 */
import * as THREE from 'three'

const STUD_WIDTH_M = 0.038   // 1-1/2" nominal stud face
const PLATE_H_M = 0.038      // plate thickness
const STUD_SPACING_M = 0.4064 // 16" on-centre

export interface WallFramingOpts {
  /** Wall run length, metres. */
  length: number
  /** Wall height, metres (floor to top of top plate). */
  height: number
  /** Wall thickness, metres (stud depth). */
  thickness: number
  /** Stud on-centre spacing, metres. Defaults to 16" OC. */
  spacingM?: number
  /** Lumber colour. */
  color?: string
  /** 0–1; < 1 renders translucent (used for the ghost preview). */
  opacity?: number
}

/**
 * Build the stud cage (bottom plate, top plate, studs at spacing) for one wall.
 * Returns a THREE.Group the caller can position and rotate.
 */
export function buildWallFraming(opts: WallFramingOpts): THREE.Group {
  const {
    length,
    height,
    thickness,
    spacingM = STUD_SPACING_M,
    color = '#c9a56c',
    opacity = 1,
  } = opts

  const group = new THREE.Group()
  if (length < 0.02 || height < 0.05) return group

  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    roughness: 0.75,
    metalness: 0.05,
    transparent: opacity < 1,
    opacity,
  })
  const depth = Math.max(STUD_WIDTH_M, thickness)

  // Top + bottom plates run the full length.
  const plateGeo = new THREE.BoxGeometry(length, PLATE_H_M, depth)
  const bottomPlate = new THREE.Mesh(plateGeo, mat)
  bottomPlate.position.set(0, PLATE_H_M / 2, 0)
  group.add(bottomPlate)
  const topPlate = new THREE.Mesh(plateGeo, mat)
  topPlate.position.set(0, height - PLATE_H_M / 2, 0)
  group.add(topPlate)

  // Studs between the plates, at spacing, with a stud guaranteed at each end.
  const studH = Math.max(0.02, height - 2 * PLATE_H_M)
  const studGeo = new THREE.BoxGeometry(STUD_WIDTH_M, studH, depth)
  const studY = PLATE_H_M + studH / 2
  const half = length / 2
  const positions = new Set<number>()
  for (let x = -half; x < half; x += spacingM) positions.add(Math.round(x * 1000) / 1000)
  positions.add(Math.round(half * 1000) / 1000) // end stud
  for (const x of positions) {
    const stud = new THREE.Mesh(studGeo, mat)
    stud.position.set(x, studY, 0)
    group.add(stud)
  }

  for (const child of group.children) {
    if (child instanceof THREE.Mesh) { child.castShadow = true; child.receiveShadow = true }
    child.userData.layer = 'framing'
  }
  return group
}
