// Trade-rules — the on-device "master tradesman" knowledge base. A pure,
// baked-in source of truth for MEP standards so the AI can AUTO-PLACE fixtures at
// the right heights, AUTO-ROUTE service from outside, and SIZE pipe/wire without
// the user hand-drawing everything (see the ai-auto-places-mep memory).
//
// Values are common U.S. RESIDENTIAL practice per NEC (electrical) and IPC/UPC
// (plumbing). They are sensible defaults for auto-placement, NOT a substitute for
// the local code / Authority Having Jurisdiction — always verify against the AHJ.
// Free/open-source reference values only (no paid data, on-device).
//
// Units: heights in METRES (AFF = above finished floor), pipe/conduit in INCHES
// (trade nominal), wire in AWG.

const IN = 0.0254 // inch → metre

// ─── Electrical: standard mount heights (AFF, to device centre) ───────────────

export interface MountRule {
  /** Height above finished floor to the device centre, metres. */
  heightM: number
  /** Which trace band the run to this device lives in. */
  band: 'under-floor' | 'in-wall' | 'ceiling'
  note: string
}

/** Keyed by canonical element type (lowercased). */
export const ELECTRICAL_MOUNTS: Record<string, MountRule> = {
  outlet:          { heightM: 12 * IN, band: 'in-wall', note: 'General receptacle, ~12" to centre (NEC min 15" to bottom of box varies).' },
  receptacle:      { heightM: 12 * IN, band: 'in-wall', note: 'General receptacle.' },
  'counter-outlet':{ heightM: 44 * IN, band: 'in-wall', note: 'Kitchen counter GFCI, ~42–45" AFF above backsplash.' },
  switch:          { heightM: 48 * IN, band: 'in-wall', note: 'Wall switch, ~48" to centre.' },
  panel:           { heightM: 60 * IN, band: 'in-wall', note: 'Load centre; highest breaker handle <= 6\'7" (2.0m).' },
  thermostat:      { heightM: 60 * IN, band: 'in-wall', note: 'Thermostat ~60" AFF.' },
  sconce:          { heightM: 66 * IN, band: 'in-wall', note: 'Wall sconce ~5.5\'.' },
  'light':         { heightM: 96 * IN, band: 'ceiling', note: 'Ceiling fixture — routed overhead.' },
  smoke:           { heightM: 96 * IN, band: 'ceiling', note: 'Smoke/CO on the ceiling.' },
}

// ─── Plumbing: rough-in heights + pipe sizing by fixture ──────────────────────

export interface PlumbingRule {
  /** Drain rough-in height AFF (metres); 0 = at the floor (e.g. toilet/WC). */
  drainM: number
  /** Supply rough-in height AFF (metres). */
  supplyM: number
  /** Trap-arm / drain nominal size (inches). */
  drainIn: number
  /** Supply nominal size (inches). */
  supplyIn: number
  note: string
}

export const PLUMBING_FIXTURES: Record<string, PlumbingRule> = {
  toilet:      { drainM: 0,        supplyM: 8 * IN,  drainIn: 3,   supplyIn: 0.5, note: 'WC: 3" drain, flange 12" off finished wall, supply ~8" AFF.' },
  'water-closet': { drainM: 0,     supplyM: 8 * IN,  drainIn: 3,   supplyIn: 0.5, note: 'WC.' },
  lavatory:    { drainM: 18 * IN,  supplyM: 21 * IN, drainIn: 1.5, supplyIn: 0.5, note: 'Bath sink: drain ~18", supply ~21" AFF.' },
  sink:        { drainM: 18 * IN,  supplyM: 21 * IN, drainIn: 1.5, supplyIn: 0.5, note: 'Bath/vanity sink.' },
  'kitchen-sink': { drainM: 16 * IN, supplyM: 19 * IN, drainIn: 1.5, supplyIn: 0.5, note: 'Kitchen sink: 1.5" drain (2" if disposal+dishwasher).' },
  shower:      { drainM: 0,        supplyM: 48 * IN, drainIn: 2,   supplyIn: 0.5, note: 'Shower: 2" drain at floor, valve ~48", head ~78".' },
  tub:         { drainM: 0,        supplyM: 12 * IN, drainIn: 1.5, supplyIn: 0.5, note: 'Tub: 1.5" drain, spout ~4" above rim.' },
  washer:      { drainM: 42 * IN,  supplyM: 44 * IN, drainIn: 2,   supplyIn: 0.5, note: 'Laundry box ~42–48" AFF, 2" standpipe.' },
  'water-heater': { drainM: 0,     supplyM: 0,       drainIn: 0,   supplyIn: 0.75, note: 'WH: 3/4" supply typical.' },
}

/** Building drain / stack nominal size (inches) by fixture load — coarse. */
export const STACK_SIZE_IN = 4      // main building drain / soil stack
export const BRANCH_SIZE_IN = 3     // branch serving a WC
export const WATER_MAIN_IN = 0.75   // 3/4" water service into the building

// ─── Electrical wire sizing (copper, 60/75°C NM-B "Romex", residential) ───────

const WIRE_TABLE: Array<{ maxAmps: number; awg: string }> = [
  { maxAmps: 15, awg: '14 AWG' },
  { maxAmps: 20, awg: '12 AWG' },
  { maxAmps: 30, awg: '10 AWG' },
  { maxAmps: 40, awg: '8 AWG' },
  { maxAmps: 50, awg: '6 AWG' },
  { maxAmps: 60, awg: '4 AWG' },
  { maxAmps: 100, awg: '2 AWG' },
]

/** Minimum copper conductor for a breaker/circuit amperage. */
export function wireGaugeForAmps(amps: number): string {
  for (const row of WIRE_TABLE) if (amps <= row.maxAmps) return row.awg
  return '2 AWG'
}

// ─── Spacing / placement rules ────────────────────────────────────────────────

/** NEC 210.52: no point along a wall line may be >6 ft from a receptacle → outlets
 *  no more than 12 ft (3.66 m) apart. Used to auto-space outlets along a wall. */
export const OUTLET_MAX_SPACING_M = 12 * 12 * IN // 12 ft

/** Studs/joists on-centre (also in framingGeometry); here for placement math. */
export const STUD_OC_M = 16 * IN

// ─── Service entry (from OUTSIDE the building) ────────────────────────────────

/** Where each trade's service enters and the band it starts routing in. */
export const SERVICE_ENTRY: Record<'plumbing' | 'electrical' | 'hvac', { band: MountRule['band']; note: string }> = {
  plumbing:   { band: 'under-floor', note: 'Water main + sewer enter below grade / under the floor, from outside.' },
  electrical: { band: 'under-floor', note: 'Service lateral to the panel (or overhead to a weatherhead); route from outside.' },
  hvac:       { band: 'ceiling',     note: 'Trunk from the air handler runs overhead to registers.' },
}

// ─── Lookups (tolerant of catalog naming) ─────────────────────────────────────

const norm = (t: string): string => (t || '').trim().toLowerCase().replace(/\s+/g, '-')

/** Standard mount height (m AFF) for an electrical device, or null if unknown. */
export function electricalMountM(elementType: string): number | null {
  const r = ELECTRICAL_MOUNTS[norm(elementType)]
  return r ? r.heightM : null
}

/** Plumbing rough-in rule for a fixture, or null if unknown. */
export function plumbingRule(fixtureType: string): PlumbingRule | null {
  return PLUMBING_FIXTURES[norm(fixtureType)] ?? null
}

/** The band a run to/from this element should live in. */
export function bandForElectrical(elementType: string): MountRule['band'] {
  return ELECTRICAL_MOUNTS[norm(elementType)]?.band ?? 'in-wall'
}
