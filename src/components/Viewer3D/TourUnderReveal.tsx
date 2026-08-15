/**
 * TourUnderReveal — duck under the floor the moment it is laid, then come back.
 *
 * The tour says a floor is a deck on joists. The user taps two corners, a grey
 * slab appears from above, and that proves nothing: from up there a floor and a
 * rectangle look identical. So the camera drops below the deck for a beat — the
 * joists are right there overhead — and then it returns to exactly the view it
 * started from. One move, under two seconds, and the claim is demonstrated
 * rather than asserted.
 *
 * It goes through setCameraPreset rather than moving the camera itself. A first
 * attempt lerped camera.position inside useFrame and nothing happened at all:
 * OrbitEnabledGuard re-asserts `enabled` every frame, and OrbitControls then
 * rewrites the camera from its own spherical coordinates, so the move was
 * overwritten before it could ever be seen. CameraPresetApplier is the one path
 * that hands the controls a new pose properly — target included, damping zeroed
 * for a frame so nothing drifts.
 *
 * Fires ONCE per tour, on the transition from no floor to a floor, and only
 * while the floor step is live. It is a reveal, not a camera mode.
 */
import { useEffect, useRef } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useAppStore } from '../../store/useAppStore'
import { useFloorplanLocalStore } from '../../store/useFloorplanLocalStore'
import { TUTORIAL_STEPS, clampStep } from '../../services/tutorial'

/** How long we stay under before coming home. */
const UNDER_MS = 1500

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
  const timer = useRef<number | null>(null)

  const onFloorStep = active && TUTORIAL_STEPS[clampStep(rawStep)]?.id === 'floor'

  useEffect(() => {
    const has = floors.length > 0
    const justLaid = has && !hadFloor.current
    hadFloor.current = has
    if (!justLaid || !onFloorStep || fired.current) return
    fired.current = true

    const ctl = controls as unknown as Ctl | null
    const [cx, cz] = overlay.position
    const spread = Math.max(overlay.scale[0], overlay.scale[1]) || 8

    // Where we are now, so we can put it back exactly.
    const home: { position: [number, number, number]; target: [number, number, number] } = {
      position: [camera.position.x, camera.position.y, camera.position.z],
      target: ctl?.target ? [ctl.target.x, ctl.target.y, ctl.target.z] : [cx, 0, cz],
    }

    // Below the deck and off to one side, so the joists run away from the eye
    // rather than being seen edge-on.
    setCameraPreset({
      position: [cx + spread * 0.16, -spread * 0.26, cz + spread * 0.16],
      target: [cx, 0, cz],
    })

    timer.current = window.setTimeout(() => setCameraPreset(home), UNDER_MS)
  }, [floors.length, onFloorStep, camera, controls, overlay.position, overlay.scale, setCameraPreset])

  // Reset between tours so a second run reveals again; never leave a pending
  // "come home" behind when the tour is closed mid-dip.
  useEffect(() => {
    if (!active) fired.current = false
  }, [active])
  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current)
  }, [])

  return null
}
