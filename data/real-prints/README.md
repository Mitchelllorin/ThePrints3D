# Real prints — drop zone

Put real drawings here: PDFs, screenshots, photos. Framing plans especially.

**These files are never committed.** They may be client work or purchased sets;
`data/real-prints/` is gitignored except for this README. `data/test-prints/`
is the other thing — those are PUBLIC permit sets kept as the scoring corpus,
and they are never trained on ([[real-print-test-corpus]]).

What they are for: labelling with Claude vision, then training the on-device
model on drawings that look like what users actually upload. The model shipped
today has only ever seen synthetic plans — no furniture, one wall style — which
is why it traces a sofa as a wall on a real screenshot.

Useful to note alongside each file (a line in `notes.md` is plenty):
- what it is (framing plan, floor plan, elevation, site plan)
- the trade/era/region if it matters, and anything unusual about how it's drawn
- anything the app currently gets wrong on it
