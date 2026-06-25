import type { SeedWall, WallType } from '../types'
import { detectWalls as heuristicDetect } from './wallDetector'
import type { ParsedWall } from '../types'

export interface EnhancedOptions {
  edgeThreshold?: number
  minWallLengthPx?: number
  minWallThicknessPx?: number
  maxWallThicknessPx?: number
  mergeGapPx?: number
}

export interface WallWithType extends ParsedWall {
  wallTypeId: string | null
  confidence: number
}

export function detectWalls(
  imageData: ImageData,
  seeds: SeedWall[],
  wallTypes: WallType[],
  scaleMmPerPx: number | null,
  options: EnhancedOptions = {}
): WallWithType[] {
  const result = heuristicDetect(imageData, { ...options, requirePairedEdges: false })
  const baseWalls = result.walls
  const scale = scaleMmPerPx ?? 1

  const walls: WallWithType[] = baseWalls.map((w) => ({
    ...w,
    wallTypeId: null,
    confidence: 0,
  }))

  // Turn each traced example into a labeled prototype: the wall type it best
  // matches, plus the line weight (px) it was actually drawn at. Because the
  // weight is measured from THIS drawing, prototypes calibrate to its own
  // conventions — far more reliable than absolute mm thresholds. "Trace one
  // exterior + one interior wall" then classifies every other line by which
  // example it most resembles ("which lines are which").
  const prototypes: TypePrototype[] = seeds
    .map((seed) => {
      const type = findBestTypeMatch(seed, wallTypes, scale)
      return type ? { wallTypeId: type.id, thicknessPx: seed.thicknessPx, confidence: seed.confidence } : null
    })
    .filter((p): p is TypePrototype => p != null)

  for (const wall of walls) {
    // 1) Few-shot: classify against the traced examples by line-weight signature.
    const matched = classifyByThicknessPrototype(wall.thickness, prototypes)
    if (matched) {
      wall.wallTypeId = matched.wallTypeId
      wall.confidence = matched.confidence
      continue
    }

    // 2) Lazy-user fallback: no usable example for this line — infer the type
    // from its absolute thickness against the known wall types.
    const inferred = inferWallType(wall, wallTypes, scale)
    if (inferred) {
      wall.wallTypeId = inferred.id
      wall.confidence = 0.4
    }
  }

  return walls
}

export interface TypePrototype {
  wallTypeId: string
  /** Line weight (px) the example was traced at, in this drawing's own scale. */
  thicknessPx: number
  /** 0..1 trust in the example. */
  confidence: number
}

/**
 * Few-shot line classification: given line-weight prototypes built from the
 * user's traced examples, return the type of the nearest prototype to a line of
 * `thicknessPx`, or null if none is close enough. Distance is a scale-free
 * log-ratio so the tolerance holds at any zoom — a line within ~`band` (default
 * 35%) of an example is treated as the same type. Pure + reusable: the same
 * shape will drive symbol matching ("trace one window, find them all").
 */
export function classifyByThicknessPrototype(
  thicknessPx: number,
  prototypes: TypePrototype[],
  band: number = Math.log(1.35),
): { wallTypeId: string; confidence: number } | null {
  if (prototypes.length === 0 || thicknessPx <= 0) return null
  let best: TypePrototype | null = null
  let bestRatio = Infinity
  for (const p of prototypes) {
    if (p.thicknessPx <= 0) continue
    const ratio = Math.abs(Math.log(thicknessPx / p.thicknessPx))
    if (ratio < bestRatio) { bestRatio = ratio; best = p }
  }
  if (!best || bestRatio > band) return null
  const closeness = 1 - bestRatio / band // 1 = exact weight match
  return {
    wallTypeId: best.wallTypeId,
    confidence: Math.min(1, 0.5 + 0.5 * closeness * best.confidence),
  }
}

function findBestTypeMatch(seed: SeedWall, types: WallType[], scale: number): WallType | null {
  const seedThicknessMm = seed.thicknessPx * scale
  let best: WallType | null = null
  let bestDiff = Infinity
  for (const t of types) {
    const diff = Math.abs(t.thicknessMm - seedThicknessMm)
    if (diff < bestDiff) { bestDiff = diff; best = t }
  }
  if (bestDiff > 100) return null
  return best
}

function inferWallType(wall: WallWithType, types: WallType[], scale: number): WallType | null {
  const wallThicknessMm = wall.thickness * scale
  let best: WallType | null = null
  let bestDiff = Infinity
  for (const t of types) {
    const diff = Math.abs(t.thicknessMm - wallThicknessMm)
    if (diff < bestDiff) { bestDiff = diff; best = t }
  }
  if (bestDiff > 80) return null
  return best
}
