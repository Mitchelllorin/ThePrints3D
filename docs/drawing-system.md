# The drawing system

One way to draw walls on a plan, used by tracing in the main workspace and by the
Draw it sheet, and meant for any family app that draws on a plan. The rules are in
`src/services/drawSystem.ts` (no React, no units, tested in `drawSystem.test.ts`).
Each app only converts between screen pixels and its own plan units, and draws
what a snap reports.

## Gestures

| Do this | What happens |
| --- | --- |
| Tap | Places a point. The first tap starts a run; each tap after it puts a wall down and its end is the next start. |
| Drag | Draws one wall from where the finger lands to where it lifts. A drag from the last point carries the run on. |
| Tap the last point again | Ends the run. No wall is added. |
| Double tap | Ends the run. |
| Tap the first point | Closes the shape. The close ring on the first point turns green when the next tap will close. |
| Long-press (0.55 s, still) | Ends the run. Lifting the finger after it adds nothing. |
| Undo / Done | Outlined text buttons beside the current point, placed clear of the point, the pointer and the direction you are drawing. Undo takes back the last wall and steps the run back to its start. |
| Two fingers | Camera (pan, zoom). A second finger never leaves half a wall behind. |

Touch: while a finger is down, a loupe (112 px, 2.5x) shows the exact point 96 px
above the finger, with a crosshair that turns green when the point has caught
something. A mouse uses its normal crosshair and gets no loupe.

## Snaps, in order

1. **Close**: within 1.6x the reach of the run's first point, the point is the first point.
2. **End**: within the reach of another wall's end, the point is that end (never the end being drawn from).
3. **Held angle** (with a start): the wall is held to the plan axes (0, 90, 180, 270), or to straight on / square either way off the wall before, within 9 degrees; to the 45s within 5 degrees. Past that the wall keeps the angle drawn, to the whole degree. "Any angle" leaves only a 3 degree pull to square and the 45s.
4. **Run on**: a held wall that nearly reaches another wall runs on along its own line to meet it, instead of kinking to get there.
5. **Line up**: a held wall stops level with a corner it lines up with (the run's first point first), so the last wall of a room comes out square to the first.
6. **First point**: with no start, a point near a wall lands on the wall; otherwise on the grid when the app has one.

The reach is 18 screen pixels, converted to plan units where the pointer is, so it
means the same at any zoom.

## What you see

- **Guide**: a dashed amber line along the held angle, past the point. A dotted line to the corner it lined up with.
- **Marker** on the point: a ring on an end, a cross on a wall, a diamond on a line-up.
- **Length**: plain text on the wall being drawn, kept clear of the end being dragged (and of the loupe). Tap it to type an exact length (12, 12 6, 12'6", 3.6 m).
- **Corner angle**: plain text inside the corner (90 is square, 180 is straight on). Tap it to type an exact angle; the wall leaves the corner at that angle on the side it was drawn.
- Readouts and controls are text with a dark outline (`--ink-on-model`), never on a plate, and never on the rail, the top icon row, the point or the pointer.

## Curves and circles

- **Arc**: drag the bend ring on a wall's middle. The ends stay where they are, so the walls either side stay joined; the middle follows the finger, up to a half circle. The radius reads on the arc; tap it to type one. In the workspace the bend ring is on the wall just drawn; on Draw it, on the wall you picked.
- **Circle**: in the workspace choose Circle, tap the centre, then tap (or drag) out to the radius, or type the radius on the readout. On Draw it choose Circles and drag out from the centre; tap the circle to type its diameter.
- Both are built as short straight walls, one bay each: the bay is a quarter of the radius, held between 8" and 16", with one stud at each break.

## Editing after drawing

- **Corner**: drag it. Every wall joined there goes with it. A wall that was level stays level and one that was plumb stays plumb, so dragging a corner of a rectangle resizes the rectangle.
- **Wall**: drag it to slide it square to itself; the walls on its ends stretch to stay on.
- **Length**: tap a wall's length and type it.

## Using it in another app

```ts
import { snapDrawPoint, endsOf, segsOf, DRAW } from './drawSystem'
const snap = snapDrawPoint(pointer, {
  from, prevDir, runStart,              // the run so far
  ends: endsOf(walls), lines: segsOf(walls),
  tol: DRAW.REACH_PX / pixelsPerUnit,    // reach in plan units
  square: true,
})
// snap.point, snap.kind, snap.guide, snap.alignGuide, snap.cornerDeg, snap.closes
```

`movedCorner`, `slidWall`, `arcWalls`, `bulgeForRadius`, `pointAtCornerAngle` and
`isDoubleTap` cover the rest.
