/**
 * Decision schema & helpers
 * -------------------------
 * The unifying abstraction that lets one construction engine serve both
 * "Build for me" (auto) and Wizard (guided) modes.
 *
 * Every inference the engine makes is emitted as a Decision — auto-mode
 * takes the default silently; the Wizard surfaces the question to the user.
 */

// ─── Construction layers in dependency order ────────────────────────────────

export type ConstructionLayer =
  | 'excavation'
  | 'foundation'
  | 'framing'
  | 'electrical'
  | 'plumbing'
  | 'hvac'
  | 'insulation'
  | 'drywall'
  | 'finishes'

/** Canonical build order — index gives the sort rank. */
export const LAYER_ORDER: readonly ConstructionLayer[] = [
  'excavation',
  'foundation',
  'framing',
  'electrical',
  'plumbing',
  'hvac',
  'insulation',
  'drywall',
  'finishes',
] as const

// ─── Decision types ─────────────────────────────────────────────────────────

export interface DecisionOption<T> {
  value: T
  label: string
}

export interface Decision<T = unknown> {
  /** Dot-separated path, e.g. 'framing.studSpacing' */
  id: string
  layer: ConstructionLayer
  /** Human-readable question surfaced by the Wizard */
  question: string
  /** The value auto-mode takes */
  default: T
  /** Starts as `default`; updated when the user overrides */
  chosen: T
  options: DecisionOption<T>[]
  /** 0..1 — drives smart-skip in Wizard mode */
  confidence: number
  /** Decision ids that must be answered first */
  dependsOn: string[]
}

// ─── Placed geometry ────────────────────────────────────────────────────────

export type FramingComponentType =
  | 'stud'
  | 'top-plate'
  | 'bottom-plate'
  | 'king-stud'
  | 'jack-stud'
  | 'header'
  | 'cripple-stud'
  | 'corner-assembly'

export interface PlacedComponent {
  id: string
  /** Which wall (by index) this component belongs to */
  wallIndex: number
  layer: ConstructionLayer
  componentType: FramingComponentType
  /** World-space position [x, y, z] in metres */
  position: [number, number, number]
  /** Euler rotation [rx, ry, rz] in radians */
  rotation: [number, number, number]
  /** Dimensions [width, height, depth] in metres */
  dimensions: [number, number, number]
  /** Human-readable label for UI/tooltips */
  label: string
  /** Framing material. Defaults to wood when absent. */
  material?: 'wood' | 'steel'
  /** Render profile: solid rectangle (wood), steel C-stud, or steel track. */
  profile?: 'rect' | 'c-stud' | 'track'
  /** Steel gauge (e.g. '25', '18') for labels/BOM. */
  gauge?: string
}

// ─── Build result ───────────────────────────────────────────────────────────

export interface BuildResult {
  components: PlacedComponent[]
  decisions: Decision[]
  suggestions: string[]
  /** The exact reference frame the engine placed components in: the wall
   *  centroid (image-pixel space) and the scale used. Consumers re-map the
   *  framing into world/overlay space with these — never recompute the
   *  centroid, or it drifts as walls are added. */
  frameOriginPx?: [number, number]
  frameScaleMmPerPx?: number
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Topologically sort decisions by their `dependsOn` graph.
 * Decisions with unresolved deps are pushed to the end.
 */
export function orderDecisions(decisions: readonly Decision[]): Decision[] {
  const byId = new Map(decisions.map((d) => [d.id, d]))
  const sorted: Decision[] = []
  const visited = new Set<string>()

  function visit(d: Decision) {
    if (visited.has(d.id)) return
    visited.add(d.id)
    for (const depId of d.dependsOn) {
      const dep = byId.get(depId)
      if (dep) visit(dep)
    }
    sorted.push(d)
  }

  // Primary sort by layer order, then topo-sort within
  const layerRank = (d: Decision) => LAYER_ORDER.indexOf(d.layer)
  const byLayer = [...decisions].sort((a, b) => layerRank(a) - layerRank(b))
  for (const d of byLayer) visit(d)

  return sorted
}

/**
 * Returns true if a decision should be smart-skipped in Wizard mode.
 * Threshold defaults to 0.9 (matching the existing onboarding mechanic).
 */
export function shouldSmartSkip(
  decision: Decision,
  threshold = 0.9,
): boolean {
  return decision.confidence >= threshold
}
