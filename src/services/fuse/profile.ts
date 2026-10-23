/**
 * F.U.S.E.'s view of THIS building, and of the site it is standing on.
 *
 * The engine (./building.ts) scores layers. This file decides which layers the
 * model actually has, in the order they are built, from the same settings the
 * rest of the app already reads — the cladding the user picked, the barrier the
 * wall wants, the sheathing the frame material implies, the board behind it,
 * and whether the model has plumbing and wiring traced in it.
 *
 * Nothing here asks a question the model already answers. The rainscreen, for
 * instance, is not a preference — a rainscreen panel and a brick veneer are
 * both detailed with a drained cavity in this app's own material table
 * (CladdingSpec.gapM), so the cavity comes from the cladding choice rather than
 * from the user. What IS asked is what the model genuinely does not know: how
 * the roof space is vented, whether anything is being maintained, and the site
 * itself, which no floor plan can tell you.
 */

import { claddingSpec } from '../constructionCode'
import type { BoardKind, CladdingKind, WoodSheathing, WrbKind } from '../constructionCode'
import type { BuildingProfile, DetailFacts, Layer, LayerId, SiteEnvironment } from './building'

/** The app draws no roof covering, so the covering is the user's answer. */
export type RoofCovering = 'asphalt-shingle' | 'metal-standing-seam' | 'membrane'

export const ROOF_COVERINGS: Array<{ id: RoofCovering; label: string }> = [
  { id: 'asphalt-shingle', label: 'Asphalt shingles' },
  { id: 'metal-standing-seam', label: 'Metal standing seam' },
  { id: 'membrane', label: 'Low-slope membrane' },
]

/** Everything the profile needs, taken straight off the stores. */
export interface BuildShape {
  framingMaterial: 'wood' | 'steel'
  cladding: CladdingKind
  wrb: WrbKind
  woodSheathing: WoodSheathing
  board: BoardKind
  /** A wall has been drawn or built — without one there is nothing to score. */
  hasWalls: boolean
  /** A roof has been pulled. */
  hasRoof: boolean
  storeys: number
  hasPlumbing: boolean
  hasElectrical: boolean
  roofing: RoofCovering
}

/**
 * THE ENVELOPE, OUTERMOST FIRST.
 *
 * Order is not cosmetic — it is the cascade. Water arrives at the cladding, and
 * whatever gets past it arrives at the wrap, and then at the sheathing, and the
 * score of each is computed with the failures in front of it already counted.
 * Rebuilding this list in a different order is how you would accidentally claim
 * a wall rots before its siding falls off.
 */
export function buildingProfileFor(shape: BuildShape): BuildingProfile {
  const layers: Layer[] = []
  const push = (id: LayerId, material: string) => layers.push({ id, material })

  // A dried-in wall simply has no cladding layer — not a 'none' material. It is
  // still a wall, and the layers behind it score wetter for the absence.
  if (shape.cladding !== 'none') push('cladding', shape.cladding)
  push('wrb', shape.wrb)
  // Steel gets glass-mat: the app already refuses to put plywood on a steel
  // frame (see constructionCode.sheathingFor), so F.U.S.E. must not either.
  push('sheathing', shape.framingMaterial === 'steel' ? 'glassmat' : shape.woodSheathing)
  push('framing', shape.framingMaterial)
  push('board', shape.board)

  if (shape.hasRoof) {
    push('roofing', shape.roofing)
    push('roofDeck', shape.framingMaterial === 'steel' ? 'glassmat' : shape.woodSheathing)
  }

  // Services are scored only when the model actually has them, and they sit
  // inside the envelope — a wet wall is what corrodes the box and bursts the
  // pipe.
  if (shape.hasPlumbing) push('plumbing', 'piping')
  if (shape.hasElectrical) push('electrical', 'wiring')

  return {
    layers,
    steelFramed: shape.framingMaterial === 'steel',
    storeys: Math.max(1, shape.storeys),
    hasPlumbing: shape.hasPlumbing,
    hasElectrical: shape.hasElectrical,
  }
}

/** True when the cladding is detailed with a drained cavity behind it. */
export function claddingIsDrained(cladding: CladdingKind): boolean {
  const spec = claddingSpec(cladding)
  return spec != null && spec.gapM > 0
}

/**
 * The site, normalised so 1.0 is the benign temperate climate every nominal
 * life is quoted at. The blurbs are the trade's own shorthand for what each one
 * does to a building, because "uv 1.35" means nothing to anybody.
 */
export interface ClimateScenario {
  id: string
  name: string
  blurb: string
  env: SiteEnvironment
}

export const SITES: ClimateScenario[] = [
  {
    id: 'temperate',
    name: 'Temperate',
    blurb: 'Four real seasons, no extreme. What a product data sheet assumes.',
    env: { uv: 1, wet: 1, freezeThaw: 1, coastal: false, indoorRh: 0.4 },
  },
  {
    id: 'coast',
    name: 'Wet coast',
    blurb: 'Driven rain, salt air, mild winters. Rot and corrosion, together.',
    env: { uv: 0.9, wet: 1.4, freezeThaw: 0.7, coastal: true, indoorRh: 0.55 },
  },
  {
    id: 'gulf',
    name: 'Hot and humid',
    blurb: 'Sun and moisture both working on the wall. The worst case for a wall.',
    env: { uv: 1.25, wet: 1.35, freezeThaw: 0.5, coastal: true, indoorRh: 0.65 },
  },
  {
    id: 'desert',
    name: 'High desert',
    blurb: 'Burning sun, almost no rain. Nothing rots; everything goes brittle.',
    env: { uv: 1.35, wet: 0.55, freezeThaw: 1.15, coastal: false, indoorRh: 0.3 },
  },
  {
    id: 'continental',
    name: 'Continental',
    blurb: 'Hard freeze–thaw cycles. Masonry and coatings pay for it.',
    env: { uv: 1.1, wet: 1, freezeThaw: 1.4, coastal: false, indoorRh: 0.35 },
  },
  {
    id: 'sheltered',
    name: 'Sheltered lot',
    blurb: 'Shade and trees, little driving rain. The best case a wall gets.',
    env: { uv: 0.75, wet: 0.85, freezeThaw: 0.9, coastal: false, indoorRh: 0.45 },
  },
]

export const DEFAULT_SITE_ID = 'temperate'

export function siteById(id: string): ClimateScenario {
  return SITES.find((s) => s.id === id) ?? SITES[0]
}

/** What the model cannot know, with defaults that do not flatter the building. */
export const DEFAULT_DETAILS: Omit<DetailFacts, 'rainscreen'> = {
  /** A closed, unvented roof space is the assumption — the conservative one,
   *  because a roof that does not vent cooks its own shingles. */
  atticVentilated: false,
  /** Nothing is being repainted until somebody says so. */
  maintained: false,
}

/** The answered facts, with the cavity taken from the cladding itself. */
export function detailsFor(
  cladding: CladdingKind,
  answered: Omit<DetailFacts, 'rainscreen'>,
): DetailFacts {
  return { rainscreen: claddingIsDrained(cladding), ...answered }
}
