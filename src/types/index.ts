// ─── Construction Engine ────────────────────────────────────────────────────────

export type {
  ConstructionLayer,
  Decision,
  DecisionOption,
  BuildResult,
  PlacedComponent,
  FramingComponentType,
} from '../services/decisions'

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

/**
 * How the scale value was determined:
 * - 'parsed'   — extracted directly from the PDF text layer (title block)
 * - 'inferred' — carried over from a previous run or user calibration
 * - 'fallback' — no scale information found; manual calibration needed
 */
export type ScaleConfidence = 'parsed' | 'inferred' | 'fallback'

export interface ParsedWall {
  /** Pixel coordinates on the rasterized image */
  x1: number
  y1: number
  x2: number
  y2: number
  /** Estimated wall thickness in pixels */
  thickness: number
  /** Detection source: auto pipeline vs user-traced override */
  source?: 'auto' | 'user'
  /** 0..1 confidence from detection/classification stage */
  detectionConfidence?: number
  /** Structural classification (filled by wallTypeClassifier, may be 'unknown' before scale calibration) */
  wallType?: import('../services/wallTypeClassifier').WallType
  /** Estimated structural framing thickness in mm */
  framingMm?: number
  /** Measured finished thickness in mm */
  finishedMm?: number
  /** 0..1 — how cleanly this wall fits its assigned bucket */
  typeConfidence?: number
  /** Framing material/size chosen in the wall-type picker, e.g. 'wood-2x6' */
  framingType?: string
  /** Structural role chosen in the wall-type picker, e.g. 'exterior-bearing' */
  wallRole?: string
}

/**
 * A furniture/fixture item placed by the user into the 3D scene.
 * Position is in world metres (X/Z ground plane); dimensions come from the
 * catalog default and may be tweaked via the per-axis scale factors.
 */
export interface PlacedObject {
  id: string
  /** Catalog type key, e.g. 'sofa' | 'door' */
  type: string
  /** World position on the ground plane (metres) */
  x: number
  z: number
  /** Rotation about the vertical (Y) axis, radians */
  rotationY: number
  /** Per-axis scale factors applied to the catalog default dimensions */
  scaleX: number
  scaleZ: number
  scaleY: number
  /** Human-readable label shown in the UI */
  label: string
  /** Sub-type (e.g. door 'pocket', window 'casement'); furniture leaves blank */
  subtype?: string
  /** Free-text brand/model (placeholder for product matching later) */
  brand?: string
}

/** A room (enclosed region) detected by flood-filling the rasterized image. */
export interface ParsedRoom {
  id: string
  /** Centroid in pixel coordinates */
  cx: number
  cy: number
  /** Bounding box in pixel coordinates */
  x1: number
  y1: number
  x2: number
  y2: number
  /** Area in square pixels */
  areaPx: number
  /** Area in square metres (null if scale unknown) */
  areaSqM: number | null
}

/** A door or window opening detected as a gap between co-linear wall segments. */
export interface ParsedOpening {
  /** Gap midpoint in pixel coordinates */
  x: number
  y: number
  /** Width of the gap in pixels */
  widthPx: number
  /** Width in mm (null if scale unknown) */
  widthMm: number | null
  /** Orientation of the wall containing this opening */
  orientation: 'horizontal' | 'vertical'
  /** Best guess at opening type based on gap width */
  type: 'door' | 'window' | 'unknown'
}

/** Parsed text entity detected from drawing text layers (or future OCR). */
export interface ParsedTextEntity {
  id: string
  text: string
  x: number
  y: number
  kind: 'room_tag' | 'dimension' | 'callout' | 'note'
  confidence: number
  source: 'pdf_text' | 'ocr'
}

/** Symbol candidate mapped to a glossary symbol entry. */
export interface ParsedSymbol {
  id: string
  symbolId: string
  category: import('../symbols/types').SymbolCategory
  label: string
  x: number
  y: number
  confidence: number
  source: 'line_classifier' | 'opening_detector' | 'room_extractor' | 'wall_detector'
}

/** Annotation candidate inferred from parsed text/symbol context on the sheet. */
export interface ParsedAnnotationCandidate {
  id: string
  x: number
  y: number
  text?: string
  kind: 'room_tag' | 'dimension' | 'callout' | 'note'
  confidence: number
  source: 'text' | 'room' | 'symbol'
}

// Re-export so the Drawing type can reference it without circular imports.
export type { LineClassificationStats, ClassifiedLine, LineClass } from '../symbols/types'

export interface Drawing {
  id: string
  name: string
  source?: 'upload' | 'preset'
  presetDifficulty?: 'easy' | 'medium' | 'hard'
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
  /** Enclosed room regions detected by flood-filling the rasterized image */
  parsedRooms: ParsedRoom[]
  /** Door/window openings detected as gaps between co-linear wall segments */
  parsedOpenings: ParsedOpening[]
  /** Text entities detected from the source document */
  parsedText: ParsedTextEntity[]
  /** Symbol detections mapped against the canonical symbol glossary */
  parsedSymbols: ParsedSymbol[]
  /** Inferred annotation candidates detected on the sheet */
  parsedAnnotationCandidates: ParsedAnnotationCandidate[]
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
  /** How the scale value was determined */
  scaleConfidence: ScaleConfidence | null
  uploadedAt: number
}

// ─── Layers ────────────────────────────────────────────────────────────────────

export type LayerId =
  | 'structure'
  | 'walls'
  | 'floors'
  | 'ceiling'
  | 'doors-windows'
  | 'framing'
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

export type AppView = 'upload' | 'drawings' | 'model' | 'tools'

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
  /** Unix timestamp (ms) when this measurement was created */
  createdAt: number
}

// ─── Smart Processing / Seed-Guided Detection ────────────────────────────────

export interface WallLayer {
  name: string
  thicknessMm: number
  material: string
}

export interface WallType {
  id: string
  name: string
  thicknessMm: number
  layers: WallLayer[]
  loadBearing: boolean
  usage: 'interior' | 'exterior' | 'partition'
  markupTag: string
  color: string
}

export interface UserTrace {
  points: [number, number][]
  timestamp: number
}

export interface SeedWall {
  x1: number
  y1: number
  x2: number
  y2: number
  thicknessPx: number
  confidence: number
}

export interface DetectedWallType {
  wallId: string
  wallType: WallType
  confidence: number
  fromSeed: boolean
}

// ─── Annotations ──────────────────────────────────────────────────────────────

export interface Annotation {
  id: string
  /** World-space anchor [x, y, z] */
  position: [number, number, number]
  /** Display text */
  text: string
  /** Emoji icon */
  icon: string
  /** Hex colour string e.g. "#f87171" */
  color: string
  createdAt: number
}

// ─── Unified 2D→3D Wizard Context ─────────────────────────────────────────────

export type WizardGroupId = 'group1' | 'group2' | 'group3'

export interface WorkspaceWizardInputs {
  set1BuildingBasics: string
  set1Clarifications: string
  set2StructuralDetails: string
  set2Clarifications: string
  set3FinishingDetails: string
  set3Clarifications: string
  completedGroup: WizardGroupId
  completedAt: number
}

export interface FloorplanOverlayState {
  drawingId: string | null
  visible: boolean
  locked: boolean
  snapToGrid: boolean
  calibrationMode: boolean
  traceModeActive: boolean
  guidedStep: number
  position: [number, number]
  scale: [number, number]
  rotationDeg: number
  opacity: number
}
