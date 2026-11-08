/**
 * WHAT F.U.S.E. SAYS ABOUT A MANUFACTURER'S PART.
 *
 * A part does not fail on its own — it fails in an assembly, in a climate, and
 * usually after something in front of it has already gone. So scoring a part
 * means scoring the assembly it is built into and reading the part's own place
 * in that cascade, which is the same reading the F.U.S.E. panel gives a user.
 *
 * The part is substituted into the layer it occupies; everything else is the
 * assembly as the app would build it. That is the whole trick, and it is why a
 * maker's sheet and the app cannot disagree: the numbers on the sheet are the
 * panel's numbers, computed by the same engine at the same horizon.
 *
 * Two columns, two owners. `rated` on the part is what the maker published.
 * Everything this file returns is the model's opinion, and the sheet says so.
 */

import {
  DEFAULT_DETAILS, HORIZON_YEARS, SITES,
  buildingProfileFor, clamp, detailsFor, runFuse, siteById, specFor,
  type AssemblyState, type BuildShape, type MaterialSpec,
} from '../fuse'
import type { ManufacturerPart } from '../../data/manufacturerParts'

/**
 * The assembly a part is demoed in, unless the caller says otherwise.
 *
 * A drained, vented, ordinary wall and a metal roof over it: the honest middle
 * of what the app draws. The details are F.U.S.E.'s conservative defaults
 * (closed roof space, nothing being repainted), so a reading is not flattered
 * by assuming the maintenance the owner has not promised.
 */
export const DEMO_ASSEMBLY: BuildShape = {
  framingMaterial: 'wood',
  cladding: 'fiber-cement-lap',
  wrb: 'housewrap',
  woodSheathing: 'osb',
  board: 'gypsum-half',
  hasWalls: true,
  hasRoof: true,
  storeys: 2,
  hasPlumbing: true,
  hasElectrical: true,
  roofing: 'metal-standing-seam',
}

export interface PartSiteReading {
  siteId: string
  siteName: string
  /** The part's own layer state at the year on the scrubber, or null. */
  part: AssemblyState | null
  /** First thing to go in this assembly, whatever it is. */
  first: { label: string; year: number } | null
  failedCount: number
  /** Worst first — the order the panel walks. */
  states: AssemblyState[]
}

export interface PartReading {
  part: ManufacturerPart
  year: number
  horizon: number
  /**
   * True when the demo assembly has no layer for this part to occupy — a
   * framing part in an assembly with no frame, say. The sheet must not print a
   * reading that was scored against something else.
   */
  missing: boolean
  sites: PartSiteReading[]
}

export interface ScoreOptions {
  /** Where the scrubber is. Default: the whole horizon, aged. */
  year?: number
  horizon?: number
  assembly?: BuildShape
  /** Default: all six sites — a part is specified somewhere, so show the range. */
  siteIds?: string[]
}

/** The F.U.S.E. material row a part is scored as. */
export function partMaterialSpec(part: ManufacturerPart): MaterialSpec | null {
  return specFor({ id: part.layer.id, material: part.layer.material })
}

export function scorePart(part: ManufacturerPart, opts: ScoreOptions = {}): PartReading {
  const horizon = Math.max(1, Math.round(opts.horizon ?? HORIZON_YEARS))
  const year = clamp(Math.round(opts.year ?? horizon), 0, horizon)
  const shape = opts.assembly ?? DEMO_ASSEMBLY

  const base = buildingProfileFor(shape)
  const missing = !base.layers.some((l) => l.id === part.layer.id)

  // Substitute, don't rebuild: the layers in front of and behind the part are
  // what make the cascade a cascade.
  const profile = {
    ...base,
    layers: base.layers.map((l) =>
      l.id === part.layer.id ? { id: l.id, material: part.layer.material } : l,
    ),
  }
  const details = detailsFor(shape.cladding, {
    atticVentilated: DEFAULT_DETAILS.atticVentilated,
    maintained: DEFAULT_DETAILS.maintained,
  })

  const siteIds = opts.siteIds ?? SITES.map((s) => s.id)
  const sites: PartSiteReading[] = siteIds.map((id) => {
    const site = siteById(id)
    const reading = runFuse(profile, site.env, details, { year, horizon })
    const firstState = reading.states.find((s) => s.failsYear != null) ?? null
    return {
      siteId: site.id,
      siteName: site.name,
      part: missing ? null : reading.states.find((s) => s.id === part.layer.id) ?? null,
      first: firstState && firstState.failsYear != null
        ? { label: firstState.label, year: firstState.failsYear }
        : null,
      failedCount: reading.failedCount,
      states: reading.states,
    }
  })

  return { part, year, horizon, missing, sites }
}
