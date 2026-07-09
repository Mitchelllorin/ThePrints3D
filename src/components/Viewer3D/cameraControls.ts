// Bridge so DOM chrome (TopIcons) can drive the R3F OrbitControls that live
// inside the Canvas. ModelViewer mirrors its controls ref here on mount; the
// zoom buttons in TopIcons call zoomCamera(). No-ops safely when no 3D view is
// mounted (controls null).
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'

export const cameraControls: { current: OrbitControlsImpl | null } = { current: null }

/** Dolly the camera toward/away from the orbit target. factor < 1 zooms IN. */
export function zoomCamera(factor: number): void {
  const c = cameraControls.current
  if (!c) return
  const cam = c.object
  const offset = cam.position.clone().sub(c.target)
  offset.multiplyScalar(factor)
  cam.position.copy(c.target).add(offset)
  c.update()
}
