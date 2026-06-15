/**
 * Starter catalog of placeable furniture/fixtures for the object-placement
 * system. Dimensions are footprint width (W, along X) × depth (D, along Z) ×
 * height (H, along Y) in METRES, plus a base colour for the box stand-in.
 *
 * `type` is the stable key stored on each PlacedObject; `label` is shown in the
 * UI. Doors and windows are placed as thin marker boxes for now.
 */
export interface ObjectCatalogItem {
  type: string
  label: string
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
  { type: 'sofa',           label: 'Sofa',           defaultW: 2.0,  defaultD: 0.9,  defaultH: 0.8,  color: '#6366f1' },
  { type: 'chair',          label: 'Chair',          defaultW: 0.55, defaultD: 0.55, defaultH: 0.9,  color: '#22c55e' },
  { type: 'dining-table',   label: 'Dining Table',   defaultW: 1.6,  defaultD: 0.9,  defaultH: 0.75, color: '#b45309' },
  { type: 'desk',           label: 'Desk',           defaultW: 1.4,  defaultD: 0.7,  defaultH: 0.75, color: '#0891b2' },
  { type: 'bed-single',     label: 'Bed (Single)',   defaultW: 0.99, defaultD: 1.9,  defaultH: 0.5,  color: '#db2777' },
  { type: 'bed-double',     label: 'Bed (Double)',   defaultW: 1.5,  defaultD: 2.0,  defaultH: 0.5,  color: '#be185d' },
  { type: 'toilet',         label: 'Toilet',         defaultW: 0.4,  defaultD: 0.7,  defaultH: 0.8,  color: '#e2e8f0' },
  { type: 'bathtub',        label: 'Bathtub',        defaultW: 1.7,  defaultD: 0.75, defaultH: 0.6,  color: '#38bdf8' },
  { type: 'kitchen-counter',label: 'Kitchen Counter',defaultW: 2.4,  defaultD: 0.6,  defaultH: 0.9,  color: '#78716c' },
  { type: 'door',           label: 'Door',           defaultW: 0.9,  defaultD: 0.12, defaultH: 2.05, color: '#f59e0b' },
  { type: 'window',         label: 'Window',         defaultW: 1.2,  defaultD: 0.12, defaultH: 1.2,  color: '#7dd3fc' },
]

export function getCatalogItem(type: string): ObjectCatalogItem | undefined {
  return OBJECT_CATALOG.find((o) => o.type === type)
}
