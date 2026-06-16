/**
 * Trade/discipline trace layers — colours and per-layer pre-trace picker
 * options. Single source of truth shared by the panel picker, the 2D overlay,
 * and the 3D trade renderer.
 */
export type TraceLayer = 'framing' | 'plumbing' | 'electrical' | 'hvac'

export const TRACE_LAYER_ORDER: TraceLayer[] = ['framing', 'plumbing', 'electrical', 'hvac']

/** Line colour per layer (rubber-band + committed lines + 3D geometry). */
export const LAYER_COLORS: Record<TraceLayer, string> = {
  framing: '#ffffff',
  plumbing: '#60a5fa',
  electrical: '#facc15',
  hvac: '#4ade80',
}

export const LAYER_LABELS: Record<TraceLayer, string> = {
  framing: 'Framing',
  plumbing: 'Plumbing',
  electrical: 'Electrical',
  hvac: 'HVAC',
}

/** Pre-trace picker rows for plumbing. */
export const PLUMBING_PICKER = {
  element: ['Supply Line', 'Drain Line', 'Vent Stack', 'Cleanout'],
  size: ['1/2"', '3/4"', '1-1/2"', '2"', '3"', '4"'],
  material: ['PEX', 'Copper', 'PVC', 'ABS'],
}
export const PLUMBING_DEFAULTS = { element: 'Supply Line', size: '1/2"', material: 'PEX', temp: 'cold' as 'hot' | 'cold' }

/** Pre-trace picker rows for electrical (size = amperage, material = wire gauge). */
export const ELECTRICAL_PICKER = {
  element: ['Circuit Run', 'Home Run', 'Low Voltage'],
  size: ['15A', '20A', '30A', '50A'],
  material: ['14/2 Romex', '12/2 Romex', '10/2 Romex', 'Conduit'],
  role: ['Hot (Black)', 'Hot (Red)', 'Neutral', 'Ground'],
}
export const ELECTRICAL_DEFAULTS = { element: 'Circuit Run', size: '15A', material: '14/2 Romex', role: 'Hot (Black)' }

// ── Field-convention colours: a plumber/sparky reads these like real plans ────

/** Plumbing colour by element type (supply lines split hot/cold). */
export function plumbingColorFor(element: string, temp?: 'hot' | 'cold'): string {
  switch (element) {
    case 'Drain Line': return '#a3a3a3' // grey
    case 'Vent Stack': return '#d4d4d4' // light grey
    case 'Cleanout':   return '#f97316' // orange marker
    case 'Supply Line':
    default:           return temp === 'hot' ? '#ef4444' : '#60a5fa' // red hot / blue cold
  }
}

/** Electrical colour by conductor role (Low Voltage element overrides). */
export function electricalColorFor(element: string, role?: string): string {
  if (element === 'Low Voltage') return '#a855f7' // purple
  switch (role) {
    case 'Hot (Red)': return '#ef4444'
    case 'Neutral':   return '#ffffff'
    case 'Ground':    return '#22c55e'
    case 'Hot (Black)':
    default:          return '#111111' // near-black (visible on dark bg)
  }
}

export function plumbingColor(line: { elementType: string; tempType?: 'hot' | 'cold' }): string {
  return plumbingColorFor(line.elementType, line.tempType)
}
export function electricalColor(line: { elementType: string; wireRole?: string }): string {
  return electricalColorFor(line.elementType, line.wireRole)
}
