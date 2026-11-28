# The drawing system

One way to draw walls on a plan, and one tool that does it: the main workspace's.
Draw it opens that same tool, on a blank squared sheet when no plan is open (40 x 30 ft,
or 12 x 9 m) and on the plan when one is. There is no second editor. It is meant for any
family app that draws on a plan. The rules are in
`src/services/drawSystem.ts` (no React, no units, tested in `drawSystem.test.ts`).
Each app only converts between screen pixels and its own plan units, and draws
what a snap reports.

## Gestures

There is no long-press. The loupe asks you to hold still and aim, and a long-press that ended the run fought it.

| Do this | What happens |
| --- | --- |
| Tap | A press that moves less than 22 px (touch) or 9 px (mouse) is a tap. Places a point. The first tap starts a run; each tap after it puts a wall down and its end is the next start. |
| Drag | Draws one wall from where the finger lands to where it lifts. A drag from the last point carries the run on. |
| Tap the last point again | Ends the run. No wall is added. |
| Double tap (within 350 ms and 28 px) | Ends the run. |
| Tap the first point | Closes the shape. The close ring on the first point turns green when the next tap will close. |
| Undo / Done | Outlined text buttons beside the current point, placed clear of the point, the pointer and the direction you are drawing. Undo takes back the last wall and steps the run back to its start. |
| Two fingers | Camera (pan, zoom). A second finger never leaves half a wall behind. |

A press on the current point never picks it back up: a drag from it draws the next wall. Undo takes a wall back.

A touchscreen laptop has a finger and a touchpad. After a finger, mouse hover is ignored until the mouse has travelled 40 px, so a parked cursor or a palm on the touchpad cannot pull the wall off to wherever the cursor was left. A mouse press always counts.

Touch: while a finger is down, a loupe (112 px, 2.5x) shows the exact point 96 px
above the finger, with a crosshair that turns green when the point has caught
something. A mouse uses its normal crosshair and gets no loupe.

## Snaps, in order

1. **Close**: within 1.6x the reach of the run's first point, the point is the first point.
2. **End**: within the reach of another wall's end, the point is that end (never the end being drawn from).
3. **Held angle** (with a start): the wall is held to the plan axes (0, 90, 180, 270), or to straight on / square either way off the wall before, within 9 degrees; to the 45s within 5 degrees. Past that the wall keeps the angle drawn, to the whole degree. "Any angle" leaves only a 3 degree pull to square and the 45s.
4. **Run on**: a held wall that nearly reaches another wall you drew (not a line on the print) runs on along its own line to meet it, instead of kinking to get there.
5. **Line up**: a held wall stops level with the run's first point, so the last wall of a room comes out square to the first. Only that point: lining up with every corner on the plan made the end jump about.
6. **First point**: with no start, a point near a wall lands on the wall; otherwise on the grid when the app has one.

The reach is 18 screen pixels for a finger and 9 for a mouse (a mouse is exact, and 18 felt sticky), converted to plan units where the pointer is, so it
means the same at any zoom.

## What you see

- **Guide**: a dashed amber line along the held angle, past the point. A dotted line to the corner it lined up with.
- **Marker** on the point: a ring on an end, a cross on a wall, a diamond on a line-up.
- **Length**: plain text on the wall being drawn, kept clear of the end being dragged (and of the loupe). Tap it to type an exact length (12, 12 6, 12'6", 3.6 m).
- **Corner angle**: plain text inside the corner (90 is square, 180 is straight on). Tap it to type an exact angle; the wall leaves the corner at that angle on the side it was drawn.
- Readouts and controls are text with a dark outline (`--ink-on-model`), never on a plate, and never on the rail, the top icon row, the point or the pointer.

## Curves and circles

- **Arc**: drag the bend ring on a wall's middle. The ends stay where they are, so the walls either side stay joined; the middle follows the finger, up to a half circle. The radius reads on the arc; tap it to type one. The bend ring is on the wall just drawn.
- **Circle**: choose Circle, tap the centre, then tap (or drag) out to the radius, or type the radius on the readout.
- Both are built as short straight walls, one bay each: the bay is a quarter of the radius, held between 8" and 16", with one stud at each break.

## Editing after drawing

- **Corner**: drag it. Every wall joined there goes with it. A wall that was level stays level and one that was plumb stays plumb, so dragging a corner of a rectangle resizes the rectangle.
- **Wall**: drag it to slide it square to itself; the walls on its ends stretch to stay on.
- **Length**: tap a wall's length and type it.

### ✎ Edit

On the drawing bar once there is a wall. While it is on, a tap picks a wall you drew instead of starting one (tap ✏ Draw to go back).

- **Swing it onto an angle**: drag either end dot. The other end stays put; the walls joined at that corner follow, nothing held square. Length and angle read at the finger.
- **Angle part of it**: press anywhere else along the wall (or its +) and drag. The wall is cut there and the new corner comes out with the finger.
- **Type the angle**: tap ∠ on the chip. It is the corner angle against the wall joined at the held end (90 is square), or the angle off level for a wall on its own. The wall keeps its length.
- **Delete** on the chip.

### ▭ Rooms

On the drawing bar next to ✎ Edit. While it is on, a tap picks the room around it: the space the walls on this floor close round that point (services/roomRegions.ts flood-fills it; an unclosed room or a tap outside picks nothing).

- **Ceiling height**: tap Ceiling on the chip and type it. The walls stay at the building height (↕): the storey has to stack and the joists above sit on them. A lower room gets a dropped ceiling board at its height (RoomCeilingLayer). It cannot go above the walls or under 1.8 m.
- **Bulkhead**: + Bulkhead, then tap the walls it runs along. It hangs on the room's side, only along the stretch of that wall in this room, at the Settings drop and depth, framed with 2x2 ladders and boarded. Tap a wall again to take it off.
- **Reset** puts the room back to the building height with no bulkheads.

A room is stored as a point inside it, not as its outline, so moving its walls moves its ceiling with them.

### Hung ceilings

services/suspendedCeiling.ts lays a drywall suspension in any shape of room: 12ga hanger wire at 4' x 4' up to the structure above, 1-1/2" carrying channel at 4' o.c. running the long way, 7/8" hat track at 16" o.c. across it (a clip at every crossing), wall angle on every wall face, then the board. It is used for every dropped room, and on a steel job (Settings framing material steel, or most drawn walls steel studs) for every closed room on every floor (`allRooms`), in place of the wood ceiling joists. A full-height hung ceiling comes down by the depth of the channel. Counts are on each room's group (`userData.ceilingTakeoff`); they are not in the takeoff panel yet.

### ▱ Balcony

Tap an outside wall where it starts and where it ends; it comes out 6' on the outside (read from the floor's outline, so it does not matter which way the wall was drawn). Tap it for its chip: depth, concrete (slab on a thermal break, stepped down 2") or wood (2x10 at 16" cantilevered, rim, ledger, decking), a 42" glass or picket guard on its three open sides, and every floor above (built on each storey up to the top one). services/balconies.ts, BalconyLayer.tsx. No door is put in the wall for it.

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
