/**
 * TourUnderReveal — the hand takes hold of the workspace and turns it over.
 *
 * The floor step says joists and sheeting, screws and nails. From above, a
 * finished floor and a grey rectangle are the same picture, so the claim has to
 * be shown from underneath. The same invisible hand that drops the marks and
 * pulls the floor grabs the print here and rolls it over: under the deck, in
 * close on a joist hanger so the metal saddle at the joist-to-rim connection is
 * actually legible, back out, and over again to where it started — then it
 * carries on turning with its new floor on it.
 *
 * SLOWLY. The first version cut straight under and back in a second and a half,
 * which is fine for a machine reading a state change and useless for a person:
 * you cannot see a thing you were not given time to look at. Eleven seconds of
 * continuous movement, every phase eased, nothing cut.
 *
 * It drives the camera through setCameraPreset every frame rather than writing
 * camera.position directly. Writing the camera does nothing: OrbitEnabledGuard
 * re-asserts `enabled` each frame and OrbitControls then rewrites the camera
 * from its own spherical coordinates, so the move is overwritten before it can
 * be seen. CameraPresetApplier is the one path that sets position AND target
 * and re-syncs the controls, so it is the one that survives.
 *
 * Fires ONCE per tour, on the transition from no floor to a floor, while the
 * floor step is live. It is a reveal, not a camera mode.
 */
import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useAppStore } from '../../store/useAppStore'
import { useFloorplanLocalStore } from '../../store/useFloorplanLocalStore'
import { TUTORIAL_STEPS, clampStep } from '../../services/tutorial'

type Pose = { position: [number, number, number]; target: [number, number, number] }

/**
 * The whole move, in seconds per phase. Read these as camera directions:
 * roll it under · come in on a hanger · let it be looked at · draw back ·
 * roll it home.
 */
const PHASES = [
  { name: 'under', secs: 3.0 },
  { name: 'zoom', secs: 2.2 },
  { name: 'hold', secs: 1.4 },
  { name: 'back', secs: 2.0 },
  { name: 'home', secs: 3.0 },
] as const

const TOTAL = PHASES.reduce((n, p) => n + p.secs, 0)

/** Slow at both ends, so nothing snaps into or out of motion. */
const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2)

function lerpPose(a: Pose, b: Pose, k: number): Pose {
  const m = (i: 0 | 1 | 2) => a.position[i] + (b.position[i] - a.position[i]) * k
  const t = (i: 0 | 1 | 2) => a.target[i] + (b.target[i] - a.target[i]) * k
  return { position: [m(0), m(1), m(2)], target: [t(0), t(1), t(2)] }
}

type Ctl = { target?: THREE.Vector3 }

export default function TourUnderReveal() {
  const { camera, controls } = useThree()
  const active = useFloorplanLocalStore((s) => s.tutorialActive)
  const rawStep = useFloorplanLocalStore((s) => s.tutorialStep)
  const floors = useAppStore((s) => s.floorsAreas)
  const overlay = useAppStore((s) => s.floorplanOverlay)
  const setCameraPreset = useAppStore((s) => s.setCameraPreset)

  const fired = useRef(false)
  const hadFloor = useRef(floors.length > 0)
  const run = useRef<{ t: number; home: Pose; under: Pose; hanger: Pose } | null>(null)

  const onFloorStep = active && TUTORIAL_STEPS[clampStep(rawStep)]?.id === 'floor'

  // Dev-only: hand out the camera so a camera move can be MEASURED rather than
  // squinted at in a screenshot that lands whenever it lands.
  useEffect(() => {
    if (!import.meta.env.DEV) return
    ;(window as unknown as Record<string, unknown>).__tourCamera = camera
  }, [camera])

  useEffect(() => {
    const has = floors.length > 0
    const justLaid = has && !hadFloor.current
    hadFloor.current = has
    if (!justLaid || !onFloorStep || fired.current) return
    fired.current = true

    const ctl = controls as unknown as Ctl | null
    const [cx, cz] = overlay.position
    const [ow, od] = overlay.scale
    const spread = Math.max(ow, od) || 8

    const home: Pose = {
      position: [camera.position.x, camera.position.y, camera.position.z],
      target: ctl?.target ? [ctl.target.x, ctl.target.y, ctl.target.z] : [cx, 0, cz],
    }

    // Under the deck and off to one side, so the joists run away from the eye
    // rather than being seen edge-on.
    const under: Pose = {
      position: [cx + spread * 0.16, -spread * 0.30, cz + spread * 0.20],
      target: [cx, 0, cz],
    }

    // A joist-to-rim connection on the near edge — where the hangers are (see
    // framingGeometry: a galvanised saddle at each joist end). Close enough that
    // the saddle is a saddle and not a grey speck.
    const hx = cx + ow * 0.36
    const hz = cz + od * 0.20
    const hanger: Pose = {
      position: [hx + 1.5, -1.15, hz + 1.5],
      target: [hx, -0.28, hz],
    }

    run.current = { t: 0, home, under, hanger }
  }, [floors.length, onFloorStep, camera, controls, overlay.position, overlay.scale])

  useFrame((_, delta) => {
    const r = run.current
    if (!r) return
    r.t += delta

    // Cut the move short if the tour has moved on — the reveal belongs to the
    // sentence being read, and holding the camera hostage past it is worse than
    // not showing it at all. Always finish AT home.
    if (!onFloorStep || r.t >= TOTAL) {
      run.current = null
      setCameraPreset(r.home)
      return
    }

    let t = r.t
    let pose: Pose = r.home
    for (const phase of PHASES) {
      if (t > phase.secs) { t -= phase.secs; continue }
      const k = ease(t / phase.secs)
      pose = phase.name === 'under' ? lerpPose(r.home, r.under, k)
        : phase.name === 'zoom' ? lerpPose(r.under, r.hanger, k)
        : phase.name === 'hold' ? r.hanger
        : phase.name === 'back' ? lerpPose(r.hanger, r.under, k)
        : lerpPose(r.under, r.home, k)
      break
    }
    setCameraPreset(pose)
  })

  // Reset between tours so a second run reveals again. If the tour is closed
  // mid-move, put the camera back rather than leaving someone underneath.
  useEffect(() => {
    if (active) return
    fired.current = false
    const r = run.current
    if (r) {
      run.current = null
      setCameraPreset(r.home)
    }
  }, [active, setCameraPreset])

  return null
}
