/**
 * buildingSystemsInference — unified AI inference engine for ALL building
 * trades and assemblies.
 *
 * Pure, deterministic, side-effect free. Takes a context snapshot and returns
 * a ranked recommendation for every system layer: exterior envelope, insulation,
 * MEP (electrical / plumbing / HVAC), drywall, and interior finishes. Each
 * recommendation carries a confidence score (0–1) that the Decision system and
 * the Construction Wizard use to auto-resolve high-confidence picks and surface
 * low-confidence ones as questions.
 *
 * This is the substrate a future cloud-AI layer can override — for now it's
 * rules that run instantly, offline, and free.
 */

import type { BuildingType } from '../onboarding/types'

// ─── Types ───────────────────────────────────────────────────────────────────

export type ClimateZone =
  | 'hot-humid'
  | 'hot-dry'
  | 'mixed-humid'
  | 'mixed-dry'
  | 'cold'
  | 'very-cold'
  | 'subarctic'
  | 'marine'

export interface SystemsInferenceInput {
  buildingType: BuildingType
  /** Wall role from the framing classifier (exterior-bearing, partition, etc.). */
  wallRole?: string
  climateZone?: ClimateZone
  /** Number of storeys — affects structural cladding and insulation requirements. */
  buildingHeightStoreys?: number
}

export interface SystemRecommendation<T = string> {
  value: T
  confidence: number
  /** One-line human-readable rationale surfaced in the Wizard. */
  reason: string
}

// ─── Exterior envelope ───────────────────────────────────────────────────────

export type CladdingKey =
  | 'stucco'
  | 'vinylSiding'
  | 'woodSiding'
  | 'brick'
  | 'stone'
  | 'metalPanel'
  | 'fiberCement'
  | 'exposedBrick'
  | 'concrete'

export type SheathingKey = 'osb' | 'plywood' | 'none'

export const CLADDING_LABELS: Record<CladdingKey, string> = {
  stucco:       'Stucco',
  vinylSiding:  'Vinyl siding',
  woodSiding:   'Wood siding',
  brick:        'Brick veneer',
  stone:        'Stone veneer',
  metalPanel:   'Metal panel',
  fiberCement:  'Fiber cement (HardiePlank)',
  exposedBrick: 'Exposed brick',
  concrete:     'Exposed concrete',
}

/** Nominal cladding assembly thickness (sheathing + WRB + cladding), metres. */
export const CLADDING_ASSEMBLY_DEPTH_M: Record<CladdingKey, number> = {
  stucco:       0.032, // 3-coat stucco ≈ 1-1/4"
  vinylSiding:  0.025, // 1"
  woodSiding:   0.030, // 1-3/16"
  brick:        0.114, // 4.5" brick veneer + airspace
  stone:        0.090, // 3.5" manufactured stone
  metalPanel:   0.022, // 7/8"
  fiberCement:  0.027, // 1-1/16"
  exposedBrick: 0.114,
  concrete:     0.020,
}

/** Sheathing labels. */
export const SHEATHING_LABELS: Record<SheathingKey, string> = {
  osb:     'OSB sheathing (7/16")',
  plywood: 'Plywood sheathing (1/2")',
  none:    'No structural sheathing',
}

// ─── Insulation ──────────────────────────────────────────────────────────────

export type InsulationTypeKey = 'batt' | 'spray-foam' | 'rigid' | 'none'

export const INSULATION_TYPE_LABELS: Record<InsulationTypeKey, string> = {
  'batt':        'Fiberglass batt',
  'spray-foam':  'Closed-cell spray foam',
  'rigid':       'Rigid foam board',
  'none':        'Uninsulated',
}

/** Typical R-value per inch for each type. */
const R_PER_INCH: Record<InsulationTypeKey, number> = {
  'batt':       3.7,
  'spray-foam': 6.5,
  'rigid':      5.0,
  'none':       0,
}

// ─── MEP ─────────────────────────────────────────────────────────────────────

export type HeatingSystemKey =
  | 'forced-air'
  | 'heat-pump'
  | 'boiler'
  | 'radiant'
  | 'mini-split'
  | 'none'

export type CoolingSystemKey = 'central-ac' | 'heat-pump' | 'mini-split' | 'none'
export type PlumbingMaterialKey = 'copper' | 'pex' | 'cpvc' | 'galvanized' | 'cast-iron'

export const HEATING_LABELS: Record<HeatingSystemKey, string> = {
  'forced-air':  'Forced-air gas furnace',
  'heat-pump':   'Heat pump (air-source)',
  'boiler':      'Hot-water boiler',
  'radiant':     'Radiant floor heating',
  'mini-split':  'Ductless mini-split',
  'none':        'No central heating',
}

export const COOLING_LABELS: Record<CoolingSystemKey, string> = {
  'central-ac': 'Central A/C',
  'heat-pump':  'Heat pump (cooling mode)',
  'mini-split': 'Ductless mini-split',
  'none':       'No mechanical cooling',
}

export const PLUMBING_LABELS: Record<PlumbingMaterialKey, string> = {
  'copper':     'Copper (type L)',
  'pex':        'PEX-A cross-linked polyethylene',
  'cpvc':       'CPVC plastic',
  'galvanized': 'Galvanized steel',
  'cast-iron':  'Cast iron (DWV)',
}

// ─── Full spec ────────────────────────────────────────────────────────────────

export interface BuildingSystemsSpec {
  // Exterior envelope
  cladding:              SystemRecommendation<CladdingKey>
  sheathing:             SystemRecommendation<SheathingKey>
  // Insulation
  wallInsulationType:    SystemRecommendation<InsulationTypeKey>
  wallInsulationRValue:  SystemRecommendation<number>
  // MEP
  heatingSystem:         SystemRecommendation<HeatingSystemKey>
  coolingSystem:         SystemRecommendation<CoolingSystemKey>
  plumbingMaterial:      SystemRecommendation<PlumbingMaterialKey>
  electricalPanelAmps:   SystemRecommendation<number>
  // Drywall / finishes
  drywallThicknessIn:    SystemRecommendation<number>
  interiorFinish:        SystemRecommendation<string>
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isResidential(bt: BuildingType): boolean {
  return (
    bt === 'residential-single' ||
    bt === 'residential-multi' ||
    bt === 'townhouse'
  )
}

function isCommercial(bt: BuildingType): boolean {
  return bt === 'commercial' || bt === 'mixed-use' || bt === 'office'
}

function isIndustrial(bt: BuildingType): boolean {
  return bt === 'industrial' || bt === 'warehouse' || bt === 'agricultural'
}

function isMasonryWall(wallRole?: string): boolean {
  return wallRole === 'masonry' || wallRole === 'cmu' || wallRole === 'concrete'
}

function isColdClimate(zone?: ClimateZone): boolean {
  return zone === 'cold' || zone === 'very-cold' || zone === 'subarctic'
}

function isHotClimate(zone?: ClimateZone): boolean {
  return zone === 'hot-humid' || zone === 'hot-dry'
}

// ─── Inference rules ─────────────────────────────────────────────────────────

function inferCladding(input: SystemsInferenceInput): SystemRecommendation<CladdingKey> {
  const { buildingType: bt, wallRole, climateZone } = input

  // Masonry walls → brick or stone veneer is natural finish
  if (isMasonryWall(wallRole)) {
    return { value: 'brick', confidence: 0.88, reason: 'Masonry wall type — brick veneer matches the structural system' }
  }

  // Industrial / agricultural → metal panel is standard
  if (isIndustrial(bt)) {
    return { value: 'metalPanel', confidence: 0.92, reason: 'Industrial/warehouse buildings predominantly use metal panel cladding' }
  }

  // Commercial / office → fiber cement or metal panel
  if (isCommercial(bt)) {
    return { value: 'fiberCement', confidence: 0.80, reason: 'Fiber cement offers low-maintenance, code-compliant exterior for commercial builds' }
  }

  // Residential — vary by climate
  if (isResidential(bt)) {
    if (isColdClimate(climateZone)) {
      return { value: 'fiberCement', confidence: 0.82, reason: 'Cold climate: fiber cement resists freeze-thaw cycles better than vinyl' }
    }
    if (isHotClimate(climateZone)) {
      return { value: 'stucco', confidence: 0.80, reason: 'Hot climate: stucco provides thermal mass and moisture management' }
    }
    // Temperate / unknown: vinyl siding is the most common North American residential choice
    return { value: 'vinylSiding', confidence: 0.78, reason: 'Vinyl siding is the most cost-effective low-maintenance residential cladding' }
  }

  // Fallback
  return { value: 'stucco', confidence: 0.60, reason: 'Default — verify cladding choice against project requirements' }
}

function inferSheathing(input: SystemsInferenceInput): SystemRecommendation<SheathingKey> {
  const { buildingType: bt, wallRole } = input

  if (isMasonryWall(wallRole)) {
    return { value: 'none', confidence: 0.95, reason: 'Masonry walls do not require separate structural sheathing' }
  }
  if (isIndustrial(bt)) {
    return { value: 'none', confidence: 0.85, reason: 'Industrial metal-panel systems typically self-sheath without OSB' }
  }
  // Wood-frame default is OSB; specify plywood for high-wind / seismic zones
  const isTall = (input.buildingHeightStoreys ?? 1) > 2
  if (isTall) {
    return { value: 'plywood', confidence: 0.82, reason: '3+ storeys: plywood sheathing provides better racking strength than OSB' }
  }
  return { value: 'osb', confidence: 0.90, reason: 'OSB 7/16" is the standard structural sheathing for wood-frame construction' }
}

function inferWallInsulationType(input: SystemsInferenceInput): SystemRecommendation<InsulationTypeKey> {
  const { climateZone, buildingType: bt, wallRole } = input

  if (isMasonryWall(wallRole)) {
    return { value: 'rigid', confidence: 0.82, reason: 'Masonry walls: rigid foam continuous insulation on the exterior face avoids thermal bridging' }
  }
  if (isIndustrial(bt)) {
    return { value: 'batt', confidence: 0.75, reason: 'Industrial: fiberglass batt in stud cavities is cost-effective' }
  }
  if (isColdClimate(climateZone)) {
    return { value: 'spray-foam', confidence: 0.82, reason: 'Cold climate: closed-cell spray foam provides the highest R-value and air-sealing in one pass' }
  }
  if (isCommercial(bt)) {
    return { value: 'rigid', confidence: 0.78, reason: 'Commercial: continuous rigid insulation meets ASHRAE 90.1 continuous-insulation requirements' }
  }
  return { value: 'batt', confidence: 0.85, reason: 'Fiberglass batt is the standard, code-compliant choice for wood-stud cavities' }
}

function inferRValue(input: SystemsInferenceInput, type: InsulationTypeKey): SystemRecommendation<number> {
  const { climateZone, wallRole } = input
  // Code-minimum R-values by climate (approximate IRC 2021 Table R402.1.2)
  const rTable: Record<ClimateZone, number> = {
    'hot-humid':   13,
    'hot-dry':     13,
    'mixed-humid': 20,
    'mixed-dry':   20,
    'cold':        21,
    'very-cold':   21,
    'subarctic':   21,
    'marine':      20,
  }
  const baseR = climateZone ? (rTable[climateZone] ?? 13) : 13
  // Masonry continuous insulation target: R-10 to R-15
  const targetR = isMasonryWall(wallRole) ? Math.max(10, Math.min(baseR, 15)) : baseR
  const depth = type !== 'none' ? targetR / R_PER_INCH[type] : 0
  const confidence = climateZone ? 0.88 : 0.70
  const reason = climateZone
    ? `R-${targetR} meets code minimum for ${climateZone} climate zone`
    : `R-${targetR} is a typical code-minimum starting point — confirm with local energy code`
  return { value: Math.max(targetR, Math.round(depth * R_PER_INCH[type])), confidence, reason }
}

function inferHeatingSystem(input: SystemsInferenceInput): SystemRecommendation<HeatingSystemKey> {
  const { buildingType: bt, climateZone } = input

  if (isIndustrial(bt)) {
    return { value: 'forced-air', confidence: 0.80, reason: 'Industrial: rooftop forced-air units are standard for open-span buildings' }
  }
  if (isHotClimate(climateZone)) {
    return { value: 'heat-pump', confidence: 0.84, reason: 'Hot climate: air-source heat pump covers both heating and cooling efficiently' }
  }
  if (isColdClimate(climateZone)) {
    return { value: 'forced-air', confidence: 0.86, reason: 'Cold climate: high-efficiency gas furnace delivers reliable heat at low operating cost' }
  }
  if (isCommercial(bt)) {
    return { value: 'forced-air', confidence: 0.80, reason: 'Commercial: packaged rooftop units with VAV distribution are the industry standard' }
  }
  // Temperate residential
  return { value: 'heat-pump', confidence: 0.78, reason: 'Heat pump provides both heating and cooling — most energy-efficient option in mild climates' }
}

function inferCoolingSystem(input: SystemsInferenceInput, heating: HeatingSystemKey): SystemRecommendation<CoolingSystemKey> {
  const { climateZone } = input

  if (heating === 'heat-pump') {
    return { value: 'heat-pump', confidence: 0.95, reason: 'Heat pump already covers cooling — no separate system needed' }
  }
  if (heating === 'mini-split') {
    return { value: 'mini-split', confidence: 0.95, reason: 'Mini-split system handles both heating and cooling modes' }
  }
  if (isHotClimate(climateZone) || !isColdClimate(climateZone)) {
    return { value: 'central-ac', confidence: 0.82, reason: 'Central A/C paired with the air handler from the furnace system' }
  }
  return { value: 'none', confidence: 0.65, reason: 'Cold climate: evaluate if mechanical cooling is cost-justified for this project' }
}

function inferPlumbingMaterial(input: SystemsInferenceInput): SystemRecommendation<PlumbingMaterialKey> {
  const { buildingType: bt } = input

  if (isIndustrial(bt)) {
    return { value: 'galvanized', confidence: 0.70, reason: 'Industrial: galvanized or carbon-steel for process water; verify with process engineer' }
  }
  if (isCommercial(bt)) {
    return { value: 'copper', confidence: 0.80, reason: 'Commercial: copper type L is the time-tested, code-accepted standard for supply lines' }
  }
  // Residential: PEX has largely replaced copper in new residential construction
  return { value: 'pex', confidence: 0.86, reason: 'PEX-A is freeze-resistant, flexible, and the fastest-growing residential supply material' }
}

function inferElectricalPanel(input: SystemsInferenceInput): SystemRecommendation<number> {
  const { buildingType: bt } = input

  if (isIndustrial(bt)) {
    return { value: 400, confidence: 0.75, reason: 'Industrial: 400A service minimum — confirm with electrical engineer per connected load' }
  }
  if (isCommercial(bt)) {
    return { value: 200, confidence: 0.80, reason: 'Commercial: 200A is typical for small commercial; scale up per load calculation' }
  }
  // Residential: 200A is now the de-facto standard (EV chargers, heat pumps)
  return { value: 200, confidence: 0.88, reason: '200A residential service accommodates EV chargers, heat pumps, and whole-home growth' }
}

function inferDrywallThickness(input: SystemsInferenceInput): SystemRecommendation<number> {
  const { buildingType: bt } = input

  if (isIndustrial(bt)) {
    return { value: 5 / 8, confidence: 0.82, reason: 'Industrial: 5/8" Type X drywall for 1-hour fire rating on steel-stud partitions' }
  }
  if (isCommercial(bt)) {
    return { value: 5 / 8, confidence: 0.80, reason: 'Commercial: 5/8" Type X required by IBC for most occupancy separations' }
  }
  return { value: 1 / 2, confidence: 0.88, reason: '1/2" standard drywall is code-compliant and the default for residential applications' }
}

function inferInteriorFinish(input: SystemsInferenceInput): SystemRecommendation<string> {
  const { buildingType: bt } = input

  if (isIndustrial(bt)) {
    return { value: 'concrete', confidence: 0.80, reason: 'Industrial: sealed or painted concrete walls are the practical standard' }
  }
  if (isCommercial(bt)) {
    return { value: 'plaster', confidence: 0.75, reason: 'Commercial: painted plaster or skim coat over drywall for a clean corporate finish' }
  }
  return { value: 'drywall', confidence: 0.90, reason: 'Standard painted drywall is the universal residential interior finish' }
}

// ─── Main entry point ─────────────────────────────────────────────────────────

/**
 * Infer a complete building-systems spec from context.
 * All outputs are self-consistent (e.g. heat-pump cooling matches heat-pump
 * heating; insulation R-value matches the wall type and climate zone).
 */
export function inferBuildingSystems(input: SystemsInferenceInput): BuildingSystemsSpec {
  const cladding          = inferCladding(input)
  const sheathing         = inferSheathing(input)
  const wallInsulationType  = inferWallInsulationType(input)
  const wallInsulationRValue = inferRValue(input, wallInsulationType.value)
  const heatingSystem     = inferHeatingSystem(input)
  const coolingSystem     = inferCoolingSystem(input, heatingSystem.value)
  const plumbingMaterial  = inferPlumbingMaterial(input)
  const electricalPanelAmps = inferElectricalPanel(input)
  const drywallThicknessIn  = inferDrywallThickness(input)
  const interiorFinish    = inferInteriorFinish(input)

  return {
    cladding,
    sheathing,
    wallInsulationType,
    wallInsulationRValue,
    heatingSystem,
    coolingSystem,
    plumbingMaterial,
    electricalPanelAmps,
    drywallThicknessIn,
    interiorFinish,
  }
}

/**
 * Convenience: run inference and return just the exterior-envelope decisions,
 * for callers that only need to wire up the cladding + sheathing layer.
 */
export function inferExteriorEnvelope(input: SystemsInferenceInput) {
  const spec = inferBuildingSystems(input)
  return { cladding: spec.cladding, sheathing: spec.sheathing }
}

/**
 * Convenience: run inference and return just the insulation decisions.
 */
export function inferInsulation(input: SystemsInferenceInput) {
  const spec = inferBuildingSystems(input)
  return { type: spec.wallInsulationType, rValue: spec.wallInsulationRValue }
}
