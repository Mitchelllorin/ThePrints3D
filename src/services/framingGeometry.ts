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

/** Block face size on the wall (~16") — texture tile size. */
export const BLOCK_TILE_M = 0.4

// A running-bond block/mortar pattern, drawn once and tiled across masonry
// walls (ghost + built) so they read as block courses, not a flat slab.
let _blockTex: THREE.Texture | null = null
export function blockTexture(): THREE.Texture | null {
  if (_blockTex) return _blockTex
  if (typeof document === 'undefined') return null
  const c = document.createElement('canvas')
  c.width = 128; c.height = 128
  const ctx = c.getContext('2d')
  if (!ctx) return null
  ctx.fillStyle = '#b4b0aa'
  ctx.fillRect(0, 0, 128, 128)
  ctx.strokeStyle = '#6b6f76'
  ctx.lineWidth = 6
  ctx.beginPath()
  ctx.moveTo(0, 2); ctx.lineTo(128, 2)
  ctx.moveTo(0, 64); ctx.lineTo(128, 64)
  ctx.moveTo(0, 126); ctx.lineTo(128, 126)
  ctx.moveTo(2, 0); ctx.lineTo(2, 64)
  ctx.moveTo(126, 0); ctx.lineTo(126, 64)
  ctx.moveTo(64, 64); ctx.lineTo(64, 128)
  ctx.stroke()
  const tex = new THREE.CanvasTexture(c)
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  _blockTex = tex
  return tex
}

/** Block-faced material tiled to a wall face of the given size. */
export function blockMaterial(faceLengthM: number, faceHeightM: number, opacity = 1): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#cdc8c0'), roughness: 1, metalness: 0,
    transparent: opacity < 1, opacity,
  })
  const tex = blockTexture()
  if (tex) {
    const t = tex.clone(); t.needsUpdate = true
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.repeat.set(Math.max(1, faceLengthM / BLOCK_TILE_M), Math.max(1, faceHeightM / BLOCK_TILE_M))
    m.map = t
  }
  return m
}

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
  /** Heavy-duty / exterior steel: threads a cold-rolled carrying channel
   *  through the knockouts. Interior 25ga steel leaves the knockouts empty. */
  heavyDuty?: boolean
  /** Steel gauge ('25'|'20'|'18'|'16'|'12'). Lower = heavier steel → a visibly
   *  beefier stud. Ignored for wood. */
  steelGauge?: string
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
    heavyDuty = false,
    steelGauge = '25',
    opacity = 1,
  } = opts

  const group = new THREE.Group()
  if (length < 0.02 || height < 0.05) return group

  const steel = material === 'steel'
  // Heavier gauge (lower number) → a visibly beefier stud face.
  const GAUGE_SCALE: Record<string, number> = { '25': 1, '20': 1.06, '18': 1.14, '16': 1.24, '12': 1.42 }
  const studW = steel ? STUD_WIDTH_M * (GAUGE_SCALE[steelGauge] ?? 1) : STUD_WIDTH_M
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(opts.color ?? (steel ? '#d2d6dc' : '#c9a56c')),  // bright galvanized silver
    roughness: steel ? 0.22 : 0.75,
    metalness: steel ? 0.95 : 0.05,
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
  const studGeo = new THREE.BoxGeometry(studW, studH, depth)

  const half = length / 2
  const xs: number[] = []
  for (let x = -half; x < half - 1e-4; x += spacingM) xs.push(Math.round(x * 1000) / 1000)
  xs.push(half)
  // Doubled end posts: an extra stud just inside each end (corner/end packs).
  const endInset = studW
  xs.push(-half + endInset, half - endInset)

  const seen = new Set<number>()
  for (const x of xs) {
    const key = Math.round(x * 1000)
    if (seen.has(key)) continue
    seen.add(key)
    add(studGeo, Math.max(-half, Math.min(half, x)), studY)
  }

  const ordered = [...seen].map((k) => k / 1000).sort((a, b) => a - b)
  const midY = studBottom + studH / 2
  if (steel) {
    // Steel studs are punched with knockouts at 2', 4' and 6'. A cold-rolled
    // carrying channel runs through them ONLY on heavy-duty / exterior walls;
    // typical interior 25ga leaves them empty. No wood blocking.
    const koMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#0b0f17'), roughness: 1, metalness: 0,
      transparent: opacity < 1, opacity,
    })
    const koGeo = new THREE.CylinderGeometry(studW * 0.32, studW * 0.32, depth + 0.006, 10)
    const koHeights = [0.610, 1.219, 1.829, 2.438].filter((h) => h > studBottom + 0.05 && h < studTop - 0.05)
    for (const x of ordered) {
      for (const h of koHeights) {
        const m = new THREE.Mesh(koGeo, koMat)
        m.position.set(x, h, 0)
        m.rotation.x = Math.PI / 2  // bore through the web (along depth)
        m.userData.layer = 'framing'
        group.add(m)
      }
    }
    if (heavyDuty) {
      // Cold-rolled carrying channel runs through the knockouts at 4' and 8'.
      for (const h of [1.219, 2.438].filter((y) => y > studBottom + 0.05 && y < studTop - 0.05)) {
        add(new THREE.BoxGeometry(length, studW * 0.7, depth * 0.55), 0, h, 0)
      }
    }
  } else {
    // Wood: solid blocking between consecutive studs at mid-height.
    for (let i = 0; i < ordered.length - 1; i++) {
      const gap = ordered[i + 1] - ordered[i]
      const span = gap - STUD_WIDTH_M
      if (span < 0.04) continue
      add(new THREE.BoxGeometry(span, STUD_WIDTH_M, depth), (ordered[i] + ordered[i + 1]) / 2, midY)
    }
  }

  return group
}
