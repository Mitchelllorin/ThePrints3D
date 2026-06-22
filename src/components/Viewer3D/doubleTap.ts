/**
 * Touch-friendly double-tap detector for react-three-fiber meshes.
 *
 * r3f's onDoubleClick rides the DOM `dblclick` event, which is unreliable on
 * touch (Android-first here, see mobile UX notes) — so we detect it ourselves
 * from pointerdown timing + position. Keep ONE state per layer in a ref and call
 * `detectDoubleTap(state, id, e)` inside each item's onPointerDown; it returns
 * true on the SECOND quick tap of the SAME id (close in time and screen space),
 * so a slow tap, a drag, or tapping a different element never false-fires.
 */
import type { ThreeEvent } from '@react-three/fiber'

export interface DoubleTapState {
  id: string | null
  t: number
  x: number
  y: number
}

export function createDoubleTapState(): DoubleTapState {
  return { id: null, t: 0, x: 0, y: 0 }
}

/** @returns true when this pointerdown completes a double-tap on `id`. */
export function detectDoubleTap(
  state: DoubleTapState,
  id: string,
  e: ThreeEvent<PointerEvent>,
  ms = 320,
  px = 28,
): boolean {
  const n = e.nativeEvent
  const close = Math.hypot(n.clientX - state.x, n.clientY - state.y) < px
  if (state.id === id && n.timeStamp - state.t < ms && close) {
    state.id = null
    state.t = 0
    return true
  }
  state.id = id
  state.t = n.timeStamp
  state.x = n.clientX
  state.y = n.clientY
  return false
}
