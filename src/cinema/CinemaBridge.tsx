/**
 * CINEMA BRIDGE — the handle the recorder drives the app by.
 *
 * Mounted inside the Canvas next to the other frame drivers. It does two jobs
 * and deliberately no more:
 *
 *   1. Publishes `window.__cinema` — arm a shot, seek to a time, strike the
 *      set. That is the entire remote control, and it is the same one whether
 *      the caller is the Playwright recorder writing an mp4, a person poking at
 *      a devtools console to frame a still, or an attract loop.
 *
 *   2. Guarantees a RENDERED frame per seek. `rendered()` counts frames that
 *      have actually gone to the GPU, so the recorder can wait for the pose it
 *      just set to be on screen before it shutters. Without it the recorder
 *      races the renderer: it seeks, screenshots, and gets the PREVIOUS frame
 *      back — invisible on a slow move, and everywhere else a one-frame
 *      stutter that is near impossible to diagnose from the output file alone.
 *
 * The camera pose itself is NOT applied here. The director pushes it through
 * the store as a camera preset, and ModelViewer's existing CameraPresetApplier
 * puts it on the camera inside its own frame — the same path the camera HUD
 * buttons already use. Reusing it means a shot cannot drift from what the app
 * does when a person presses a preset, and there stays exactly one piece of
 * code that knows how to hand a pose to OrbitControls without leaving damping
 * velocity behind it.
 */
import { useEffect, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { director, measureFrame, peakExplode, type Shot } from './director'
import { cinema } from './cinemaRuntime'
import { SHOTS } from './storyboards'

/**
 * The caption, passed out of the Canvas.
 *
 * A component inside <Canvas> can only return 3D objects — returning a <div>
 * there throws, because R3F's reconciler has no idea what to do with one. So
 * the text hops out through this sink and the DOM overlay subscribes to it. A
 * store slice would do the same job and cost a file; this has exactly one
 * writer and one reader.
 */
const captionSink = {
  value: '',
  subs: new Set<(v: string) => void>(),
  set(v: string) {
    if (v === this.value) return
    this.value = v
    for (const fn of this.subs) fn(v)
  },
  subscribe(fn: (v: string) => void) {
    this.subs.add(fn)
    return () => { this.subs.delete(fn) }
  },
}

export interface CinemaAPI {
  /** Arm a shot by id from the library, or an inline storyboard object. */
  arm: (shot: string | Shot) => {
    ok: boolean
    duration: number
    radius: number
    /** Seek here, let it render, then call refit() — see refit. */
    peakAt: number
    peakExplode: number
    reason?: string
  }
  /** Put the workspace at time `t` seconds of the armed shot. */
  seek: (t: number) => void
  /** Frames rendered since the bridge mounted — the recorder's vsync. */
  rendered: () => number
  /**
   * Re-measure with the model at its most spread out, and keep those bounds as
   * the apart-reference the framing is interpolated against. Returns the
   * measured radius, for the run log.
   *
   * Two-step because geometry only moves in a frame loop: seek to the peak
   * returned by arm(), let the page render it, THEN call this. Measuring
   * inside arm() would read positions that have not been updated yet and
   * quietly hand back the assembled bounds a second time — a shot that then
   * loses its corners off the frame at full explode, with nothing to say why.
   */
  refit: () => number
  /** Hand the camera and the easing back to the app. */
  strike: () => void
  /** Shot ids in the library, for a recorder that renders them all. */
  list: () => Array<{ id: string; title: string; duration: number; plan: string; aspect: string; chrome: boolean }>
  /** Whether a shot is currently armed. */
  active: () => boolean
  /**
   * Measure the scene right now, without arming anything.
   *
   * This is the recorder's readiness signal. `model.status` is NOT one — the
   * preset path leaves it 'idle' while putting a complete building in the
   * scene, so waiting on it waits forever on a scene that has been finished
   * for a minute. What a shot actually needs is geometry to point at, so the
   * recorder polls this until the radius stops changing.
   */
  measure: () => { radius: number; center: [number, number, number] }
}

export default function CinemaBridge() {
  const capRev = useRef(-1)
  const frames = useRef(0)
  const { camera, gl } = useThree()

  /**
   * NAME THE WORKSPACE CANVAS, so the clean plate can say which one it means.
   *
   * There is more than one canvas on screen — the brand badge is an isolated
   * <Canvas> of its own — so "keep the canvas, hide everything else" spares
   * the badge too, and only its canvas half: the lockup is the building mark
   * BESIDE the wordmark and the mark half is an <img>, so what survives into
   * the footage is half a lockup in the top centre.
   *
   * Marked from in here rather than as a prop on <Canvas>, because R3F does
   * not forward `className` to anything — passing it looks like it works,
   * silently applies to nothing, and the clean plate then hides the workspace
   * along with the rest and renders an empty frame. This component is mounted
   * inside the workspace Canvas, so `gl.domElement` IS the canvas in question
   * and there is nothing to get wrong.
   */
  useEffect(() => {
    const el = gl.domElement
    el.classList.add('workspace-canvas')
    return () => { el.classList.remove('workspace-canvas') }
  }, [gl])

  useFrame(() => {
    frames.current++

    /**
     * NO VIEW OFFSET DURING A TAKE.
     *
     * The workspace renders through a camera view-offset: a constant 24px
     * nudge so the plan clears the left edge rail, plus more when a drawer or
     * the tutorial band is up. That is exactly right for someone using the app
     * — the model stays centred in the space the interface actually leaves.
     *
     * It is exactly wrong for footage. A clean plate has hidden the rail and
     * the drawers, so the offset compensates for chrome that is no longer on
     * screen and every frame comes out sitting low and right of centre. It is
     * a small shift and it reads as sloppy framing rather than as a bug, which
     * is why it would have survived all the way into a published file.
     *
     * Cleared per frame rather than once on arm: the offset is applied from an
     * effect that re-runs on drawer and layout state, so anything that nudges
     * that state mid-shot would silently put it back.
     */
    if (cinema.active && cinema.cleanPlate) {
      const cam = camera as typeof camera & {
        view?: { enabled?: boolean } | null
        clearViewOffset?: () => void
      }
      if (cam.view?.enabled) {
        cam.clearViewOffset?.()
        cam.updateProjectionMatrix()
      }
    }
    // The caption lives on the director — a plain object, seeked from outside
    // React — and has to reach the DOM somehow. Polling a revision counter once
    // a frame is cheaper than a subscription and cannot tear; it pushes only on
    // the frames where the caption genuinely changed, which over a ten-second
    // shot is about four frames out of six hundred.
    if (capRev.current !== director.captionRev) {
      capRev.current = director.captionRev
      captionSink.set(director.caption)
    }
  })

  useEffect(() => {
    const api: CinemaAPI = {
      arm: (shot) => {
        const s = typeof shot === 'string' ? SHOTS.find((x) => x.id === shot) : shot
        if (!s) {
          return { ok: false, duration: 0, radius: 0, peakAt: 0, peakExplode: 0, reason: `no shot "${String(shot)}"` }
        }
        director.arm(s)
        // The measured radius comes back so the recorder can log what it
        // framed — and fail the run when it is the empty-scene fallback. A take
        // of nothing is not obviously a take of nothing until someone watches
        // the file, which is usually after the rest of the batch has rendered.
        const peak = peakExplode(s)
        return {
          ok: true,
          duration: s.duration,
          radius: director.frame.radius,
          peakAt: peak.at,
          peakExplode: peak.value,
        }
      },
      seek: (t) => director.seek(t),
      refit: () => director.refit(),
      rendered: () => frames.current,
      strike: () => director.strike(),
      list: () => SHOTS.map((s) => ({
        id: s.id, title: s.title, duration: s.duration,
        plan: s.plan ?? 'easy', aspect: s.aspect ?? 'wide', chrome: s.chrome !== false,
      })),
      active: () => cinema.active,
      measure: () => {
        const f = measureFrame()
        return { radius: f.radius, center: f.center }
      },
    }
    ;(window as unknown as Record<string, unknown>).__cinema = api
    return () => {
      director.strike()
      delete (window as unknown as Record<string, unknown>).__cinema
    }
  }, [])

  return null
}

/**
 * The lower third — the only chrome a clean-plate shot keeps.
 *
 * It is text over a 3D render, so it obeys the same rule as every other label
 * in the app: it sits in a chip carrying its own tint and blur, never directly
 * on the canvas, because the scene behind it changes brightness as the model
 * turns and unbacked text vanishes at half the angles in a sweep.
 *
 * Bottom-centre rather than out on the perimeter, and that is a deliberate
 * exception to where things live: this is not a control, it is a subtitle, it
 * exists only while a shot is rolling, and centred is where the eye watching
 * footage already is. It is `pointer-events: none` throughout, so it cannot
 * take a tap even by accident.
 */
export function CinemaCaption() {
  const [text, setText] = useState(captionSink.value)
  useEffect(() => captionSink.subscribe(setText), [])
  if (!text) return null
  return (
    <div className="cinema-caption" aria-hidden="true">
      <span>{text}</span>
    </div>
  )
}
