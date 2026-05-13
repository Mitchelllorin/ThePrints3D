/**
 * Sheet discipline classifier
 * ---------------------------
 * Construction drawings are organized by *discipline* via sheet number prefix:
 *
 *   A-xxx → Architectural   (walls, doors, finishes — RUN wall detection)
 *   S-xxx → Structural      (framing, steel — RUN wall detection)
 *   M-xxx → Mechanical      (HVAC ducts — SKIP wall detection)
 *   E-xxx → Electrical      (wiring — SKIP wall detection)
 *   P-xxx → Plumbing        (pipes — SKIP wall detection)
 *   C-xxx → Civil           (site work — SKIP wall detection)
 *   T-xxx → Telecom / Data  (SKIP)
 *   FP-xxx, F-xxx → Fire    (SKIP)
 *   L-xxx → Landscape       (SKIP)
 *   I-xxx → Interiors       (RUN — usually has finished walls)
 *
 * On non-architectural sheets, the "thick parallel lines" we'd normally
 * call walls are actually ducts/pipes/conduit — running wall detection
 * there produces garbage. So we gate detection by discipline.
 */

export type Discipline =
  | 'architectural'
  | 'structural'
  | 'interiors'
  | 'mechanical'
  | 'electrical'
  | 'plumbing'
  | 'civil'
  | 'fire-protection'
  | 'telecom'
  | 'landscape'
  | 'unknown'

const PREFIX_MAP: Array<{ re: RegExp; discipline: Discipline }> = [
  // Two-letter prefixes first (more specific)
  { re: /^FP[-_.]?\d/i,           discipline: 'fire-protection' },
  // Single-letter prefixes
  { re: /^A[-_.]?\d/i,            discipline: 'architectural' },
  { re: /^S[-_.]?\d/i,            discipline: 'structural' },
  { re: /^I[-_.]?\d/i,            discipline: 'interiors' },
  { re: /^M[-_.]?\d/i,            discipline: 'mechanical' },
  { re: /^E[-_.]?\d/i,            discipline: 'electrical' },
  { re: /^P[-_.]?\d/i,            discipline: 'plumbing' },
  { re: /^C[-_.]?\d/i,            discipline: 'civil' },
  { re: /^F[-_.]?\d/i,            discipline: 'fire-protection' },
  { re: /^T[-_.]?\d/i,            discipline: 'telecom' },
  { re: /^L[-_.]?\d/i,            discipline: 'landscape' },
]

/**
 * Infer drawing discipline from filename / sheet title.
 *   "A-2.7 - 6th level plan.pdf" → 'architectural'
 *   "P-101 plumbing.pdf"         → 'plumbing'
 *   "first floor.jpg"            → 'unknown'  (caller can default to architectural)
 */
export function inferDiscipline(name: string): Discipline {
  const n = name.trim()
  for (const { re, discipline } of PREFIX_MAP) {
    if (re.test(n)) return discipline
  }
  // Keyword fallback for filenames without sheet numbers
  const u = n.toUpperCase()
  if (u.includes('PLUMBING'))             return 'plumbing'
  if (u.includes('ELECTRICAL'))           return 'electrical'
  if (u.includes('MECHANICAL') || u.includes('HVAC')) return 'mechanical'
  if (u.includes('STRUCTURAL'))           return 'structural'
  if (u.includes('LANDSCAPE'))            return 'landscape'
  if (u.includes('CIVIL'))                return 'civil'
  if (u.includes('FIRE'))                 return 'fire-protection'
  if (u.includes('TELECOM') || u.includes('DATA'))     return 'telecom'
  if (u.includes('ARCHITECTURAL') || u.includes('FLOOR PLAN') || u.includes('LEVEL PLAN')) return 'architectural'
  if (u.includes('INTERIOR'))             return 'interiors'
  return 'unknown'
}

/**
 * Should we attempt wall detection on this sheet?
 *
 * We treat 'unknown' as YES (likely a phone snap of a floor plan
 * with no clean filename — better to try than to skip silently).
 */
export function shouldDetectWalls(discipline: Discipline): boolean {
  switch (discipline) {
    case 'architectural':
    case 'structural':
    case 'interiors':
    case 'unknown':
      return true
    default:
      return false
  }
}

/** Human label for badges/legend. */
export const DISCIPLINE_LABEL: Record<Discipline, string> = {
  'architectural':   'Architectural',
  'structural':      'Structural',
  'interiors':       'Interiors',
  'mechanical':      'Mechanical',
  'electrical':      'Electrical',
  'plumbing':        'Plumbing',
  'civil':           'Civil',
  'fire-protection': 'Fire Protection',
  'telecom':         'Telecom / Data',
  'landscape':       'Landscape',
  'unknown':         'Unknown',
}
