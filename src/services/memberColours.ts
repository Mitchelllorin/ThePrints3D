/**
 * COLOUR BY MEMBER — one colour per kind of framing member.
 *
 * A wall of tan sticks is a wall you have to squint at: the header, the jacks
 * under it and the kings beside them are all the same wood, so the one thing
 * framing is about — what each piece is doing — is exactly what the picture
 * does not show. A shop layout solves it with colour (packs are drawn green on
 * a panel print), and so does this.
 *
 * Two renderers name members two ways. The live walls label a mesh in words
 * ("2×4 king stud", "LVL header") because that label is also what the nameplate
 * reads and what the takeoff tallies; the built model tags a `componentType`
 * ("king-stud"). Both are read here so the key is the same whichever is on
 * screen. Pack studs — the ones at L corners, T's and wall ends — carry the
 * same "stud" label as field studs on purpose (the takeoff counts studs), so
 * the geometry marks them separately with `userData.member = 'pack'`.
 *
 * Applied as a MATERIAL SWAP, never a rebuild: turning it on or off must not
 * regenerate geometry, and the original material is kept so off restores it
 * exactly, opacity and all.
 */
import * as THREE from 'three'

export type MemberKind =
  | 'stud' | 'pack' | 'king' | 'jack' | 'header' | 'cripple' | 'sill' | 'plate' | 'blocking'

/** In the order a carpenter reads a wall: body, then the opening from outside in. */
export const MEMBER_KEY: ReadonlyArray<{ kind: MemberKind; label: string; color: string }> = [
  { kind: 'stud',     label: 'Stud',            color: '#d9b77e' },
  { kind: 'pack',     label: 'Pack · L · T',    color: '#16a34a' },
  { kind: 'plate',    label: 'Plate / track',   color: '#94a3b8' },
  { kind: 'blocking', label: 'Blocking',        color: '#a78bfa' },
  { kind: 'king',     label: 'King stud',       color: '#a3e635' },
  { kind: 'jack',     label: 'Jack stud',       color: '#22d3ee' },
  { kind: 'header',   label: 'Header',          color: '#f97316' },
  { kind: 'cripple',  label: 'Cripple',         color: '#facc15' },
  { kind: 'sill',     label: 'Sill',            color: '#a16207' },
]

const COLOR = Object.fromEntries(MEMBER_KEY.map((m) => [m.kind, m.color])) as Record<MemberKind, string>

/**
 * What a member is, from whatever the renderer told us. Order matters: "sill
 * cripple" is a cripple, "sill plate" is a sill, "top plate" is a plate, and
 * "corner backer" / "tee backer" belong to the pack they back.
 */
export function memberKind(tags: { member?: unknown; info?: unknown; componentType?: unknown }): MemberKind | null {
  if (tags.member === 'pack') return 'pack'
  const s = String(tags.componentType ?? tags.info ?? '').toLowerCase()
  if (!s) return null
  // Blocking before king: "bloc-KING" contains "king".
  if (/blocking|carrying channel/.test(s)) return 'blocking'
  if (/header/.test(s)) return 'header'
  if (/cripple/.test(s)) return 'cripple'
  if (/king/.test(s)) return 'king'
  if (/jack|trimmer/.test(s)) return 'jack'
  if (/sill/.test(s)) return 'sill'
  if (/backer|corner-assembly|corner post/.test(s)) return 'pack'
  if (/plate|track/.test(s)) return 'plate'
  if (/stud/.test(s)) return 'stud'
  return null
}

/** One material per colour and transparency state, shared by every wall. */
const cache = new Map<string, THREE.MeshStandardMaterial>()
function memberMaterial(kind: MemberKind, base: THREE.Material): THREE.MeshStandardMaterial {
  const key = `${kind}|${base.opacity}|${base.transparent}|${base.depthWrite}`
  let m = cache.get(key)
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color: new THREE.Color(COLOR[kind]),
      roughness: 0.7,
      metalness: 0.05,
      transparent: base.transparent,
      opacity: base.opacity,
      depthWrite: base.depthWrite,
    })
    m.userData.sharedMemberColour = true
    cache.set(key, m)
  }
  return m
}

/** Tags live on the mesh, or on the group a steel C-channel is built from. */
function tagsFor(o: THREE.Object3D, root: THREE.Object3D) {
  for (let n: THREE.Object3D | null = o; n; n = n === root ? null : n.parent) {
    const u = n.userData
    if (u.member || u.info || u.componentType) return u
  }
  return {}
}

/**
 * Swap every framing member under `root` to its member colour, or back.
 * Meshes that are not framing members (knockout holes, sheathing) are left
 * alone. Safe to call repeatedly with the same value.
 */
export function applyMemberColours(root: THREE.Object3D, on: boolean): void {
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || Array.isArray(o.material)) return
    const u = o.userData
    if (!on) {
      if (u.baseMaterial) { o.material = u.baseMaterial; delete u.baseMaterial }
      return
    }
    const base = (u.baseMaterial ?? o.material) as THREE.Material
    const kind = memberKind(tagsFor(o, root))
    if (!kind) return
    u.baseMaterial = base
    o.material = memberMaterial(kind, base)
  })
}

/** The material a mesh really owns — what cleanup should dispose. Never a shared colour. */
export function ownedMaterial(o: THREE.Mesh): THREE.Material | THREE.Material[] | null {
  const m = (o.userData.baseMaterial ?? o.material) as THREE.Material | THREE.Material[]
  if (!Array.isArray(m) && m.userData?.sharedMemberColour) return null
  return m
}
