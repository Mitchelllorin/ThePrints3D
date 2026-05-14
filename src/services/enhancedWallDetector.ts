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

  for (const seed of seeds) {
    const match = findBestTypeMatch(seed, wallTypes, scale)
    const nearest = findNearestWall(seed, walls)
    if (nearest && match) {
      nearest.wallTypeId = match.id
      nearest.confidence = seed.confidence
    }
  }

  for (const wall of walls) {
    if (!wall.wallTypeId) {
      const inferred = inferWallType(wall, wallTypes, scale)
      if (inferred) {
        wall.wallTypeId = inferred.id
        wall.confidence = 0.4
      }
    }
  }

  return walls
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

function findNearestWall(seed: SeedWall, walls: WallWithType[]): WallWithType | null {
  let nearest: WallWithType | null = null
  let minDist = Infinity
  const sx = (seed.x1 + seed.x2) / 2
  const sy = (seed.y1 + seed.y2) / 2
  for (const w of walls) {
    const wx = (w.x1 + w.x2) / 2
    const wy = (w.y1 + w.y2) / 2
    const d = Math.hypot(sx - wx, sy - wy)
    if (d < minDist) { minDist = d; nearest = w }
  }
  return minDist < 50 ? nearest : null
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
