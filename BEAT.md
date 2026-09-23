# The beat — ThePrints3D

The patrol. Same route, same order, every build, **including the parts nobody
touched**. Regressions do not live where you were working; they live where you
weren't looking.

**How it is walked** (from `C:\Dev\CLAUDE.md`):

- **Cold start, real device, 360×640.** Not a resumed session, not an emulator,
  not a desktop window dragged narrow.
- **Every screen, every tab, every panel opened, every toggle flipped.** Not the
  diff.
- **Write it down, don't fix it.** Anything odd gets logged in *Notes from this
  walk* at the bottom and fixed after. Stopping to fix breaks the route, and the
  rest of the beat goes unwalked.
- **The route grows when a screen ships.** A new screen that isn't on the beat is
  a screen nobody will look at again.
- **Report the walk, not a verdict.** "Walked 31 of 31, three notes" beats
  "looks good."

---

## 1 · Cold start

1. Force-stop, then launch. Splash shows the exploded mark over the print, on
   the navy — no white flash.
2. Start page: the three ranked doors are **Draw it**, **Open a plan**, **Scan**,
   then **Show me a finished one**, then **Other ways to start**.
3. Open **Other ways to start** — the tour chip and the three sample plans.
4. Back button here. Where does it go, and can you get out?

## 2 · Draw it — the main road

5. **Draw it** → type a width and a depth. Check both units parse: `24`,
   `24 6`, `24'6"`, `7.3 m`.
6. Shell wall type and floor choice (slab / joists / later).
7. The blank gridded sheet lands. Grid visible, scale known.
8. **Stand them up** — the four outside walls frame themselves.
9. **Draw the inside walls** — the chip drops you into plan view, drawing walls.
   - The stretchy dimension arrow follows the finger, ft-in live in the chip on
     the line.
   - Tap the chip, type an exact length, commit. The wall goes down at that
     length, the run carries on from its end.
   - Tap the chip and cancel — no stray wall underneath.
10. **Add doors & windows** — place a door, a window, and a garage-width door.
11. **See the cut list** — every stick, per wall. Scroll it. Export it.

## 3 · The print underneath

12. With the model standing, the sheet sits below it carrying the live plan:
    wall outlines at real thickness, opening breaks, door swing arcs, window
    bars.
13. Hang another door — it appears on the sheet.
14. Change a door's **Hand** (LH/RH) and **Opens** (In/Out) — the arc on the
    sheet redraws to match, both ways, all four combinations.
15. Run the **explode** slider to both ends. The model comes apart; **the print
    does not move**.
16. Hide the print in the layer list — the plan marks go with it. Show it again.
17. Switch storeys. The sheet shows the storey you are on, not both stacked.

## 4 · The wall sheet

18. Tap a wall (outside edit mode) — the wall sheet opens, and it is the only
    thing in the drawer.
19. Every control on it: Member, Role, Stud packs (add, move, change count,
    remove), Spans, Board, Interior, Exterior, Trim, X-ray, nudge D-pad at all
    three steps, Explode framing, Delete, Deselect.
20. Enter edit mode, select a wall, use the rail's specs mark — **the same one
    sheet** opens, not a second one.
21. Deselect. The build sequence is back in the drawer.

## 5 · Trace a plan

22. **Open a plan** — a real print. The scale step is mandatory and says so.
23. Calibrate: two taps and a number. Check the number you type is the number
    you get.
24. Trace walls — Line and Freehand both.
25. Detected walls appear as faded suggestions only. Tap one to accept it.
26. **Scan** — the camera path, on the real device.

## 6 · The rest of the model

27. Floor: pull a deck. Roof: pull a roof, move the ridge.
28. Trade layers: plumbing, electrical, HVAC. Trace a run in each.
29. Nameplates: cycle the global tier 0→1→2→3. Tap a part — it promotes to full
    and drops back when deselected. Crowd three plates together and watch them
    rank, drop and draw leader lines.
30. Plan view toggle. Top-plates-off toggle. Colour-by-member toggle.

## 7 · Chrome

31. Settings drawer, every toggle. Layers panel. Ask. Toolbox and the
    calculators. Projects list. About → **More from the 3D family** (all eight,
    this app listed but not linked). Legal pages.

---

## Then: driving for bugs

Not part of the route — a separate pass, same build. Hammer one control. Two at
once. Rotate mid-action. Background and return with a panel open. Slam explode
to both ends while orbiting. Select/deselect/select with a panel open. Empty,
exactly one, and maximum data. Interrupt it. Kill it dirty and relaunch. Back
button everywhere including the root. Throttle it and load the biggest model.

Anything found goes in the bug list **with the exact steps that produced it**. A
bug without repro steps is a rumour.

---

## Notes from this walk

_Date, device, build. One line per observation. Cleared after the notes are
turned into fixes._

- 2026-09-19 — route written, **not yet walked**. First walk will correct it:
  steps 27–31 are written from the code rather than from a device, so expect the
  order and the names to need adjusting.

### 2026-09-20 — route audited against the code. NOT a walk.

Every label on the route was checked against the source before the first real
walk, so a wrong name in the route cannot derail it. This is not the beat: the
beat is a cold start on the real phone at 360×640, and none of the below was
seen on a device. Six notes, logged not fixed, per the rule.

1. **Step 31 — "More from the 3D family" does not exist.** What exists is
   `StudioCredit` ("From the makers of"), mounted on the launch screen and in
   the workspace. Against the family rule it is wrong five ways: wrong heading;
   lists 2 of the 8 siblings, not all 8; spells it **Automotive3D** where the
   wordmark grammar requires **AutoMotive3D** (Auto | Motive | 3D — the capital
   is where the mark breaks); links to Play listings where the rule says link to
   the app's own site, never the store; and omits ThePrints3D itself, which the
   rule wants listed-but-unlinked so the set reads as complete.

2. **Step 29 describes a nameplate that was never built.** The route says cycle
   a global tier 0→1→2→3, tap to promote, watch three crowd and draw leader
   lines. The build has `NameplateStrip` — ONE fixed plate in a HUD corner for
   the selected member — plus a `dimensionsMode` of `always | selected | off`.
   No tiers, no anchored plates, no collision ranking.

   Worth saying plainly: the strip is not an oversight, it is an argued
   decision, and its own header makes the case — floating labels put a storey of
   text in front of the model, which is rule zero. But `C:\Dev\CLAUDE.md` still
   specifies the tiered floating plate. One of the two has to move, and that is
   Mitchell's call, not a thing to quietly fix on a walk. **Step 29 cannot be
   walked until it is.**

3. **"Wet walls" is on screen.** `FinishesPanel.tsx:162` renders a row labelled
   `Wet walls`, and `presetDrawings.ts:188` writes "share a wet wall with the
   utility room". The term is **plumbing wall**, never wet wall. The store key
   `wetWallMethod` and `services/wetWalls.ts` are internal and can follow later;
   the two strings are what a user reads.

4. **The property card breaks rule 1, and the fallback that would save it is
   absent.** `AmbientGuide.module.css` `.propCard` sits at `rgba(..., 0.55)` —
   under the 0.72 floor — and the file contains **zero** `@supports not
   (backdrop-filter: …)` blocks. On an Android webview without backdrop-filter
   that is a 55%-opacity wash with no blur behind it, over a model that changes
   colour as it turns. That is exactly the unreadable-screen bug the rule
   exists to stop, and it will show on a real phone and not on this laptop.

5. **Text and targets in the same card are under the minimums.** Font sizes of
   10, 11 and 12px throughout (floor is 13px on a phone), and a control at
   `min-height: 24px` (floor is 48×48, 8px apart). Check it with a thumb at
   step 19, not with a cursor.

6. **Three `EdgeDrawer`s exist** — one in `WorkspaceLayout`, two in
   `FloorplanPanel`. `wallSheetOpen` does hide the build sequence while the wall
   sheet is up, which is what steps 18–21 expect, so the one-sheet rule looks
   built. Whether two drawers can be open at once is a device question. Push on
   it at step 21.

**Not checked, and only a device can:** anything about how it actually behaves —
cold start, the splash, gesture handling, orientation, whether the model refits
when a sheet opens, and every one of the bug-drive items.

### 2026-09-22 — notes 1 and 3 fixed in code. Not seen on a device.

- **Note 1:** the Settings drawer now ends in "More from the 3D family" — all
  eight, in family order, the CircuiTry3D one-liners, links to sites not
  stores, ThePrints3D listed unlinked. The launch screen keeps only the
  theprints3d.com link. Check it at step 31.
- **Note 3:** "Wet walls" reads "Plumbing walls"; the preset line says
  "plumbing wall".
