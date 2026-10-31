/**
 * STOCK SIZES — the sizes these things are actually SOLD in, per axis, in inches.
 *
 * The catalogue gives every item one default size, which is right for dropping a
 * stand-in on a plan and wrong for fitting one to a room: a counter is not one
 * length, a tub is not one length, and a 4" can is not six inches away from
 * being a 10" can. Before this table the only way to size anything was to open
 * the ft/in fields and work out by hand what would fit.
 *
 * Axes are honest, not symmetric. W is the length along the wall, D is the depth
 * front-to-back, H is the height. A door has no useful depths (the wall sets
 * that) and a case has no bought height, so those axes are simply absent and no
 * buttons are offered for them — a control that could not do anything is not a
 * control.
 *
 * Inches, because that is how the trade buys them; the card converts.
 */
export interface StockSizes {
  /** Length along the wall (the catalogue's W). */
  w?: number[]
  /** Depth front-to-back (D). */
  d?: number[]
  /** Height (H), where height is a bought size. */
  h?: number[]
}

const DOOR_HEIGHTS = [80, 84, 96]

export const STOCK_SIZES_IN: Record<string, StockSizes> = {
  // ── Openings ────────────────────────────────────────────────────────────────
  // 3068 is the door that gets hung most; 6' and 8' sliders are in the same list
  // because a patio door places as a `door` with its Type set.
  door: { w: [24, 28, 30, 32, 34, 36, 42, 48, 60, 72, 96], h: DOOR_HEIGHTS },
  window: {
    w: [24, 30, 36, 42, 48, 60, 72, 96],
    h: [24, 36, 48, 60, 72, 80],
  },

  // ── Seating ─────────────────────────────────────────────────────────────────
  sofa: { w: [60, 72, 84, 96, 108], d: [34, 38, 40] },
  armchair: { w: [30, 34, 38], d: [32, 36, 38] },
  chair: { w: [18, 20, 24], d: [18, 20, 22] },

  // ── Beds and bedroom ────────────────────────────────────────────────────────
  // Widths are twin / full / queen / king; depth is the mattress length, 75" or
  // the 80" of a queen and king.
  'bed-double': { w: [39, 54, 60, 76], d: [75, 80] },
  'bed-single': { w: [30, 36, 39], d: [75, 80] },
  nightstand: { w: [18, 20, 24], d: [16, 18] },
  dresser: { w: [24, 36, 48, 60], d: [18, 20] },
  wardrobe: { w: [24, 30, 36, 48, 60, 72], d: [24, 30] },
  bookshelf: { w: [24, 30, 36, 48], d: [12, 16] },

  // ── Tables ──────────────────────────────────────────────────────────────────
  desk: { w: [36, 42, 48, 60, 72], d: [24, 30] },
  'dining-table': { w: [36, 42, 48, 60, 72, 96], d: [30, 36, 42] },
  'coffee-table': { w: [36, 42, 48, 54], d: [18, 24, 30] },

  // ── Kitchen ─────────────────────────────────────────────────────────────────
  // 24" and 25" are the two depths a counter actually is: base cabinet, and
  // base cabinet plus a countertop overhang.
  'kitchen-counter': { w: [24, 36, 48, 60, 72, 96], d: [24, 25] },
  refrigerator: { w: [24, 30, 33, 36, 42], d: [24, 30, 36] },
  stove: { w: [20, 24, 30, 36], d: [24, 25, 29] },
  'range-hood': { w: [24, 30, 36, 48], d: [18, 20, 24] },
  dishwasher: { w: [18, 24], d: [24] },
  'kitchen-sink': { w: [24, 30, 33, 36, 42], d: [22, 24] },

  // ── Bath and laundry ────────────────────────────────────────────────────────
  'bathroom-sink': { w: [24, 30, 36, 48, 60], d: [18, 21, 22] },
  // 5' is the alcove tub; 4'6" is the short one, 6' the soaking tub.
  bathtub: { w: [48, 54, 60, 66, 72], d: [30, 32, 34, 36] },
  shower: { w: [36, 42, 48, 60], d: [36, 42, 48] },
  washer: { w: [24, 27], d: [24, 27, 30] },
  dryer: { w: [24, 27], d: [24, 27, 30] },
  'water-heater': { w: [20, 24], d: [20, 24] },

  // ── Vertical circulation ────────────────────────────────────────────────────
  // Depth is the run — how much floor a flight eats.
  stairs: { w: [36, 39, 42, 48], d: [120, 132, 144, 168] },

  // ── Electrical and mechanical ───────────────────────────────────────────────
  // Cans and boxes are bought by diameter; the sizes below are the trade sizes
  // on the shelf. 4", 5", 6" covers residential, 8" is a commercial can.
  'recessed-light': { w: [4, 5, 6, 8], d: [4, 5, 6, 8] },
  'ceiling-light': { w: [6, 8, 10, 12], d: [6, 8, 10, 12] },
  'exhaust-fan': { w: [8, 10], d: [8, 10] },
  'supply-register': { w: [6, 8, 10, 12, 14], d: [4, 6] },
  'return-grille': { w: [14, 16, 18, 20, 24], d: [6, 8] },
  furnace: { w: [14, 17.5, 21, 24], d: [28, 30, 33] },
}

/** The bought sizes for a type, or null when it has none (a toilet, a stack). */
export function stockSizes(type: string): StockSizes | null {
  const s = STOCK_SIZES_IN[type]
  if (!s) return null
  return s.w?.length || s.d?.length || s.h?.length ? s : null
}
