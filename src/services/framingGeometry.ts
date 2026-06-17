/**
 * framingGeometry — shared stud-framing geometry so the live trace preview and
 * the built model draw the SAME studs and plates (never solid boxes).
 *
 * Produces a wall's stud cage centred on the origin along X (−L/2 … +L/2),
 * sitting on the floor (Y 0 … height). The caller positions/rotates the group
 * to seat it on the traced wall — exactly where the solid box used to go.
 *
 * Real-world detail modelled: double bottom plate + double top plate, studs at
 * 16" OC, doubled end studs (corner/end posts, so perpendicular walls read as
 * connected), and a mid-height row of blocking between studs.
 */
import * as THREE from 'three'

const STUD_WIDTH_M = 0.038    // 1-1/2" nominal stud face
const PLATE_H_M = 0.038       // one plate's thickness
const STUD_SPACING_M = 0.4064 // 16" on-centre

export interface WallFramingOpts {
  /** Wall run length, metres. */
  length: number
  /** Wall height, metres (floor to top of the upper top plate). */
  height: number
  /** Wall thickness, metres (stud depth). */
  thickness: number
  /** Stud on-centre spacing, metres. Defaults to 16" OC. */
  spacingM?: number
  /** Framing material — drives colour/finish: tan lumber vs silvery steel. */
  material?: 'wood' | 'steel'
  /** Lumber colour override. */
  color?: string
  /** 0–1; < 1 renders translucent (used for the ghost preview). */
  opacity?: number
}

/**
 * Build the stud cage for one wall: 2 bottom plates, 2 top plates, studs at
 * spacing with doubled end posts, and a mid-height blocking row.
 * Returns a THREE.Group the caller positions and rotates.
 */
export function buildWallFraming(opts: WallFramingOpts): THREE.Group {
  const {
    length,
    height,
    thickness,
    spacingM = STUD_SPACING_M,
    material = 'wood',
    opacity = 1,
  } = opts

  const group = new THREE.Group()
  if (length < 0.02 || height < 0.05) return group

  const steel = material === 'steel'
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(opts.color ?? (steel ? '#9aa6b2' : '#c9a56c')),
    roughness: steel ? 0.35 : 0.75,
    metalness: steel ? 0.85 : 0.05,
    transparent: opacity < 1,
    opacity,
  })
  const depth = Math.max(STUD_WIDTH_M, thickness)
  const add = (geo: THREE.BufferGeometry, x: number, y: number, z = 0) => {
    const m = new THREE.Mesh(geo, mat)
    m.position.set(x, y, z)
    m.castShadow = true
    m.receiveShadow = true
    m.userData.layer = 'framing'
    group.add(m)
  }

  // Plates/track differ by material:
  //   Wood  → double bottom plate + double top plate.
  //   Steel → single shallow track at the bottom, deep track at the top.
  let studBottom: number
  let studTop: number
  if (steel) {
    const botH = PLATE_H_M          // shallow bottom track
    const topH = PLATE_H_M * 1.8    // deep top track
    add(new THREE.BoxGeometry(length, botH, depth), 0, botH / 2, 0)
    add(new THREE.BoxGeometry(length, topH, depth), 0, height - topH / 2, 0)
    studBottom = botH
    studTop = height - topH
  } else {
    const plateGeo = new THREE.BoxGeometry(length, PLATE_H_M, depth)
    add(plateGeo, 0, PLATE_H_M / 2, 0)            // sole plate
    add(plateGeo, 0, PLATE_H_M * 1.5, 0)          // 2nd bottom plate
    add(plateGeo, 0, height - PLATE_H_M / 2, 0)   // upper top plate
    add(plateGeo, 0, height - PLATE_H_M * 1.5, 0) // lower top plate
    studBottom = PLATE_H_M * 2
    studTop = height - PLATE_H_M * 2
  }

  const studH = Math.max(0.02, studTop - studBottom)
  const studY = studBottom + studH / 2
  const studGeo = new THREE.BoxGeometry(STUD_WIDTH_M, studH, depth)

  const half = length / 2
  const xs: number[] = []
  for (let x = -half; x < half - 1e-4; x += spacingM) xs.push(Math.round(x * 1000) / 1000)
  xs.push(half)
  // Doubled end posts: an extra stud just inside each end (corner/end packs).
  const endInset = STUD_WIDTH_M
  xs.push(-half + endInset, half - endInset)

  const seen = new Set<number>()
  for (const x of xs) {
    const key = Math.round(x * 1000)
    if (seen.has(key)) continue
    seen.add(key)
    add(studGeo, Math.max(-half, Math.min(half, x)), studY)
  }

  const midY = studBottom + studH / 2
  if (steel) {
    // Steel studs have knockouts every ~2' and a continuous carrying channel
    // (cold-rolled channel) threaded through them — NO wood blocking.
    const channelH = STUD_WIDTH_M * 0.7
    add(new THREE.BoxGeometry(length, channelH, depth * 0.55), 0, midY, 0)
  } else {
    // Wood: solid blocking between consecutive studs at mid-height.
    const ordered = [...seen].map((k) => k / 1000).sort((a, b) => a - b)
    for (let i = 0; i < ordered.length - 1; i++) {
      const gap = ordered[i + 1] - ordered[i]
      const span = gap - STUD_WIDTH_M
      if (span < 0.04) continue
      add(new THREE.BoxGeometry(span, STUD_WIDTH_M, depth), (ordered[i] + ordered[i + 1]) / 2, midY)
    }
  }

  return group
}
