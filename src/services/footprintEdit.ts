/**
 * Drawing the footprint by hand — the arithmetic, with no React in it.
 *
 * Draw it used to be four form fields: type a width, type a depth, type where a
 * section hangs and how far along. The shape was a preview of what you typed.
 * Now the shape IS the input. You pull an edge and the building gets bigger;
 * you slide a section along the wall it hangs off. The number is still there —
 * on the dimension, where you can tap it and type it exact — but it is the
 * backup, not the front door.
 *
 * Everything here works on the same `FootprintBox` list `placeBoxes` already
 * turns into rectangles, so the thing you drag is the thing that gets built.
 * Every edit comes back through `normalizeBoxes`, which is what keeps a drag
 * from producing a building the app cannot frame: a box too small to be a
 * room, or a section dragged clean off the side it is supposed to be hung on.
 */
import { placeBoxes, type AttachSide, type FootprintBox } from './footprint'

/** Smaller than this is a closet, not a building section, and almost always a slip. */
export const MIN_BOX_MM = 1000
/** Bigger than this is a city block. Same limit the typed sizes always had. */
export const MAX_BOX_MM = 120000
/**
 * How much of a section's side has to stay against the main box.
 *
 * A section is HUNG OFF a wall, so it has to share some of that wall. Slide it
 * to where it only touches at a corner and the outline pinches to a point,
 * which is not a building anyone frames. Two feet of shared wall is a door's
 * worth — the least that still reads as one house.
 */
export const MIN_OVERLAP_MM = 600

export type SizeField = 'w' | 'd'
/** What a handle changes: the width, the depth, both (a corner), or where a section sits. */
export type GripKind = 'w' | 'd' | 'wd' | 'slide'
export interface Grip { box: number; kind: GripKind }

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** A section on the left or right runs DOWN the page along the main box. */
export const runsDown = (side: AttachSide): boolean => side === 'left' || side === 'right'

/** Round to the nearest step — a finger lands on clean numbers, not 40′ 3 7/16″. */
export function snapTo(v: number, step: number): number {
  return step > 0 ? Math.round(v / step) * step : v
}

/**
 * Every box in range, and every section still hanging off its side.
 *
 * Run after EVERY edit, not just drags on sections: shrink the main box and a
 * section that was comfortably attached can find itself past the new end of
 * the wall it was hung on. It is pulled back until it shares at least
 * `MIN_OVERLAP_MM` of that wall again, rather than left floating.
 */
export function normalizeBoxes(boxes: readonly FootprintBox[]): FootprintBox[] {
  if (boxes.length === 0) return []
  const main: FootprintBox = {
    widthMm: clamp(boxes[0].widthMm, MIN_BOX_MM, MAX_BOX_MM),
    depthMm: clamp(boxes[0].depthMm, MIN_BOX_MM, MAX_BOX_MM),
  }
  const rest = boxes.slice(1).map((b): FootprintBox => {
    const widthMm = clamp(b.widthMm, MIN_BOX_MM, MAX_BOX_MM)
    const depthMm = clamp(b.depthMm, MIN_BOX_MM, MAX_BOX_MM)
    const side: AttachSide = b.attach?.side ?? 'right'
    const own = runsDown(side) ? depthMm : widthMm
    const wall = runsDown(side) ? main.depthMm : main.widthMm
    const lo = MIN_OVERLAP_MM - own
    const hi = wall - MIN_OVERLAP_MM
    const offsetMm = clamp(b.attach?.offsetMm ?? 0, Math.min(lo, hi), Math.max(lo, hi))
    return { widthMm, depthMm, attach: { side, offsetMm } }
  })
  return [main, ...rest]
}

/**
 * The boxes after a handle has been pulled by (dx, dy) millimetres.
 *
 * Always measured from where the drag STARTED, never accumulated frame to
 * frame. Accumulating snapped deltas loses the remainder every frame, so a slow
 * drag creeps behind the finger and a fast one overshoots it.
 *
 * Which way is "bigger" depends on the side a section hangs off. A section on
 * the left grows LEFTWARD — its outer edge is its left edge — so pulling left
 * is positive. A section on top (the front) grows UPWARD for the same reason.
 * The main box is anchored at its top-left corner and grows right and down.
 */
export function dragBoxes(
  start: readonly FootprintBox[],
  grip: Grip,
  dxMm: number,
  dyMm: number,
  snapMm: number,
): FootprintBox[] {
  const next = start.map((b) => ({ ...b, attach: b.attach ? { ...b.attach } : undefined }))
  const b = next[grip.box]
  const s0 = start[grip.box]
  if (!b || !s0) return normalizeBoxes(start)

  if (grip.box === 0) {
    if (grip.kind === 'w' || grip.kind === 'wd') b.widthMm = snapTo(s0.widthMm + dxMm, snapMm)
    if (grip.kind === 'd' || grip.kind === 'wd') b.depthMm = snapTo(s0.depthMm + dyMm, snapMm)
    return normalizeBoxes(next)
  }

  const side: AttachSide = s0.attach?.side ?? 'right'
  if (grip.kind === 'w' || grip.kind === 'wd') b.widthMm = snapTo(s0.widthMm + (side === 'left' ? -dxMm : dxMm), snapMm)
  if (grip.kind === 'd' || grip.kind === 'wd') b.depthMm = snapTo(s0.depthMm + (side === 'top' ? -dyMm : dyMm), snapMm)
  if (grip.kind === 'slide' && b.attach) {
    b.attach.offsetMm = snapTo((s0.attach?.offsetMm ?? 0) + (runsDown(side) ? dyMm : dxMm), snapMm)
  }
  return normalizeBoxes(next)
}

/** One size, typed exact. Not snapped: a typed number is the number you meant. */
export function typeBoxSize(
  boxes: readonly FootprintBox[],
  box: number,
  field: SizeField,
  mm: number,
): FootprintBox[] {
  const next = boxes.map((b) => ({ ...b, attach: b.attach ? { ...b.attach } : undefined }))
  if (!next[box]) return normalizeBoxes(boxes)
  if (field === 'w') next[box].widthMm = mm
  else next[box].depthMm = mm
  return normalizeBoxes(next)
}

/** Where a section starts along its side, typed exact. Negative runs back past the corner. */
export function typeOffset(boxes: readonly FootprintBox[], box: number, mm: number): FootprintBox[] {
  const next = boxes.map((b) => ({ ...b, attach: b.attach ? { ...b.attach } : undefined }))
  const b = next[box]
  if (!b || box === 0) return normalizeBoxes(boxes)
  b.attach = { side: b.attach?.side ?? 'right', offsetMm: mm }
  return normalizeBoxes(next)
}

/**
 * Which outside edge of the plan each of a box's two dimensions is drawn along.
 *
 * A section's OUTER size goes on its outer edge — the back of a section off the
 * back, the left of a section off the left. Its other size goes on whichever
 * end of the building the section is nearer. That second rule was first a fixed
 * side, and a section at the left end of the back wall had its depth dimensioned
 * on the far right, beside the main box's corner, with a witness line running
 * the length of the house to reach it. It read as the main box's depth.
 */
export function dimensionSides(
  box: FootprintBox,
  index: number,
  main: FootprintBox,
): { w: AttachSide; d: AttachSide } {
  if (index === 0) return { w: 'top', d: 'left' }
  const side = box.attach?.side ?? 'right'
  const off = box.attach?.offsetMm ?? 0
  if (runsDown(side)) {
    const nearTop = off + box.depthMm / 2 < main.depthMm / 2
    return { w: nearTop ? 'top' : 'bottom', d: side }
  }
  const nearLeft = off + box.widthMm / 2 < main.widthMm / 2
  return { w: side, d: nearLeft ? 'left' : 'right' }
}

export interface DimensionLane { side: AttachSide; lane: number }

const EPS = 1e-6

/**
 * Which lane each dimension sits in, and how many lanes each edge needs.
 *
 * Dimensions stack outward from the building, but ONLY WHEN THEY OVERLAP.
 * Two that run end to end — the main box's depth from 0 to 30′, a section's
 * from 30′ to 44′ — share a lane and read as one chain, the way a print
 * dimensions a run of rooms. Stacking every dimension on its own lane cost a
 * full lane of plan for nothing, and on a phone that was the difference
 * between a house you could grab and a house squeezed into a third of the box.
 *
 * The count lives HERE rather than in the component on purpose. It was first a
 * counter bumped inside a `.map()` during render; the React compiler memoises
 * render code, a side effect inside a map callback is exactly what it is free
 * to cache or run again, so the count ran twice and every dimension landed one
 * lane out — off the edge of the plan. A plain function in a plain module is
 * opaque to the compiler, so it counts once.
 */
export function dimensionLanes(boxes: readonly FootprintBox[]): {
  lanes: Array<{ w: DimensionLane; d: DimensionLane }>
  count: Record<AttachSide, number>
} {
  const placed = placeBoxes(boxes)
  const taken: Record<AttachSide, Array<Array<[number, number]>>> = { top: [], bottom: [], left: [], right: [] }
  const put = (side: AttachSide, a: number, b: number): number => {
    const onSide = taken[side]
    let k = onSide.findIndex((lane) => lane.every(([s, e]) => b <= s + EPS || a >= e - EPS))
    if (k === -1) { k = onSide.length; onSide.push([]) }
    onSide[k].push([a, b])
    return k
  }
  const lanes: Array<{ w: DimensionLane; d: DimensionLane }> = []
  for (let i = 0; i < boxes.length; i++) {
    const sides = dimensionSides(boxes[i], i, boxes[0])
    const r = placed[i]
    lanes.push({
      w: { side: sides.w, lane: put(sides.w, r.x1, r.x2) },
      d: { side: sides.d, lane: put(sides.d, r.y1, r.y2) },
    })
  }
  return {
    lanes,
    count: { top: taken.top.length, bottom: taken.bottom.length, left: taken.left.length, right: taken.right.length },
  }
}
