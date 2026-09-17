/**
 * THE DIRECTOR — a storyboard plus a clock in, app state out.
 *
 * `seek(t)` is the whole interface, and it is a PURE FUNCTION OF t. Call it
 * with 4.5 and the workspace is exactly as it is 4.5 seconds into the shot: the
 * camera on its mark, the explode at the right point in its ramp, the right
 * trades visible, the right caption up. Call it again with 4.5 and nothing
 * moves. Call it with 3.0 and the shot runs backwards without complaint.
 *
 * That property is what separates this from a screen recording, and it buys
 * three things that matter for outreach footage:
 *
 *   • The capture rate and the playback rate are unrelated. The recorder steps
 *     scene time by exactly 1/60s per frame and takes as long as it likes over
 *     each one. A laptop managing four frames a second still writes a file that
 *     plays back perfectly smooth, because no easing anywhere is reading a
 *     wall clock.
 *   • A take is reproducible. Same storyboard, same model, same frames — so a
 *     shot can be tweaked and re-rendered and the only thing that changed is
 *     the thing that was edited.
 *   • Any frame can be rendered on its own. Stills for a store listing or a
 *     deck come out of the same storyboard as the video, at the exact moment
 *     the shot looks best, instead of being screenshotted by hand.
 *
 * WHAT IT IS ALLOWED TO TOUCH is deliberately narrow: the camera, the explode
 * progress, trade-layer visibility and its own caption. It does not build a
 * special scene, swap in prettier materials or hide anything that is not
 * chrome. The model in the footage is the model the app produces, because
 * footage of something the product does not do is worth less than no footage.
 */
import { useAppStore } from '../store/useAppStore'
import { useFloorplanLocalStore } from '../store/useFloorplanLocalStore'
import type { TraceLayer } from '../data/traceLayers'
import { cinema } from './cinemaRuntime'
import { poseAt, EASINGS, boxCenter, boxRadius, lerpBox, type CamKey, type Frame, type EaseName } from './moves'

/** A timed change to something other than the camera. */
export interface Cue {
  /** Seconds from the start of the shot. */
  at: number
  /**
   * Explode progress to arrive at, 0..1. Ramped from whatever it was over
   * `over` seconds — an instant jump to 1 is a cut, not an explode, and the
   * in-between states are the whole point of the interaction.
   */
  explode?: number
  /** Seconds the ramp takes. Default 0, i.e. immediate. */
  over?: number
  /** Curve for the ramp. Default easeInOut. */
  ease?: EaseName
  /** Trades to switch on and off at this moment. */
  layers?: { on?: TraceLayer[]; off?: TraceLayer[] }
  /**
   * Select a wall by index, or null to clear it.
   *
   * What this is really for is the NAMEPLATE: the data plate reads out the
   * selected member and shows nothing at all when nothing is selected, which
   * is correct for the app and useless for a shot whose whole subject is the
   * plate. Selecting one wall puts real rated values on screen — member,
   * depth, spacing, span, grade — instead of a caption asserting they exist.
   */
  selectWall?: number | null
  /**
   * Lower-third text. Held until the next caption cue; an empty string clears
   * it. Kept to a few words — this is a label on what the camera is showing,
   * not narration, and anything longer cannot be read in the time it is up.
   */
  caption?: string
}

export interface Shot {
  id: string
  /** Human title, used for the output filename and the run log. */
  title: string
  /** Seconds. The recorder renders frames from 0 to this. */
  duration: number
  /** Which preset plan to build the shot on. */
  plan?: 'easy' | 'medium' | 'hard'
  /** Show the app's own chrome. False gives a clean plate of just the model. */
  chrome?: boolean
  /**
   * Frame shape the shot was composed for. The recorder picks the viewport
   * from this; it is on the SHOT rather than a flag on the run because a 9:16
   * frame needs different camera marks, not a crop — stand the camera where a
   * 16:9 shot stands it and a tall frame loses the building off both sides.
   */
  aspect?: 'wide' | 'vertical' | 'square'
  /** Trades visible when the shot opens. */
  layers?: TraceLayer[]
  /** The camera marks. */
  cam: CamKey[]
  /** Everything else on the timeline. */
  cues?: Cue[]
}

/** Resolved state for one instant of a shot. */
export interface Beat {
  explode: number
  caption: string
  layers: TraceLayer[] | null
  selectWall: number | null
}

interface SceneNode {
  visible: boolean
  isMesh?: boolean
  geometry?: {
    boundingBox?: {
      min: { x: number; y: number; z: number }
      max: { x: number; y: number; z: number }
    } | null
    computeBoundingBox?: () => void
  }
  matrixWorld?: { elements: number[] }
  updateWorldMatrix?: (up: boolean, down: boolean) => void
}

/**
 * Where the model is and how big it is, measured off the live scene.
 *
 * Shots are written in model radii (see moves.ts), so every shot needs this
 * before it can resolve a single pose. Measured once when the shot is armed
 * rather than per frame: the bounds CHANGE as the model explodes, and a shot
 * that re-measures mid-ramp chases its own tail — the camera pulls back as the
 * parts spread, which cancels out the explode and produces a take where
 * nothing appears to happen.
 */
export function measureFrame(): Frame {
  const scene = (window as unknown as { __scene?: unknown }).__scene as
    | { traverse: (fn: (o: SceneNode) => void) => void }
    | undefined

  // Nothing measurable: a box big enough that the camera is outside it, and a
  // radius of 8 that the recorder recognises as "the scene looks empty" and
  // fails the run on, rather than writing six hundred frames of grid.
  const fallback: Frame = {
    center: [0, 1.5, 0],
    radius: 8,
    box: { min: [-5, -1, -5], max: [5, 4, 5] },
  }
  if (!scene) return fallback

  let minX = Infinity, minY = Infinity, minZ = Infinity
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
  let seen = 0

  scene.traverse((o: SceneNode) => {
    if (!o.visible) return
    if (!o.isMesh || !o.geometry) return
    const g = o.geometry
    if (!g.boundingBox) g.computeBoundingBox?.()
    const bb = g.boundingBox
    if (!bb) return
    // The ground grid is a mesh too and it is effectively infinite. Anything
    // that large is scenery, not subject: including it drags the centre to the
    // origin and the radius to something that frames empty grass.
    const span = Math.max(bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z)
    if (!Number.isFinite(span) || span > 120) return

    o.updateWorldMatrix?.(true, false)
    const m = o.matrixWorld
    if (!m) return
    const e = m.elements
    for (let i = 0; i < 8; i++) {
      const x = i & 1 ? bb.max.x : bb.min.x
      const y = i & 2 ? bb.max.y : bb.min.y
      const z = i & 4 ? bb.max.z : bb.min.z
      const wx = e[0] * x + e[4] * y + e[8] * z + e[12]
      const wy = e[1] * x + e[5] * y + e[9] * z + e[13]
      const wz = e[2] * x + e[6] * y + e[10] * z + e[14]
      if (!Number.isFinite(wx) || !Number.isFinite(wy) || !Number.isFinite(wz)) continue
      if (wx < minX) minX = wx
      if (wy < minY) minY = wy
      if (wz < minZ) minZ = wz
      if (wx > maxX) maxX = wx
      if (wy > maxY) maxY = wy
      if (wz > maxZ) maxZ = wz
      seen++
    }
  })

  if (!seen || !Number.isFinite(minX)) return fallback

  const box = { min: [minX, minY, minZ] as [number, number, number], max: [maxX, maxY, maxZ] as [number, number, number] }
  // The radius is no longer what the framing is computed from — the box is,
  // per pose. It stays because `look` offsets are written in model radii, and
  // because the recorder reads it to tell a real scene from an empty one.
  return { center: boxCenter(box), radius: boxRadius(box), box }
}

/**
 * Explode value asserted by the cue list at time `t`.
 *
 * Walks the ramps in order, applying each completed one in full and
 * interpolating the one that is currently running. Written as a scan rather
 * than a lookup because ramps chain: a shot that goes 0 → 1 → 0.35 has to know
 * where the second ramp started from, and that is the first ramp's endpoint,
 * not the slider's value at some earlier frame.
 */
export function explodeAt(cues: Cue[], t: number): number {
  const ramps = cues.filter((c) => typeof c.explode === 'number')
  let value = 0
  for (const c of ramps) {
    const target = c.explode as number
    const over = c.over ?? 0
    if (t <= c.at) break
    if (over <= 0 || t >= c.at + over) {
      value = target
      continue
    }
    const seg = (t - c.at) / over
    const e = EASINGS[c.ease ?? 'easeInOut'](seg)
    value = value + (target - value) * e
    break
  }
  return Math.max(0, Math.min(1, value))
}

/**
 * The moment the shot is most spread out, and how spread out it gets.
 *
 * The camera has to be fitted to THAT, not to the assembled model — a shot
 * framed at 0% explode and left there has parts leaving the frame by 60%, and
 * the build rules are explicit that a model which fits assembled and runs off
 * the screen apart has not been fitted, it has been placed.
 */
export function peakExplode(shot: Shot): { at: number; value: number } {
  const cues = shot.cues ?? []
  let best = { at: 0, value: 0 }
  for (const c of cues) {
    if (typeof c.explode !== 'number') continue
    // The end of the ramp is where the value is reached, not its start.
    const at = c.at + (c.over ?? 0)
    if (c.explode > best.value) best = { at, value: c.explode }
  }
  return best
}

/** Caption and layer state asserted by the cue list at time `t`. */
export function beatAt(shot: Shot, t: number): Beat {
  const cues = shot.cues ?? []
  let caption = ''
  let selectWall: number | null = null
  let layers: TraceLayer[] | null = shot.layers ? [...shot.layers] : null
  for (const c of cues) {
    if (c.at > t) break
    if (typeof c.caption === 'string') caption = c.caption
    if (c.selectWall !== undefined) selectWall = c.selectWall
    if (c.layers) {
      const set = new Set<TraceLayer>(layers ?? [])
      for (const l of c.layers.off ?? []) set.delete(l)
      for (const l of c.layers.on ?? []) set.add(l)
      layers = [...set]
    }
  }
  return { explode: explodeAt(cues, t), caption, layers, selectWall }
}

/**
 * The live shot — armed, sought, struck.
 *
 * A module singleton rather than a hook because the recorder drives it from
 * outside React entirely (`window.__cinema.seek`), and because exactly one shot
 * can be rolling at a time by definition: there is one camera.
 */
class Director {
  shot: Shot | null = null
  frame: Frame = { center: [0, 1.5, 0], radius: 8, box: { min: [-5, -1, -5], max: [5, 4, 5] } }
  /**
   * The model measured at its most spread out, and the explode value it was
   * measured at.
   *
   * A shot's framing is interpolated between the assembled bounds and these by
   * the live explode value, which is what "recompute and refit on every event
   * that changes the free rectangle" means when the thing changing size is the
   * model itself. Fitting only to the assembled bounds loses parts off the
   * frame at full explode; fitting only to the exploded bounds leaves the
   * assembled opening of every shot sitting tiny in the middle of a lot of
   * empty grid. Interpolating gives a tight opening AND keeps everything in
   * frame at full separation, and because explode is a pure function of the
   * shot clock the pull-back is perfectly smooth and repeatable.
   */
  apart: Frame | null = null
  apartAt = 1
  /** Current caption, read by the DOM overlay. */
  caption = ''
  /** Bumped whenever the caption changes, so the overlay can cheaply diff. */
  captionRev = 0
  time = 0

  /** Arm a shot: measure the model, take the camera, quiet the app down. */
  arm(shot: Shot) {
    this.shot = shot
    /**
     * MEASURED BEFORE THE FIRST SEEK, WHICH IS THE ORDER THAT MATTERS.
     *
     * A shot that reveals trades one at a time opens with almost nothing in
     * the scene. Measure after applying its opening layers and the camera
     * frames the floor deck alone, then sits there while a building grows out
     * of the top of the frame. Measuring first takes the bounds of the model
     * as the app currently has it — the whole thing — so the camera is already
     * standing where the finished building fits and each trade arrives inside
     * the frame it was composed for.
     */
    this.frame = measureFrame()
    this.apart = null
    this.apartAt = Math.max(0.01, peakExplode(shot).value)
    this.time = 0
    cinema.active = true
    cinema.cleanPlate = shot.chrome === false
    document.body.classList.toggle('cinema-clean', cinema.cleanPlate)
    // Explode is asserted from here on, so the damped drivers stand down.
    cinema.explode = 0
    this.seek(0)
  }

  /** Put the workspace at time `t` of the armed shot. */
  seek(t: number) {
    const shot = this.shot
    if (!shot) return
    this.time = t

    const beat = beatAt(shot, t)
    const pose = poseAt(shot.cam, t, this.frameFor(beat.explode))
    const store = useAppStore.getState()

    store.setCameraPreset({ position: pose.position, target: pose.target })
    cinema.explode = beat.explode

    // Keep the app's own slider honest too, so a shot that ends with the model
    // apart hands back a workspace whose UI matches what is on screen.
    if (Math.abs(store.explodeAmount - beat.explode) > 1e-3) {
      store.setExplodeAmount(beat.explode)
    }

    if (beat.layers) {
      // Toggled one at a time rather than assigning the Set, because the
      // toggle is what keeps the TWO visibility systems in step — the
      // per-system Set the trade renderer reads, and the older layer ARRAY
      // BuildingModel is handed. Writing the Set directly lights the trades up
      // in one renderer and not the other, which on camera reads as pipes that
      // render without the walls they run through.
      const want = new Set<TraceLayer>(beat.layers)
      const have = store.visibleLayers
      for (const l of want) if (!have.has(l)) store.toggleTradeLayerVisible(l)
      for (const l of have) if (!want.has(l)) store.toggleTradeLayerVisible(l)
    }

    /**
     * Set the index WITHOUT the store action.
     *
     * `setSelectedWallIndex` also opens the wall editing panel, which is right
     * for a tap — you selected a wall because you want to work on it — and
     * wrong here, where a panel sliding over the model is the one thing the
     * shot is trying to show. The plate reads the index directly, so writing
     * just the index gives the data plate and none of the editor.
     */
    if (useFloorplanLocalStore.getState().selectedWallIndex !== beat.selectWall) {
      useFloorplanLocalStore.setState({ selectedWallIndex: beat.selectWall })
    }

    if (beat.caption !== this.caption) {
      this.caption = beat.caption
      this.captionRev++
    }
  }

  /**
   * The frame to compose against at a given explode value.
   *
   * The BOX is what moves, so the box is what interpolates — both the fit
   * distance and the point the camera is aimed at fall out of it. The centre
   * travels too, and deliberately: systems push to their own zones, so the
   * spread model is not centred on the assembled one, and a camera left aimed
   * at the assembled centre watches the arrangement drift out of frame. It
   * travels on the explode ramp's own easing, which is slow by design, so it
   * reads as the camera following the parts rather than as drift.
   *
   * Before `refit()` has run there is only one measurement, so this is the
   * assembled frame and the shot is composed exactly as it was written — a
   * missing second measurement degrades to the old behaviour rather than to a
   * broken one.
   */
  frameFor(explode: number): Frame {
    const apart = this.apart
    if (!apart) return this.frame
    const k = Math.max(0, Math.min(1, explode / this.apartAt))
    const box = lerpBox(this.frame.box, apart.box, k)
    return { center: boxCenter(box), radius: boxRadius(box), box }
  }

  /**
   * Measure again, with the model currently at its most spread out, and keep
   * that as the apart-reference.
   *
   * Called by the recorder once it has seeked to the shot's peak explode and
   * let the scene render there. It has to be driven from outside because the
   * geometry only moves in a frame loop — arming and measuring in the same
   * synchronous call would measure positions that have not been updated yet
   * and hand back the assembled bounds twice.
   */
  refit(): number {
    this.apart = measureFrame()
    return this.apart.radius
  }

  /** Hand the workspace back: the app's own easing and camera resume. */
  strike() {
    this.shot = null
    this.apart = null
    cinema.active = false
    cinema.cleanPlate = false
    cinema.explode = null
    this.caption = ''
    this.captionRev++
    document.body.classList.remove('cinema-clean')
  }
}

export const director = new Director()
