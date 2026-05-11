/**
 * Canonical symbol/entity glossary types.
 *
 * Used by the detection pipeline to know what symbols exist on a print and
 * how to represent them in 3D. The data itself lives in `glossary.json` and
 * is grown over time (eventually with community-contributed variants).
 */

export type SymbolCategory =
  | 'wall'           // building structure (load-bearing, partition, etc.)
  | 'opening'        // doors, windows, arches
  | 'electrical'     // outlets, switches, fixtures, panels, smoke detectors
  | 'plumbing'       // supplies, drains, fixtures
  | 'hvac'           // registers, returns, equipment
  | 'dimension'      // dimension lines, leaders, elevations
  | 'annotation'     // tags, callouts, section bubbles
  | 'overhead'       // dotted-line entities above (soffits, beams, coves)
  | 'section_marker' // cut lines, view direction arrows
  | 'material_hatch' // concrete, brick, CMU, wood stud, gypsum, insulation
  | 'fixture'        // sinks, toilets, tubs, appliances, furniture

/** How a line on the print is rendered visually — drives classification. */
export type LineStrokeStyle =
  | 'solid_thick'    // typical wall edge
  | 'solid_thin'     // dimension, leader, light fixture outline
  | 'dashed'         // hidden / above / grid
  | 'dotted'         // overhead / underground / phantom
  | 'dash_dot'       // centerline / property line
  | 'double_solid'   // wall with cavity, paired edges

/** A canonical glossary entry. */
export interface SymbolEntry {
  id: string
  category: SymbolCategory
  /** Human-readable names + common aliases / abbreviations. */
  common_names: string[]
  /** Short description of what the symbol represents in real life. */
  represents: string
  /** Typical visual fingerprint (used by template matcher). */
  appearance?: {
    shape?: 'circle' | 'triangle' | 'square' | 'hexagon' | 'arrow' | 'line' | 'polyline' | 'custom'
    stroke_style?: LineStrokeStyle
    has_text?: boolean
    relative_size?: 'tiny' | 'small' | 'medium' | 'large'
  }
  /** Path to a sample SVG/PNG for ML training and side-by-side preview. */
  sample_assets?: string[]
  /** Path to the 3D model used to render this entity. */
  render_3d?: string
  /** Default mounting height above floor, in inches (where applicable). */
  default_height_in?: number
  /** Standards this symbol references (AIA, NCS, IEC 60617, ISO 7000, etc.). */
  standards?: string[]
}

/** Result of classifying a single line segment against the glossary. */
export type LineClass =
  | 'wall'        // solid + thick, qualifies as building structure
  | 'dimension'   // thin solid, often paired with tick marks
  | 'dashed'      // grid / hidden object / above-but-not-floating
  | 'dotted'      // overhead / underground / phantom
  | 'leader'      // very short, points at a label
  | 'unknown'

export interface ClassifiedLine {
  x1: number
  y1: number
  x2: number
  y2: number
  thickness: number
  classification: LineClass
  /** 0–1 confidence. */
  confidence: number
  /** Number of dark→light transitions sampled along the line (debug). */
  transitions: number
  /** Fraction of samples that were "dark" / on the line (debug). */
  dark_ratio: number
}

/** Aggregate stats returned alongside the detection. */
export interface LineClassificationStats {
  total: number
  wall: number
  dimension: number
  dashed: number
  dotted: number
  leader: number
  unknown: number
}
