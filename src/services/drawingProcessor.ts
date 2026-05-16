import { rasterizeFile } from './pdfRasterizer'
import { detectWalls } from './wallDetector'
import { inferFloorNumber } from './sheetParser'
import { deriveScaleFromNotation } from './scaleParser'
import { inferDiscipline, shouldDetectWalls } from './sheetDiscipline'
import { classifyWallType, pxToMm, type DrywallConfig } from './wallTypeClassifier'
import { extractRooms } from './roomExtractor'
import { detectOpenings } from './openingDetector'
import type { Drawing, ParsedWall, ScaleConfidence } from '../types'
import { detectWallsWithAI } from './aiWallDetector'
import { detectSemanticEntities } from './symbolDetection'

export type DrawingPatch = Partial<Drawing>

/**
 * Full processing pipeline for a single drawing.
 * Resolves with a patch to apply to the Drawing in the store.
 *
 * @param drywall Drywall configuration assumed when converting finished →
 *                framing thickness. Defaults to single-layer 5/8" both sides
 *                (residential). Override to 'double-layer' for fire-rated
 *                demising / shaft walls common in multi-unit / commercial.
 */
export async function processDrawing(
  drawing: Drawing,
  onProgress: (pct: number) => void,
  drywall: DrywallConfig = 'single-layer',
): Promise<DrawingPatch> {
  try {
    let lastProgress = 0
    const setProgress = (pct: number) => {
      const next = Math.max(lastProgress, Math.min(100, Math.round(pct)))
      lastProgress = next
      onProgress(next)
    }

    // 1. Rasterize
    const raster = await rasterizeFile(drawing.file, (p) => setProgress(p * 0.8))

    // 2. Discipline gate — skip wall detection on M/E/P/C/L/F/T sheets where
    //    "thick parallels" are ducts/pipes/conduit, not walls.
    const discipline = inferDiscipline(drawing.name)
    if (!shouldDetectWalls(discipline)) {
      setProgress(100)
      const gatedScaleConf: ScaleConfidence = raster.scaleNotation
        ? 'parsed'
        : drawing.scaleMmPerPx !== null
          ? 'inferred'
          : 'fallback'
      return {
        status: 'ready',
        rasterUrl: raster.blobUrl,
        rasterWidth: raster.width,
        rasterHeight: raster.height,
        pageCount: raster.pageCount,
        parsedWalls: [],
        parsedRooms: [],
        parsedOpenings: [],
        parsedText: [],
        parsedSymbols: [],
        parsedAnnotationCandidates: [],
        parseProgress: 100,
        scaleNotation: raster.scaleNotation ?? drawing.scaleNotation,
        scaleMmPerPx: drawing.scaleMmPerPx,
        scaleConfidence: gatedScaleConf,
        floorNumber: inferFloorNumber(drawing.name) ?? drawing.floorNumber,
      }
    }

    // 3. Detect walls (runs in main thread — acceptable for most drawing sizes)
    setProgress(82)
    const isRasterPhoto = drawing.file.type.startsWith('image/')
    let result = await detectWallsWithAI(raster.imageData)
    if (!result) {
      result = detectWalls(raster.imageData, {
        // Stricter defaults reduce annotation noise (text/dimension lines)
        edgeThreshold: isRasterPhoto ? 30 : 34,
        minWallLengthPx: isRasterPhoto ? 55 : 70,
        minWallThicknessPx: 3,
        maxWallThicknessPx: 60,
        requirePairedEdges: true,
        mergeGapPx: 4,
      })
    }
    if (result.walls.length === 0) {
      // Stricter defaults reduce annotation noise (text/dimension lines)
      // Fallback pass for noisy scans/photos where strict pairing can miss walls.
      result = detectWalls(raster.imageData, {
        edgeThreshold: isRasterPhoto ? 26 : 30,
        minWallLengthPx: isRasterPhoto ? 40 : 55,
        minWallThicknessPx: 2,
        maxWallThicknessPx: 72,
        requirePairedEdges: false,
        mergeGapPx: 6,
      })
    }
    if (result.walls.length === 0) {
      // Third pass: very lenient — targets heavily degraded scans, low-contrast
      // prints, and hand-drawn sketches where normal edge magnitudes are low.
      result = detectWalls(raster.imageData, {
        edgeThreshold: isRasterPhoto ? 16 : 20,
        minWallLengthPx: isRasterPhoto ? 28 : 38,
        minWallThicknessPx: 2,
        maxWallThicknessPx: 120,
        requirePairedEdges: false,
        mergeGapPx: 8,
      })
    }
    const classificationStats = result.stats
    setProgress(92)

    // 4. Derive scale from notation if available
    let scaleMmPerPx: number | null = null
    if (raster.scaleNotation) {
      scaleMmPerPx = deriveScaleFromNotation(raster.scaleNotation)
    }
    const effectiveScale = scaleMmPerPx ?? drawing.scaleMmPerPx

    // Determine confidence based on how the scale was sourced.
    const scaleConfidence: ScaleConfidence = raster.scaleNotation
      ? 'parsed'
      : drawing.scaleMmPerPx !== null
        ? 'inferred'
        : 'fallback'

    // 5. Classify each detected wall into a structural type (2x4 / 2x6 / etc.)
    //    Only meaningful once scale is known — otherwise leave as 'unknown'.
    const walls: ParsedWall[] = result.walls.map((w) => {
      const finishedMm = pxToMm(w.thickness, effectiveScale)
      if (finishedMm === null) {
        return {
          ...w,
          source: w.source ?? 'auto',
          detectionConfidence: w.detectionConfidence ?? 0.65,
          wallType: 'unknown' as const,
        }
      }
      const c = classifyWallType(finishedMm, drywall)
      return {
        ...w,
        source: w.source ?? 'auto',
        detectionConfidence: w.detectionConfidence ?? c.confidence,
        wallType: c.type,
        framingMm: c.framingMm,
        finishedMm: c.finishedMm,
        typeConfidence: c.confidence,
      }
    })

    // 6. Extract enclosed room regions from the rasterized image
    const rooms = extractRooms(raster.imageData, {
      scaleMmPerPx: effectiveScale,
    })

    // 7. Detect door/window openings as gaps between co-linear wall segments
    const openings = detectOpenings(walls, {
      scaleMmPerPx: effectiveScale,
    })

    // 8. Derive text/symbol/annotation semantics by combining detector outputs
    //    with the canonical symbol glossary.
    const semantic = detectSemanticEntities({
      classifiedLines: result.classified,
      walls,
      openings,
      rooms,
      textTokens: raster.textTokens,
    })

    // 9. Floor number from filename
    const floorNumber = inferFloorNumber(drawing.name)

    setProgress(100)

    return {
      status: 'ready',
      rasterUrl: raster.blobUrl,
      rasterWidth: raster.width,
      rasterHeight: raster.height,
      pageCount: raster.pageCount,
      parsedWalls: walls,
      parsedRooms: rooms,
      parsedOpenings: openings,
      parsedText: semantic.text,
      parsedSymbols: semantic.symbols,
      parsedAnnotationCandidates: semantic.annotations,
      lineClassificationStats: classificationStats,
      parseProgress: 100,
      scaleNotation: raster.scaleNotation ?? drawing.scaleNotation,
      scaleMmPerPx: effectiveScale,
      scaleConfidence,
      floorNumber: floorNumber ?? drawing.floorNumber,
    }
  } catch (err) {
    return {
      status: 'error',
      errorMessage: err instanceof Error ? err.message : 'Processing failed',
      parseProgress: 0,
    }
  }
}
