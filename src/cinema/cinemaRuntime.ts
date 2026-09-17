/**
 * CINEMA RUNTIME — the flag the rest of the app checks while a shot is rolling.
 *
 * Footage is not a screen recording. A screen recording of this app gets you
 * the idle spin fighting your camera move, the explode easing at whatever rate
 * the frame clock felt like, and a print that wanders off on its little legs
 * halfway through the hero shot. All three are correct behaviour for a person
 * sitting in front of the app and all three ruin a take.
 *
 * So a shot puts the workspace into a known, quiet state and takes authority
 * over exactly two things — the camera pose and the explode progress — while
 * leaving everything else running normally. The model builds the way it always
 * builds, the layers render the way they always render. Nothing here is a
 * special "demo mode" scene: what the camera flies through is the real app,
 * which is the entire reason the footage is worth anything to someone deciding
 * whether to believe the product.
 *
 * DETERMINISM IS THE POINT. The recorder advances scene time itself, one fixed
 * step per captured frame, instead of letting wall-clock time drive the easing.
 * A capture that renders at four frames a second on a laptop still produces a
 * perfectly smooth 60fps file, because scene time and capture time are not the
 * same clock. That only works if every animated value a shot touches is a pure
 * function of the shot clock — hence `explode` below, which bypasses the
 * damped, delta-driven easing the live app uses.
 */

export const cinema = {
  /**
   * A shot is rolling. Read by the things that move the camera on their own —
   * the idle spin, the walkabout easter egg — so they stand down rather than
   * fight the director for the same camera.
   */
  active: false,

  /**
   * Explode progress the director is asserting, 0..1, or null when the app's
   * own damped easing should run.
   *
   * Both explode drivers (ExplodeDriver pre-build, BuildingModel after) damp
   * toward the slider using frame delta. That is right for a thumb on a slider
   * — it is why the explode feels weighted instead of snapping — and wrong for
   * capture, where the same shot has to produce identical geometry on every
   * run regardless of how long the machine took to draw each frame. When this
   * is non-null the drivers copy it straight through and skip the damping.
   */
  explode: null as number | null,

  /**
   * This shot has the interface hidden.
   *
   * Gates the view-offset clear. The workspace renders through a camera
   * view-offset that keeps the model centred in the space the chrome actually
   * leaves — a constant nudge clear of the left rail, more when a drawer is
   * open. On a clean plate that chrome is hidden, so the offset compensates
   * for something that is not there and every frame lands low and right of
   * centre. On a shot that KEEPS the chrome the offset is doing its real job
   * and must be left alone, or the model sits centred on the viewport with a
   * rail over one end of it — which is the very bug the offset exists to fix.
   */
  cleanPlate: false,
}

/** True while a shot owns the camera. */
export function cinemaActive(): boolean {
  return cinema.active
}
