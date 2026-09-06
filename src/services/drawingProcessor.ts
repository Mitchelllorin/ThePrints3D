import { rasterizeFile } from './pdfRasterizer'
import { detectWallsOffThread } from './detectOffThread'
import { inferFloorNumber } from './sheetParser'
import { deriveScaleFromNotation } from './scaleParser'
import { inferDiscipline, shouldDetectWalls } from './sheetDiscipline'
import { classifyWallType, pxToMm, type DrywallConfig, type WallType } from './wallTypeClassifier'
import { extractRooms } from './roomExtractor'
import { rejoinAcrossOpenings } from './openingDetector'
import type { Drawing, ParsedWall, ScaleConfidence } from '../types'
import { detectWallsWithAI } from './aiWallDetector'
import { logEvent } from './logger'
import { enclosedRegions } from './wallEnclosure'
import { joinDetectedWalls } from './joinDetectedWalls'
import { keepUnlessWorse } from './detectionGuard'
import { wallsFromRooms } from './wallsFromRooms'
import { inferScaleFromPaper, inferScaleFromStructure } from './scaleInference'
import { detectSemanticEntities } from './symbolDetection'
import { filterWallsForNoisyPrint } from './noisyPrintFilter'
import { findWallReturns } from './wallReturns'
import { inferCorners } from './wallTraceReducer'
import { setInkBuffer } from './inkRaster'
import { normalizeForDetection } from './rasterNormalize'
import { shouldOcr, groupIntoLines, type SizedTextToken } from './ocr'
import { ocrRasterOffThread } from './ocrOffThread'
import { statedAreaSqM, looksLikeRoomName } from './roomNames'
import { scaleFromTotalArea, footprintAreaPx } from './scaleInference'

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
  pageOverride?: number,
  /** What a wall IS when the thickness cannot be trusted to say. A house is
   *  stud-framed unless the drawing proves otherwise — see the masonry note
   *  in step 5. Mirrors config `defaultStudSize`. */
  defaultStudType: WallType = 'stud-2x4',
): Promise<DrawingPatch> {
  try {
    let lastProgress = 0
    const setProgress = (pct: number) => {
      const next = Math.max(lastProgress, Math.min(100, Math.round(pct)))
      lastProgress = next
      onProgress(next)
    }

    // 1. Rasterize. For a multi-page set this also PICKS the sheet — the floor
    //    plan is rarely page 1 — unless the caller has named one.
    const raster = await rasterizeFile(drawing.file, (p) => setProgress(p * 0.8), pageOverride)
    // Cache a grayscale "ink" buffer so tracing can snap to the actual printed
    // line under the stroke — even on lines detection discarded as noise.
    /**
     * NORMALISE BEFORE ANYTHING LOOKS AT IT.
     *
     * Every stage below compares brightness against a fixed number —
     * INK_THRESHOLD in inkRaster, WALL_GRAY_THRESHOLD in roomExtractor, and the
     * ImageNet mean/std the wall model was trained with over clean synthetic
     * plans. Those constants are right for a PDF render (near-white paper,
     * near-black ink) and meaningless for a screenshot, whose paper sits around
     * 200 and whose ink sits around 120 — lighter than both thresholds, so
     * nothing reads as a wall at all.
     *
     * Stretching the print onto the full range first makes one set of constants
     * correct for every source. A clean PDF is passed through untouched (see
     * rasterNormalize) so this can only help the broken cases.
     *
     * The DISPLAY raster is deliberately left alone: `rasterUrl` below still
     * points at the original render, because the user should see their drawing,
     * not our corrected copy of it.
     */
    const norm = normalizeForDetection(raster.imageData)
    let detectImage: ImageData = raster.imageData
    if (norm.adjusted) {
      // Copied into a freshly allocated buffer: ImageData will not take an
      // array that might be backed by a SharedArrayBuffer.
      const bytes = new Uint8ClampedArray(norm.image.data.length)
      bytes.set(norm.image.data)
      detectImage = new ImageData(bytes, norm.image.width, norm.image.height)
    }

    setInkBuffer(drawing.id, detectImage)

    /**
     * START READING THE WORDS NOW, NOT AFTER THE WALLS.
     *
     * OCR used to be awaited down at step 3, after detection and filtering had
     * both finished, on the same thread they ran on. That made it the last
     * thing to start and the first thing to starve — measured on the 759x622
     * screenshot in data/test-prints/, it read 35 words on one run and zero on
     * the next, taking 42 seconds against a 25 second budget it could not see
     * it was losing.
     *
     * Now that it lives in a worker (`ocrRasterOffThread`) it costs the main
     * thread nothing to have it already running, so it is kicked off here — the
     * moment there are pixels to read — and collected below. By the time the
     * walls are detected the words are usually sitting there waiting.
     *
     * Not awaited, deliberately. A rejected promise nobody is holding yet is an
     * unhandled rejection, so the catch is attached at the point of creation and
     * the failure is turned into "no words", which is what the caller does with
     * it anyway.
     */
    const wordsPromise: Promise<SizedTextToken[]> = shouldOcr(raster.textTokens)
      ? ocrRasterOffThread(detectImage).then((r) => r.tokens).catch(() => [])
      : Promise.resolve([])

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
        currentPage: raster.page,
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

    /**
     * 3. Detect walls — OFF THE MAIN THREAD.
     *
     * This used to run inline, with a comment saying that was "acceptable for
     * most drawing sizes". It is not, for a real sheet: ten megapixels, and up
     * to THREE full passes over it when the strict one finds nothing. Measured,
     * the smallest print in the corpus had not finished after ninety-five
     * seconds and the tab was locked solid.
     *
     * The whole ladder now goes to a worker in one message — the fallbacks only
     * fire when the previous pass came up empty, so sending them separately
     * would mean up to three round trips and three copies of the image. Falls
     * back to running inline wherever workers are unavailable, so behaviour is
     * unchanged, just no longer on the thread that has to paint.
     */
    setProgress(82)
    const isRasterPhoto = drawing.file.type.startsWith('image/')
    const aiWalls = await detectWallsWithAI(detectImage)
    let result = aiWalls
    if (!result) {
      const { result: detected } = await detectWallsOffThread(detectImage, [
        // Strict: reduces annotation noise (text, dimension lines).
        {
          edgeThreshold: isRasterPhoto ? 30 : 34,
          minWallLengthPx: isRasterPhoto ? 55 : 70,
          minWallThicknessPx: 3,
          maxWallThicknessPx: 60,
          requirePairedEdges: true,
          mergeGapPx: 4,
        },
        // Looser: noisy scans and photos, where strict pairing can miss walls.
        {
          edgeThreshold: isRasterPhoto ? 26 : 30,
          minWallLengthPx: isRasterPhoto ? 40 : 55,
          minWallThicknessPx: 2,
          maxWallThicknessPx: 72,
          requirePairedEdges: false,
          mergeGapPx: 6,
        },
        // Very lenient: degraded scans, low-contrast prints, hand drawings.
        {
          edgeThreshold: isRasterPhoto ? 16 : 20,
          minWallLengthPx: isRasterPhoto ? 28 : 38,
          minWallThicknessPx: 2,
          maxWallThicknessPx: 120,
          requirePairedEdges: false,
          mergeGapPx: 8,
        },
      ])
      result = detected
    }
    /**
     * WHERE DID THE WALLS COME FROM, AND WHERE DID THEY GO?
     *
     * lacounty-adu-A came back with 655 walls on a seven-room bungalow, and
     * nothing in the pipeline could say which stage produced them or which
     * stage failed to remove them. Every number below is counted at the point
     * it changes, so over-detection can be attributed instead of guessed at.
     */
    const stageCounts: Record<string, number> = {}
    const wallSource = aiWalls ? 'ai' : 'ladder'
    stageCounts.detected = result.walls.length

    const filtered = filterWallsForNoisyPrint({
      walls: result.walls,
      classified: result.classified,
      stats: result.stats,
      imageWidth: detectImage.width,
      imageHeight: detectImage.height,
      minWallLengthPx: isRasterPhoto ? 40 : 55,
    })
    /**
     * AND NOW THE RETURNS — see `wallReturns`.
     *
     * The ladder above cannot find them: its shortest pass demands 55px on a
     * screenshot, which on the sheet this was measured against is 806mm, and a
     * wall return is 4 to 24 inches. So every one of them is shorter than the
     * smallest thing the detector is permitted to call a wall.
     *
     * Strictly additive: `filtered.walls` is untouched, and what comes back is
     * only ever short segments that are attached to one of those walls and turn
     * away from it. A print with no returns gets nothing and loses nothing.
     *
     * WHERE THEY END UP IS NOT ALWAYS AS THEIR OWN WALL. On the ADU screenshot
     * the one return found is the jamb piece past the bathroom door, and step 7
     * welds it into the wall run it is collinear with, recording the doorway
     * between them. That is the right answer and the point of finding it: the
     * wall now reaches the far jamb instead of stopping short at the opening,
     * which is the shape of the complaint. So a build can gain a return without
     * gaining a wall, and counting `isReturn` in the finished model understates
     * what this did — see scripts/returns-overlay.mjs.
     */
    stageCounts.afterNoiseFilter = filtered.walls.length
    /**
     * Did the noise filter actually filter, or did it bail?
     *
     * `filterWallsForNoisyPrint` has a retention floor: if scoring keeps fewer
     * than a share of the candidates it hands back the whole capped set
     * instead. That is the difference between a filtered print and an
     * unfiltered one, and it was never recorded anywhere — so a sheet coming
     * back with hundreds of walls looked identical to one that had been
     * cleaned.
     */
    const noiseMetrics = filtered.metrics
    const returns = await findWallReturns(detectImage, filtered.walls, isRasterPhoto)
    if (returns.length) filtered.walls = [...filtered.walls, ...returns]
    stageCounts.afterReturns = filtered.walls.length

    const classificationStats = result.stats
    setProgress(92)

    /**
     * READ THE WORDS, IF NOBODY HAS.
     *
     * A PDF hands over its text layer for free and exactly positioned, so OCR
     * is only ever a fallback for the rasters that have none — a screenshot, a
     * photo, a scan. That is most of what people actually upload, and until now
     * those arrived with no words at all: no room names, so nothing could be
     * tiled or given a kitchen circuit, and no stated area, so scale had to be
     * guessed from line weight and came out 3x wrong on the ADU capture.
     *
     * Phrases as well as words, because a room is usually named in several
     * ("Kitchen & Dining Area") and the total area always is.
     */
    let textTokens = raster.textTokens
    if (shouldOcr(textTokens)) {
      // Started back at step 1, in parallel with detection — this is the
      // collection point, not the beginning of the work.
      const words = await wordsPromise
      if (words.length) textTokens = groupIntoLines(words)
    }

    // 4. Derive scale from notation if available
    let scaleMmPerPx: number | null = null
    if (raster.scaleNotation) {
      scaleMmPerPx = deriveScaleFromNotation(raster.scaleNotation)
    }
    /**
     * THE DRAWING USUALLY STATES ITS OWN SIZE.
     *
     * Every other route here guesses — a door is probably 813mm, a wall is
     * probably 121mm — because the sheet did not say. But "TOTAL AREA = 71 m²"
     * is printed on the ADU capture in data/test-prints/, and one stated area
     * over a footprint we can measure in pixels gives mm/px as arithmetic, with
     * no assumption about what anything is made of.
     *
     * Placed above the structural guess deliberately: this is READ, not
     * inferred, and it is the only route that does not depend on line weight —
     * which is what made the guess 3.1x too big on that very file.
     */
    let scaleFromStatedText = false
    if (scaleMmPerPx == null) {
      const stated = textTokens
        .map((t) => ({ t, area: statedAreaSqM(t.text) }))
        .filter((x): x is { t: typeof x.t; area: number } => x.area != null)
      // Only an explicit TOTAL. Summing the room labels misses halls, walls and
      // anything unlabelled, so it reads small and would skew the scale.
      /**
       * WHICH STATED AREA IS THE WHOLE BUILDING.
       *
       * Requiring the word "total" was too strict to survive OCR. The ADU
       * capture prints "TOTAL AREA = 71 m2" and Tesseract returned that line
       * broken as "AREA = 71 m?" - the figure read correctly, the qualifying
       * word did not, and the one number that fixes the scale was discarded.
       *
       * So take an explicit total when it survives, and otherwise fall back on
       * what makes a total a total: it is no smaller than the other stated
       * areas put together. A label passing that test is the building; one
       * failing it is a room, and a room's area cannot be paired with the
       * whole footprint.
       *
       * Never sum the room labels instead. They miss halls, walls and anything
       * unlabelled, so the sum reads small and the scale comes out short.
       */
      const largest = stated.length
        ? stated.reduce((a, b) => (b.area > a.area ? b : a))
        : null
      const restSum = stated.reduce((s, x) => s + x.area, 0) - (largest?.area ?? 0)
      const total =
        stated.find((x) => /total/i.test(x.t.text)) ??
        (largest && largest.area >= restSum && /area/i.test(largest.t.text)
          ? largest
          : undefined)
      if (total) {
        const candidate = scaleFromTotalArea(total.area, footprintAreaPx(filtered.walls))
        if (candidate != null) {
          scaleMmPerPx = candidate
          scaleFromStatedText = true
        }
      }
    }
    if (scaleMmPerPx == null && drawing.scaleMmPerPx == null) {
      // Paper-anchored first. When the sheet states its own size the question
      // collapses from "what is the scale" to "which of the standard scales",
      // which is a far easier one to get right — the free-range version put the
      // real 1-&-2-family set out by about 4×, calling every wall 600mm of
      // masonry. Falls through to the unanchored guess for photos and images,
      // where nothing says how big the paper was.
      scaleMmPerPx =
        (raster.pxPerPaperInch
          ? inferScaleFromPaper(result.walls, raster.pxPerPaperInch, drywall)?.scaleMmPerPx
          : null) ??
        inferScaleFromStructure(result.walls, drywall)?.scaleMmPerPx ??
        null
    }
    const effectiveScale = scaleMmPerPx ?? drawing.scaleMmPerPx

    // Determine confidence based on how the scale was sourced.
    // A stated area counts as PARSED, not inferred: it was read off the sheet.
    // That distinction has teeth — only a trusted scale is allowed to conclude
    // masonry in step 5.
    const scaleConfidence: ScaleConfidence = raster.scaleNotation || scaleFromStatedText
      ? 'parsed'
      : effectiveScale !== null
        ? 'inferred'
        : 'fallback'

    // 5. Classify each detected wall into a structural type (2x4 / 2x6 / etc.)
    //    Only meaningful once scale is known — otherwise leave as 'unknown'.
    //    Corner inference first: perpendicular walls whose endpoints nearly
    //    meet get extended/trimmed to an exact intersection, so detected
    //    walls connect instead of floating as disjoint segments.
    const corneredWalls = inferCorners(filtered.walls)
    stageCounts.afterCorners = corneredWalls.length
    let walls: ParsedWall[] = corneredWalls.map((w) => {
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
      /**
       * MASONRY IS NEVER A GUESS.
       *
       * The classifier buckets a thickness in MILLIMETRES, and those
       * millimetres come from the scale. Get the scale wrong on the high side
       * and every wall in the house measures far too thick — past 2x12, into
       * the masonry bucket — so a timber-framed one-bed came out as CMU, brown
       * and 300mm, with the takeoff and the model to match. The note in step 4
       * records exactly this happening: a real 1-&-2-family set out by about
       * 4x, "calling every wall 600mm of masonry".
       *
       * A residential plan is overwhelmingly stud-framed, so on a scale we only
       * INFERRED, masonry is far more likely to be arithmetic than a material
       * choice. Only a scale we actually READ off the drawing is allowed to
       * reach that conclusion; otherwise the wall keeps the default framing the
       * project is set to build in, which for a house is timber.
       */
      const trustedScale = scaleConfidence === 'parsed'
      const type = c.type === 'masonry-thick' && !trustedScale ? defaultStudType : c.type
      return {
        ...w,
        source: w.source ?? 'auto',
        detectionConfidence: w.detectionConfidence ?? c.confidence,
        wallType: type,
        framingMm: c.framingMm,
        finishedMm: c.finishedMm,
        // Say out loud that the type was defaulted rather than measured.
        typeConfidence: type === c.type ? c.confidence : 0.3,
      }
    })

    // 6. Extract enclosed room regions from the rasterized image
    const rooms = extractRooms(detectImage, {
      scaleMmPerPx: effectiveScale,
      /**
       * The drawing's own labels, as ground truth for the fill.
       *
       * Five room names means five rooms, so a fill that swallows two of them
       * has escaped through a doorway and the extractor can widen its seal and
       * try again. Only tokens that actually NAME a room are passed — a
       * dimension or a title block is not an interior point, and seeding on one
       * would ask the extractor to justify a room that is not there.
       */
      labels: textTokens
        .filter((t) => looksLikeRoomName(t.text))
        .map((t) => ({ x: t.x, y: t.y, text: t.text })),
    })

    // 7. Detect door/window openings — and REJOIN the walls they interrupt.
    //    In framing this hole is a ROUGH OPENING (R.O.): the studs stop, king
    //    and jack studs frame the sides, a header spans it and the plate runs
    //    over the top. It is a hole in a wall, not the end of one. The detector
    //    was leaving two stub walls with a gap, so framing put a wall end where
    //    a header belongs and anything routing inside the wall stopped at the
    //    door.
    const rejoined = rejoinAcrossOpenings(walls, {
      scaleMmPerPx: effectiveScale,
    })
    walls = rejoined.walls
    stageCounts.afterRejoin = walls.length
    const openings = rejoined.openings

    /**
     * NOW MAKE THE CORNERS MEET — AND ROLL BACK IF THAT MADE IT WORSE.
     *
     * `rejoinAcrossOpenings` above closes the COLLINEAR case: a doorway gap in
     * an otherwise straight run. It cannot close the perpendicular one, where
     * two walls stop a few pixels short of each other, and neither can
     * `inferCorners` in step 5 — that one only fires when both walls'
     * ENDPOINTS are already within 20px, so it closes L-corners and misses the
     * T-junctions that most interior walls actually form. Twenty pixels is also
     * an absolute constant, which is the bug class behind most of the others:
     * it is nothing on a 3900px sheet and a great deal on a 732px screenshot.
     *
     * `joinDetectedWalls` casts a ray from each endpoint along the wall's own
     * direction until it meets another wall's INTERIOR, so it ties in Ts as
     * well as corners, with a tolerance taken from the median wall length
     * rather than a pixel count. It was written for this and has been sitting
     * unwired, reachable only from the dev sweep.
     *
     * It runs BEFORE the room-derived rung below on purpose. Walls read off
     * the ink and carried to meet each other are a truer building than
     * boundaries estimated from a room's bounding box, so the cheap real fix
     * gets its turn before the estimate does.
     */
    const joined = joinDetectedWalls(walls)
    if (joined.joined > 0) {
      /**
       * Extending endpoints can shatter a room as easily as close one — a wall
       * carried across an opening splits the space behind it. So the step is
       * measured, not trusted, against the room extractor's own independent
       * reading of the same raster.
       */
      const verdict = keepUnlessWorse(
        walls, joined.walls, detectImage.width, detectImage.height,
        rooms.length || null,
      )
      walls = verdict.walls
      logEvent('drawing.walls.joined', {
        drawingId: drawing.id,
        endpointsMoved: joined.joined,
        maxExtendPx: Math.round(joined.maxExtendPx),
        kept: verdict.kept,
        enclosedBefore: verdict.enclosedBefore,
        enclosedAfter: verdict.enclosedAfter,
        reason: verdict.reason,
      })
    }

    /**
     * THE LAST RUNG: IF THE WALLS DO NOT MAKE ROOMS, USE THE ROOMS.
     *
     * Every step above is a cascade — the model, then the heuristic ladder,
     * then the returns pass, then rejoining across doorways — and each only
     * knows to try because the one before produced NOTHING. That is a poor
     * test. A print can come back with fifty walls that enclose no rooms at
     * all, and every guard in the pipeline waves it through because fifty is
     * not zero. Measured on screenshot-adu-71sqm: 50-plus walls, ZERO enclosed
     * rooms, across 42 threshold configurations and again after corner-joining.
     * The lines were read; they simply never closed.
     *
     * `extractRooms` was succeeding on that same image the whole time, from the
     * other direction — it floods the raster, seals the doorways, reads the
     * labels, and found 7 rooms against a stated truth of 5. The app knew where
     * the kitchen was. Nothing had ever turned that back into the walls which
     * must be around it.
     *
     * So when the ink-read walls enclose less of the plan than the rooms say
     * exists, the rooms' own boundaries are added. They are marked
     * `roomDerived`, because they are an estimate from a bounding box rather
     * than a reading of the ink, and the user is the one who corrects them.
     * Additive: nothing the detector found is discarded.
     */
    const roomsFound = rooms.length
    if (roomsFound > 0) {
      const enclosed = enclosedRegions(walls, detectImage.width, detectImage.height)
      if (enclosed < roomsFound) {
        const thicknessPx = walls.length
          ? [...walls].map((w) => w.thickness).sort((a, b) => a - b)[Math.floor(walls.length / 2)]
          : 6
        const derived = wallsFromRooms(rooms, thicknessPx, detectImage.width * detectImage.height)
        if (derived.walls.length) {
          walls = [...walls, ...derived.walls]
          logEvent('drawing.walls.roomDerived', {
            drawingId: drawing.id,
            enclosedBefore: enclosed,
            roomsFound,
            added: derived.walls.length,
            sharedEdges: derived.shared,
            roomsRejected: derived.rejected,
            enclosedAfter: enclosedRegions(walls, detectImage.width, detectImage.height),
          })
        }
      }
    }

    stageCounts.final = walls.length
    logEvent('drawing.walls.stages', {
      drawingId: drawing.id,
      source: wallSource,
      ...stageCounts,
      profile: noiseMetrics.profileId,
      filterBailed: noiseMetrics.fallbackApplied,
      noiseRatio: +noiseMetrics.noiseRatio.toFixed(3),
      threshold: +noiseMetrics.adaptiveThreshold.toFixed(3),
      rooms: rooms.length,
      imageW: detectImage.width,
      imageH: detectImage.height,
      /** What SHAPE are the things being called rooms? A plan's rooms are a
       *  handful of large boxes that tile the footprint. Fifty-seven small
       *  ones scattered over a page are paragraphs of body text. */
      roomAreaShares: rooms
        .map((r) => Math.abs((r.x2 - r.x1) * (r.y2 - r.y1)) / (detectImage.width * detectImage.height))
        .sort((a, b) => b - a)
        .map((v) => +v.toFixed(4)),
      roomsNamed: rooms.filter((r) => !!r.name).length,
    })

    // 8. Derive text/symbol/annotation semantics by combining detector outputs
    //    with the canonical symbol glossary.
    const semantic = detectSemanticEntities({
      classifiedLines: result.classified,
      walls,
      openings,
      rooms,
      textTokens,
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
      currentPage: raster.page,
      parsedWalls: walls,
      // The NAMED rooms, not the bare geometric ones — see symbolDetection.
      // A room that knows it is a bathroom is what makes wetWalls put tile
      // backer on it and the electrical rules give a kitchen its circuits.
      parsedRooms: semantic.rooms,
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
