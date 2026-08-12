/**
 * The built model, counted.
 *
 * The takeoff has always been a PARALLEL ESTIMATE: it reads the 2D lines and
 * re-derives quantities from rules of thumb — studs at 16" o.c., sheets at
 * 32 sq ft, a 0.4 m eave. It never looks at what was actually built, so it
 * cannot know about per-wall framing, the ceiling height, a per-edge overhang,
 * the felt, the ridge caps or the rake boards. Measured on the two-storey
 * preset it reported 932 studs against a model containing 629, and could not
 * tell a 2×4 from a 2×8.
 *
 * That gap is the whole product claim. If the model is genuinely made of
 * components, COUNTING THEM IS THE TAKEOFF — there is no estimating step to
 * get wrong. The geometry builders already do the hard part: every member is
 * stamped with the name a supplier would recognise.
 *
 * So this is deliberately dumb. Walk the built tree, tally by that name. No
 * spacing rules, no sheet maths, no assumptions to drift out of date.
 */

/** The live scene, handed over by ModelViewer. Null before the 3D mounts. */
export const builtScene: { current: CountNode | null } = { current: null }

/**
 * The shape we need from a THREE.Object3D — structural, so the counter can be
 * tested with plain objects and never imports THREE.
 */
export interface CountNode {
  userData?: { info?: unknown; layer?: unknown } | undefined
  visible?: boolean
  isMesh?: boolean
  children?: CountNode[] | undefined
}

export interface BuiltMember {
  /** The member's own name, e.g. `2×6 wood stud`, `7/16" OSB`. */
  label: string
  /** Which system it belongs to, for grouping. */
  layer: string
  count: number
}

/** Strip the descriptive tail: `Rafter · 6:12` and `Rafter · 8:12` are rafters. */
function baseLabel(info: string): string {
  return info.split('·')[0].trim()
}

/**
 * Every member in the built model, tallied by name.
 *
 * Hidden branches are skipped, so what you get is what is standing — turn the
 * roof off and the rafters leave the count, which is the honest reading of
 * "what is in this model". Untagged meshes (helpers, catchers, highlights) are
 * ignored: no name, not a component.
 */
export function countBuiltMembers(root: CountNode | null): BuiltMember[] {
  if (!root) return []
  const tally = new Map<string, BuiltMember>()

  const walk = (node: CountNode, visible: boolean) => {
    const vis = visible && node.visible !== false
    if (vis && node.isMesh) {
      const info = node.userData?.info
      const layer = node.userData?.layer
      if (typeof info === 'string' && info.trim()) {
        const label = baseLabel(info)
        const key = `${String(layer ?? '-')}|${label}`
        const hit = tally.get(key)
        if (hit) hit.count++
        else tally.set(key, { label, layer: String(layer ?? '-'), count: 1 })
      }
    }
    for (const c of node.children ?? []) walk(c, vis)
  }
  walk(root, true)

  return [...tally.values()].sort(
    (a, b) => a.layer.localeCompare(b.layer) || b.count - a.count || a.label.localeCompare(b.label),
  )
}

/** Grouped by system, for display. */
export function groupBuiltMembers(members: BuiltMember[]): { layer: string; items: BuiltMember[] }[] {
  const byLayer = new Map<string, BuiltMember[]>()
  for (const m of members) {
    const list = byLayer.get(m.layer)
    if (list) list.push(m)
    else byLayer.set(m.layer, [m])
  }
  return [...byLayer.entries()].map(([layer, items]) => ({ layer, items }))
}


/**
 * Where to put the camera to look straight down at a drawing.
 *
 * Framed to the sheet rather than a fixed height — a guessed height leaves a
 * small drawing stranded in a corner, which is useless for judging a line.
 * Nudged a hair off dead-centre because looking exactly down the Y axis gives
 * OrbitControls a degenerate up-vector and it flips.
 */
export function planViewCamera(overlay: { scale: [number, number]; position: [number, number] }): {
  position: [number, number, number]; target: [number, number, number]
} {
  const [w, d] = overlay.scale
  const [px, pz] = overlay.position
  const h = Math.max(6, Math.max(w, d) * 1.15)
  return { position: [px, h, pz + 0.001], target: [px, 0, pz] }
}
