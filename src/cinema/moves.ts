/**
 * THE CAMERA VOCABULARY — a crane arm, described in four numbers.
 *
 * Every move in the shot library is the same rig: a camera on an arm pointed at
 * a target, where the arm has an azimuth, an elevation and a length. Change
 * azimuth over time and you have an orbit. Change elevation and it cranes.
 * Change length and it dollies in or pulls back. Change two together and you
 * get the arc that reads as "expensive" — rising as it swings, easing out of
 * the turn rather than stopping dead on a mark.
 *
 * That is deliberately the WHOLE vocabulary. A named-move library (`orbitLeft`,
 * `pushIn`, `craneUp`) looks tidy for a week and then every shot wants a move
 * that is two of them at once, and the library grows a combinatorial tail. Four
 * interpolated numbers cover all of it, and the storyboard reads as what the
 * camera is doing rather than which helper got called.
 *
 * TWO RULES MAKE THESE PORTABLE ACROSS MODELS:
 *
 *   • Distance is in MODEL RADII, not metres. `dist: 2.4` frames the same way
 *     on a 1,200 sq ft bungalow and a two-storey with a garage. A shot written
 *     in metres is a shot that only ever worked on the plan it was written on.
 *   • The target is an OFFSET from the model centre, also in radii. So a shot
 *     that pushes in on the roof line is written once and lands correctly
 *     whatever is underneath it.
 *
 * Azimuth is NOT normalised on purpose: `az: 0 → 375` is a full sweep plus a
 * touch of overshoot, and clamping it to the short way round would silently
 * turn that into standing still.
 */

/** Where the camera is and what it is pointed at, in world space. */
export interface Pose {
  position: [number, number, number]
  target: [number, number, number]
}

/** The model the shot is framing — centre, enclosing radius, and its bounds. */
export interface Frame {
  center: [number, number, number]
  /** Radius of the sphere enclosing the model, in world units. */
  radius: number
  /**
   * The model's axis-aligned bounds in world space.
   *
   * The FIT DISTANCE IS COMPUTED FROM THESE, PER POSE, not from the radius —
   * and that is the difference between a building that fills the frame and one
   * sitting small in the middle of a lot of empty grid.
   *
   * A house is a flat, oblong box. The sphere that encloses it is mostly air:
   * a 12m x 9m ranch has a 4m ridge and an 8m enclosing radius, so framing the
   * SPHERE edge to edge puts the actual building across about a third of the
   * frame and the rest is sky. That is exactly what every shot in the first
   * cut of this library did, and from inside the maths it looks correct —
   * `dist: 1` really is "the model exactly fills the frame", for a model that
   * is a ball.
   *
   * Fitting the eight corners instead costs a projection per pose and frames
   * the thing that is actually there. It is direction-dependent by nature —
   * the same house is wide across the front and narrow off the end — so the
   * distance is resolved at seek time against the pose, which is what keeps a
   * sweep tight all the way round instead of tight at one azimuth and loose at
   * every other.
   */
  box: Box
}

/** An axis-aligned box in world space. */
export interface Box {
  min: [number, number, number]
  max: [number, number, number]
}

/**
 * One camera mark on the timeline.
 *
 * Everything except `at` is optional and inherits from the previous key, so a
 * key that only changes `dist` is a pure push-in and reads as one.
 */
export interface CamKey {
  /** Seconds from the start of the shot. */
  at: number
  /** Degrees around the model. 0 looks down -Z; increases anticlockwise. */
  az?: number
  /** Degrees above the ground plane. 0 is a level elevation, 90 is top-down. */
  elev?: number
  /**
   * The shot's framing margin at this mark.
   *
   * How much air to leave, as a fraction of the frame: 1 puts the model's
   * corners exactly on the frame edges, 1.18 leaves them at 85% of the way
   * out, and it means the same thing at every elevation and every azimuth.
   * So 1 is never what a composed shot wants: use `AIR` below. Under 1 crops
   * on purpose — a detail push-in is the only honest reason to.
   */
  dist?: number
  /** Target offset from the model centre, in model radii: [x, y, z]. */
  look?: [number, number, number]
  /** How this key is approached from the one before it. Default easeInOut. */
  ease?: EaseName
}

export type EaseName =
  | 'linear'
  | 'easeIn'
  | 'easeOut'
  | 'easeInOut'
  | 'easeOutSoft'
  | 'hold'

/**
 * The easing set, kept small.
 *
 * `easeInOut` is the default because a camera that starts and stops abruptly
 * looks like a bug rather than a move. `easeOutSoft` is the one for the end of
 * a hero shot — it decelerates for most of the segment and arrives without a
 * visible stop, which is what keeps a loop from having a seam. `hold` freezes
 * on the previous key and jumps at the end, for a deliberate cut.
 */
export const EASINGS: Record<EaseName, (t: number) => number> = {
  linear: (t) => t,
  easeIn: (t) => t * t * t,
  easeOut: (t) => 1 - Math.pow(1 - t, 3),
  easeInOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  // Quintic out: most of the deceleration happens late, so the arrival is
  // almost imperceptible. This is the "lands softly" curve.
  easeOutSoft: (t) => 1 - Math.pow(1 - t, 5),
  hold: (t) => (t >= 1 ? 1 : 0),
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const DEG = Math.PI / 180

/**
 * Resolve the camera pose at time `t` (seconds) for a list of keys.
 *
 * Keys must be sorted by `at`. Before the first key and after the last, the
 * pose is held — a shot cannot run off the end of its own timeline.
 */
export function poseAt(keys: CamKey[], t: number, frame: Frame): Pose {
  if (keys.length === 0) return { position: [0, 0, 0], target: [...frame.center] }

  // Fill inherited fields forward once, so a key that omits `elev` genuinely
  // means "whatever it was" rather than "zero".
  const filled = fillKeys(keys)

  let a: SolidKey = filled[0]
  let b: SolidKey = filled[0]
  let seg = 0
  for (let i = 0; i < filled.length - 1; i++) {
    if (t >= filled[i].at && t <= filled[i + 1].at) {
      a = filled[i]
      b = filled[i + 1]
      const span = b.at - a.at
      seg = span <= 0 ? 1 : (t - a.at) / span
      break
    }
    if (t > filled[i + 1].at) {
      a = filled[i + 1]
      b = filled[i + 1]
      seg = 1
    }
  }

  const e = EASINGS[b.ease ?? 'easeInOut'](Math.max(0, Math.min(1, seg)))
  const az = lerp(a.az, b.az, e)
  const elev = lerp(a.elev, b.elev, e)
  const dist = lerp(a.dist, b.dist, e)
  const look: [number, number, number] = [
    lerp(a.look[0], b.look[0], e),
    lerp(a.look[1], b.look[1], e),
    lerp(a.look[2], b.look[2], e),
  ]

  return toPose(az, elev, dist, look, frame)
}

/** Spherical arm + target offset → world-space camera pose. */
export function toPose(
  az: number,
  elev: number,
  dist: number,
  look: [number, number, number],
  frame: Frame,
): Pose {
  const r = Math.max(0.001, frame.radius)
  const target: [number, number, number] = [
    frame.center[0] + look[0] * r,
    frame.center[1] + look[1] * r,
    frame.center[2] + look[2] * r,
  ]
  // Elevation is clamped just short of the poles. At exactly 90 degrees the
  // camera's up vector and view direction are parallel, lookAt degenerates and
  // the view rolls unpredictably — a top-down shot that spins on its own axis.
  const el = Math.max(-88, Math.min(88, elev)) * DEG
  const azr = az * DEG
  // `dist` is the air factor, not a multiplier on the answer — see fitFor.
  const arm = Math.max(0.001, fitFor(frame, azr, el, target, dist))
  const horiz = Math.cos(el) * arm
  return {
    position: [
      target[0] + Math.sin(azr) * horiz,
      target[1] + Math.sin(el) * arm,
      target[2] + Math.cos(azr) * horiz,
    ],
    target,
  }
}

/**
 * THE STANDARD MARGINS.
 *
 * "Same fit margin in every app — the model sits inside the rectangle with
 * consistent breathing room, not jammed to the edges and not lost in the
 * middle of a big frame." These are that margin, named, so a storyboard says
 * how much air it wants instead of carrying a tuned number nobody can check.
 */
export const AIR = {
  /** Corners just off the edge. The tightest a composed shot goes. */
  tight: 1.06,
  /** The default. Enough air to read the shape without floating in it. */
  normal: 1.18,
  /** An establishing frame, or a shot whose subject grows as it runs. */
  wide: 1.34,
}

/**
 * The live camera's half-angle tangents.
 *
 * Read off the real camera rather than assumed, so the fit accounts for the
 * actual field of view and the actual aspect the shot is being rendered at.
 * Through `globalThis` rather than `window` so the maths is exercisable
 * outside a browser — the fit is the one part of a shot that is wrong without
 * looking wrong, so it has unit tests, and they run in node.
 * Both axes are needed and neither can be dropped: a 16:9 frame runs out of
 * room vertically, a 9:16 frame horizontally, and using the vertical figure
 * alone — which is the one three.js stores — quietly crops the ends off every
 * building in a vertical take.
 */
function lens(): { tanH: number; tanV: number } {
  const cam = (globalThis as unknown as { __camera?: { fov?: number; aspect?: number } }).__camera
  const vFov = ((cam?.fov ?? 50) * Math.PI) / 180
  const aspect = cam?.aspect && Number.isFinite(cam.aspect) && cam.aspect > 0 ? cam.aspect : 16 / 9
  const tanV = Math.max(0.05, Math.tan(vFov / 2))
  return { tanH: tanV * aspect, tanV }
}

/**
 * The exact distance along the arm at which the model's bounds fill the frame.
 *
 * Perspective, so this is not "half the width over the tangent" — a corner
 * nearer the camera needs more room than one further away, and on a low three-
 * quarter view of a long house the near corner is the one that decides the
 * shot. Solved per corner instead: with the camera at `target + armDir * d`, a
 * corner sits `s` along the arm and `x`, `y` across it, so it is inside the
 * frustum when
 *
 *     |x| <= tanH * (d - s)   and   |y| <= tanV * (d - s)
 *
 * which rearranges to a minimum d for that corner. The shot's distance is the
 * largest of the sixteen, and every corner is then inside the frame by
 * construction, at any azimuth, in any frame shape, on any plan.
 *
 * `look` is already folded in: the fit is measured from the TARGET the shot is
 * actually pointed at, so a shot that looks at the roof line pulls back enough
 * to keep the slab in shot rather than framing a centre it is not using.
 *
 * SO IS THE AIR, AND THAT IS THE POINT OF PASSING IT IN RATHER THAN
 * MULTIPLYING THE ANSWER. Standing 1.34x further back does not leave 34% more
 * air on screen: perspective foreshortens the near corner and the far corner
 * differently, so the same multiplier reads as a third of a model of air at a
 * high angle and half a model at a low one — measured at 0.63 of the frame
 * where 0.75 was asked for. Folding it into the solve instead puts the worst
 * corner at exactly `1 / air` of the way to the edge whatever the elevation,
 * which is what "the same fit margin in every app" has to mean if it is going
 * to mean anything.
 */
export function fitFor(
  frame: Frame,
  azRad: number,
  elRad: number,
  target: [number, number, number],
  air = 1,
): number {
  const { tanH, tanV } = lens()
  const k = Math.max(0.05, air)

  // Unit vector from the target out along the arm to the camera.
  const armX = Math.sin(azRad) * Math.cos(elRad)
  const armY = Math.sin(elRad)
  const armZ = Math.cos(azRad) * Math.cos(elRad)

  // Screen right is the arm crossed with world up, which degenerates only at
  // the poles — and elevation is clamped short of them before it gets here.
  const rlen = Math.hypot(armZ, armX) || 1
  const rx = armZ / rlen
  const rz = -armX / rlen
  // Screen up completes the basis: the arm crossed with right.
  const ux = rz * armY
  const uy = rx * armZ - rz * armX
  const uz = -rx * armY

  const { min, max } = frame.box
  let need = 0
  for (let i = 0; i < 8; i++) {
    const px = (i & 1 ? max[0] : min[0]) - target[0]
    const py = (i & 2 ? max[1] : min[1]) - target[1]
    const pz = (i & 4 ? max[2] : min[2]) - target[2]

    // How far along the arm the corner sits, and how far across the frame.
    const s = px * armX + py * armY + pz * armZ
    const x = Math.abs(px * rx + pz * rz)
    const y = Math.abs(px * ux + py * uy + pz * uz)

    const dh = s + (k * x) / tanH
    const dv = s + (k * y) / tanV
    if (dh > need) need = dh
    if (dv > need) need = dv
  }
  // A degenerate box — nothing measured yet — would otherwise park the camera
  // inside the model and render a frame of clipped geometry with no clue why.
  return Math.max(frame.radius * 0.5, need)
}

/** The centre of a box. */
export function boxCenter(b: Box): [number, number, number] {
  return [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2]
}

/** The radius of the sphere enclosing a box. */
export function boxRadius(b: Box): number {
  return Math.max(1, 0.5 * Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]))
}

/** Blend two boxes — see Director.frameFor for why the framing interpolates. */
export function lerpBox(a: Box, b: Box, t: number): Box {
  const k = Math.max(0, Math.min(1, t))
  return {
    min: [lerp(a.min[0], b.min[0], k), lerp(a.min[1], b.min[1], k), lerp(a.min[2], b.min[2], k)],
    max: [lerp(a.max[0], b.max[0], k), lerp(a.max[1], b.max[1], k), lerp(a.max[2], b.max[2], k)],
  }
}

/** A key with every field resolved — what the interpolator actually reads. */
interface SolidKey {
  at: number
  az: number
  elev: number
  dist: number
  look: [number, number, number]
  ease?: EaseName
}

/** Carry each omitted field forward from the previous key. */
function fillKeys(keys: CamKey[]): SolidKey[] {
  const out: SolidKey[] = []
  // Defaults for a shot whose first key omits fields: a friendly iso that
  // frames the whole model, i.e. roughly where the app itself opens.
  let az = 35
  let elev = 22
  let dist = AIR.normal
  let look: [number, number, number] = [0, 0, 0]
  for (const k of keys) {
    az = k.az ?? az
    elev = k.elev ?? elev
    dist = k.dist ?? dist
    look = k.look ?? look
    out.push({ at: k.at, az, elev, dist, look: [look[0], look[1], look[2]], ease: k.ease })
  }
  return out
}
