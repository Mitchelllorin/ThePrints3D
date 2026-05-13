// ─── Drawing Set ───────────────────────────────────────────────────────────────

import type { LineClassificationStats as _LineClassificationStats } from '../symbols/types'

export type DrawingType =
  | 'floor-plan'
  | 'rcp'          // Reflected Ceiling Plan
  | 'architectural'
  | 'structural'
  | 'electrical'
  | 'plumbing'
  | 'mechanical'
  | 'civil'
  | 'other'

export type DrawingStatus = 'pending' | 'processing' | 'ready' | 'error'

export interface ParsedWall {
  /** Pixel coordinates on the rasterized image */
  x1: number
  y1: number
  x2: number
  y2: number
  /** Estimated wall thickness in pixels */
  thickness: number
  /** Structural classification (filled by wallTypeClassifier, may be 'unknown' before scale calibration) */
  wallType?: import('../services/wallTypeClassifier').WallType
  /** Estimated structural framing thickness in mm */
  framingMm?: number
  /** Measured finished thickness in mm */
  finishedMm?: number
  /** 0..1 — how cleanly this wall fits its assigned bucket */
  typeConfidence?: number
}

// Re-export so the Drawing type can reference it without circular imports.
export type { LineClassificationStats, ClassifiedLine, LineClass } from '../symbols/types'

export interface Drawing {
  id: string
  name: string
  type: DrawingType
  file: File
  pageCount: number
  currentPage: number
  /** URL created via URL.createObjectURL for preview */
  previewUrl: string | null
  /** URL of the rasterized canvas image (may differ from previewUrl for PDFs) */
  rasterUrl: string | null
  /** Pixel dimensions of the rasterized image */
  rasterWidth: number | null
  rasterHeight: number | null
  /** Wall segments detected from the rasterized image */
  parsedWalls: ParsedWall[]
  /** Breakdown of every candidate line by class — surfaces what was filtered out. */
  lineClassificationStats?: _LineClassificationStats
  /** 0–100 processing progress */
  parseProgress: number
  /** Floor level inferred from sheet numbering (0 = ground) */
  floorNumber: number | null
  status: DrawingStatus
  errorMessage?: string
  /** Scale factor: real-world mm per pixel on the rasterized image */
  scaleMmPerPx: number | null
  /** Parsed scale notation from title block, e.g. "1:100" */
  scaleNotation: string | null
  uploadedAt: number
}

// ─── Layers ────────────────────────────────────────────────────────────────────

export type LayerId =
  | 'structure'
  | 'walls'
  | 'floors'
  | 'ceiling'
  | 'doors-windows'
  | 'electrical'
  | 'plumbing'
  | 'mechanical'
  | 'furniture'
  | 'annotations'

export interface Layer {
  id: LayerId
  label: string
  color: string
  visible: boolean
  opacity: number
  /** Which drawing types feed this layer */
  sourceTypes: DrawingType[]
  icon: string
}

// ─── 3D Model ──────────────────────────────────────────────────────────────────

export type ModelStatus = 'idle' | 'building' | 'ready' | 'error'

export interface FloorLevel {
  id: string
  label: string
  /** Elevation in metres above ground floor */
  elevation: number
  height: number
  drawingIds: string[]
}

export interface Model3D {
  status: ModelStatus
  floorLevels: FloorLevel[]
  boundingBox: { width: number; depth: number; height: number } | null
  /** Metres per model unit */
  scale: number
  generatedAt: number | null
}

// ─── App State ─────────────────────────────────────────────────────────────────

export type AppView = 'upload' | 'drawings' | 'model'

export interface ScaleCalibration {
  /** px distance measured on canvas */
  pixelDistance: number
  /** real-world distance entered by user (mm) */
  realDistance: number
}

// ─── Measurements ──────────────────────────────────────────────────────────────

export interface Measurement {
  id: string
  label: string | null
  /** World-space coordinates [x,y,z] */
  pointA: [number, number, number]
  pointB: [number, number, number]
  /** Distance in metres */
  distanceM: number
}
