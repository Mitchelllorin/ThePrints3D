/**
 * The ROUGH OPENING a door or window needs — which is not the door or window.
 *
 * A door is sold by its size: a "3068" is a 3′-0″ × 6′-8″ leaf. The hole you
 * frame for it is bigger, because the jamb, the shims and the clearance all
 * live between the leaf and the studs. Frame the hole to the door's own size
 * and the prehung does not go in.
 *
 * That is exactly what this app did. The framer is handed an opening width and
 * frames it as the clear span between the jacks — correct — but what it was
 * handed was the DOOR's width, straight off the object. Every door and window
 * placed in the app was framed about two inches tight, and the door TYPE in the
 * property card was never read at all, so a pocket door got the same hole as a
 * swing door: one door's worth, where the pocket needs two.
 *
 * These are the allowances the trade works to. They are rules of thumb, not a
 * manufacturer's sheet — a specific unit's install sheet wins, which is why the
 * size stays editable and the rough opening is shown next to it.
 *
 *   Hinged single / double   +2″ wide, +2½″ tall      36″ door → 38″ × 82½″
 *   Bifold, Sliding          +2″ wide, +2½″ tall      jambs + clearance, same rule
 *   Pocket                   2 × door + 1″, +4½″ tall the pocket frame kit
 *   Garage                   the door's own size      the opening IS the door size
 *   Window                   +½″ each way             nominal unit + ½″
 */

const IN = 0.0254

export type RoughOpeningRule = 'swing' | 'pocket' | 'garage' | 'window'

/** Which rule a placed door or window is framed by. Unknown door types frame as a swing door. */
export function roughOpeningRule(type: string, subtype?: string): RoughOpeningRule {
  if (type === 'window') return 'window'
  const s = (subtype ?? '').toLowerCase()
  if (s.includes('pocket')) return 'pocket'
  if (s.includes('garage')) return 'garage'
  return 'swing'
}

/**
 * The hole to frame for a unit of this size, in metres.
 * `widthM` / `heightM` are the UNIT — the door leaf (both leaves for a pair) or
 * the window's nominal size — which is what the property card's size means.
 */
export function roughOpening(
  type: string,
  subtype: string | undefined,
  widthM: number,
  heightM: number,
): { widthM: number; heightM: number; rule: RoughOpeningRule } {
  const rule = roughOpeningRule(type, subtype)
  switch (rule) {
    case 'pocket':
      return { rule, widthM: 2 * widthM + 1 * IN, heightM: heightM + 4.5 * IN }
    case 'garage':
      return { rule, widthM, heightM }
    case 'window':
      return { rule, widthM: widthM + 0.5 * IN, heightM: heightM + 0.5 * IN }
    case 'swing':
    default:
      return { rule, widthM: widthM + 2 * IN, heightM: heightM + 2.5 * IN }
  }
}

/**
 * THE TUB ALCOVE — a tub's rough opening.
 *
 * Read off a real panel layout (Giusti Wall Tech, Castle by Telus L3), where
 * every alcove is called out the same way: "Tub 5' 0-7/8" (4' 11-7/8" + 3/8"
 * + 5/8")". The alcove between the end walls is the tub plus an inch — 3/8"
 * clearance and 5/8" for the board — and at each end, where the end wall meets
 * the back wall, the layout shows a pack: two L's, so the flange has something
 * to fasten to.
 */
export const TUB_ALCOVE_ALLOWANCE_M = 1 * IN

/** The framed length between a tub's end walls, from the tub's own length. */
export function tubAlcoveM(tubLengthM: number): number {
  return tubLengthM + TUB_ALCOVE_ALLOWANCE_M
}
