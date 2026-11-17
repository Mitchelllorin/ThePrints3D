# pitch/

What goes out to a manufacturer, and how to regenerate it.

| File | What it is |
| --- | --- |
| `<part-id>.html` | the one-pager, generated from the engine |
| `pdf/<part-id>.pdf` | the same page, printed — **this is what gets attached** |
| `<part-id>-email.md` | the email, with the send notes at the bottom |
| `clips/` | footage of the model — **linked, never attached** |

## Regenerate

```bash
npx vite-node scripts/pitch-sheet.ts     # data/manufacturerParts.ts + F.U.S.E. -> HTML
node scripts/pitch-pdf.mjs               # HTML -> PDF
node scripts/cinema.mjs --only reply --fps 24 --out media/cinema   # clip
```

Nothing in the sheet is typed by hand. Rated values come out of
`src/data/manufacturerParts.ts`, where each field carries the document it came
from; the year column comes out of `src/services/fuse`. Change the data, rerun,
and the sheet and the app still agree.

## The two columns, and why they are kept apart

**Rated** is the manufacturer's, cited, and rounded to nothing. **The year** is
the model's. A maker almost never publishes a service life, so F.U.S.E. scores
the part with the app's own figure for its material and `basis` on the part says
so in words. A pitch that blurs the two is one an engineer takes apart in front
of you.

## Adding the next manufacturer

1. A member row in `src/data/members.ts` at the maker's real size.
2. A part in `src/data/manufacturerParts.ts` — designation, rated fields, source,
   basis, pitch line.
3. `npx vite-node scripts/pitch-sheet.ts && node scripts/pitch-pdf.mjs`
4. Write the email next to it from the sheet's own numbers.
