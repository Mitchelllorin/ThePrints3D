# Interaction standard

**This is a button map.** In the old video-game sense: the moves are the moves,
we are deciding which input triggers which one. No action is added, removed or
changed — only rebound. If a function exists today it exists afterwards; see
"No function is lost" below, which is the checklist that keeps this honest.

**One gesture vocabulary for the whole app.** Not per layer, not per component
type. If a gesture means something in one place, it means the same thing
everywhere — and if a thing can be done, it is done the same way regardless of
what it is being done to.

Keep this file in step with the code. It is the reference for "what does this
gesture do?" and the spec any new component must follow.

---

## The rule

> **Gestures navigate and select. Actions live on the selection card.**

A gesture never *changes* the model. It moves the camera, or it chooses what you
are talking about. Everything that alters the build — X-ray, ghost, explode,
delete, properties — is a control on the card for the selected thing.

That is the whole standard. The tables below are just it, spelled out.

## Gestures

| Gesture | Meaning | Where |
|---|---|---|
| **Tap a component** | **Select it** | every component, no exceptions |
| Tap empty space | deselect, dismiss any open card | workspace |
| Press-drag the **selected** component | move it | workspace |
| Press-drag anything else | orbit the camera | workspace |
| Double-tap during an action | end that action | trace, calibrate, place |
| Swipe in from an edge | open that edge's drawer | chrome |
| Tap outside an open drawer | close it | chrome |

"Every component, no exceptions" means: walls, floor decks, ceilings, roof areas,
placed objects, doors, windows, devices, trade lines (plumbing / electrical /
HVAC), annotations. If a new thing is added to the workspace, it gets the same
gesture for free or it is not finished.

### Why a single tap selects, and the DRAG is what's protected

Double-tap-to-select was tried and reverted 2026-07-28. Two different annoyances
were being conflated:

- a stray tap pops a card open — noise
- a stray press drags geometry across the plan — actual damage

Only the second one matters, and it is fixed by requiring a component to be
SELECTED before a press can move it. That protection is independent of how
selection happens, so it survives either way.

Double-tap therefore bought only "no card on a stray tap", and cost a two-tap
gesture on small targets — a stud or a trade line, with a finger, twice inside
320 ms and 28 px. Bad trade on a phone-first app. Selection is one tap again.

The sequence is: **tap to select, then drag to move.** Pressing an unselected
component selects it and nothing else; pressing the one already selected moves
it. Orbit is unaffected either way — OrbitControls reads the DOM event directly,
so stopping r3f propagation in a layer never freezes the camera.

### Why not `onDoubleClick`

r3f's `onDoubleClick` rides the DOM `dblclick` event, which is unreliable on
touch. Android is ground truth here, so double-tap is detected manually from
pointerdown timing + position — `detectDoubleTap()` in
`src/components/Viewer3D/doubleTap.ts` (320 ms, 28 px). Every layer uses that one
detector. Nothing should call `onDoubleClick` directly.

## The selection card

**One card component, one action row, same order every time.** What is selected
changes the title and the properties; it does not change where the controls are
or what they are called.

```
┌──────────────────────────────┐
│ <what it is>                 │   title
│ [X-ray] [Ghost] [Explode] [🗑]│   action row — SAME ORDER ALWAYS
│ …type-specific properties…   │
└──────────────────────────────┘
```

An action the selected thing does not support is **omitted, never reordered** —
so the controls stay where the hand expects them.

---

## Edit mode

Edit mode is currently four different systems wearing one name. Verified in the
running app, 2026-07-28:

| Component | How a pick is recorded | Highlight | Gizmo |
|---|---|---|---|
| Placed object | `selectedObjectId` (`selectObjectExclusive`) | `Edges` | **yes** |
| Floor deck | `editSelected` (`setEditSelected`) | `AreaHighlight` | no |
| Roof area | `editSelected` | `AreaHighlight` | no |
| Wall | nothing — only `editHover` | cyan hover line | no |

Consequences, each observed rather than inferred:

1. **Two selection channels, neither clearing the other.** Picking an object set
   `selectedObjectId` while `editSelected` still held the roof — two things
   selected at once, both highlighted.
2. **The gizmo is objects-only.** `PlacedObjectsLayer` attaches it to
   `selectedObjectId`, which is not the channel Edit mode uses for floors and
   roofs, so those never get one. Walls never get one either.
3. **Press = immediate drag.** `onBodyDown` starts moving the component on
   pointer-down, so there is no select-then-act; every press risks shifting
   geometry.
4. **Small handles sit on grab-anywhere bodies.** The roof's ridge bar is a thin
   target mounted on a body that drags from any pixel — miss the bar slightly and
   you slide the whole roof instead of pitching it. This is why editing a roof
   "was really difficult".
5. **The selection card is a large centred panel** that covers the model, with
   the gizmo's own Move/Rotate/Stretch toggle behind it.

### The standard, applied to Edit mode

Nothing new — the same rule as everywhere else:

| Gesture | Meaning |
|---|---|
| Tap a component | select it (ONE selection, any type, one channel) |
| Press-drag the **selected** component | move it |
| Press-drag anything else | orbit |
| Grab a handle on the selection | that handle's job (ridge pitch, endpoint, corner) |

- **One selection channel for every component type.** Whatever is picked, one
  thing is selected and everything else is cleared.
- **The gizmo attaches to the selection, whatever it is** — object, floor, roof
  or wall — instead of existing only for objects.
- **Handles only appear on the selected component**, so a thin grip never
  competes with an unselected body underneath it.
- **The card is slim and off-centre**, per the near-invisible-chrome rule. It
  must never cover the thing being edited.

Selection replaces Edit mode's press-to-drag as the safety gate, which is the
same move made in "What this does to Edit mode" below.

## No function is lost

The hard constraint on this standard: **it relocates capability, it never removes
it.** Every function that exists today must still be reachable afterwards. This
table is the checklist — if something here has no new home, the standard is wrong
and must change, not the feature.

| Function (today) | Reached today by | Reached under the standard |
|---|---|---|
| Select object | single tap | single tap (unchanged) |
| Select floor deck | single tap | single tap (unchanged) |
| Select wall | single tap, only when `canEditWalls` | single tap, any time |
| Select trade line | single tap | single tap (unchanged) |
| Select roof area | single tap | single tap (unchanged) |
| Toggle X-ray (object) | double-tap object | card → X-ray |
| Toggle X-ray (wall) | card | card → X-ray (same button) |
| Ghost a storey | double-tap wall or floor | card → Ghost |
| Detail explode | card | card → Explode |
| Move object | press-drag | select, then press-drag |
| Move floor deck | Edit mode + press-drag | select, then press-drag |
| Move wall / wall end | Edit mode + press-drag | select, then press-drag |
| Rotate object | rotate knob when selected | unchanged — knob on selection |
| Precision translate/rotate/scale | Edit mode gizmo | gizmo on selection |
| Hover highlight | Edit mode hover | hover when idle |
| Delete | card | card → Delete |
| End a trace run | double-tap | unchanged |
| Orbit camera | press-drag anywhere | press-drag anywhere unselected |

### What this does to Edit mode

Edit mode exists today to gate drag-to-move so a stray press cannot skate a floor
across the plan. Under the standard, **selection is that gate**: press-drag on an
unselected component orbits the camera; press-drag on the **selected** component
moves it. Same protection, one less mode to remember — and drag-to-move becomes
available on everything rather than only the types Edit mode covers.

Edit mode may still be worth keeping as a *bulk* affordance (hover-highlight
everything at once). That is a separate decision; the standard does not require
removing it, only that nothing depends on it exclusively.

## Rollout status

The rebind is done in two passes so that no function is ever unreachable, not
even mid-way.

**Pass 1 — give the displaced actions a home (ADDITIVE, landed).** Nothing about
how you work changes yet; every gesture still does what it did.

Actions are placed by **scope**, which is the rule that decides which surface
anything belongs on:

| Scope | Surface | Actions |
|---|---|---|
| one component | selection card | X-ray, explode, delete, properties |
| one floor | floor bar | fade, isolate |

Fading a floor was a double-tap on a wall or a floor deck — a floor-scoped action
bound to a component, which is both wrong and undiscoverable. It now lives in the
floor bar beside isolate, as the same control: tapping a floor cycles
**normal → faded → isolated → normal**. No new buttons, no new surface.

X-ray already had card buttons on walls and objects, so it needed nothing.

After pass 1 every displaced function is reachable **two** ways — old gesture and
new control — which is what makes pass 2 safe.

**Pass 2 — rebind the gestures (NOT started).** Double-tap becomes select
everywhere; single tap on a component goes inert; drag-to-move gates on selection
instead of Edit mode. Only safe once pass 1 is confirmed working in the app.

## Migration from the old behaviour

Before this standard the map was inconsistent in exactly the ways it warns
against:

| Component | was: single tap | was: double tap |
|---|---|---|
| Placed object | select | toggle X-ray |
| Floor deck | select area | toggle ghost storey |
| Wall | select (only when `canEditWalls`) | toggle ghost storey |
| Trade line | select | — |
| Roof area | select | — |

Double-tap meant two different things depending on what you hit, and nothing at
all on roofs and trade lines. Walls were selectable only in some modes while
floors were selectable in others. X-ray and ghost were gestures on some things
and unavailable on others.

Under the standard: all of those become double-tap-to-select, and X-ray and ghost
become card buttons available on everything that supports them.

## Code touchpoints

- `src/components/Viewer3D/doubleTap.ts` — the shared detector
- `src/components/Viewer3D/PlacedObjectsLayer.tsx` — objects, doors, windows, devices
- `src/components/Viewer3D/FloorJoistsLayer.tsx` — floor decks / joists
- `src/components/Viewer3D/LiveWallsLayer.tsx` — walls
- `src/components/Viewer3D/RoofLayer.tsx` — roof areas
- `src/components/Viewer3D/FloorplanOverlay.tsx` — trade lines, wall pick targets
- `src/components/Viewer3D/FloorplanPanel.tsx` — the selection card
- `src/store/useFloorplanLocalStore.ts` — `select*Exclusive` actions (one selection at a time)
