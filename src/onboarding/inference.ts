/**
 * Wizard inference — derive ProjectMeta from the uploaded drawings without
 * asking the user anything. The result feeds Step 2 (confirm) and powers
 * the smart-skip toast when confidence ≥ 0.9.
 */
import type { Drawing } from '../types'
import { inferDiscipline } from '../services/sheetDiscipline'
import { inferFloorNumber } from '../services/sheetParser'
import type {
  BuildingType, DrywallConfig, FramingMaterial, UnitSystem, WizardInference,
} from './types'

function looksMetric(notation: string | null | undefined): boolean {
  if (!notation) return false
  if (/\d+\s*[/\\]\s*\d+\s*"/.test(notation)) return false
  return /1\s*:\s*\d+/.test(notation)
}

function looksImperial(notation: string | null | undefined): boolean {
  if (!notation) return false
  return /["']/.test(notation) || /=\s*\d/.test(notation)
}

function guessBuildingType(floorCount: number | null, sheetCount: number): BuildingType {
  if (floorCount && floorCount >= 4) return 'residential-multi'
  if (sheetCount >= 15) return 'commercial'
  return 'residential-single'
}

function guessFraming(buildingType: BuildingType): FramingMaterial {
  if (buildingType === 'commercial' || buildingType === 'industrial' || buildingType === 'institutional') {
    return 'steel'
  }
  if (buildingType === 'residential-multi') return 'mixed'
  return 'wood'
}

function guessDrywall(buildingType: BuildingType): DrywallConfig {
  if (buildingType === 'residential-multi' || buildingType === 'commercial') return 'double-layer'
  return 'single-layer'
}

function guessFloorHeight(buildingType: BuildingType): number {
  switch (buildingType) {
    case 'commercial':
    case 'industrial':
    case 'institutional':
      return 3.2
    default:
      return 2.7
  }
}

export function inferProjectMeta(drawings: Drawing[]): WizardInference {
  let architectural = 0
  let structural = 0
  let skipped = 0
  let metricVotes = 0
  let imperialVotes = 0
  const floors = new Set<number>()

  for (const d of drawings) {
    const disc = inferDiscipline(d.name)
    if (disc === 'architectural') architectural++
    else if (disc === 'structural') structural++
    else if (disc !== 'unknown' && disc !== 'interiors') skipped++

    if (looksMetric(d.scaleNotation)) metricVotes++
    if (looksImperial(d.scaleNotation)) imperialVotes++

    const f = inferFloorNumber(d.name)
    if (f !== null && f >= 0 && f <= 50) floors.add(f)
  }

  const unitSystem: UnitSystem =
    metricVotes && imperialVotes ? 'mixed'
    : imperialVotes              ? 'imperial'
    : metricVotes                ? 'metric'
    : 'metric'

  const floorCount = floors.size > 0 ? floors.size : null
  const buildingType = guessBuildingType(floorCount, drawings.length)
  const framing = guessFraming(buildingType)
  const drywall = guessDrywall(buildingType)
  const floorHeightM = guessFloorHeight(buildingType)

  const haveScale = drawings.some((d) => d.scaleNotation || d.scaleMmPerPx)
  const haveDiscipline = architectural + structural > 0
  const haveFloors = floorCount !== null
  const confidence = Math.min(
    1,
    (Number(haveScale) * 0.4) + (Number(haveDiscipline) * 0.3) + (Number(haveFloors) * 0.3),
  )

  const reasons: string[] = []
  if (haveScale && metricVotes >= imperialVotes) {
    reasons.push(`Scale notation looks metric (1:N ratio)`)
  } else if (haveScale && imperialVotes > 0) {
    reasons.push(`Scale notation looks imperial (1/n" = 1'-0")`)
  }
  if (haveFloors) {
    reasons.push(`Sheet numbers suggest ${floorCount} floor${floorCount === 1 ? '' : 's'}`)
  }
  if (architectural > 0) {
    reasons.push(`${architectural} architectural sheet${architectural === 1 ? '' : 's'} found`)
  }
  if (skipped > 0) {
    reasons.push(`${skipped} M/E/P sheet${skipped === 1 ? '' : 's'} — wall detection skipped`)
  }
  if (buildingType === 'residential-multi') {
    reasons.push(`Looks multi-unit — defaulting demising walls to double-layer drywall`)
  }

  return {
    detected: { buildingType, unitSystem, floorCount, floorHeightM, framing, drywall },
    confidence,
    reasons,
    sheetSummary: { total: drawings.length, architectural, structural, skipped },
  }
}
