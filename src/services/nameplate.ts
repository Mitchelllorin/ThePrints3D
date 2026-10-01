/**
 * NAMEPLATE FIELDS — what a selected member reads out, and in what order.
 *
 * Real equipment carries a data plate, and this is ours. Two rules from the
 * build spec drive the whole file, and both are about the EYE, not the data:
 *
 *   SAME FIELD ORDER EVERY TIME. ThePrints3D reads
 *       member, depth, spacing, span, grade
 *   and it reads that way whether the thing selected is a wall, a joist or a
 *   ceiling. A readout whose fields move around is a readout you have to search
 *   instead of glance at, which is the whole value gone.
 *
 *   UNITS ALWAYS SHOWN. No bare numbers. "16" is not a spacing; 16" is.
 *
 * A field with nothing behind it is returned with `value: null` rather than
 * dropped, so the strip keeps the same shape and the same field stays in the
 * same place — a gap reads as "not applicable here", and the row above it does
 * not jump into its slot.
 *
 * Pure: no THREE, no store, no DOM. The strip renders what this returns.
 */
import { wallFramingSpec } from './constructionCode'
import { formatMeasureMm, type LengthFormat } from './unitConverter'
import type { ActiveUnit } from '../store/useConfigStore'

/** The five slots, in reading order. Never reordered, never omitted. */
export const NAMEPLATE_FIELDS = ['member', 'depth', 'spacing', 'span', 'grade'] as const
export type NameplateFieldKey = (typeof NAMEPLATE_FIELDS)[number]

export interface NameplateField {
  key: NameplateFieldKey
  /** Short label — the strip is compact and never grows into a page. */
  label: string
  /** Already formatted WITH its unit, or null when the field does not apply. */
  value: string | null
}

const LABELS: Record<NameplateFieldKey, string> = {
  member: 'Member',
  depth: 'Depth',
  spacing: 'Spacing',
  span: 'Span',
  grade: 'Grade',
}

/**
 * ACTUAL MILLED DEPTHS, in mm.
 *
 * A 2x8 is 7-1/4", not 7-1/2" — the same rule the framing geometry is built on,
 * and for the same reason: the nameplate is read off the screen and taken to a
 * lumber yard. Rounding a depth "for looks" is how somebody orders wrong.
 */
const STUD_DEPTH_MM: Record<string, number> = {
  '2x4': 88.9,    // 3-1/2"
  '2x6': 139.7,   // 5-1/2"
  '2x8': 184.15,  // 7-1/4"
}

/** Steel web widths as sold, keyed by the nominal name. */
const STEEL_DEPTH_MM: Record<string, number> = {
  '1-5/8': 41.3,
  '3-5/8': 92.1,
  '6': 152.4,
  '8': 203.2,
}

export interface WallNameplateInput {
  framingType?: string
  wallRole?: string
  /** Wall length in metres — the span. */
  lengthM: number
  /** Stud spacing on centre, in mm. */
  spacingMm?: number
  /** Lumber grade stamp, when the project states one. */
  grade?: string
  activeUnit: ActiveUnit
  lengthFormat: LengthFormat
}

/**
 * A wall's data plate.
 *
 * Masonry has no stud and no spacing, so those two come back null rather than
 * inventing a 2x4 nobody is going to build — the CMU wall genuinely has no
 * member on layout, and saying so is more use than filling the slot.
 */
export function wallNameplate(input: WallNameplateInput): NameplateField[] {
  const { framingType, wallRole, lengthM, spacingMm, grade, activeUnit, lengthFormat } = input
  const spec = wallFramingSpec(framingType, wallRole)
  const len = (mm: number) => formatMeasureMm(mm, activeUnit, lengthFormat)

  let member: string | null
  let depthMm: number | undefined
  if (spec.isMasonry) {
    member = 'CMU'
    depthMm = undefined
  } else if (spec.material === 'steel') {
    member = spec.steelWidth ? `${spec.steelWidth}" steel stud` : 'Steel stud'
    depthMm = spec.steelWidth ? STEEL_DEPTH_MM[spec.steelWidth] : undefined
  } else {
    member = spec.studSize.replace('x', '×')
    depthMm = STUD_DEPTH_MM[spec.studSize]
  }

  return [
    { key: 'member', label: LABELS.member, value: member },
    { key: 'depth', label: LABELS.depth, value: depthMm != null ? len(depthMm) : null },
    {
      key: 'spacing',
      label: LABELS.spacing,
      value: spec.isMasonry || spacingMm == null ? null : `${len(spacingMm)} o.c.`,
    },
    { key: 'span', label: LABELS.span, value: len(lengthM * 1000) },
    {
      key: 'grade',
      label: LABELS.grade,
      // Steel is a gauge, not a grade — but it belongs in the grade SLOT,
      // because that slot means "what stock is this" and the eye is already
      // looking there. Same position, right answer for the material.
      value: grade ?? (spec.gauge ? `${spec.gauge} ga` : null),
    },
  ]
}

export interface JoistNameplateInput {
  /** '2x8', '2x10', 'I-joist' … whatever the builder placed. */
  member: string
  depthMm?: number
  spacingMm?: number
  spanM?: number
  grade?: string
  activeUnit: ActiveUnit
  lengthFormat: LengthFormat
}

/**
 * A joist or ceiling member's data plate — the SAME five slots in the same
 * order, so the eye does not have to re-learn the strip when the selection
 * changes from a wall to the floor under it.
 */
export function joistNameplate(input: JoistNameplateInput): NameplateField[] {
  const { member, depthMm, spacingMm, spanM, grade, activeUnit, lengthFormat } = input
  const len = (mm: number) => formatMeasureMm(mm, activeUnit, lengthFormat)
  return [
    { key: 'member', label: LABELS.member, value: member || null },
    { key: 'depth', label: LABELS.depth, value: depthMm != null ? len(depthMm) : null },
    { key: 'spacing', label: LABELS.spacing, value: spacingMm != null ? `${len(spacingMm)} o.c.` : null },
    { key: 'span', label: LABELS.span, value: spanM != null ? len(spanM * 1000) : null },
    { key: 'grade', label: LABELS.grade, value: grade ?? null },
  ]
}

/** Is there anything on this plate worth showing? */
export function nameplateHasContent(fields: readonly NameplateField[]): boolean {
  return fields.some((f) => f.value != null)
}

/** What a wall is called on its plate — the role a framer would say out loud.
 *  No "wall" on the end: the plate is already pointing at one, and the word
 *  cost every plate on screen five characters of model. */
export function wallTitle(wallRole?: string): string {
  switch (wallRole) {
    case 'exterior-bearing': return 'Exterior'
    case 'interior-bearing': return 'Bearing'
    case 'partition': return 'Partition'
    case 'interior-non-bearing': return 'Interior'
    default: return 'Wall'
  }
}

/** The one figure a wall's tier-2 plate carries: its span, with its unit. */
export function wallFigure(fields: readonly NameplateField[]): string | null {
  return fields.find((f) => f.key === 'span')?.value ?? null
}
