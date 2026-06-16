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
  'duplex-outlet', 'gfci-outlet', 'switch', 'ceiling-light', 'recessed-light', 'exhaust-fan', 'panel-box',
]

/** Outlet/receptacle types (relevant to spacing/GFCI validation). */
export const OUTLET_TYPES = new Set(['duplex-outlet', 'gfci-outlet'])

export function electricalTrayItems(): ObjectCatalogItem[] {
  return ELECTRICAL_TRAY_ORDER
    .map((t) => OBJECT_CATALOG.find((o) => o.type === t))
    .filter((o): o is ObjectCatalogItem => Boolean(o))
}

/** Tray display order (curated; one bed entry shown as "Bed"). */
export const TRAY_ORDER: string[] = [
  'door', 'window', 'sofa', 'chair', 'bed-double', 'desk',
  'dining-table', 'kitchen-counter', 'toilet', 'bathtub',
]

/** Sub-type options offered in the property card, by object type. */
export const SUBTYPES: Record<string, string[]> = {
  door: ['Hinged Single', 'Hinged Double', 'Pocket', 'Sliding', 'Bifold'],
  window: ['Single-hung', 'Double-hung', 'Casement', 'Fixed'],
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
