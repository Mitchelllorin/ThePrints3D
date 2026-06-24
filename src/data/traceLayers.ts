/**
 * Trade/discipline trace layers — colours and per-layer pre-trace picker
 * options. Single source of truth shared by the panel picker, the 2D overlay,
 * and the 3D trade renderer.
 */
export type TraceLayer = 'floors' | 'framing' | 'roof' | 'plumbing' | 'electrical' | 'hvac'

// Ordered to match real construction sequence: the floor deck/slab goes in
// first, then the walls are framed on top of it, then the roof goes on, then
// the MEP rough-ins.
export const TRACE_LAYER_ORDER: TraceLayer[] = ['floors', 'framing', 'roof', 'plumbing', 'electrical', 'hvac']

/** Line colour per layer (rubber-band + committed lines + 3D geometry). */
export const LAYER_COLORS: Record<TraceLayer, string> = {
  framing: '#ffffff',
  floors: '#c9a36a',
  roof: '#f472b6',
  plumbing: '#60a5fa',
  electrical: '#facc15',
  hvac: '#4ade80',
}

export const LAYER_LABELS: Record<TraceLayer, string> = {
  framing: 'Framing',
  floors: 'Floors',
  roof: 'Roof',
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

/** Pre-trace picker rows for HVAC (size = round-duct diameter). */
export const HVAC_PICKER = {
  element: ['Supply Duct', 'Return Duct', 'Branch / Flex', 'Exhaust'],
  size: ['4"', '6"', '8"', '10"', '12"', '14"'],
  material: ['Sheet Metal', 'Flex', 'Rigid Fiberglass'],
}
export const HVAC_DEFAULTS = { element: 'Supply Duct', size: '6"', material: 'Sheet Metal' }

/** Pre-trace picker rows for floors (element = joist type / slab / ceiling, size = on-centre). */
export const FLOORS_PICKER = {
  element: ['2x10', '2x12', 'I-Joist', 'LVL', 'Concrete Slab', 'Ceiling joists'],
  size: ['12"', '16"', '19.2"', '24"'],
}

/** Floor-element names that build a CEILING (joists + drywall at wall-top), not a floor. */
export const CEILING_TYPES = new Set(['Ceiling joists'])
export const FLOORS_DEFAULTS = { element: 'I-Joist', size: '16"' }

/** Storey picker — which level a floor (or roof) sits on. */
export const LEVEL_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 0, label: 'Ground' },
  { value: 1, label: '2nd floor' },
  { value: 2, label: '3rd floor' },
  { value: 3, label: '4th floor' },
]

/**
 * Floor-joist cross-section + colour per joist type. `width`/`depth` are the
 * member's section in metres (depth = vertical web height). Engineered members
 * (I-Joist/LVL) run deeper than dimensional lumber.
 */
export const JOIST_PROFILES: Record<string, { width: number; depth: number; color: string }> = {
  '2x10':    { width: 0.038, depth: 0.235, color: '#caa46a' }, // SPF dimensional
  '2x12':    { width: 0.038, depth: 0.286, color: '#c49a5f' },
  'I-Joist': { width: 0.045, depth: 0.302, color: '#d8c490' }, // OSB web, pale flanges
  'LVL':     { width: 0.045, depth: 0.302, color: '#b9925a' }, // laminated, darker
}
export function joistProfile(element: string) {
  return JOIST_PROFILES[element] ?? JOIST_PROFILES['I-Joist']
}
/** On-centre spacing string ('16"') → metres. */
export function ocToM(size: string): number {
  const inches = parseFloat(size)
  return Number.isFinite(inches) ? inches * 0.0254 : 0.4064
}

/** Pre-trace picker rows for roofs (element = roof type, size = pitch). */
export const ROOF_PICKER = {
  // Each maps to a builder in framingGeometry (buildRoofByType). Truss = Fink
  // (W-web) at 24" OC; Gable = stick. Gambrel = barn; Saltbox = asymmetric.
  // A COMBINED roof = trace several areas, each with its own type. Shed =
  // mono-pitch/lean-to; Flat ignores pitch.
  element: ['Gable', 'Truss', 'Hip', 'Gambrel', 'Saltbox', 'Shed', 'Flat'],
  size: ['3:12', '4:12', '6:12', '8:12', '12:12'],
}
export const ROOF_DEFAULTS = { element: 'Gable', size: '6:12' }

/** Roof pitch string ('6:12') → rise/run ratio (0.5 for 6:12). */
export function pitchToRatio(size: string): number {
  const [rise, run] = size.split(':').map(Number)
  return run ? rise / run : 0.5
}

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
    case 'Hot (Red)': return '#f87171'   // bright red
    case 'Neutral':   return '#f8fafc'   // bright white
    case 'Ground':    return '#4ade80'   // bright green
    case 'Hot (Black)':
    default:          return '#94a3b8'   // black conductor, lifted to a visible
                                         // slate so it reads on the dark workspace
                                         // (pure black was invisible)
  }
}

/** HVAC duct colour by element type (supply green / return sky / exhaust grey). */
export function hvacColorFor(element: string): string {
  switch (element) {
    case 'Return Duct':  return '#38bdf8' // sky — cool return air
    case 'Exhaust':      return '#a3a3a3' // grey
    case 'Branch / Flex': return '#86efac' // light green
    case 'Supply Duct':
    default:             return '#4ade80' // green — HVAC theme
  }
}
export function hvacColor(line: { elementType: string }): string {
  return hvacColorFor(line.elementType)
}

export function plumbingColor(line: { elementType: string; tempType?: 'hot' | 'cold' }): string {
  return plumbingColorFor(line.elementType, line.tempType)
}
export function electricalColor(line: { elementType: string; wireRole?: string }): string {
  return electricalColorFor(line.elementType, line.wireRole)
}
