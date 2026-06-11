export interface WallDetectionConfig {
  aiThreshold: number
  edgeThreshold: number
  minWallLengthPx: number
  minWallThicknessPx: number
  maxWallThicknessPx: number
  mergeGapPx: number
}

export const DEFAULT_WALL_DETECTION_CONFIG: WallDetectionConfig = {
  aiThreshold: 0.5,
  edgeThreshold: 8,
  minWallLengthPx: 36,
  minWallThicknessPx: 2,
  maxWallThicknessPx: 80,
  mergeGapPx: 6,
}
