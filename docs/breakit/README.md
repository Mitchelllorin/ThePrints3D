# Break It — 360×640 acceptance shots

The Ramp's failure moment is checked in pixels, not just in assertions. The four
states BREAK-IT §4 asks for are captured by `scripts/breakit-shots.mjs` against
the app's dev server at a phone size:

| Shot | What it has to show |
| --- | --- |
| `01-ramp-strip.png` | The Ramp as a slim glass strip (≤ ⅓ of the screen), canvas above it |
| `02-preset.png` | A generic preset chip chosen — no maker's name in the label |
| `03-sweep-mid.png` | The camera moving onto the part, everything else fading |
| `04-card.png` | The part alone, the failure card up, the strip gone |

## Running it

A dev server must already be running — this script never starts one.

```bash
node scripts/breakit-shots.mjs
# or point it elsewhere
APP_URL=http://127.0.0.1:5173/ node scripts/breakit-shots.mjs
```

The script exits non-zero if the card is missing, the strip is still up at the
break, the card takes more than a third of the screen, or the canvas is left
less than two thirds.

## The camera maths

The part's projected box — centred in the visible band, about a third of the
frame's width — is asserted in `src/services/arena/bench.test.ts`
(`projectBenchBox`, `benchViewOffsetPx`) at portrait, landscape and square
aspects, with and without chrome. That is the part of the acceptance a DOM
screenshot cannot measure.
