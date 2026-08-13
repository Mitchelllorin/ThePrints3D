/**
 * How every label in the 3D workspace is drawn — one place, so they match.
 *
 * The labels sit over the model, and the model is not a quiet background: pale
 * plywood decking, bright stud faces, the print itself. Thin unweighted glyphs
 * against that are genuinely hard to read on a phone in daylight, which is where
 * this app gets used.
 *
 * Two levers, and they do different jobs:
 *
 *   OUTLINE (`outlineWidth`) is a dark halo AROUND the glyph. It separates the
 *   text from whatever is behind it. This is what makes a label survive being
 *   dragged over a light surface.
 *
 *   STROKE (`strokeWidth`) thickens the glyph ITSELF, in the text's own colour.
 *   That is a faux-bold — it reads as heavier weight without shipping a bold
 *   font file, and troika renders it identically everywhere.
 *
 * Both are expressed as a fraction of font size rather than absolute metres, so
 * they hold up under the Settings label-scale slider instead of turning into a
 * blob at small sizes and a hairline at large ones.
 */

/** Halo thickness, as a fraction of font size.
 *  Raised from 0.11: white text on pale plywood, bright stud faces or the print
 *  itself was the real legibility problem, and the colour cannot go any
 *  brighter than white — so the separation has to come from the halo. */
export const LABEL_OUTLINE_RATIO = 0.20
/** Faux-bold thickness, as a fraction of font size. Heavier for the same
 *  reason — weight reads as brightness at a glance on a phone in daylight. */
export const LABEL_STROKE_RATIO = 0.115
/** The halo colour — the workspace's darkest tone, so it reads as a shadow. */
export const LABEL_OUTLINE_COLOR = '#0b1120'

/**
 * Spread onto a drei `<Text>` to get the standard treatment.
 *
 * `fontSize` is passed in rather than fixed because each layer sizes its own
 * labels (a wall's length reads bigger than a sheet count), and the outline and
 * stroke have to follow that size to stay proportional.
 */
export function labelText(fontSize: number, color: string) {
  return {
    fontSize,
    color,
    /* A LITTLE EXTRA WEIGHT IN THE FONT ITSELF, on top of the faux-bold stroke.
       These labels are read at arm's length, outdoors, over a model that is
       mostly pale timber and bright sheet goods — the failure is never that the
       text is too small in isolation, it is that it disappears into what is
       behind it. Weight is the cheapest legibility there is. */
    fontWeight: 'bold' as const,
    letterSpacing: 0.01,
    anchorX: 'center' as const,
    anchorY: 'middle' as const,
    outlineWidth: fontSize * LABEL_OUTLINE_RATIO,
    outlineColor: LABEL_OUTLINE_COLOR,
    // Same colour as the fill: this thickens the letterform, it does not draw a
    // second outline around it.
    strokeWidth: fontSize * LABEL_STROKE_RATIO,
    strokeColor: color,
  }
}
