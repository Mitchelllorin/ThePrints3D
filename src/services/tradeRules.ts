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

/**
 * Where each trade's distribution BEGINS, and the band it starts routing in.
 *
 * TWO OF THE THREE START OUTSIDE, AND ONE DOES NOT. Plumbing and electrical are
 * services: they cross the property, cross the wall, and everything inside
 * hangs off that entry point. Ductwork is not a service — it starts at the air
 * handler, which stands INSIDE the building, and fans out from there. Only the
 * line-set to the outdoor condenser, the gas line and the fresh-air intake
 * cross the wall at all.
 *
 * Routing has to honour that difference or HVAC gets run backwards from a
 * service entry that does not exist.
 */
export type ServiceOrigin =
  /** Crosses the building envelope from the street/yard. */
  | 'exterior'
  /** Starts at equipment standing inside the building. */
  | 'interior-plant'

export const SERVICE_ENTRY: Record<
  'plumbing' | 'electrical' | 'hvac',
  { origin: ServiceOrigin; band: MountRule['band']; note: string }
> = {
  plumbing: {
    origin: 'exterior',
    band: 'under-floor',
    note: 'Water main + sewer enter below grade / under the floor, from outside — where the city water meets the house water.',
  },
  electrical: {
    origin: 'exterior',
    band: 'under-floor',
    note: 'Service lateral to the panel, or overhead to a weatherhead with a drip loop; route from outside.',
  },
  hvac: {
    origin: 'interior-plant',
    band: 'ceiling',
    note: 'Trunk starts at the air handler INSIDE the building and runs overhead to registers. Only the condenser line-set, gas line and fresh-air intake cross the wall.',
  },
}

/** True when this trade's distribution starts outside the building envelope. */
export function startsOutside(trade: 'plumbing' | 'electrical' | 'hvac'): boolean {
  return SERVICE_ENTRY[trade].origin === 'exterior'
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

// ─── Heating: the type decides which trade even owns the work ─────────────────
//
// "HVAC" is not one system. Only ONE of the common heating types has ducts, and
// the others are not really HVAC work at all: electric baseboard is an
// ELECTRICAL job, and in-floor hydronic is closer to PLUMBING. Model heating as
// "ducts from an air handler" and you have modelled the wrong building for a
// large share of housing — baseboard alone is the norm across much of Canada.
//
// This has to be settled BEFORE devices are placed, not bolted on after: a
// baseboard heater lives under a window, and a receptacle may not sit directly
// above one — which is exactly where receptacle spacing wants to put it.

export type HeatingType =
  /** Furnace or air handler with a duct trunk and registers. The ducted one. */
  | 'forced-air'
  /** Electric resistance baseboards. No ducts; dedicated 240V circuits. */
  | 'electric-baseboard'
  /** Ductless mini-split heads, line-set through the wall to an outdoor unit. */
  | 'mini-split'
  /** Boiler and manifold feeding PEX loops in the floor. No ducts. */
  | 'in-floor-hydronic'

export interface HeatingRule {
  label: string
  /** Which trade actually installs and owns the distribution. */
  ownedBy: 'hvac' | 'electrical' | 'plumbing'
  /** True only for the one system that has a duct trunk. */
  ducted: boolean
  /** Where an emitter sits, m AFF. Null when there is nothing on the wall to
   *  place (in-floor has no emitter — the floor IS the emitter). */
  emitterMountM: number | null
  /** Emitters belong under windows on exterior walls. */
  underWindows: boolean
  /** A receptacle must not sit directly above this emitter. */
  blocksReceptacleAbove: boolean
  note: string
}

export const HEATING_SYSTEMS: Record<HeatingType, HeatingRule> = {
  'forced-air': {
    label: 'Forced air (furnace / air handler)',
    ownedBy: 'hvac',
    ducted: true,
    emitterMountM: 0,
    underWindows: false,
    blocksReceptacleAbove: false,
    note: 'Trunk from an interior air handler to floor or ceiling registers. The only ducted system.',
  },
  'electric-baseboard': {
    label: 'Electric baseboard',
    ownedBy: 'electrical',
    ducted: false,
    // Sits ON the floor; ~3" to the top of a typical unit is close enough for
    // placement, and the clearance below is what matters on site.
    emitterMountM: 3 * IN,
    underWindows: true,
    blocksReceptacleAbove: true,
    note: 'No ducts. Dedicated 240V circuits, units under windows. A receptacle may not sit directly above a unit.',
  },
  'mini-split': {
    label: 'Ductless mini-split (heat pump)',
    ownedBy: 'hvac',
    ducted: false,
    // High-wall head, just below the ceiling. Floor-standing units exist and
    // look much like a baseboard — that variant is a per-unit override, not a
    // different heating type.
    emitterMountM: 84 * IN,
    underWindows: false,
    blocksReceptacleAbove: false,
    note: 'No ducts. One head per zone, line-set (refrigerant pair + condensate + control) through the wall to an outdoor condenser.',
  },
  'in-floor-hydronic': {
    label: 'In-floor water (hydronic radiant)',
    ownedBy: 'plumbing',
    ducted: false,
    // The floor is the emitter — there is nothing on a wall to place.
    emitterMountM: null,
    underWindows: false,
    blocksReceptacleAbove: false,
    note: 'No ducts. Boiler and manifold feeding PEX loops in the floor build-up.',
  },
}

/** The heating type most houses get unless told otherwise. */
export const DEFAULT_HEATING: HeatingType = 'forced-air'

/** True when this heating system puts an emitter on the wall under windows —
 *  the case receptacle placement has to keep clear of. */
export function heatingBlocksReceptacles(type: HeatingType): boolean {
  return HEATING_SYSTEMS[type].blocksReceptacleAbove
}
