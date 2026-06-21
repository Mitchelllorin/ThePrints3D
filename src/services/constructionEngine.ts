/**
 * Construction Engine v1 — Framing
 * ---------------------------------
 * Pure, deterministic module: ParsedWall[] + ParsedOpening[] + ProjectMeta
 * → BuildResult (placed framing geometry + Decision[]).
 *
 * No DOM, no Three.js, no side effects. Outputs geometry descriptors that
 * BuildingModel can render.
 *
 * Framing placement:
 *   - Studs at 16/24″ OC along each wall centerline
 *   - Single bottom plate, double top plate (configurable)
 *   - King studs + jack studs + header at every opening
 *   - Cripple studs above headers
 *   - Corner assemblies where walls meet
 */

import type { ParsedWall, ParsedOpening } from '../types'
import type { BuildingType } from '../onboarding/types'
import type {
  BuildResult,
  Decision,
  DecisionOption,
  PlacedComponent,
} from './decisions'
import { FRAMING_MM } from './wallTypeClassifier'
import type { WallType } from './wallTypeClassifier'
import { wallFramingSpec, DEFAULT_STEEL_GAUGE, type WallFramingSpec } from './constructionCode'
import framingDefaults from '../data/defaults/framing.json'

// ─── Constants ──────────────────────────────────────────────────────────────

const MM_PER_INCH = 25.4
const STUD_WIDTH_MM = 38 // 1-1/2" actual

// ─── Internal helpers ───────────────────────────────────────────────────────

interface WallGeometry {
  /** World-space start [x, z] in metres */
  start: [number, number]
  /** World-space end [x, z] in metres */
  end: [number, number]
  /** Wall length in metres */
  lengthM: number
  /** Angle from start to end (radians) */
  angle: number
  /** Framing cavity depth in metres */
  depthM: number
  /** Wall height in metres */
  heightM: number
  /** Original ParsedWall index */
  wallIndex: number
}

function resolveStudSize(buildingType: BuildingType): string {
  const bt = buildingType in framingDefaults.buildingTypeDefaults
    ? buildingType
    : 'unknown'
  const cfg = framingDefaults.buildingTypeDefaults[bt as keyof typeof framingDefaults.buildingTypeDefaults]
  return cfg.studSize
}

function resolveSpacingMm(buildingType: BuildingType): number {
  const bt = buildingType in framingDefaults.buildingTypeDefaults
    ? buildingType
    : 'unknown'
  const cfg = framingDefaults.buildingTypeDefaults[bt as keyof typeof framingDefaults.buildingTypeDefaults]
  const spacingKey = String(cfg.spacingIn) as keyof typeof framingDefaults.spacings
  return framingDefaults.spacings[spacingKey].mm
}

function studDepthMm(studSize: string): number {
  const entry = framingDefaults.studSizes[studSize as keyof typeof framingDefaults.studSizes]
  return entry ? entry.actualDepthMm : 89
}

function wallToGeometry(
  wall: ParsedWall,
  wallIndex: number,
  scaleMmPerPx: number,
  cx: number,
  cy: number,
  floorHeightM: number,
): WallGeometry {
  const s = scaleMmPerPx / 1000 // px → metres
  const x1 = (wall.x1 - cx) * s
  const z1 = (wall.y1 - cy) * s
  const x2 = (wall.x2 - cx) * s
  const z2 = (wall.y2 - cy) * s
  const dx = x2 - x1
  const dz = z2 - z1
  const lengthM = Math.hypot(dx, dz)
  const angle = Math.atan2(dz, dx)

  const wallType: WallType = wall.wallType ?? 'unknown'
  const framingMm = wall.framingMm ?? FRAMING_MM[wallType] ?? 89
  const depthM = framingMm / 1000

  return {
    start: [x1, z1],
    end: [x2, z2],
    lengthM,
    angle,
    depthM,
    heightM: floorHeightM,
    wallIndex,
  }
}

function centerOfWalls(walls: ParsedWall[]): [number, number] {
  if (walls.length === 0) return [0, 0]
  let sx = 0
  let sy = 0
  for (const w of walls) {
    sx += (w.x1 + w.x2) / 2
    sy += (w.y1 + w.y2) / 2
  }
  return [sx / walls.length, sy / walls.length]
}

let componentCounter = 0

function makeId(): string {
  return `fc-${++componentCounter}`
}

/** Reset counter (for testing). */
export function _resetIdCounter(): void {
  componentCounter = 0
}

// ─── Stud placement ─────────────────────────────────────────────────────────

function placeStudsAlongWall(
  wg: WallGeometry,
  spacingMm: number,
  studSize: string,
  openingsOnWall: ParsedOpening[],
  scaleMmPerPx: number,
  cx: number,
  cy: number,
): PlacedComponent[] {
  const components: PlacedComponent[] = []
  const depth = studDepthMm(studSize) / 1000
  const width = STUD_WIDTH_MM / 1000
  const wallLenMm = wg.lengthM * 1000

  // Convert openings to local-space intervals [startMm, endMm] along wall
  const openingIntervals: Array<[number, number]> = []
  for (const op of openingsOnWall) {
    const opWidthMm = op.widthMm ?? op.widthPx * scaleMmPerPx
    const s = scaleMmPerPx / 1000
    const opX = (op.x - cx) * s
    const opZ = (op.y - cy) * s
    // Project opening center onto wall line
    const dx = wg.end[0] - wg.start[0]
    const dz = wg.end[1] - wg.start[1]
    const t = wg.lengthM > 0
      ? ((opX - wg.start[0]) * dx + (opZ - wg.start[1]) * dz) / (wg.lengthM * wg.lengthM)
      : 0.5
    const centerMm = Math.max(0, Math.min(wallLenMm, t * wallLenMm))
    const halfW = opWidthMm / 2
    openingIntervals.push([centerMm - halfW, centerMm + halfW])
  }

  function isInsideOpening(posMm: number): boolean {
    for (const [lo, hi] of openingIntervals) {
      if (posMm > lo + STUD_WIDTH_MM / 2 && posMm < hi - STUD_WIDTH_MM / 2) return true
    }
    return false
  }

  // Place studs at regular spacing, skipping inside openings
  const cos = Math.cos(wg.angle)
  const sin = Math.sin(wg.angle)
  const studHeightM = wg.heightM - (3 * STUD_WIDTH_MM) / 1000 // minus plates

  for (let posMm = 0; posMm <= wallLenMm; posMm += spacingMm) {
    if (isInsideOpening(posMm)) continue

    const posM = posMm / 1000
    const x = wg.start[0] + posM * cos
    const z = wg.start[1] + posM * sin
    const y = STUD_WIDTH_MM / 1000 + studHeightM / 2 // above bottom plate

    components.push({
      id: makeId(),
      wallIndex: wg.wallIndex,
      layer: 'framing',
      componentType: 'stud',
      position: [x, y, z],
      rotation: [0, -wg.angle, 0],
      dimensions: [width, studHeightM, depth],
      label: `Stud ${studSize}`,
    })
  }

  // End stud if not already at the end
  const lastStudMm = Math.floor(wallLenMm / spacingMm) * spacingMm
  if (wallLenMm - lastStudMm > STUD_WIDTH_MM && !isInsideOpening(wallLenMm)) {
    const x = wg.end[0]
    const z = wg.end[1]
    const y = STUD_WIDTH_MM / 1000 + studHeightM / 2

    components.push({
      id: makeId(),
      wallIndex: wg.wallIndex,
      layer: 'framing',
      componentType: 'stud',
      position: [x, y, z],
      rotation: [0, -wg.angle, 0],
      dimensions: [width, studHeightM, depth],
      label: `Stud ${studSize}`,
    })
  }

  return components
}

// ─── Blocking ─────────────────────────────────────────────────────────────────

/**
 * Solid mid-height blocking between consecutive studs — the same row the ghost
 * preview shows, carried into the built model so blocking goes ghost → solid
 * instead of vanishing on build. Wood only (steel uses bridging, modelled
 * separately); openings are skipped.
 */
function placeBlockingAlongWall(
  wg: WallGeometry,
  spacingMm: number,
  studSize: string,
  openingsOnWall: ParsedOpening[],
  scaleMmPerPx: number,
  cx: number,
  cy: number,
): PlacedComponent[] {
  const components: PlacedComponent[] = []
  const depth = studDepthMm(studSize) / 1000
  const width = STUD_WIDTH_MM / 1000
  const wallLenMm = wg.lengthM * 1000

  const openingIntervals: Array<[number, number]> = []
  for (const op of openingsOnWall) {
    const opWidthMm = op.widthMm ?? op.widthPx * scaleMmPerPx
    const s = scaleMmPerPx / 1000
    const opX = (op.x - cx) * s
    const opZ = (op.y - cy) * s
    const dx = wg.end[0] - wg.start[0]
    const dz = wg.end[1] - wg.start[1]
    const t = wg.lengthM > 0
      ? ((opX - wg.start[0]) * dx + (opZ - wg.start[1]) * dz) / (wg.lengthM * wg.lengthM)
      : 0.5
    const centerMm = Math.max(0, Math.min(wallLenMm, t * wallLenMm))
    const halfW = opWidthMm / 2
    openingIntervals.push([centerMm - halfW, centerMm + halfW])
  }
  const insideOpening = (posMm: number) =>
    openingIntervals.some(([lo, hi]) => posMm > lo && posMm < hi)

  const cos = Math.cos(wg.angle)
  const sin = Math.sin(wg.angle)
  const studHeightM = wg.heightM - (3 * STUD_WIDTH_MM) / 1000
  const y = STUD_WIDTH_MM / 1000 + studHeightM / 2

  // Stud x-positions, matching placeStudsAlongWall (skip openings, add end stud).
  const positions: number[] = []
  for (let posMm = 0; posMm <= wallLenMm; posMm += spacingMm) {
    if (!insideOpening(posMm)) positions.push(posMm)
  }
  const lastStudMm = Math.floor(wallLenMm / spacingMm) * spacingMm
  if (wallLenMm - lastStudMm > STUD_WIDTH_MM && !insideOpening(wallLenMm)) positions.push(wallLenMm)
  positions.sort((a, b) => a - b)

  for (let i = 0; i < positions.length - 1; i++) {
    const spanMm = positions[i + 1] - positions[i] - STUD_WIDTH_MM
    if (spanMm < 40) continue
    const midMm = (positions[i] + positions[i + 1]) / 2
    if (insideOpening(midMm)) continue   // no blocking across an opening
    const posM = midMm / 1000
    components.push({
      id: makeId(),
      wallIndex: wg.wallIndex,
      layer: 'framing',
      componentType: 'blocking',
      position: [wg.start[0] + posM * cos, y, wg.start[1] + posM * sin],
      rotation: [0, -wg.angle, 0],
      dimensions: [spanMm / 1000, width, depth],
      label: 'Blocking',
    })
  }

  return components
}

// ─── Plates ─────────────────────────────────────────────────────────────────

function placePlates(
  wg: WallGeometry,
  studSize: string,
  topCount: number,
  bottomCount: number,
): PlacedComponent[] {
  const components: PlacedComponent[] = []
  const depth = studDepthMm(studSize) / 1000
  const plateHeight = STUD_WIDTH_MM / 1000
  const midX = (wg.start[0] + wg.end[0]) / 2
  const midZ = (wg.start[1] + wg.end[1]) / 2

  // Bottom plate(s)
  for (let i = 0; i < bottomCount; i++) {
    components.push({
      id: makeId(),
      wallIndex: wg.wallIndex,
      layer: 'framing',
      componentType: 'bottom-plate',
      position: [midX, plateHeight / 2 + i * plateHeight, midZ],
      rotation: [0, -wg.angle, 0],
      dimensions: [wg.lengthM, plateHeight, depth],
      label: 'Bottom plate',
    })
  }

  // Top plate(s)
  for (let i = 0; i < topCount; i++) {
    const y = wg.heightM - plateHeight / 2 - i * plateHeight
    components.push({
      id: makeId(),
      wallIndex: wg.wallIndex,
      layer: 'framing',
      componentType: 'top-plate',
      position: [midX, y, midZ],
      rotation: [0, -wg.angle, 0],
      dimensions: [wg.lengthM, plateHeight, depth],
      label: i === 0 ? 'Top plate' : 'Cap plate',
    })
  }

  return components
}

// ─── Opening framing ────────────────────────────────────────────────────────

function selectHeaderDepthMm(spanMm: number): number {
  const spans = framingDefaults.headers.maxSpanBySize
  const sizes: Array<[string, number]> = [
    ['2x4', spans['2x4']],
    ['2x6', spans['2x6']],
    ['2x8', spans['2x8']],
    ['2x10', spans['2x10']],
    ['2x12', spans['2x12']],
  ]
  for (const [size, maxSpan] of sizes) {
    if (spanMm <= maxSpan) {
      return studDepthMm(size)
    }
  }
  return studDepthMm('2x12')
}

function placeOpeningFraming(
  wg: WallGeometry,
  opening: ParsedOpening,
  studSize: string,
  scaleMmPerPx: number,
  cx: number,
  cy: number,
): PlacedComponent[] {
  const components: PlacedComponent[] = []
  const cos = Math.cos(wg.angle)
  const sin = Math.sin(wg.angle)
  const widthM = STUD_WIDTH_MM / 1000
  const depth = studDepthMm(studSize) / 1000
  const plateHeight = STUD_WIDTH_MM / 1000
  const s = scaleMmPerPx / 1000

  const opWidthMm = opening.widthMm ?? opening.widthPx * scaleMmPerPx
  const opWidthM = opWidthMm / 1000

  // Project opening center onto wall
  const opX = (opening.x - cx) * s
  const opZ = (opening.y - cy) * s
  const dx = wg.end[0] - wg.start[0]
  const dz = wg.end[1] - wg.start[1]
  const t = wg.lengthM > 0
    ? ((opX - wg.start[0]) * dx + (opZ - wg.start[1]) * dz) / (wg.lengthM * wg.lengthM)
    : 0.5

  const centerM = t * wg.lengthM
  const halfW = opWidthM / 2

  // Opening dimensions: door = full height minus plates, window = partial
  const isDoor = opening.type === 'door'
  const headerHeightM = isDoor ? wg.heightM - 2 * plateHeight - 0.05 : wg.heightM * 0.65
  const sillHeightM = isDoor ? plateHeight : wg.heightM * 0.3

  // Header
  const headerDepthMm = selectHeaderDepthMm(opWidthMm)
  const headerDepthM = headerDepthMm / 1000
  const headerY = headerHeightM + headerDepthM / 2
  const headerCX = wg.start[0] + centerM * cos
  const headerCZ = wg.start[1] + centerM * sin

  components.push({
    id: makeId(),
    wallIndex: wg.wallIndex,
    layer: 'framing',
    componentType: 'header',
    position: [headerCX, headerY, headerCZ],
    rotation: [0, -wg.angle, 0],
    dimensions: [opWidthM, headerDepthM, depth],
    label: `Header (${Math.round(headerDepthMm / MM_PER_INCH * 2) / 2}" deep)`,
  })

  // King studs (full height, flanking the opening)
  const kingStudH = wg.heightM - 3 * plateHeight
  const kingY = plateHeight + kingStudH / 2

  for (const side of [-1, 1] as const) {
    const edgeM = centerM + side * (halfW + widthM / 2)
    const kx = wg.start[0] + edgeM * cos
    const kz = wg.start[1] + edgeM * sin

    components.push({
      id: makeId(),
      wallIndex: wg.wallIndex,
      layer: 'framing',
      componentType: 'king-stud',
      position: [kx, kingY, kz],
      rotation: [0, -wg.angle, 0],
      dimensions: [widthM, kingStudH, depth],
      label: 'King stud',
    })

    // Jack stud (supports header, shorter)
    const jackH = headerHeightM - plateHeight
    const jackY = plateHeight + jackH / 2
    const jackEdgeM = centerM + side * (halfW - widthM / 2)
    const jx = wg.start[0] + jackEdgeM * cos
    const jz = wg.start[1] + jackEdgeM * sin

    components.push({
      id: makeId(),
      wallIndex: wg.wallIndex,
      layer: 'framing',
      componentType: 'jack-stud',
      position: [jx, jackY, jz],
      rotation: [0, -wg.angle, 0],
      dimensions: [widthM, jackH, depth],
      label: 'Jack stud',
    })
  }

  // Cripple studs above header
  const crippleBottomY = headerY + headerDepthM / 2
  const topPlateBottomY = wg.heightM - 2 * plateHeight
  const crippleH = topPlateBottomY - crippleBottomY
  if (crippleH > 0.05) {
    const spacingMm = resolveSpacingMm('unknown')
    const startMm = (centerM - halfW) * 1000
    const endMm = (centerM + halfW) * 1000
    for (let posMm = startMm + spacingMm; posMm < endMm; posMm += spacingMm) {
      const posM = posMm / 1000
      const crx = wg.start[0] + posM * cos
      const crz = wg.start[1] + posM * sin

      components.push({
        id: makeId(),
        wallIndex: wg.wallIndex,
        layer: 'framing',
        componentType: 'cripple-stud',
        position: [crx, crippleBottomY + crippleH / 2, crz],
        rotation: [0, -wg.angle, 0],
        dimensions: [widthM, crippleH, depth],
        label: 'Cripple stud',
      })
    }
  }

  // Sill plate + cripples below window
  if (!isDoor && sillHeightM > plateHeight * 2) {
    const sillCrippleH = sillHeightM - plateHeight
    const spacingMm = resolveSpacingMm('unknown')
    const startMm = (centerM - halfW) * 1000
    const endMm = (centerM + halfW) * 1000
    for (let posMm = startMm + spacingMm; posMm < endMm; posMm += spacingMm) {
      const posM = posMm / 1000
      const crx = wg.start[0] + posM * cos
      const crz = wg.start[1] + posM * sin

      components.push({
        id: makeId(),
        wallIndex: wg.wallIndex,
        layer: 'framing',
        componentType: 'cripple-stud',
        position: [crx, plateHeight + sillCrippleH / 2, crz],
        rotation: [0, -wg.angle, 0],
        dimensions: [widthM, sillCrippleH, depth],
        label: 'Sill cripple',
      })
    }
  }

  return components
}

// ─── Corner detection ───────────────────────────────────────────────────────

const CORNER_PROXIMITY_M = 0.15

function findCorners(geometries: WallGeometry[]): Array<{
  wallIndexA: number
  wallIndexB: number
  position: [number, number]
}> {
  const corners: Array<{
    wallIndexA: number
    wallIndexB: number
    position: [number, number]
  }> = []
  const seen = new Set<string>()

  for (let i = 0; i < geometries.length; i++) {
    const gi = geometries[i]
    const endpoints_i = [gi.start, gi.end]

    for (let j = i + 1; j < geometries.length; j++) {
      const gj = geometries[j]
      const endpoints_j = [gj.start, gj.end]

      for (const pi of endpoints_i) {
        for (const pj of endpoints_j) {
          const dist = Math.hypot(pi[0] - pj[0], pi[1] - pj[1])
          if (dist < CORNER_PROXIMITY_M) {
            const key = [gi.wallIndex, gj.wallIndex].sort().join('-')
            if (!seen.has(key)) {
              seen.add(key)
              corners.push({
                wallIndexA: gi.wallIndex,
                wallIndexB: gj.wallIndex,
                position: [(pi[0] + pj[0]) / 2, (pi[1] + pj[1]) / 2],
              })
            }
          }
        }
      }
    }
  }

  return corners
}

function placeCornerAssemblies(
  corners: ReturnType<typeof findCorners>,
  geometries: WallGeometry[],
  studSize: string,
  cornerType: 'three-stud' | 'california',
): PlacedComponent[] {
  const components: PlacedComponent[] = []
  const depth = studDepthMm(studSize) / 1000
  const width = STUD_WIDTH_MM / 1000
  // California (two-stud) corners use one fewer stud — better insulation, fewer
  // thermal bridges; three-stud is the standard backing-stud corner.
  const studCount = cornerType === 'california' ? 2 : 3
  const label = cornerType === 'california'
    ? 'Corner assembly (California 2-stud)'
    : 'Corner assembly (3-stud)'

  for (const corner of corners) {
    const wgA = geometries.find((g) => g.wallIndex === corner.wallIndexA)
    if (!wgA) continue

    const studH = wgA.heightM - 3 * (STUD_WIDTH_MM / 1000)
    const y = STUD_WIDTH_MM / 1000 + studH / 2

    components.push({
      id: makeId(),
      wallIndex: corner.wallIndexA,
      layer: 'framing',
      componentType: 'corner-assembly',
      position: [corner.position[0], y, corner.position[1]],
      rotation: [0, -wgA.angle, 0],
      dimensions: [width * studCount, studH, depth],
      label,
    })
  }

  return components
}

// ─── Decisions ──────────────────────────────────────────────────────────────

function buildFramingDecisions(
  buildingType: BuildingType,
  wallCount: number,
  openingCount: number,
): Decision[] {
  const studSize = resolveStudSize(buildingType)
  const bt = buildingType in framingDefaults.buildingTypeDefaults
    ? buildingType
    : 'unknown'
  const cfg = framingDefaults.buildingTypeDefaults[bt as keyof typeof framingDefaults.buildingTypeDefaults]
  const spacingIn = cfg.spacingIn

  const decisions: Decision[] = []

  // Stud size decision
  const studOptions: DecisionOption<string>[] = Object.entries(framingDefaults.studSizes).map(
    ([key, entry]) => ({ value: key, label: entry.label }),
  )
  decisions.push({
    id: 'framing.studSize',
    layer: 'framing',
    question: 'What stud size for framing?',
    default: studSize,
    chosen: studSize,
    options: studOptions,
    confidence: wallCount > 0 ? 0.85 : 0.5,
    dependsOn: [],
  })

  // Spacing decision
  const spacingOptions: DecisionOption<number>[] = Object.values(framingDefaults.spacings).map(
    (entry) => ({ value: entry.inches, label: entry.label }),
  )
  decisions.push({
    id: 'framing.studSpacing',
    layer: 'framing',
    question: 'Stud spacing (on-center)?',
    default: spacingIn,
    chosen: spacingIn,
    options: spacingOptions,
    confidence: 0.9,
    dependsOn: ['framing.studSize'],
  })

  // Corner type
  const cornerOptions: DecisionOption<string>[] = [
    { value: 'standard', label: 'Three-stud corner (standard)' },
    { value: 'california', label: 'California corner (energy-efficient)' },
  ]
  decisions.push({
    id: 'framing.cornerType',
    layer: 'framing',
    question: 'Corner assembly type?',
    default: 'standard',
    chosen: 'standard',
    options: cornerOptions,
    confidence: 0.95,
    dependsOn: ['framing.studSize'],
  })

  // Header config (only if there are openings)
  if (openingCount > 0) {
    decisions.push({
      id: 'framing.headerDoublePly',
      layer: 'framing',
      question: 'Use double-ply headers at openings?',
      default: true,
      chosen: true,
      options: [
        { value: true, label: 'Double-ply (standard for load-bearing)' },
        { value: false, label: 'Single-ply (non-load-bearing partitions)' },
      ],
      confidence: 0.9,
      dependsOn: ['framing.studSize'],
    })
  }

  // Plate count
  decisions.push({
    id: 'framing.topPlateCount',
    layer: 'framing',
    question: 'Number of top plates?',
    default: 2,
    chosen: 2,
    options: [
      { value: 1, label: 'Single top plate (non-load-bearing)' },
      { value: 2, label: 'Double top plate (standard)' },
    ],
    confidence: 0.95,
    dependsOn: [],
  })

  return decisions
}

// ─── Opening → wall assignment ──────────────────────────────────────────────

function assignOpeningsToWalls(
  openings: ParsedOpening[],
  walls: ParsedWall[],
): Map<number, ParsedOpening[]> {
  const map = new Map<number, ParsedOpening[]>()
  const maxDistPx = 50 // max perpendicular distance to consider

  for (const op of openings) {
    let bestWall = -1
    let bestDist = Infinity

    for (let i = 0; i < walls.length; i++) {
      const w = walls[i]
      const dx = w.x2 - w.x1
      const dy = w.y2 - w.y1
      const lenSq = dx * dx + dy * dy
      if (lenSq === 0) continue

      // Perpendicular distance from opening center to wall line
      const t = Math.max(0, Math.min(1,
        ((op.x - w.x1) * dx + (op.y - w.y1) * dy) / lenSq,
      ))
      const projX = w.x1 + t * dx
      const projY = w.y1 + t * dy
      const dist = Math.hypot(op.x - projX, op.y - projY)

      if (dist < bestDist && dist < maxDistPx + w.thickness) {
        bestDist = dist
        bestWall = i
      }
    }

    if (bestWall >= 0) {
      const existing = map.get(bestWall) ?? []
      existing.push(op)
      map.set(bestWall, existing)
    }
  }

  return map
}

// ─── Main entry point ───────────────────────────────────────────────────────

export interface ConstructionEngineOptions {
  scaleMmPerPx: number
  floorHeightM?: number
  buildingType?: BuildingType
  /** Global override for stud spacing (mm). Falls back to the building-type default. */
  spacingMm?: number
  /** Global override for stud size / wall depth. Falls back to the building-type default. */
  studSize?: string
  /** Corner framing style. Falls back to three-stud (standard). */
  cornerType?: 'three-stud' | 'california'
  /** Framing material. Wood (default) keeps solid lumber; steel emits C-studs + track. */
  material?: 'wood' | 'steel'
  /** Steel web width (nominal, e.g. '3-5/8'). */
  steelWidth?: string
  /** Steel gauge for labels/BOM. */
  steelGauge?: string
  /** Top/bottom steel track types (for labels/BOM). */
  steelTrackTop?: string
  steelTrackBottom?: string
  /** Deflection gap left at the top of steel studs (mm). */
  steelDeflectionGapMm?: number
}

// Nominal steel stud/track web widths → actual mm.
const STEEL_WIDTHS_MM: Record<string, number> = {
  '1-5/8': 41.3,
  '2-1/2': 63.5,
  '3-1/2': 88.9,
  '3-5/8': 92.1,
  '6': 152.4,
  '8': 203.2,
}
const STEEL_FLANGE_MM = 35 // ~1-3/8" flange run along the wall

/**
 * Transform an already-placed wood layout into cold-formed steel: studs become
 * C-studs at the steel web width, plates become track (slotted top / shallow
 * bottom), and studs are shortened to leave a deflection gap at the top. Done
 * as a post-pass so the (correct) wood placement geometry is reused as-is.
 */
function applySteel(
  components: PlacedComponent[],
  opts: { widthMm: number; gauge: string; deflectionGapM: number; trackTop: string; trackBottom: string },
): void {
  const widthM = opts.widthMm / 1000
  const flangeM = STEEL_FLANGE_MM / 1000
  for (const c of components) {
    c.material = 'steel'
    const isVertical = c.componentType === 'stud' || c.componentType === 'king-stud'
      || c.componentType === 'jack-stud' || c.componentType === 'cripple-stud'
      || c.componentType === 'corner-assembly'
    if (isVertical) {
      c.profile = 'c-stud'
      c.gauge = opts.gauge
      // Corner assemblies keep their multi-stud along-wall width; single studs
      // take the steel flange run. Depth across the wall = steel web width.
      if (c.componentType !== 'corner-assembly') c.dimensions[0] = flangeM
      c.dimensions[2] = widthM
      // Deflection gap: shorten the stud and drop its top, leaving room to move.
      c.dimensions[1] = Math.max(0.05, c.dimensions[1] - opts.deflectionGapM)
      c.position[1] -= opts.deflectionGapM / 2
      c.label = `Steel C-stud ${opts.gauge}ga`
    } else if (c.componentType === 'top-plate' || c.componentType === 'bottom-plate') {
      c.profile = 'track'
      c.gauge = opts.gauge
      c.dimensions[2] = widthM
      const top = c.componentType === 'top-plate'
      c.label = top ? `Top track (${opts.trackTop})` : `Bottom track (${opts.trackBottom})`
    } else {
      // Headers etc. stay solid (steel box beam), just retagged as steel.
      c.profile = 'rect'
      c.gauge = opts.gauge
      c.dimensions[2] = widthM
    }
  }
}

export function buildFraming(
  walls: ParsedWall[],
  openings: ParsedOpening[],
  options: ConstructionEngineOptions,
): BuildResult {
  const {
    scaleMmPerPx,
    floorHeightM = 2.7,
    buildingType = 'residential-single',
  } = options

  _resetIdCounter()

  const [cx, cy] = centerOfWalls(walls)
  // Global setting overrides take precedence over the building-type defaults.
  // These are the FALLBACK for auto-detected walls; walls the user traced carry
  // their own framingType/role and are resolved per-wall below.
  const globalStudSize = options.studSize ?? resolveStudSize(buildingType)
  const globalMaterial: 'wood' | 'steel' = options.material ?? 'wood'
  const spacingMm = options.spacingMm ?? resolveSpacingMm(buildingType)
  const bt = buildingType in framingDefaults.buildingTypeDefaults
    ? buildingType
    : 'unknown'
  const cfg = framingDefaults.buildingTypeDefaults[bt as keyof typeof framingDefaults.buildingTypeDefaults]

  // Filter to framed walls only (skip masonry)
  const framedWallTypes: Array<WallType | undefined> = [
    'partition-thin', 'stud-2x4', 'stud-2x6', 'stud-2x8', 'stud-2x10', 'stud-2x12', 'unknown', undefined,
  ]
  const framedWalls = walls.filter((w) => framedWallTypes.includes(w.wallType))

  // Resolve EACH wall's own framing spec (material / stud size / steel gauge),
  // keyed by its original index. A traced wall uses the type it was drawn with;
  // an auto wall falls back to the global options. This is what lets a wood
  // exterior and a steel-stud interior live in the same build.
  const specByIndex = new Map<number, WallFramingSpec>()
  for (const w of framedWalls) {
    const idx = walls.indexOf(w)
    specByIndex.set(idx, w.framingType
      ? wallFramingSpec(w.framingType, w.wallRole)
      : { material: globalMaterial, studSize: globalStudSize, steelWidth: options.steelWidth, gauge: options.steelGauge, isMasonry: false })
  }

  // Build geometry descriptors
  const geometries: WallGeometry[] = framedWalls.map((w) => {
    const originalIndex = walls.indexOf(w)
    return wallToGeometry(w, originalIndex, scaleMmPerPx, cx, cy, floorHeightM)
  }).filter((g) => g.lengthM >= 0.3) // skip tiny segments

  // Assign openings to walls
  const openingsByWall = assignOpeningsToWalls(openings, walls)

  // Place components
  const components: PlacedComponent[] = []
  const suggestions: string[] = []

  for (const wg of geometries) {
    const wallOpenings = openingsByWall.get(wg.wallIndex) ?? []
    const spec = specByIndex.get(wg.wallIndex)
    const studSize = spec?.studSize ?? globalStudSize
    const isSteel = (spec?.material ?? globalMaterial) === 'steel'

    // Studs
    components.push(
      ...placeStudsAlongWall(wg, spacingMm, studSize, wallOpenings, scaleMmPerPx, cx, cy),
    )

    // Plates
    components.push(
      ...placePlates(wg, studSize, cfg.topPlates, cfg.bottomPlates),
    )

    // Blocking (wood only — steel gets bridging, modelled separately). Carries
    // the ghost's blocking row into the built model so it goes ghost → solid.
    if (!isSteel) {
      components.push(
        ...placeBlockingAlongWall(wg, spacingMm, studSize, wallOpenings, scaleMmPerPx, cx, cy),
      )
    }

    // Opening framing
    for (const op of wallOpenings) {
      components.push(
        ...placeOpeningFraming(wg, op, studSize, scaleMmPerPx, cx, cy),
      )
    }
  }

  // Corner assemblies span two walls; frame them at the global stud size.
  const corners = findCorners(geometries)
  components.push(...placeCornerAssemblies(corners, geometries, globalStudSize, options.cornerType ?? 'three-stud'))

  // Steel: convert ONLY the components of steel walls into cold-formed C-studs +
  // track, each at that wall's own web width and role-derived gauge. Corner
  // assemblies follow the wall they're keyed to. Wood walls are left untouched.
  const componentsByWall = new Map<number, PlacedComponent[]>()
  for (const c of components) {
    const arr = componentsByWall.get(c.wallIndex)
    if (arr) arr.push(c)
    else componentsByWall.set(c.wallIndex, [c])
  }
  for (const [idx, spec] of specByIndex) {
    if (spec.material !== 'steel') continue
    const subset = componentsByWall.get(idx)
    if (!subset || subset.length === 0) continue
    const widthMm = STEEL_WIDTHS_MM[spec.steelWidth ?? '3-5/8'] ?? STEEL_WIDTHS_MM['3-5/8']
    applySteel(subset, {
      widthMm,
      gauge: spec.gauge ?? options.steelGauge ?? DEFAULT_STEEL_GAUGE,
      deflectionGapM: (options.steelDeflectionGapMm ?? 19) / 1000,
      trackTop: options.steelTrackTop ?? 'slotted',
      trackBottom: options.steelTrackBottom ?? 'shallow',
    })
  }

  // Decisions
  const decisions = buildFramingDecisions(buildingType, framedWalls.length, openings.length)

  // Suggestions
  if (framedWalls.length < walls.length) {
    const masonryCount = walls.length - framedWalls.length
    suggestions.push(
      `${masonryCount} masonry wall${masonryCount === 1 ? '' : 's'} detected — framing skipped (CMU/concrete).`,
    )
  }
  if (openings.length > 0 && components.some((c) => c.componentType === 'header')) {
    suggestions.push(
      'Headers sized automatically based on opening span. Verify for load-bearing walls.',
    )
  }

  return { components, decisions, suggestions, frameOriginPx: [cx, cy], frameScaleMmPerPx: scaleMmPerPx }
}
