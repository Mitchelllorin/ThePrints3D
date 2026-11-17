/**
 * THE FLAT-TOP NUMERALS, AS GEOMETRY.
 *
 * The digits in the family are drawn, not typed. The 3 is a flat top bar with a
 * diagonal falling off its right end, the way a 7's slash falls — not the round
 * upper bowl a typeface gives you. So no stock font numeral goes into a
 * wordmark, an icon or a nameplate heading, and this is where they come from
 * instead.
 *
 * Ported from `C:\Dev\_tools\brand-render\flat3.py`, which is the authored
 * geometry — `flat_top_three`, `five`, `seven_french`. Every number below is
 * flat3.py's number, unchanged: the cap, the stroke weight, the glyph width, the
 * bowl's radii and each quadrant angle. A render from here and a render from the
 * Python land on the same shape. Do not nudge a point to make one glyph look
 * better in one place — change flat3.py and port it again, or the two drift and
 * nobody notices until an icon and a wordmark disagree.
 *
 * UNITS. The authored frame is a 1000-unit em with a 700-unit cap, which is what
 * the wordmark's typeface (Helvetiker bold) is drawn on. A digit built here at
 * `size / 1000` therefore sits in a line of `Text3D` at the same cap height and
 * occupies the same 828-unit advance slot as the typed numeral it replaces,
 * with no hand-tuning to line the two up.
 *
 * Each glyph is a set of overlapping closed prisms, exactly as flat3.py builds
 * it (top bar, stem, bowl, arm), not one unioned outline. Overlap is how the
 * authored file does it; they are the same colour and material, so the seam
 * never shows.
 */

import * as THREE from 'three'

export type FlatTopDigit = '3' | '5' | '7'

/** Helvetiker bold's advance for a digit, in font units — the slot each glyph fills. */
export const DIGIT_ADVANCE = 828

/** Authored frame: 1000-unit em, 700-unit cap, 135-unit stroke. */
const EM = 1000
const CAP = 700
const T = 135
/** Glyph width. All three share it, so they set together. */
const W = 560
/** Bowl: outer radius, inner radius, and the centre it turns about. */
const RO = 250
const RI = RO - T
const CX = W - RO
const CY = RO

type Pt = readonly [number, number]

const rect = (x0: number, y0: number, x1: number, y1: number): Pt[] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
]

/** A closed ring band: out along the outer arc, back along the inner one. */
function arcBand(
  cx: number,
  cy: number,
  ro: number,
  ri: number,
  a0: number,
  a1: number,
  steps = 40,
): Pt[] {
  const out: Pt[] = []
  const back: Pt[] = []
  for (let i = 0; i <= steps; i++) {
    const t = ((a0 + (a1 - a0) * (i / steps)) * Math.PI) / 180
    out.push([cx + ro * Math.cos(t), cy + ro * Math.sin(t)])
    back.push([cx + ri * Math.cos(t), cy + ri * Math.sin(t)])
  }
  return [...out, ...back.reverse()]
}

/** The prisms each glyph is made of, in the authored 1000-unit frame. */
function contours(digit: FlatTopDigit): Pt[][] {
  switch (digit) {
    case '3': {
      // Flat top bar, then a diagonal leaning left as it descends, then the
      // lower bowl and the arm that carries the eye into it.
      const lean = 95
      const topR = W
      const topL = W - T
      const yTop = CAP - T + 2
      const yBot = CY + RO - 20
      return [
        rect(0, CAP - T, W, CAP),
        [
          [topL, yTop],
          [topR, yTop],
          [topR - lean, yBot],
          [topL - lean, yBot],
        ],
        arcBand(CX, CY, RO, RI, -178, 78),
        rect(W * 0.16, CY + RO - T, CX + 14, CY + RO),
      ]
    }
    case '5': {
      // Same flat top bar and the same stroke weight, a left stem, and the bowl
      // on the lower right — the 3 reshaped, not a different hand.
      return [
        rect(0, CAP - T, W, CAP),
        rect(0, CY + RO - T, T, CAP - T + 2),
        arcBand(CX, CY, RO, RI, -186, 92),
        rect(0, CY + RO - T, CX + 10, CY + RO),
      ]
    }
    case '7': {
      // Flat top bar, long diagonal, and the crossbar — the French 7, always.
      const lean = 200
      const topR = W
      const topL = W - T * 1.05
      const y = CAP * 0.33
      return [
        rect(0, CAP - T, W, CAP),
        [
          [topL, CAP - T + 2],
          [topR, CAP - T + 2],
          [topR - lean, 0],
          [topL - lean, 0],
        ],
        rect(W * 0.06, y, W * 0.74, y + T * 0.72),
      ]
    }
  }
}

export interface FlatTopOptions {
  /** `Text3D` size — the font size the digit has to sit beside, in world units. */
  size: number
  /** Extrusion depth, the same as `Text3D`'s height. */
  depth: number
  /** Leave the bevel off to measure the glyph exactly; the wordmark keeps it on. */
  bevel?: boolean
}

/**
 * The glyph as extruded prisms, baseline at y=0, starting at x=0, extruded from
 * z=0 to z=`depth` — the same origin and depth convention `Text3D` uses, so the
 * two can be laid out in one line without offsets.
 */
export function flatTopDigitGeometries(
  digit: FlatTopDigit,
  { size, depth, bevel = true }: FlatTopOptions,
): THREE.BufferGeometry[] {
  const s = size / EM
  const bevelOptions = bevel
    ? {
        bevelEnabled: true,
        bevelSize: 0.018,
        bevelThickness: 0.035,
        bevelSegments: 3,
      }
    : { bevelEnabled: false }

  return contours(digit).map((points) => {
    const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x * s, y * s)))
    return new THREE.ExtrudeGeometry(shape, { depth, ...bevelOptions })
  })
}
