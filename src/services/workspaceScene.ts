import type { WorkspaceWizardInputs } from '../types'

export interface WorkspaceSceneConfig {
  footprintWidthM: number
  footprintDepthM: number
  wallHeightM: number
  floorCount: number
  foundationType: string
  defaultWallThicknessM: number
  specialFeatures: string[]
  primaryWallMaterial: string
  finishMaterial: string
  hasLoadBearingWalls: boolean
}

export const DEFAULT_WORKSPACE_SCENE_CONFIG: WorkspaceSceneConfig = {
  footprintWidthM: 12,
  footprintDepthM: 8,
  wallHeightM: 3.2,
  floorCount: 1,
  foundationType: 'slab',
  defaultWallThicknessM: 0.2,
  specialFeatures: [],
  primaryWallMaterial: 'Concrete block',
  finishMaterial: 'Painted gypsum',
  hasLoadBearingWalls: false,
}

function parseNumber(text: string, pattern: RegExp): number | null {
  const match = text.match(pattern)
  if (!match) return null
  const value = Number.parseFloat(match[1])
  return Number.isFinite(value) ? value : null
}

function parseDimension(text: string): { widthM: number | null; depthM: number | null } {
  const metric = text.match(/(\d+(?:\.\d+)?)\s*(?:m|meter|metre)s?\s*[x×]\s*(\d+(?:\.\d+)?)\s*(?:m|meter|metre)s?/i)
  if (metric) {
    return {
      widthM: Number.parseFloat(metric[1]),
      depthM: Number.parseFloat(metric[2]),
    }
  }

  const imperial = text.match(/(\d+(?:\.\d+)?)\s*(?:ft|foot|feet)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(?:ft|foot|feet)/i)
  if (imperial) {
    return {
      widthM: Number.parseFloat(imperial[1]) * 0.3048,
      depthM: Number.parseFloat(imperial[2]) * 0.3048,
    }
  }

  return { widthM: null, depthM: null }
}

function parseWallHeight(text: string): number | null {
  const metric = parseNumber(text, /wall\s*height[^\d]*(\d+(?:\.\d+)?)\s*(?:m|meter|metre)/i)
  if (metric) return metric
  const imperial = parseNumber(text, /wall\s*height[^\d]*(\d+(?:\.\d+)?)\s*(?:ft|foot|feet)/i)
  if (imperial) return imperial * 0.3048
  return null
}

function parseFloorCount(text: string): number | null {
  const direct = parseNumber(text, /(\d+)\s*(?:floor|floors|storey|storeys|story|stories)/i)
  if (direct) return Math.max(1, Math.round(direct))
  if (/single\s*story|single\s*storey/i.test(text)) return 1
  if (/two\s*story|two\s*storey/i.test(text)) return 2
  return null
}

function parseFoundationType(text: string): string | null {
  const match = text.match(/foundation[^a-zA-Z]*(slab|crawl\s*space|basement|pier|pile|raft|strip)/i)
  return match?.[1]?.replace(/\s+/g, ' ') ?? null
}

function parseThickness(text: string): number | null {
  const metric = parseNumber(text, /(\d+(?:\.\d+)?)\s*(?:mm|millimet(?:er|re)s?)/i)
  if (metric) return metric / 1000
  const metricM = parseNumber(text, /(\d+(?:\.\d+)?)\s*(?:m|meter|metre)s?\s*(?:thick|thickness)/i)
  if (metricM) return metricM
  const inches = parseNumber(text, /(\d+(?:\.\d+)?)\s*(?:in|inch|inches)/i)
  if (inches) return inches * 0.0254
  return null
}

function parseMaterial(text: string, fallback: string): string {
  const match = text.match(/(concrete|cmu|masonry|brick|steel stud|timber|wood|gypsum|glass|stone|render|tile)/i)
  return match?.[1] ? match[1].replace(/\bcmu\b/i, 'CMU') : fallback
}

function parseSpecialFeatures(text: string): string[] {
  return Array.from(
    new Set(
      ['soffit', 'bulkhead', 'niche', 'reveal', 'core wall', 'mezzanine', 'stair', 'ramp']
        .filter((feature) => new RegExp(feature, 'i').test(text)),
    ),
  )
}

/**
 * A finished residential ceiling is eight foot. Not 3.2 m — that is ten foot
 * six, which is a lobby.
 *
 * The generic default below was written for the commercial shell the wizard was
 * originally aimed at, and every house built since has framed a foot and a half
 * too tall because nobody typed "wall height 2.4m" into a textarea for the
 * regex to find.
 */
const RESIDENTIAL_CEILING_M = 2.44

/** Answers we hold as VALUES rather than scraping back out of prose. */
export interface WorkspaceSceneOverrides {
  /** Stated ceiling height in metres. Beats anything parsed from the text. */
  ceilingM?: number | null
  /** e.g. 'residential-single' — picks the default when nobody has said. */
  buildType?: string | null
}

/** The height to frame at when the drawing and the user have both said nothing. */
function defaultCeilingM(buildType?: string | null): number {
  if (!buildType || buildType.startsWith('residential')) return RESIDENTIAL_CEILING_M
  return DEFAULT_WORKSPACE_SCENE_CONFIG.wallHeightM
}

export function deriveWorkspaceSceneConfig(
  inputs: WorkspaceWizardInputs | null,
  overrides?: WorkspaceSceneOverrides,
): WorkspaceSceneConfig {
  // A stated height is a fact and outranks everything, including having no
  // wizard text at all — which is the common case now that the questions are
  // asked directly rather than typed into a notes field.
  const stated = overrides?.ceilingM ?? null
  if (!inputs) {
    return {
      ...DEFAULT_WORKSPACE_SCENE_CONFIG,
      wallHeightM: stated ?? defaultCeilingM(overrides?.buildType),
    }
  }

  const allText = [
    inputs.set1BuildingBasics,
    inputs.set1Clarifications,
    inputs.set2StructuralDetails,
    inputs.set2Clarifications,
    inputs.set3FinishingDetails,
    inputs.set3Clarifications,
  ].join(' ')

  const dims = parseDimension(`${inputs.set1BuildingBasics} ${inputs.set1Clarifications}`)
  const wallHeightM = stated ?? parseWallHeight(allText) ?? defaultCeilingM(overrides?.buildType)
  const floorCount = parseFloorCount(inputs.set1BuildingBasics) ?? DEFAULT_WORKSPACE_SCENE_CONFIG.floorCount
  const foundationType = parseFoundationType(inputs.set1BuildingBasics) ?? DEFAULT_WORKSPACE_SCENE_CONFIG.foundationType
  const defaultWallThicknessM = parseThickness(inputs.set3FinishingDetails) ?? DEFAULT_WORKSPACE_SCENE_CONFIG.defaultWallThicknessM

  return {
    footprintWidthM: dims.widthM ?? DEFAULT_WORKSPACE_SCENE_CONFIG.footprintWidthM,
    footprintDepthM: dims.depthM ?? DEFAULT_WORKSPACE_SCENE_CONFIG.footprintDepthM,
    wallHeightM,
    floorCount,
    foundationType,
    defaultWallThicknessM,
    specialFeatures: parseSpecialFeatures(allText),
    primaryWallMaterial: parseMaterial(inputs.set2StructuralDetails, DEFAULT_WORKSPACE_SCENE_CONFIG.primaryWallMaterial),
    finishMaterial: parseMaterial(inputs.set3FinishingDetails, DEFAULT_WORKSPACE_SCENE_CONFIG.finishMaterial),
    hasLoadBearingWalls: /load[-\s]?bearing/i.test(inputs.set2StructuralDetails),
  }
}
