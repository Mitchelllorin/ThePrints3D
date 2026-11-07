/**
 * THE BRANDED PARTS, AS A SURFACE YOU CAN SEE.
 *
 * A beam cut from Nordic Lam was drawn as the same tan box as a beam cut from
 * any other glulam. That is the one thing a maker's part cannot be: the whole
 * reason a framer specifies Nordic Lam over a generic 24F-V4 is the layup, and
 * the whole reason a maker takes the meeting is that the app shows their
 * product. Two identical boxes cannot show anybody's product.
 *
 * So the surface is DRAWN, per product family, from the part's own published
 * dimensions:
 *
 *   glulam  — lamination bands, count = depth ÷ 1-1/2", each lam its own tone
 *             with a glue line between, because that is what you see end-on.
 *   LVL     — the veneer stack through the thickness: fine, regular lines.
 *   LSL     — strands: short flakes, cross-oriented, no two alike.
 *   PSL     — parallel strand: long streaks running the length of the member.
 *
 * DETERMINISTIC ON PURPOSE. The strand pattern is seeded from the part id, so
 * the same part draws the same surface on every run. The demo director captures
 * frames one at a time and expects two runs to be byte-identical
 * (_tools/demo-director/SPEC.md §3); a Math.random() texture would make every
 * clip subtly different from the last one.
 *
 * Nothing here decides what a part IS. The rated values stay in
 * `data/manufacturerParts.ts` and the F.U.S.E. reading in `./reading` — this
 * only answers "what does this maker's product look like".
 */

import * as THREE from 'three'
import { MANUFACTURER_PARTS, type ManufacturerPart } from '../../data/manufacturerParts'
import { getMember } from '../../data/members'

/** Glulam laminations are 1-1/2" thick. It is the industry's standard layup. */
export const LAMINATION_IN = 1.5

/** Product family, which is what actually decides the surface. */
export type SurfaceKind = 'glulam' | 'lvl' | 'lsl' | 'psl'

/**
 * How many laminations a glulam member is laid up from — depth ÷ 1-1/2".
 *
 * Returns null for anything that is not laminated through its depth: an LVL is
 * veneer stacked through its thickness, an LSL and a PSL are strands, and none
 * of them have a lam count to quote.
 */
export function laminationCount(part: ManufacturerPart): number | null {
  if (surfaceKind(part) !== 'glulam') return null
  const depth = ratedNumber(part, 'Depth')
  if (depth == null) return null
  return Math.round(depth / LAMINATION_IN)
}

/** A rated figure off the part, as a number, or null when it isn't printed. */
function ratedNumber(part: ManufacturerPart, label: string): number | null {
  const field = part.rated.find((f) => f.label === label)
  if (!field) return null
  const n = Number(field.value.replace(/[^\d.-]/g, ''))
  return Number.isFinite(n) ? n : null
}

/**
 * Which family's surface a part gets.
 *
 * ORDER MATTERS, and not for tidiness: 'Parallam' contains 'lam', so a naive
 * match for laminated timber classifies Weyerhaeuser's strand product as
 * Nordic's glulam and draws the wrong surface on the wrong beam. The strand
 * products are tested first and the laminated-timber match comes last, where
 * 'Nordic Lam' still reaches it and 'Parallam' never does.
 */
export function surfaceKind(part: ManufacturerPart): SurfaceKind {
  const p = part.product.toLowerCase()
  if (p.includes('lsl')) return 'lsl'
  if (p.includes('psl') || p.includes('parallam')) return 'psl'
  if (p.includes('lvl')) return 'lvl'
  if (p.includes('lam')) return 'glulam'
  return 'psl'
}

/**
 * The catalogue member a stock name refers to, so a mesh can find its part from
 * the string it already carries. 'Nordic Lam 6-3/4 × 18' is the member's `name`,
 * which is what `MemberCut.member` writes on every cut.
 */
export function brandForMemberName(name: string): ManufacturerPart | null {
  const found = MANUFACTURER_PARTS.find((part) => getMember(part.memberId)?.name === name)
  return found ?? null
}

/** Deterministic PRNG — the same seed draws the same strands every run. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A stable 32-bit seed from a part id — no Math.random, no run-to-run drift. */
function seedOf(id: string): number {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

const BASE_TONE: Record<SurfaceKind, [number, number, number]> = {
  glulam: [201, 160, 104],
  lvl: [214, 180, 128],
  lsl: [208, 186, 142],
  psl: [196, 166, 116],
}

const clamp255 = (v: number) => Math.max(0, Math.min(255, Math.round(v)))

/**
 * The surface, drawn once per part. 512×512 is enough for a member a few inches
 * across; the member is metres long, so the caller tiles it along the length
 * rather than trying to draw every foot of it.
 */
function drawSurface(part: ManufacturerPart): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null
  const W = 512
  const H = 512
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const ctx = c.getContext('2d')
  if (!ctx) return null

  const kind = surfaceKind(part)
  const [r, g, b] = BASE_TONE[kind]
  const rnd = mulberry32(seedOf(part.id))

  ctx.fillStyle = `rgb(${r},${g},${b})`
  ctx.fillRect(0, 0, W, H)

  if (kind === 'glulam' || kind === 'lvl') {
    // Laminations (or veneers) run the length of the member, so the bands are
    // horizontal and the glue lines are thin and dark.
    const count = kind === 'glulam'
      ? Math.max(4, laminationCount(part) ?? 8)
      : 14
    const bandH = H / count
    for (let i = 0; i < count; i++) {
      const j = (rnd() * 2 - 1) * (kind === 'glulam' ? 13 : 7)
      ctx.fillStyle = `rgb(${clamp255(r + j)},${clamp255(g + j)},${clamp255(b + j)})`
      ctx.fillRect(0, i * bandH, W, bandH)
      // The glue line between two lams: darker, and never quite straight.
      ctx.fillStyle = `rgba(96,70,40,${kind === 'glulam' ? 0.55 : 0.22})`
      ctx.fillRect(0, i * bandH, W, kind === 'glulam' ? 2 : 1)
    }
  } else {
    // Strands. LSL flake is short and cross-oriented; Parallam's is long and
    // runs with the member, which is the whole difference between the products.
    const long = kind === 'psl'
    const count = long ? 260 : 900
    for (let i = 0; i < count; i++) {
      const x = rnd() * W
      const y = rnd() * H
      const len = long ? 60 + rnd() * 120 : 8 + rnd() * 18
      const thick = long ? 3 + rnd() * 3 : 2 + rnd() * 2
      // PSL strands stay nearly parallel; LSL flakes wander.
      const angle = long ? (rnd() - 0.5) * 0.06 : (rnd() - 0.5) * 1.6
      const tone = (rnd() * 2 - 1) * 26
      ctx.save()
      ctx.translate(x, y)
      ctx.rotate(angle)
      ctx.fillStyle = `rgba(${clamp255(r + tone)},${clamp255(g + tone)},${clamp255(b + tone * 0.8)},0.85)`
      ctx.fillRect(-len / 2, -thick / 2, len, thick)
      ctx.restore()
    }
  }

  return c
}

const matCache = new Map<string, THREE.MeshStandardMaterial>()

/**
 * A member's brand surface, or null when the stock is not a manufacturer part.
 *
 * Cached by part id and SHARED, the way material swaps already work in
 * `memberColours` — every Nordic Lam header in the model gets the one material,
 * so a wall of them costs one texture, not one per stick.
 */
export function brandSurfaceMaterial(part: ManufacturerPart): THREE.MeshStandardMaterial | null {
  const cached = matCache.get(part.id)
  if (cached) return cached
  const canvas = drawSurface(part)
  if (!canvas) return null
  const tex = new THREE.CanvasTexture(canvas)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(3, 1)
  tex.anisotropy = 4
  const mat = new THREE.MeshStandardMaterial({
    map: tex,
    roughness: surfaceKind(part) === 'glulam' ? 0.72 : 0.78,
    metalness: 0.02,
  })
  mat.userData.brandPart = part.id
  matCache.set(part.id, mat)
  return mat
}

/** The brand surface for a stock name, if that stock is a maker's part. */
export function brandSurfaceForMemberName(name: string): THREE.MeshStandardMaterial | null {
  const part = brandForMemberName(name)
  return part ? brandSurfaceMaterial(part) : null
}
