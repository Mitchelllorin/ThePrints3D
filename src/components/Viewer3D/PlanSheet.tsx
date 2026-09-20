/**
 * PlanSheet — the drawing of the building, drawn from the building.
 *
 * THE PRINT KEEPS UP WITH THE WORK. Pull a wall and it appears on the sheet as
 * a plan-cut pair of face lines at its real thickness. Cut a door into it and
 * the sheet shows the break, with the jambs and the swing arc (those come from
 * PlacedObjectsLayer, on this same plane). Move it, retype its length, change
 * it from a 2x4 to a 2x6 — the sheet changes, because there is no second set of
 * facts here: this reads the very same framing plan the 3D walls are built
 * from, so the drawing cannot drift out of step with the model.
 *
 * That is the trade this app is for. A builder works off a print; a drafter
 * makes one. Doing both from one model means the print is never the stale thing
 * in the binder — it is a view of what is actually standing.
 *
 * WHAT IT DOES NOT DO IS EXPLODE. The sheet is not a layer of the assembly, so
 * there is nothing for it to come apart into, and it stays flat and whole while
 * the model lifts away above it. That is deliberate: the fixed drawing is what
 * makes the exploded parts readable, because you have something square to read
 * them against. It also has to stay put to remain a plan — a plan that tilted
 * and scattered with the model would be neither.
 *
 * ONE SHEET, ONE FLOOR, like any drawing set: it shows the storey being worked
 * on, not every storey stacked into one unreadable tangle.
 */
import { useMemo } from 'react'
import { Line } from '@react-three/drei'
import { useAppStore } from '../../store/useAppStore'
import { useFloorplanLocalStore } from '../../store/useFloorplanLocalStore'
import { usePrintDrop } from '../../services/printPlane'
import { getCatalogItem } from '../../data/objectCatalog'
import { useWallPlans } from './useWallPlans'
import type { PlacedObject } from '../../types'

/** Ink colours. A print is drawn in one weight of line, not coloured in — the
 *  colour coding belongs to the model, where there is a member to colour. */
const INK = '#7ea4dd'
const INK_FAINT = '#4a6b9c'

/** A hair above the sheet, so the lines sit ON the paper rather than z-fighting
 *  the image under them. */
const INK_LIFT = 0.012

/** Opening width in metres, from the catalogue and the object's own scale —
 *  the same figure the 3D uses to cut the hole, so the break drawn on the sheet
 *  is the width of the hole that exists. */
function openingWidth(obj: PlacedObject): number {
  return (getCatalogItem(obj.type)?.defaultW ?? 0.9) * obj.scaleX
}

/** A sectional overhead, not a hinged door — decided by WIDTH, the same test
 *  PlacedObjectsLayer uses, because width is what actually decides it. */
const isOverhead = (obj: PlacedObject) => obj.type === 'door' && openingWidth(obj) >= 2.1
/** Past 36in nobody hangs one leaf; the opening takes a pair. */
const isPair = (obj: PlacedObject) => obj.type === 'door' && openingWidth(obj) > 1.0 && !isOverhead(obj)

export default function PlanSheet() {
  const plans = useWallPlans()
  const placedObjects = useAppStore((s) => s.placedObjects)
  const activeLevel = useFloorplanLocalStore((s) => s.activeLevel)
  const printVisible = useAppStore((s) => s.floorplanOverlay.visible)
  const printDrop = usePrintDrop()

  /**
   * Each wall becomes its own footprint: the rectangle it occupies in plan,
   * drawn as a closed outline at the wall's REAL thickness. A single centre
   * line would be a diagram; two faces at the right spacing is a plan, and it
   * is what lets someone read a 2x6 wall as thicker than the 2x4 beside it
   * without being told.
   */
  const outlines = useMemo(() => plans
    .filter((p) => p.level === activeLevel)
    .map((p) => {
      const hl = p.length / 2
      const ht = Math.max(p.thicknessM, 0.05) / 2
      const cos = Math.cos(p.angle)
      const sin = Math.sin(p.angle)
      // Corners in the wall's own frame, turned into world by its angle. The
      // same cx/cz/angle the 3D wall stands on, so the two cannot disagree.
      const corner = (u: number, v: number): [number, number, number] => [
        p.cx + u * cos - v * sin,
        INK_LIFT,
        p.cz + u * sin + v * cos,
      ]
      return {
        key: p.index,
        pts: [
          corner(-hl, -ht), corner(hl, -ht), corner(hl, ht), corner(-hl, ht), corner(-hl, -ht),
        ] as [number, number, number][],
        // The centre line, faint — what a dimension would be pulled to.
        centre: [corner(-hl, 0), corner(hl, 0)] as [number, number, number][],
      }
    }), [plans, activeLevel])

  /**
   * THE OPENINGS, as a drafter marks them: the break in the wall between two
   * jamb ticks, and — for a door — the leaf and the quarter-circle it sweeps.
   *
   * The arc is the only thing on a drawing that says which way a door goes, and
   * it is what gets read when the door is ordered and when the framer decides
   * which side the stop goes on. So it is drawn from the hand AND the swing
   * direction actually set on the door, not from whichever way the geometry
   * happened to point.
   */
  const openings = useMemo(() => placedObjects
    .filter((o) => (o.type === 'door' || o.type === 'window') && (o.level ?? 0) === activeLevel)
    .map((obj) => {
      const w = openingWidth(obj)
      const cos = Math.cos(obj.rotationY)
      const sin = Math.sin(obj.rotationY)
      // Object-local (along the opening, across it) → world.
      const at = (u: number, v: number): [number, number, number] => [
        obj.x + u * cos - v * sin,
        INK_LIFT,
        obj.z + u * sin + v * cos,
      ]
      const jambs: [number, number, number][][] = [
        [at(-w / 2, -0.11), at(-w / 2, 0.11)],
        [at(w / 2, -0.11), at(w / 2, 0.11)],
      ]

      if (obj.type === 'window') {
        return {
          key: obj.id, jambs,
          bars: [[at(-w / 2, -0.045), at(w / 2, -0.045)], [at(-w / 2, 0.045), at(w / 2, 0.045)]],
          leaves: [] as { leaf: [number, number, number][]; arc: [number, number, number][] }[],
        }
      }

      if (isOverhead(obj)) {
        // Nothing swings on a sectional: the door across the opening, and the
        // tracks running back into the garage, which is where it actually goes.
        const reach = Math.min(w, 2.4)
        return {
          key: obj.id, jambs,
          bars: [
            [at(-w / 2, 0), at(w / 2, 0)],
            [at(-w / 2 + 0.06, 0), at(-w / 2 + 0.06, reach)],
            [at(w / 2 - 0.06, 0), at(w / 2 - 0.06, reach)],
          ],
          leaves: [],
        }
      }

      // Hinged. `face` is which side of the wall the leaf sweeps into.
      const face = (obj.swingSide ?? 'in') === 'in' ? 1 : -1
      const leafAt = (hinge: number, sign: number, reach: number) => {
        const arc: [number, number, number][] = []
        for (let i = 0; i <= 20; i++) {
          const t = (i / 20) * (Math.PI / 2)
          arc.push(at(hinge + sign * reach * Math.cos(t), face * reach * Math.sin(t)))
        }
        return { arc, leaf: [at(hinge, 0), at(hinge, face * reach)] }
      }
      // A pair hinges at BOTH jambs, each leaf covering half the opening —
      // one big arc across a double door is the plan-symbol equivalent of
      // hanging one big slab.
      const leaves = isPair(obj)
        ? [leafAt(-w / 2, 1, w / 2), leafAt(w / 2, -1, w / 2)]
        : [leafAt(
            (obj.swing ?? 'left') === 'left' ? -w / 2 : w / 2,
            (obj.swing ?? 'left') === 'left' ? 1 : -1,
            w,
          )]
      return { key: obj.id, jambs, bars: [] as [number, number, number][][], leaves }
    }), [placedObjects, activeLevel])

  // No sheet showing, nothing to draw on. The print's own visibility toggle
  // governs its contents too — the marks are part of the drawing.
  if (!printVisible || (outlines.length === 0 && openings.length === 0)) return null

  return (
    /* NOT inside any group that explodes. Explode is opt-in per layer
       (useExplodeChildren), and this layer deliberately does not opt in — which
       is the whole reason the symbols had to come out of PlacedObjectsLayer,
       where they were children of a group that does. */
    <group name="plan-sheet" position={[0, printDrop, 0]} userData={{ noPick: true }}>
      {outlines.map((o) => (
        <group key={o.key}>
          <Line points={o.centre} color={INK_FAINT} lineWidth={1} dashed dashSize={0.18} gapSize={0.14} />
          <Line points={o.pts} color={INK} lineWidth={2} />
        </group>
      ))}
      {openings.map((o) => (
        <group key={o.key}>
          {o.jambs.map((j, i) => <Line key={`j${i}`} points={j} color={INK} lineWidth={3} />)}
          {o.bars.map((b, i) => <Line key={`b${i}`} points={b} color={INK} lineWidth={2} />)}
          {o.leaves.map((l, i) => (
            <group key={`l${i}`}>
              <Line points={l.leaf} color={INK} lineWidth={3} />
              <Line points={l.arc} color={INK_FAINT} lineWidth={2} />
            </group>
          ))}
        </group>
      ))}
    </group>
  )
}
