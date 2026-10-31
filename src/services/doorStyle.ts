/**
 * WHAT KIND OF DOOR IT IS — one answer, read by everything that draws a door.
 *
 * The card has always had a Type (Pocket, Sliding, Bifold, Garage …) and the
 * rough opening already read it, but the 3D door and the plan symbol never did:
 * they went by width alone. So a 6-ft patio slider was drawn as a pair of
 * swinging doors with two arcs on the print, and a pocket door swung into the
 * room it was bought to stay out of.
 *
 * The Type set on the door wins. A door with no Type still goes by width, the
 * way it always has, so existing plans look exactly as they did:
 *   ≥ 7 ft  → garage (no hinged residential door is that wide)
 *   > 36 in → a hinged pair
 *   else    → a single hinged leaf
 */
import { getCatalogItem } from '../data/objectCatalog'

export type DoorStyle = 'single' | 'double' | 'pocket' | 'patio' | 'bypass' | 'bifold' | 'garage'

/** The Type names the card offers, in order, and the style each one means. */
export const DOOR_TYPES: { name: string; style: DoorStyle }[] = [
  { name: 'Hinged Single', style: 'single' },
  { name: 'Hinged Double', style: 'double' },
  { name: 'Patio Slider', style: 'patio' },
  { name: 'Pocket', style: 'pocket' },
  { name: 'Bypass', style: 'bypass' },
  { name: 'Bifold', style: 'bifold' },
  { name: 'Garage', style: 'garage' },
]

/** Past this a door is a vehicle opening; the same 7-ft line the 3D always used. */
export const OVERHEAD_MIN_W = 2.1
/** Past 36in nobody hangs one leaf. */
export const PAIR_MIN_W = 1.0

/** The door's own width in metres — the unit, not the rough opening. */
export function doorWidthM(obj: { type: string; scaleX: number }): number {
  return (getCatalogItem(obj.type)?.defaultW ?? 0.9) * obj.scaleX
}

/** The style a Type name means, or null for a name this app does not know. */
export function styleFromSubtype(subtype: string | undefined, widthM: number): DoorStyle | null {
  const s = (subtype ?? '').toLowerCase()
  if (!s) return null
  if (s.includes('garage')) return 'garage'
  if (s.includes('pocket')) return 'pocket'
  if (s.includes('patio')) return 'patio'
  if (s.includes('bypass')) return 'bypass'
  if (s.includes('bifold') || s.includes('bi-fold')) return 'bifold'
  if (s.includes('double')) return 'double'
  if (s.includes('single') || s.includes('hinged')) return 'single'
  // Plans saved before the slider was split in two said only "Sliding". A wide
  // one is a patio door; a narrow one is a closet's bypass pair.
  if (s.includes('slid')) return widthM >= 1.5 ? 'patio' : 'bypass'
  return null
}

/** The style a door is drawn, framed and edited as. Null for anything not a door. */
export function doorStyle(obj: { type: string; subtype?: string; scaleX: number }): DoorStyle | null {
  if (obj.type !== 'door') return null
  const w = doorWidthM(obj)
  const typed = styleFromSubtype(obj.subtype, w)
  if (typed) return typed
  if (w >= OVERHEAD_MIN_W) return 'garage'
  if (w > PAIR_MIN_W) return 'double'
  return 'single'
}

/** The Type name to show for a door, including one decided by width. */
export function doorTypeName(style: DoorStyle): string {
  return DOOR_TYPES.find((t) => t.style === style)?.name ?? 'Hinged Single'
}

/** Doors that swing on hinges, and so have a hand and a swing side. */
export const isHinged = (s: DoorStyle | null) => s === 'single' || s === 'double' || s === 'bifold'
/** Doors that slide: two panels passing each other. */
export const isSlider = (s: DoorStyle | null) => s === 'patio' || s === 'bypass'

/**
 * WHERE THE FRAMED HOLE SITS, relative to the doorway — for a pocket door.
 *
 * A pocket door comes as a kit with its own pocket, and you frame ONE rough
 * opening for the whole kit: the doorway plus the pocket, about a door's width
 * more (2 × door + 1″ — 73″ for a 3-ft door). The doorway is at one end of that
 * hole and the pocket is the other end.
 *
 * The object sits where you walk through, so the hole has to be pushed toward
 * the pocket side by half a door — centred on the doorway, the framing split
 * the pocket in two, half a door each side. Every other door frames centred.
 * Returned along the door's own +X (metres); `swing` names the pocket side.
 */
export function framedShiftM(obj: { type: string; subtype?: string; scaleX: number; swing?: 'left' | 'right' }): number {
  if (doorStyle(obj) !== 'pocket') return 0
  const side = (obj.swing ?? 'left') === 'left' ? -1 : 1
  return side * doorWidthM(obj) / 2
}

/** How many leaves a bifold folds into: a pair per side past 36in. */
export function bifoldLeaves(widthM: number): number {
  return widthM > PAIR_MIN_W ? 4 : 2
}

/**
 * What gets ORDERED for this door, as the line on a materials list. Counting
 * every door as "door" told the yard nothing: a pocket door is a frame kit and
 * a slab, a patio door is a unit, and every one of them is bought by size.
 */
export function doorOrderName(obj: { type: string; subtype?: string; scaleX: number }): string | null {
  const style = doorStyle(obj)
  if (!style) return null
  const inches = Math.round(doorWidthM(obj) / 0.0254)
  const ftIn = `${Math.floor(inches / 12)}'-${inches % 12}"`
  switch (style) {
    case 'pocket': return `Pocket door frame kit + slab, ${inches}"`
    case 'patio': return `Patio slider, ${ftIn}`
    case 'bypass': return `Bypass closet door, ${inches}"`
    case 'bifold': return `Bifold closet door, ${inches}"`
    case 'garage': return `Garage door, ${ftIn}`
    case 'double': return `Door pair, ${inches}"`
    case 'single': return `Door, ${inches}"`
  }
}
