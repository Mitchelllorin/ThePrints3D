/**
 * WHAT DOES THIS SHEET SAY IT IS?
 *
 * The sheet picker next door scores PIXELS — it looks for the wall signature,
 * long thin axis-aligned line pairs, and ranks the pages by it. It was written
 * against a scanned set with no text layer at all, and its own header says
 * picking by name does not work. That was true of that set and it is not true
 * in general: LA County's ADU standard plan hands over 3,672 characters on the
 * floor plan page, and page 2 says FLOOR PLAN three times while page 3 says
 * ELECTRICAL and UTILITY, pages 4 and 5 say ELEVATION, page 8 FOUNDATION and
 * page 9 FRAMING. We were picking page 3.
 *
 * NEITHER SIGNAL IS ENOUGH ON ITS OWN, and the corpus shows both failures:
 *
 *   words without pixels   Portland's permit booklet says FLOOR PLAN five times
 *                          on page 4, which is PROSE ABOUT floor plans with no
 *                          drawing on it anywhere. The words are perfect and
 *                          there is nothing to build.
 *   pixels without words   a scanned set has no text at all, which is the case
 *                          the pixel scorer exists for and must keep handling.
 *
 * So this module answers only the naming question and hands back a WEIGHT. The
 * pixel score stays the base — a page still has to have a plan drawn on it —
 * and the words move it up or down. A sheet with no text comes back neutral and
 * the picker behaves exactly as it did before.
 *
 * THE INDEX TRAP. The most floor-plan-sounding page in a set is often the
 * index: LA County's page 1 names PLOT PLAN, SITE PLAN, FLOOR PLAN, ELECTRICAL,
 * ELEVATION, ROOF PLAN, SECTION, FOUNDATION and FRAMING, because listing every
 * sheet is its job. What gives it away is exactly that — a real sheet talks
 * about ITSELF, an index talks about all of them.
 */

/** What a sheet claims to be. Only `floor-plan` is something we build from. */
export type SheetKind =
  | 'floor-plan'
  | 'site-plan'
  | 'elevation'
  | 'section'
  | 'foundation'
  | 'roof'
  | 'framing'
  | 'services'
  | 'index'
  | 'unknown'

export interface SheetTitleRead {
  kind: SheetKind
  /**
   * Multiply the pixel score by this. 1 means "the words said nothing useful",
   * which is the honest answer for a sheet with no text layer.
   */
  weight: number
  /** How many DIFFERENT kinds of sheet this page names — an index names many. */
  distinctKinds: number
  /** The matches behind the call, so a wrong pick can be explained. */
  hits: Partial<Record<SheetKind, number>>
}

/**
 * The phrases that name a sheet, per kind.
 *
 * Phrases, not bare words, wherever a bare word would be ambiguous. Every floor
 * plan in the corpus mentions FOUNDATION somewhere in its notes, so FOUNDATION
 * alone cannot mean "this is the foundation sheet" — FOUNDATION PLAN can. The
 * same goes for a wall SECTION reference on a plan.
 */
const PATTERNS: Array<{ kind: SheetKind; re: RegExp }> = [
  // 'PLAN VIEW' is the Ukiah set's title for its floor plan, and 'DIMENSION
  // PLAN' and 'KEY PLAN' are the same drawing under other offices' names.
  { kind: 'floor-plan', re: /\b(?:FLOOR PLAN|PLAN VIEW|DIMENSION(?:ED)? PLAN|LEVEL \d+ PLAN)\b/g },
  { kind: 'site-plan', re: /\b(?:SITE PLAN|PLOT PLAN|SURVEY)\b/g },
  { kind: 'elevation', re: /\bELEVATIONS?\b/g },
  { kind: 'section', re: /\b(?:CROSS ?SECTIONS?|BUILDING SECTIONS?|SECTION DRAWINGS?)\b/g },
  { kind: 'foundation', re: /\b(?:FOUNDATION PLAN|FOOTING PLAN|SLAB PLAN)\b/g },
  { kind: 'roof', re: /\bROOF PLAN\b/g },
  { kind: 'framing', re: /\b(?:FRAMING PLAN|ROOF FRAMING|FLOOR FRAMING|SHEAR WALL)\b/g },
  // One bucket for the trades: an electrical or plumbing sheet is a floor plan
  // with services drawn over it, which is exactly why it beat the real plan.
  { kind: 'services', re: /\b(?:ELECTRICAL|UTILITY PLAN|PLUMBING|MECHANICAL|LIGHTING) ?(?:PLAN)?\b/g },
  { kind: 'index', re: /\b(?:INDEX OF DRAWINGS|SHEET INDEX|DRAWING INDEX|TITLE SHEET|COVER SHEET)\b/g },
]

/**
 * Naming this many different kinds means the page is a list of sheets, not one
 * of them. Four is comfortably above what a real plan mentions in its notes and
 * below the nine that LA County's index page manages.
 */
const INDEX_DISTINCT_KINDS = 5

/**
 * Read the sheet's own words.
 *
 * `text` is everything on the page — the text layer for a vector PDF, OCR for a
 * raster. Case and whitespace are normalised here so callers can pass either.
 */
export function readSheetTitle(text: string): SheetTitleRead {
  const t = (text || '').toUpperCase().replace(/\s+/g, ' ')
  if (t.trim().length === 0) {
    return { kind: 'unknown', weight: 1, distinctKinds: 0, hits: {} }
  }

  const hits: Partial<Record<SheetKind, number>> = {}
  for (const { kind, re } of PATTERNS) {
    const n = (t.match(re) ?? []).length
    if (n > 0) hits[kind] = (hits[kind] ?? 0) + n
  }

  const distinctKinds = Object.keys(hits).length
  const plan = hits['floor-plan'] ?? 0
  // The loudest thing on the page that is NOT a floor plan.
  let rival: SheetKind = 'unknown'
  let rivalHits = 0
  for (const [kind, n] of Object.entries(hits) as Array<[SheetKind, number]>) {
    if (kind !== 'floor-plan' && n > rivalHits) { rivalHits = n; rival = kind }
  }

  // An index first: it will also be shouting FLOOR PLAN, and it is not one.
  if (hits.index || distinctKinds >= INDEX_DISTINCT_KINDS) {
    return { kind: 'index', weight: 0.25, distinctKinds, hits }
  }

  if (plan > 0 && plan >= rivalHits) {
    /**
     * Weighted, not decided. A sheet saying it is the floor plan gets a strong
     * push, but the pixel score still has to agree that something is drawn on
     * it — which is the whole Portland page 4 lesson, where the words are
     * perfect and the page is paragraphs.
     */
    return { kind: 'floor-plan', weight: plan >= 2 ? 3 : 2, distinctKinds, hits }
  }

  if (rivalHits > 0) {
    /**
     * Damped, never zeroed. If the only sheet in the whole set is an elevation,
     * the app should still do its best with it rather than hand back nothing —
     * a bad answer the user can see and correct beats a blank screen. Refusing
     * outright is a decision for the caller, which can see the whole set.
     */
    return { kind: rival, weight: rival === 'services' ? 0.6 : 0.4, distinctKinds, hits }
  }

  return { kind: 'unknown', weight: 1, distinctKinds, hits }
}

/**
 * Is this sheet something we can build a house from?
 *
 * The honest scope line: one sheet, and it has to be a floor plan. Handing back
 * a nonsense building from an elevation is worse than saying "this looks like
 * an elevation — give me the floor plan sheet", because the first one is a lie
 * the user only finds out about after they have trusted it.
 */
export function isBuildableSheet(read: SheetTitleRead): boolean {
  return read.kind === 'floor-plan' || read.kind === 'unknown'
}

/** What to tell someone who handed us the wrong sheet. Their words, not ours. */
export function wrongSheetMessage(read: SheetTitleRead): string | null {
  if (isBuildableSheet(read)) return null
  const what: Record<string, string> = {
    'site-plan': 'a site or plot plan',
    elevation: 'an elevation',
    section: 'a section',
    foundation: 'a foundation plan',
    roof: 'a roof plan',
    framing: 'a framing plan',
    services: 'an electrical or plumbing plan',
    index: 'a title or index sheet',
  }
  const name = what[read.kind] ?? 'not a floor plan'
  return `This looks like ${name}. Give me the floor plan sheet and I can build from it.`
}
