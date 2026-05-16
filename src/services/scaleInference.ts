import type { ParsedWall } from '../types'
import { detectOpenings } from './openingDetector'
import { classifyWallType, type DrywallConfig } from './wallTypeClassifier'

const COMMON_OPENING_WIDTHS_MM = [686, 762, 813, 864, 914, 965, 1200, 1500, 1800, 2100, 2400]
const COMMON_FINISHED_WALLS_MM = [70, 89, 121, 152, 171, 184, 203, 235, 286, 305]
const MIN_SCALE_MM_PER_PX = 0.2
const MAX_SCALE_MM_PER_PX = 50

export interface InferredScale {
  scaleMmPerPx: number
  confidence: number
  support: {
    walls: number
    openings: number
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function roundScaleBucket(scaleMmPerPx: number): number {
  return Math.round(scaleMmPerPx * 20) / 20
}

function collectCandidateScales(walls: ParsedWall[]): number[] {
  const openings = detectOpenings(walls, { minGapPx: 12, maxGapPx: 320 })
  const candidates: number[] = []

  for (const opening of openings) {
    if (opening.widthPx <= 0) continue
    for (const widthMm of COMMON_OPENING_WIDTHS_MM) {
      const scale = widthMm / opening.widthPx
      if (scale >= MIN_SCALE_MM_PER_PX && scale <= MAX_SCALE_MM_PER_PX) {
        candidates.push(scale)
      }
    }
  }

  for (const wall of walls) {
    if (wall.thickness < 2) continue
    for (const widthMm of COMMON_FINISHED_WALLS_MM) {
      const scale = widthMm / wall.thickness
      if (scale >= MIN_SCALE_MM_PER_PX && scale <= MAX_SCALE_MM_PER_PX) {
        candidates.push(scale)
      }
    }
  }

  return Array.from(new Set(candidates.map(roundScaleBucket)))
}

function scoreOpening(mm: number): number {
  let best = 0
  for (const widthMm of COMMON_OPENING_WIDTHS_MM) {
    const tolerance = Math.max(120, widthMm * 0.18)
    const closeness = 1 - Math.abs(mm - widthMm) / tolerance
    if (closeness > best) best = closeness
  }
  return clamp(best, 0, 1)
}

function scoreScaleCandidate(
  walls: ParsedWall[],
  scaleMmPerPx: number,
  drywall: DrywallConfig,
): { score: number; wallHits: number; openingHits: number } {
  let wallScore = 0
  let wallHits = 0

  for (const wall of walls) {
    if (wall.thickness < 2) continue
    const result = classifyWallType(wall.thickness * scaleMmPerPx, drywall)
    if (result.type === 'unknown') continue
    const length = Math.hypot(wall.x2 - wall.x1, wall.y2 - wall.y1)
    const lengthWeight = clamp(length / 120, 0.6, 1.6)
    const detectionWeight = clamp(wall.detectionConfidence ?? 0.7, 0.4, 1)
    wallHits++
    wallScore += result.confidence * lengthWeight * detectionWeight
  }

  const openings = detectOpenings(walls, { minGapPx: 12, maxGapPx: 320 })
  let openingScore = 0
  let openingHits = 0
  for (const opening of openings) {
    const score = scoreOpening(opening.widthPx * scaleMmPerPx)
    if (score <= 0) continue
    openingHits++
    openingScore += score * 1.35
  }

  return {
    score: wallScore + openingScore,
    wallHits,
    openingHits,
  }
}

export function inferScaleFromStructure(
  walls: ParsedWall[],
  drywall: DrywallConfig = 'single-layer',
): InferredScale | null {
  if (walls.length === 0) return null

  const candidates = collectCandidateScales(walls)
  if (candidates.length === 0) return null

  let best: InferredScale | null = null
  let bestScore = 0

  for (const candidate of candidates) {
    const { score, wallHits, openingHits } = scoreScaleCandidate(walls, candidate, drywall)
    const hasSupport = wallHits >= 2 || openingHits >= 1
    if (!hasSupport || score <= bestScore) continue
    bestScore = score
    best = {
      scaleMmPerPx: candidate,
      confidence: clamp(0.35 + score / 12, 0, 0.9),
      support: {
        walls: wallHits,
        openings: openingHits,
      },
    }
  }

  if (!best) return null
  if (best.support.walls < 2 && best.support.openings < 1) return null
  if (bestScore < 2.2) return null
  return best
}
