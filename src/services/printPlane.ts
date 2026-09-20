/**
 * printPlane — where the drawing sits once the building is standing on it.
 *
 * THE PRINT IS NOT PART OF THE MODEL. It is the drawing the model was built
 * from, and it keeps being that drawing after the model exists: every wall you
 * pull, every door you hang, every opening you cut shows up on it as the mark a
 * drafter would have put there. That is the whole trade — you are the builder
 * and the printmaker at once, and the two views stay in step because there is
 * only one set of facts under them.
 *
 * Which is why the print does NOT explode. Explode takes the BUILDING apart to
 * show how it goes together; the drawing of it is not a layer of the assembly
 * and has nothing to come apart into. Pull the model up and away and the print
 * stays exactly where it is, flat and whole underneath — which is also what
 * makes the explode legible, because the drawing is the fixed thing you read
 * the lifted parts against.
 *
 * SO IT NEEDS DAYLIGHT UNDER THE BUILDING.
 *
 * Before the model exists the print and the floor are the same plane: you are
 * working ON the drawing, and the plan symbols belong right where the walls
 * are. The moment a building stands up, that coplanar arrangement turns the
 * symbols into litter around the base of every opening — a scatter of marks
 * visible from every angle except the overhead one they were drawn for.
 *
 * Dropping the print clear of the slab fixes both at once: the marks stop
 * fouling the model, and the drawing becomes a thing you look DOWN at, under
 * the building, the way a print sits on the bench under what you are building.
 *
 * The drop is VISUAL ONLY. Trace and calibration coordinates are untouched —
 * the drop goes to zero whenever either of those owns the pointer, so a tap
 * always lands on the plane you can see. Nothing derived from print pixels ever
 * reads this value.
 */
import { useAppStore } from '../store/useAppStore'
import { useFloorplanLocalStore } from '../store/useFloorplanLocalStore'

/**
 * How far the print drops below grade once a building stands on it, in metres.
 *
 * Chosen by eye against a storey: roughly a third of a wall, which is enough
 * daylight to read as a separate sheet from an ordinary three-quarter view and
 * not so much that the drawing detaches from the thing it describes. Anything
 * under ~0.6 closes up as soon as the camera comes down near the horizon.
 */
export const PRINT_DROP_M = 1.1

/**
 * The print's current vertical offset, in metres (0 or -PRINT_DROP_M).
 *
 * Every surface that draws on the print reads this — the print image itself and
 * the plan symbols in PlacedObjectsLayer — so the sheet and its marks can never
 * end up on different planes.
 */
export function usePrintDrop(): number {
  const modelReady = useAppStore((s) => s.model.status === 'ready')
  const traceMode = useFloorplanLocalStore((s) => s.traceMode)
  const calibrationMode = useAppStore((s) => s.floorplanOverlay.calibrationMode)
  // Tracing and calibrating both map a tap to a print pixel. Drop the sheet
  // under either and the tap lands where the sheet USED to be — a stray wall,
  // or a calibration that silently sets the wrong scale.
  if (!modelReady || traceMode || calibrationMode) return 0
  return -PRINT_DROP_M
}
