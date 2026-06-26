/**
 * Starter catalog of placeable furniture/fixtures for the object-placement
 * system. Dimensions are footprint width (W, along X) × depth (D, along Z) ×
 * height (H, along Y) in METRES, plus a base colour for the box stand-in.
 *
 * `type` is the stable key stored on each PlacedObject; `label` is the full UI
 * name, `short` the compact tray label, `icon` an emoji glyph for the tray.
 * Doors and windows cut openings into walls; other items render as boxes.
 */
export interface ObjectCatalogItem {
  type: string
  label: string
  short: string
  icon: string
  /** Default footprint width in metres (X) */
  defaultW: number
  /** Default footprint depth in metres (Z) */
  defaultD: number
  /** Default height in metres (Y) */
  defaultH: number
  /** Base colour of the box stand-in */
  color: string
}

export const OBJECT_CATALOG: ObjectCatalogItem[] = [
  { type: 'door',           label: 'Door',            short: 'Door',     icon: '🚪', defaultW: 0.9,  defaultD: 0.12, defaultH: 2.05, color: '#f59e0b' },
  { type: 'window',         label: 'Window',          short: 'Window',   icon: '🪟', defaultW: 1.2,  defaultD: 0.12, defaultH: 1.2,  color: '#7dd3fc' },
  { type: 'sofa',           label: 'Sofa',            short: 'Sofa',     icon: '🛋️', defaultW: 2.0,  defaultD: 0.9,  defaultH: 0.8,  color: '#6366f1' },
  { type: 'chair',          label: 'Chair',           short: 'Chair',    icon: '🪑', defaultW: 0.55, defaultD: 0.55, defaultH: 0.9,  color: '#22c55e' },
  { type: 'bed-double',     label: 'Bed (Double)',    short: 'Bed',      icon: '🛏️', defaultW: 1.5,  defaultD: 2.0,  defaultH: 0.5,  color: '#be185d' },
  { type: 'bed-single',     label: 'Bed (Single)',    short: 'Bed S',    icon: '🛏️', defaultW: 0.99, defaultD: 1.9,  defaultH: 0.5,  color: '#db2777' },
  { type: 'desk',           label: 'Desk',            short: 'Desk',     icon: '🖥️', defaultW: 1.4,  defaultD: 0.7,  defaultH: 0.75, color: '#0891b2' },
  { type: 'dining-table',   label: 'Dining Table',    short: 'Table',    icon: '🍽️', defaultW: 1.6,  defaultD: 0.9,  defaultH: 0.75, color: '#b45309' },
  { type: 'kitchen-counter',label: 'Kitchen Counter', short: 'Counter',  icon: '🍳', defaultW: 2.4,  defaultD: 0.6,  defaultH: 0.9,  color: '#78716c' },
  { type: 'toilet',         label: 'Toilet',          short: 'Toilet',   icon: '🚽', defaultW: 0.4,  defaultD: 0.7,  defaultH: 0.8,  color: '#e2e8f0' },
  { type: 'bathtub',        label: 'Bathtub',         short: 'Bath',     icon: '🛁', defaultW: 1.7,  defaultD: 0.75, defaultH: 0.6,  color: '#38bdf8' },
  // ── More furniture ──
  { type: 'armchair',       label: 'Armchair',        short: 'Armchair', icon: '🛋️', defaultW: 0.85, defaultD: 0.85, defaultH: 0.85, color: '#7c3aed' },
  { type: 'coffee-table',   label: 'Coffee Table',    short: 'Coffee',   icon: '🪵', defaultW: 1.1,  defaultD: 0.6,  defaultH: 0.4,  color: '#92400e' },
  { type: 'tv',             label: 'TV',              short: 'TV',       icon: '📺', defaultW: 1.2,  defaultD: 0.1,  defaultH: 0.72, color: '#0b0f17' },
  { type: 'bookshelf',      label: 'Bookshelf',       short: 'Shelf',    icon: '📚', defaultW: 0.9,  defaultD: 0.3,  defaultH: 1.8,  color: '#7c5c3e' },
  { type: 'dresser',        label: 'Dresser',         short: 'Dresser',  icon: '🗄️', defaultW: 1.2,  defaultD: 0.5,  defaultH: 0.8,  color: '#8b5e34' },
  { type: 'nightstand',     label: 'Nightstand',      short: 'Nightstd', icon: '🗄️', defaultW: 0.45, defaultD: 0.4,  defaultH: 0.5,  color: '#8b5e34' },
  { type: 'wardrobe',       label: 'Wardrobe',        short: 'Wardrobe', icon: '🚪', defaultW: 1.2,  defaultD: 0.6,  defaultH: 2.0,  color: '#6b4423' },
  // ── Kitchen appliances ──
  { type: 'refrigerator',   label: 'Refrigerator',    short: 'Fridge',   icon: '🧊', defaultW: 0.9,  defaultD: 0.7,  defaultH: 1.8,  color: '#cbd5e1' },
  { type: 'stove',          label: 'Range / Stove',   short: 'Stove',    icon: '🔥', defaultW: 0.76, defaultD: 0.7,  defaultH: 0.92, color: '#94a3b8' },
  { type: 'range-hood',     label: 'Range Hood',      short: 'Hood',     icon: '💨', defaultW: 0.76, defaultD: 0.5,  defaultH: 0.4,  color: '#9ca3af' },
  { type: 'dishwasher',     label: 'Dishwasher',      short: 'Dishwshr', icon: '🍽️', defaultW: 0.6,  defaultD: 0.6,  defaultH: 0.85, color: '#cbd5e1' },
  { type: 'kitchen-sink',   label: 'Kitchen Sink',    short: 'K-Sink',   icon: '🚰', defaultW: 0.8,  defaultD: 0.6,  defaultH: 0.2,  color: '#e2e8f0' },
  // ── Bath / laundry / mechanical ──
  { type: 'bathroom-sink',  label: 'Bathroom Vanity', short: 'Vanity',   icon: '🚰', defaultW: 0.6,  defaultD: 0.5,  defaultH: 0.85, color: '#e2e8f0' },
  { type: 'shower',         label: 'Shower',          short: 'Shower',   icon: '🚿', defaultW: 0.9,  defaultD: 0.9,  defaultH: 2.0,  color: '#bae6fd' },
  { type: 'washer',         label: 'Washer',          short: 'Washer',   icon: '🌀', defaultW: 0.6,  defaultD: 0.6,  defaultH: 0.9,  color: '#e2e8f0' },
  { type: 'dryer',          label: 'Dryer',           short: 'Dryer',    icon: '♨️', defaultW: 0.6,  defaultD: 0.6,  defaultH: 0.9,  color: '#e2e8f0' },
  { type: 'water-heater',   label: 'Water Heater',    short: 'Wtr Htr',  icon: '🛢️', defaultW: 0.6,  defaultD: 0.6,  defaultH: 1.5,  color: '#d6d3d1' },
  // ── Vertical circulation — H defaults to one storey rise; scale to fit. ──
  { type: 'stairs',         label: 'Stairs',          short: 'Stairs',   icon: '🪜', defaultW: 1.0,  defaultD: 3.6,  defaultH: 2.9,  color: '#a16207' },
  { type: 'elevator',       label: 'Elevator',        short: 'Lift',     icon: '🛗', defaultW: 1.7,  defaultD: 1.7,  defaultH: 2.9,  color: '#94a3b8' },
  // ── Electrical rough-in boxes (installed first, then wired) ──
  { type: 'device-box',     label: 'Device Box (1-gang)', short: 'Dev Box',  icon: '⬛', defaultW: 0.07, defaultD: 0.06, defaultH: 0.11, color: '#64748b' },
  { type: 'junction-box',   label: 'Junction Box',        short: 'J-Box',    icon: '⬛', defaultW: 0.10, defaultD: 0.06, defaultH: 0.10, color: '#64748b' },
  { type: 'light-box',      label: 'Ceiling Box',         short: 'Lt Box',   icon: '⬛', defaultW: 0.10, defaultD: 0.05, defaultH: 0.10, color: '#64748b' },
  // ── Electrical fixtures (shown when the Electrical layer is active) ──
  { type: 'duplex-outlet',  label: 'Duplex Outlet (15A)', short: 'Outlet',   icon: '🔌', defaultW: 0.08, defaultD: 0.04, defaultH: 0.12, color: '#facc15' },
  { type: 'gfci-outlet',    label: 'GFCI Outlet (20A)',   short: 'GFCI',     icon: '⚡', defaultW: 0.08, defaultD: 0.04, defaultH: 0.12, color: '#f59e0b' },
  { type: 'switch',         label: 'Switch',              short: 'Switch',   icon: '🔘', defaultW: 0.08, defaultD: 0.04, defaultH: 0.12, color: '#e2e8f0' },
  { type: 'ceiling-light',  label: 'Ceiling Light',       short: 'Ceiling',  icon: '💡', defaultW: 0.3,  defaultD: 0.3,  defaultH: 0.12, color: '#fde68a' },
  { type: 'recessed-light', label: 'Recessed Light',      short: 'Recessed', icon: '🔆', defaultW: 0.16, defaultD: 0.16, defaultH: 0.08, color: '#fef3c7' },
  { type: 'exhaust-fan',    label: 'Exhaust Fan',         short: 'Fan',      icon: '🌀', defaultW: 0.3,  defaultD: 0.3,  defaultH: 0.2,  color: '#cbd5e1' },
  { type: 'panel-box',      label: 'Panel Box',           short: 'Panel',    icon: '🔋', defaultW: 0.4,  defaultD: 0.12, defaultH: 0.75, color: '#9ca3af' },
]

/** Electrical fixture types (tray order when the Electrical layer is active). */
export const ELECTRICAL_TRAY_ORDER: string[] = [
  // Boxes first (rough-in), then the devices/fixtures that drop into them.
  'device-box', 'junction-box', 'light-box',
  'duplex-outlet', 'gfci-outlet', 'switch', 'ceiling-light', 'recessed-light', 'exhaust-fan', 'panel-box',
]

/** Electrical rough-in box types (installed before devices + wiring). */
export const ELECTRICAL_BOX_TYPES = new Set(['device-box', 'junction-box', 'light-box'])

/** Outlet/receptacle types (relevant to spacing/GFCI validation). */
export const OUTLET_TYPES = new Set(['duplex-outlet', 'gfci-outlet'])

/** Devices that mount ON a wall (snap to the nearest wall + stand at a standard
 *  height) rather than sitting on the floor. Ceiling fixtures are separate. */
export const WALL_MOUNTED_DEVICES = new Set([
  'duplex-outlet', 'gfci-outlet', 'device-box', 'junction-box', 'switch', 'panel-box',
])

/** Ceiling-mounted electrical fixtures (boxes/lights/fans up at the ceiling). */
export const CEILING_DEVICES = new Set([
  'light-box', 'ceiling-light', 'recessed-light', 'exhaust-fan',
])

/**
 * Standard rough-in mounting height for a device — the centre Y in metres above
 * the finished floor. Wall devices use code-typical heights (receptacles ~12",
 * switches ~48"); ceiling fixtures hang just below the ceiling. Returns null for
 * furniture, which just sits on the floor (caller renders at height/2).
 */
export function deviceMountHeightM(type: string, ceilingM = 2.4): number | null {
  switch (type) {
    case 'duplex-outlet':
    case 'gfci-outlet':
    case 'device-box':   return 0.35   // ~12-14" to box centre
    case 'junction-box': return 1.20
    case 'switch':       return 1.22   // ~48" to switch centre
    case 'panel-box':    return 1.40
    case 'light-box':
    case 'ceiling-light':
    case 'recessed-light':
    case 'exhaust-fan':  return Math.max(0.5, ceilingM - 0.06)
    default:             return null
  }
}

export function electricalTrayItems(): ObjectCatalogItem[] {
  return ELECTRICAL_TRAY_ORDER
    .map((t) => OBJECT_CATALOG.find((o) => o.type === t))
    .filter((o): o is ObjectCatalogItem => Boolean(o))
}

/** Tray display order (curated; one bed entry shown as "Bed"). */
export const TRAY_ORDER: string[] = [
  'door', 'window', 'sofa', 'armchair', 'chair', 'coffee-table', 'tv',
  'bed-double', 'bed-single', 'nightstand', 'dresser', 'wardrobe', 'bookshelf',
  'desk', 'dining-table',
  'kitchen-counter', 'refrigerator', 'stove', 'range-hood', 'dishwasher', 'kitchen-sink',
  'toilet', 'bathtub', 'shower', 'bathroom-sink',
  'washer', 'dryer', 'water-heater',
  'stairs', 'elevator',
]

/** Vertical-circulation types (span a storey; sit on the floor and rise up). */
export const VERTICAL_CIRCULATION = new Set(['stairs', 'elevator'])

/** Sub-type options offered in the property card, by object type. */
export const SUBTYPES: Record<string, string[]> = {
  door: ['Hinged Single', 'Hinged Double', 'Pocket', 'Sliding', 'Bifold'],
  window: ['Single-hung', 'Double-hung', 'Casement', 'Fixed'],
  stairs: ['Straight', 'L-shaped', 'U-shaped', 'Switchback'],
}

export function getCatalogItem(type: string): ObjectCatalogItem | undefined {
  return OBJECT_CATALOG.find((o) => o.type === type)
}

/** Catalog items in tray order. */
export function trayItems(): ObjectCatalogItem[] {
  return TRAY_ORDER
    .map((t) => OBJECT_CATALOG.find((o) => o.type === t))
    .filter((o): o is ObjectCatalogItem => Boolean(o))
}
