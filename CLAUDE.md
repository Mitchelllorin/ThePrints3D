# Working on this app

The full build rules for every app in the 3D Learning Family live on Mitchell's laptop at
`C:\Dev\CLAUDE.md`. Read them when you can reach them. This is the one he is most tired of
repeating, kept here so every agent sees it wherever it runs.

## No panel by default (Mitchell, 18 Nov 2026)

The default is NO panel. Agents keep reaching for a solid, coloured box around every
readout and every menu, and every time it ends up sitting in the way of the model. Don't
start there.

- **Readouts are plain text over the model.** A measurement, a length, an angle, a live
  number, a step instruction: just the text, with a strong dark text shadow or outline so
  it reads over any part of the scene. No plate, no card, no chip behind it.
- **Controls are as light as they can be.** A text button or an outlined icon with a 48px
  touch area. No filled blocks.
- **A container is the exception, not the starting point.** Only where it genuinely holds
  a group of related controls or running text the user opened, and then translucent glass
  (tint plus blur), never a solid slab. If you are not sure it needs a box, it doesn't.
- **Nothing sits on the point the user is working on.** Readouts keep clear of the cursor
  or finger and of the thing being dragged or placed.
- **Nothing overlaps.** Two pieces of text or two controls on top of each other is a
  layout bug: give each its own clear region.

## Also

- Plain, professional wording for failures: name the part and the condition ("failed",
  "overheated", "reaches its limit"). No "break it", "crack it", "burn it" style slogans.
- Test at 360x640 first. Touch targets 48px.
- Never push to main without Mitchell's explicit go.
