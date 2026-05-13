/**
 * Infer the floor level (0-based integer) from a drawing filename or sheet title.
 *
 * Common patterns:
 *   A-101 / A-102  → floor 1  (hundreds digit)
 *   A-201          → floor 2
 *   A-001 / A-000  → basement / floor 0
 *   FL-1, LVL-1    → floor 1
 *   GROUND FLOOR   → floor 0
 *   FIRST FLOOR    → floor 1
 *   BASEMENT       → floor -1
 */
export function inferFloorNumber(name: string): number | null {
  const n = name.toUpperCase()

  // Sheet number patterns: A-101 → hundreds digit = 1, A-201 → 2, A-001 → 0
  // Matches: A-101, A-201, A1.01, E-201, M-101, etc.
  const sheetMatch = n.match(/[A-Z]-?(\d)(\d{2})\b/)
  if (sheetMatch) {
    const hundreds = parseInt(sheetMatch[1], 10)
    return hundreds  // 0 = ground/basement, 1 = level 1, etc.
  }

  // Explicit level/floor/level keywords: LVL-2, FL-3, LEVEL 2, FLOOR 2
  const levelMatch = n.match(/(?:LEVEL|LVL|FL(?:OOR)?)[^0-9]*(\d+)/)
  if (levelMatch) {
    return parseInt(levelMatch[1], 10) - 1  // "LEVEL 1" → 0
  }

  // Named floors
  if (n.includes('BASEMENT') || n.includes('B1') || n.includes('SUB')) return -1
  if (n.includes('GROUND') || n.includes('GRADE') || n.includes('G/F')) return 0
  if (n.includes('FIRST') || n.includes('1ST')) return 1
  if (n.includes('SECOND') || n.includes('2ND')) return 2
  if (n.includes('THIRD') || n.includes('3RD')) return 3
  if (n.includes('FOURTH') || n.includes('4TH') || n.includes('PENTHOUSE')) return 4
  if (n.includes('ROOF') || n.includes('ROOFTOP')) return 99

  return null
}

/**
 * Group drawing IDs by floor level.
 * Drawings with no detected floor are assigned to an "unknown" bucket.
 */
export type FloorBucket = number | 'unknown'

export interface FloorGroupingLogEntry {
  drawingId: string
  drawingName: string
  providedFloorNumber: number | null
  inferredFloorNumber: number | null
  assignedBucket: FloorBucket
  assignmentSource: 'provided' | 'inferred' | 'unknown'
}

export function groupByFloor(
  drawings: Array<{ id: string; name: string; floorNumber: number | null }>
): Map<FloorBucket, string[]> {
  return groupByFloorWithLog(drawings).groups
}

export function groupByFloorWithLog(
  drawings: Array<{ id: string; name: string; floorNumber: number | null }>
): { groups: Map<FloorBucket, string[]>; floorGroupingLog: FloorGroupingLogEntry[] } {
  const groups = new Map<FloorBucket, string[]>()
  const floorGroupingLog: FloorGroupingLogEntry[] = []

  for (const d of drawings) {
    const inferredFloorNumber = d.floorNumber == null ? inferFloorNumber(d.name) : null
    const resolvedFloor = d.floorNumber ?? inferredFloorNumber
    const assignedBucket: FloorBucket = resolvedFloor ?? 'unknown'
    const assignmentSource =
      d.floorNumber != null ? 'provided' : inferredFloorNumber != null ? 'inferred' : 'unknown'

    if (!groups.has(assignedBucket)) groups.set(assignedBucket, [])
    groups.get(assignedBucket)!.push(d.id)

    floorGroupingLog.push({
      drawingId: d.id,
      drawingName: d.name,
      providedFloorNumber: d.floorNumber,
      inferredFloorNumber,
      assignedBucket,
      assignmentSource,
    })
  }

  return { groups, floorGroupingLog }
}

/** Standard floor height in metres. */
export const FLOOR_HEIGHT_M = 3.2

/**
 * Convert a floor number to an elevation in metres above grade.
 * Basement is at -FLOOR_HEIGHT_M.
 */
export function floorToElevation(floorNumber: number): number {
  return floorNumber * FLOOR_HEIGHT_M
}
