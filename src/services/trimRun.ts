/**
 * TRIM RUN — one profile, swept along one edge, mitred at every corner.
 *
 * This is the whole trim system. Corner boards, casing, sills, aprons, frieze
 * and band boards, battens, baseboard, shoe and crown are not eleven builders:
 * they are eleven entries in `trimProfiles` fed to this function with a
 * different edge. That is the only reason a trim library can grow to the size
 * the competition ships — Chief Architect gives corner boards their own Build ▸
 * Trim tool, Live Home 3D sets base and crown per wall from an inspector, and
 * both of those are this operation wearing a different hat.
 *
 * HOW THE MITRE WORKS
 *
 * A swept solid is a ring of profile points placed at each path vertex and
 * stitched into quads. The only hard part is the corner, and the fix is old:
 *
 *   - At an interior vertex the ring is placed on the BISECTOR of the two
 *     segments rather than square to either, so the two runs meet on one plane
 *     and the joint closes with no gap and no overlap. That plane is the mitre.
 *   - Sitting the ring on the bisector foreshortens the profile by cos(θ/2), so
 *     the ring is widened by 1/cos(θ/2) to compensate. Without this every
 *     corner board pinches visibly narrower exactly where two walls meet, which
 *     is the first place anybody looks.
 *
 * The correction is clamped: a path that doubles back on itself has θ→0 and the
 * scale runs to infinity, which would fire a single triangle off to the horizon.
 * Real trim does not do that either — it butts.
 *
 * FRAME
 *
 * The caller supplies the surface `normal` once for the whole run, and the
 * frame at each vertex is derived from it and the path direction:
 *
 *   out    = normal                       (profile +y, standing proud)
 *   across = normal × tangent             (profile +x, lying on the surface)
 *
 * One vector covers every case. Baseboard: normal is the wall face, the path
 * runs along the floor, so `across` comes out as up. Corner board: normal is
 * the 45° bisector out of the corner, the path runs vertically, so `across` is
 * horizontal. Casing: normal is the wall face, the path goes round the opening,
 * so `across` points radially out from it. No special cases, no per-kind code.
 *
 * Pure geometry over THREE — no DOM, no store, no canvas — so it runs in a
 * worker and in a node test.
 */
import * as THREE from 'three'
import { profileAreaM2, profileWidthM, type TrimProfile } from './trimProfiles'

export interface TrimRunOpts {
  /** The cross-section to sweep. */
  profile: TrimProfile
  /** Path in world metres. Two points is a straight run; more turns corners. */
  path: ReadonlyArray<THREE.Vector3>
  /**
   * Surface normal — which way is "proud". Casing round an opening and base
   * along a wall both take the wall's outward face normal.
   */
  normal: THREE.Vector3
  /** Close the loop back to the first point (casing, a band round a house). */
  closed?: boolean
  /** Paint colour. Trim is nearly always lighter than what it sits on. */
  color?: string
  opacity?: number
  /** Shown on the nameplate and in the takeoff. Defaults to the profile label. */
  info?: string
}

/**
 * The widest a mitre may stretch a profile.
 *
 * 1/cos(θ/2) is 1.41 at a square corner and 2.6 at 45°, both of which are real
 * carpentry. Past about 4 the path has turned back on itself and the "corner"
 * is a fold, where a carpenter butts two pieces rather than cutting a 10:1
 * spike. Clamping here keeps a bad path from producing geometry that flies off
 * the model, and costs nothing on any angle anybody actually trims.
 */
const MAX_MITRE = 4

/** Shortest run worth building — below this it is a smudge, not a board. */
const MIN_RUN_M = 0.02

function frameAt(
  tangent: THREE.Vector3,
  normal: THREE.Vector3,
): { across: THREE.Vector3; out: THREE.Vector3 } {
  const out = normal.clone().normalize()
  const across = new THREE.Vector3().crossVectors(out, tangent).normalize()
  // A path running straight along the normal has no defined `across`. Pick any
  // perpendicular rather than emitting NaN geometry that poisons the scene.
  if (!Number.isFinite(across.x) || across.lengthSq() < 1e-9) {
    across.set(out.y, out.z, out.x).cross(out).normalize()
  }
  return { across, out }
}

/**
 * Sweep `profile` along `path`.
 *
 * Returns a Group holding one mesh, plus `userData.lengthM` and
 * `userData.volumeM3` — trim is sold by the linear foot and estimated by the
 * board foot, so the takeoff wants both and neither should be recomputed by
 * measuring the mesh afterwards.
 */
export function buildTrimRun(opts: TrimRunOpts): THREE.Group {
  const { profile, normal, closed = false, opacity = 1 } = opts
  const g = new THREE.Group()

  // Drop repeated points first: a duplicated vertex has no direction, and one
  // of those anywhere in the path makes every frame after it undefined.
  const path: THREE.Vector3[] = []
  for (const p of opts.path) {
    if (!path.length || p.distanceTo(path[path.length - 1]) > 1e-6) path.push(p.clone())
  }
  if (closed && path.length > 2 && path[0].distanceTo(path[path.length - 1]) < 1e-6) path.pop()
  if (path.length < 2) return g

  let totalLen = 0
  for (let i = 0; i < path.length - 1; i++) totalLen += path[i].distanceTo(path[i + 1])
  if (closed) totalLen += path[path.length - 1].distanceTo(path[0])
  if (totalLen < MIN_RUN_M) return g

  const prof = profile.points
  const ringN = prof.length
  const vertexCount = path.length * ringN
  const positions = new Float32Array(vertexCount * 3)

  // ── rings ────────────────────────────────────────────────────────────────
  for (let i = 0; i < path.length; i++) {
    const prev = i > 0 ? path[i - 1] : closed ? path[path.length - 1] : null
    const next = i < path.length - 1 ? path[i + 1] : closed ? path[0] : null

    const dIn = prev ? path[i].clone().sub(prev).normalize() : null
    const dOut = next ? next.clone().sub(path[i]).normalize() : null

    // The bisector. At an end there is only one direction, so it is that.
    const tangent = (dIn && dOut)
      ? dIn.clone().add(dOut).normalize()
      : (dOut ?? dIn!).clone()

    // Widen to undo the foreshortening of sitting on the bisector.
    let mitre = 1
    if (dIn && dOut) {
      const cos = tangent.dot(dOut)
      mitre = cos > 1e-3 ? Math.min(1 / cos, MAX_MITRE) : MAX_MITRE
    }

    const { across, out } = frameAt(tangent, normal)
    for (let j = 0; j < ringN; j++) {
      const [px, py] = prof[j]
      const o = (i * ringN + j) * 3
      positions[o]     = path[i].x + across.x * px * mitre + out.x * py
      positions[o + 1] = path[i].y + across.y * px * mitre + out.y * py
      positions[o + 2] = path[i].z + across.z * px * mitre + out.z * py
    }
  }

  // ── skin ─────────────────────────────────────────────────────────────────
  const idx: number[] = []
  const segs = closed ? path.length : path.length - 1
  for (let i = 0; i < segs; i++) {
    const a = i * ringN
    const b = ((i + 1) % path.length) * ringN
    for (let j = 0; j < ringN; j++) {
      const j2 = (j + 1) % ringN
      idx.push(a + j, b + j, b + j2)
      idx.push(a + j, b + j2, a + j2)
    }
  }

  // Caps. An open run shows its cut ends — a baseboard stopping at a doorway is
  // a rectangle of end grain, and leaving it open renders as a hole straight
  // through the board. Fanned from vertex 0, which is correct for the convex
  // outlines trim profiles are; a concave profile would need a real triangulator.
  if (!closed) {
    const last = (path.length - 1) * ringN
    for (let j = 1; j < ringN - 1; j++) {
      idx.push(0, j + 1, j)                       // start cap, facing back
      idx.push(last, last + j, last + j + 1)      // end cap, facing forward
    }
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geo.setIndex(idx)
  geo.computeVertexNormals()

  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(opts.color ?? '#f2efe8'),
    roughness: 0.7,
    metalness: 0,
    transparent: opacity < 1,
    opacity,
    depthWrite: opacity >= 1,
    side: THREE.DoubleSide,
  })

  const mesh = new THREE.Mesh(geo, mat)
  mesh.castShadow = true
  mesh.receiveShadow = true
  mesh.userData.info = opts.info ?? profile.label
  g.add(mesh)

  g.userData.trim = profile.id
  g.userData.lengthM = Math.round(totalLen * 1000) / 1000
  g.userData.volumeM3 = Math.round(Math.abs(profileAreaM2(profile)) * totalLen * 1e6) / 1e6
  return g
}

/**
 * A RECTANGULAR RUN ROUND AN OPENING — casing, in the form the model has it.
 *
 * Openings are held as a centre, a width and a height on a wall face, so this
 * takes them in those terms rather than making every caller build the four
 * corners itself and get the winding wrong.
 *
 * `sides` is what makes it useful for more than casing: a window is cased on
 * three sides with a sill and apron under it rather than a fourth leg, and a
 * door is cased on three sides with nothing at the floor. Passing all four is
 * a picture frame.
 */
export function buildOpeningCasing(opts: {
  profile: TrimProfile
  /** Centre of the opening, on the wall face. */
  center: THREE.Vector3
  /** Along the wall, unit length. */
  along: THREE.Vector3
  /** Up the wall, unit length. */
  up: THREE.Vector3
  /** Outward wall normal. */
  normal: THREE.Vector3
  widthM: number
  heightM: number
  /** Which legs to run. Defaults to a full frame. */
  sides?: { head?: boolean; sill?: boolean; left?: boolean; right?: boolean }
  color?: string
  opacity?: number
}): THREE.Group {
  const { profile, center, along, up, normal, widthM, heightM, color, opacity } = opts
  const sides = { head: true, sill: true, left: true, right: true, ...(opts.sides ?? {}) }
  const g = new THREE.Group()

  const hw = widthM / 2
  const hh = heightM / 2
  const w = profileWidthM(profile)
  const a = along.clone().normalize()
  const u = up.clone().normalize()

  /**
   * Each leg runs PAST the opening by the width of the casing, so the legs
   * overlap at the corners the way a mitred frame does. Stopping each leg at
   * the opening's own corner leaves a square notch of bare wall at all four
   * corners — the classic tell that trim was drawn rather than built.
   */
  const at = (da: number, du: number) =>
    center.clone().addScaledVector(a, da).addScaledVector(u, du)

  const leg = (from: THREE.Vector3, to: THREE.Vector3, info: string) => {
    const run = buildTrimRun({ profile, path: [from, to], normal, color, opacity, info })
    if (run.children.length) g.add(run)
  }

  // A leg only overruns TOWARDS a side that exists. Overrunning unconditionally
  // is what sent a door's jambs a full casing-width below the floor: a door has
  // no sill leg to meet down there, so there is nothing for the jamb to run past
  // and it just buried itself in the slab.
  const eL = sides.left ? w : 0
  const eR = sides.right ? w : 0
  const eH = sides.head ? w : 0
  const eS = sides.sill ? w : 0

  // The profile grows along +x = normal × tangent, so each leg is driven in the
  // direction that puts that growth AWAY from the opening.
  if (sides.head) leg(at(hw + eR, hh), at(-hw - eL, hh), `${profile.label} — head`)
  if (sides.sill) leg(at(-hw - eL, -hh), at(hw + eR, -hh), `${profile.label} — sill leg`)
  if (sides.left) leg(at(-hw, -hh - eS), at(-hw, hh + eH), `${profile.label} — jamb`)
  if (sides.right) leg(at(hw, hh + eH), at(hw, -hh - eS), `${profile.label} — jamb`)

  let len = 0
  let vol = 0
  for (const c of g.children) {
    len += (c.userData.lengthM as number) ?? 0
    vol += (c.userData.volumeM3 as number) ?? 0
  }
  g.userData.trim = profile.id
  g.userData.lengthM = Math.round(len * 1000) / 1000
  g.userData.volumeM3 = Math.round(vol * 1e6) / 1e6
  return g
}

/**
 * Total linear metres of each profile in a subtree — the takeoff line.
 *
 * Trim is bought by the foot, so this is what the material report needs, and
 * reading it back off the scene rather than off a parallel tally means the
 * number can never drift from what was actually built.
 */
export function trimTakeoff(root: THREE.Object3D): Map<string, number> {
  const out = new Map<string, number>()
  root.traverse((o) => {
    const id = o.userData?.trim as string | undefined
    const len = o.userData?.lengthM as number | undefined
    // Only the run groups carry both, so nested groups are not double-counted.
    if (!id || typeof len !== 'number' || o.children.some((c) => c.userData?.trim)) return
    out.set(id, Math.round(((out.get(id) ?? 0) + len) * 1000) / 1000)
  })
  return out
}
