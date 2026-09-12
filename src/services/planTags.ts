import type { RasterTextToken } from './pdfRasterizer'

/**
 * THE DRAWING LABELS ITSELF — READ THE LABEL INSTEAD OF GUESSING THE GEOMETRY.
 *
 * Mitchell, on his own panel shop drawings: *"there's labels on every item on
 * that floorplan and as long as someone or something had the legend or a
 * dataset full of legends it could check against — he would know what
 * everything was."*
 *
 * Every panel, unit and assembly on a real shop drawing carries a tag:
 * `EXT-101.3`, `H&P-505.3`, `UNIT C3 305`, `SW2`, `HDU5`. Decode the tag and
 * you know what the thing IS without reading a single pixel of geometry — and
 * that is evidence the wall detector cannot produce at any threshold.
 *
 * TAGS ARE DECODED BY SHAPE, NOT BY MEMORISING ONE JOB'S CODES. A tag is a
 * prefix, a number, and often a floor or revision suffix. What a prefix MEANS
 * is data (see LEGEND below), so a new shop's scheme is an entry somebody adds,
 * never a code change. An unknown prefix is still reported — with its shape
 * read and its meaning left null — because "there is a tagged thing here" is
 * useful on its own, and silently dropping it is how a detector goes quiet.
 */

export type TagKind =
  | 'panel'        // a prefabricated wall panel: EXT-101.3, INT-204.1
  | 'unit'         // a dwelling unit: UNIT C3 305
  | 'shear'        // a shear wall schedule mark: SW1, SW2
  | 'holdown'      // a holdown mark: HDU5, HDU8, ATS
  | 'opening'      // door/window schedule mark: D-01, W-11
  | 'detail'       // a detail/section callout: A-3, 5/A501
  | 'unknown'      // shaped like a tag, prefix not in the legend

export interface LegendEntry {
  /** Prefix as it appears on the sheet, upper-cased. */
  prefix: string
  kind: TagKind
  /** What a tradesperson would call it. */
  label: string
  /** Where the scheme comes from — a shop, a standard, or the app's defaults. */
  source?: string
}

/**
 * The shipped legend. Deliberately small and boring: these are the prefixes
 * that repeat across jobs. A shop's own scheme gets appended by the caller, so
 * one contractor's `H&P` (hall and party) never becomes everyone's.
 */
export const LEGEND: LegendEntry[] = [
  { prefix: 'EXT', kind: 'panel', label: 'Exterior wall panel' },
  { prefix: 'INT', kind: 'panel', label: 'Interior wall panel' },
  { prefix: 'DEM', kind: 'panel', label: 'Demising wall panel' },
  { prefix: 'P', kind: 'panel', label: 'Wall panel' },
  { prefix: 'UNIT', kind: 'unit', label: 'Dwelling unit' },
  { prefix: 'SW', kind: 'shear', label: 'Shear wall' },
  { prefix: 'HDU', kind: 'holdown', label: 'Holdown' },
  { prefix: 'HD', kind: 'holdown', label: 'Holdown' },
  { prefix: 'ATS', kind: 'holdown', label: 'Continuous rod tiedown' },
  { prefix: 'D', kind: 'opening', label: 'Door' },
  { prefix: 'W', kind: 'opening', label: 'Window' },
]

export interface PlanTag {
  /** The token's text, trimmed. */
  raw: string
  /** Prefix as matched, upper-cased. */
  prefix: string
  /** The number carried by the tag, when it has one. */
  number: string | null
  /** Trailing floor / revision suffix — the `.3` in EXT-101.3. */
  suffix: string | null
  kind: TagKind
  /** Legend meaning, or null when the prefix is not in the legend. */
  label: string | null
  /** Where the tag sits on the raster. */
  x: number
  y: number
  confidence: number
}

/**
 * `EXT-101.3` → prefix EXT, number 101, suffix 3.
 * `H&P-505.3` → prefix H&P (ampersands are part of shop prefixes).
 * `SW2` → prefix SW, number 2, no separator.
 * `UNIT C3 305` is handled separately: its "number" is two words.
 */
const TAG_RE = /^([A-Z][A-Z&/]{0,5})[-\s]?(\d{1,4})(?:[.-](\d{1,3}))?$/
const UNIT_RE = /^UNIT\s+([A-Z]?\d{0,2}[A-Z]?)\s*(\d{2,4})?$/

function legendFor(prefix: string, legend: LegendEntry[]): LegendEntry | null {
  // Longest prefix wins, so HDU beats HD and never resolves to "Door".
  let best: LegendEntry | null = null
  for (const e of legend) {
    if (e.prefix !== prefix) continue
    if (!best || e.prefix.length > best.prefix.length) best = e
  }
  return best
}

/** Read one piece of text as a tag, or null if it is not shaped like one. */
export function parseTag(text: string, legend: LegendEntry[] = LEGEND): Omit<PlanTag, 'x' | 'y' | 'confidence'> | null {
  const raw = (text ?? '').trim()
  if (!raw) return null
  const upper = raw.toUpperCase()

  const unit = UNIT_RE.exec(upper)
  if (unit) {
    return {
      raw, prefix: 'UNIT',
      number: [unit[1], unit[2]].filter(Boolean).join(' ') || null,
      suffix: null, kind: 'unit',
      label: legendFor('UNIT', legend)?.label ?? null,
    }
  }

  const m = TAG_RE.exec(upper)
  if (!m) return null
  const [, prefix, number, suffix] = m
  const entry = legendFor(prefix, legend)
  return {
    raw,
    prefix,
    number: number ?? null,
    suffix: suffix ?? null,
    kind: entry?.kind ?? 'unknown',
    label: entry?.label ?? null,
  }
}

/**
 * Every tag on the sheet, with where it sits.
 *
 * Unknown prefixes are KEPT (kind `unknown`, label null). A tagged thing whose
 * scheme we do not hold is still a tagged thing, and the point of the legend is
 * that the gap is fillable by adding data rather than by reading pixels harder.
 */
export function readPlanTags(
  tokens: readonly RasterTextToken[],
  legend: LegendEntry[] = LEGEND,
): PlanTag[] {
  const out: PlanTag[] = []
  for (const t of tokens) {
    const parsed = parseTag(t.text, legend)
    if (!parsed) continue
    out.push({ ...parsed, x: t.x, y: t.y, confidence: t.confidence })
  }
  return out
}

/** What the sheet told us, counted by kind — a quick read on tag coverage. */
export function tagSummary(tags: readonly PlanTag[]): Record<TagKind, number> {
  const out = { panel: 0, unit: 0, shear: 0, holdown: 0, opening: 0, detail: 0, unknown: 0 }
  for (const t of tags) out[t.kind]++
  return out
}
