/**
 * F.U.S.E.™ — Failure Understanding Simulation Engine · ThePrints3D.
 *
 * The public surface is deliberately small, the way the rest of the line keeps
 * it: ask it for a reading, read the structures, read the cascade.
 *
 *   engine.ts             grading — levels, derating, stress factors. Domain-free.
 *   building.ts           the physiology: what each material is, when it goes,
 *                         and the order the failures arrive in.
 *   profile.ts            THIS building, from the model's own settings, and the
 *                         site it is standing on.
 *   focus.ts              where to point the camera at a verdict.
 *
 * The one call the panel makes is `readBuilding`: give it the shape off the
 * stores, the answered facts and the year on the scrubber, and it returns the
 * whole reading at that year.
 *
 * WHAT IT IS FOR. A build review tells you what is wrong with the drawing
 * today. F.U.S.E. tells you what the drawing is going to cost you, and in what
 * order — which is a different question and the one that decides what you spend
 * money on first. It reports the year a layer goes, what takes it, and what is
 * physically happening inside it while it does.
 *
 * WHAT IT IS NOT. A warranty, a code ruling, or a substitute for the local
 * trade. The panel says so on its face, because a number with a year attached
 * is exactly the sort of thing people repeat to a supplier as though it were a
 * guarantee.
 *
 * F.U.S.E.™ is the same engine that scores failure risk in CircuiTry3D,
 * AutoMotive3D, AnyPlanet3D, TheCell3D and TheOcean3D, with a domain file per
 * app rather than a fork of the engine.
 */

export {
  RISK_COLOR, RISK_LABEL, RISK_LEVELS, clamp, clamp01, derate, exposureWord,
  reserveToLevel, severityRank, stressFactor,
  type RiskLevel,
} from './engine'

export {
  HORIZON_YEARS, MATERIALS, runFuse, sortStates, specFor,
  type AssemblyLook, type AssemblyState, type BuildingProfile, type DetailFacts,
  type FuseReading, type HiddenLayer, type Layer, type LayerId, type MaterialSpec,
  type SiteEnvironment,
} from './building'

export {
  DEFAULT_DETAILS, DEFAULT_SITE_ID, ROOF_COVERINGS, SITES, buildingProfileFor,
  claddingIsDrained, detailsFor, siteById,
  type BuildShape, type ClimateScenario, type RoofCovering,
} from './profile'

export { cameraForAssembly, uncoverFor, type AssemblyShotOptions, type Uncover } from './focus'

import { runFuse, type FuseReading } from './building'
import { buildingProfileFor, detailsFor, siteById, type BuildShape } from './profile'

/** Everything the panel needs to build a reading, in one shape. */
export interface FuseInput {
  shape: BuildShape
  /** Site id from profile.SITES. */
  siteId: string
  /** The answered facts — roof venting and whether anything is maintained. */
  answered: { atticVentilated: boolean; maintained: boolean }
  /** The year on the scrubber. */
  year: number
}

/** The reading, at the year on the scrubber. */
export function readBuilding(input: FuseInput): FuseReading {
  const site = siteById(input.siteId)
  return runFuse(
    buildingProfileFor(input.shape),
    site.env,
    detailsFor(input.shape.cladding, input.answered),
    { year: input.year },
  )
}
