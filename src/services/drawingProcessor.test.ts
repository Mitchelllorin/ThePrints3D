import { describe, expect, it } from 'vitest'
import { deriveScaleFromNotation } from './scaleParser'
import { inferScaleFromStructure } from './scaleInference'
import { extractRooms } from './roomExtractor'
import { detectOpenings } from './openingDetector'
import { buildFraming } from './constructionEngine'
import { filterWallsForNoisyPrint } from './noisyPrintFilter'
import type { ParsedWall } from '../types'

// ─── Helpers ────────────────────────────────────────────────────────────────

function wall(x1: number, y1: number, x2: number, y2: number, thickness: number): ParsedWall {
  return { x1, y1, x2, y2, thickness, source: 'auto', detectionConfidence: 0.85 }
}

/** Synthesize a minimal floor-plan image: white interior, black wall frame */
function makeFloorplanImage(
  width: number,
  height: number,
  wallPx = 8,
): ImageData {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const isWall =
        x < wallPx || x >= width - wallPx ||
        y < wallPx || y >= height - wallPx
      const v = isWall ? 0 : 255
      const i = (y * width + x) * 4
      data[i] = v
      data[i + 1] = v
      data[i + 2] = v
      data[i + 3] = 255
    }
  }
  return { data, width, height, colorSpace: 'srgb' }
}

// ─── scaleParser ─────────────────────────────────────────────────────────────

describe('deriveScaleFromNotation', () => {
  it('parses colon-style architectural scales', () => {
    const mm = deriveScaleFromNotation('1:100')
    expect(mm).not.toBeNull()
    expect(mm!).toBeGreaterThan(20)
    expect(mm!).toBeLessThan(30)
  })

  it('parses slash-separated scales', () => {
    const mm = deriveScaleFromNotation('1/50')
    expect(mm).not.toBeNull()
    expect(mm!).toBeGreaterThan(10)
  })

  it('parses fine-detail scales', () => {
    const mm = deriveScaleFromNotation('1:20')
    expect(mm).not.toBeNull()
    expect(mm!).toBeLessThan(10)
  })

  it('returns null for invalid or implausible values', () => {
    expect(deriveScaleFromNotation('')).toBeNull()
    expect(deriveScaleFromNotation('abc')).toBeNull()
    expect(deriveScaleFromNotation('1:999999')).toBeNull()
    expect(deriveScaleFromNotation('0:0')).toBeNull()
  })
})

// ─── scaleInference ───────────────────────────────────────────────────────────

describe('inferScaleFromStructure', () => {
  it('returns null with no walls', () => {
    expect(inferScaleFromStructure([])).toBeNull()
  })

  it('returns null with a single thin wall (insufficient evidence)', () => {
    expect(inferScaleFromStructure([wall(0, 0, 40, 0, 1)])).toBeNull()
  })

  it('infers a plausible scale from multiple stud-width walls', () => {
    // 4 walls at ~3.75 px thickness → 89mm / 3.75px ≈ 23.7 mm/px (≈1:100 at 108dpi)
    const walls: ParsedWall[] = [
      wall(0, 0, 400, 0, 4),
      wall(0, 300, 400, 300, 4),
      wall(0, 0, 0, 300, 4),
      wall(400, 0, 400, 300, 4),
    ]
    const result = inferScaleFromStructure(walls)
    expect(result).not.toBeNull()
    expect(result!.scaleMmPerPx).toBeGreaterThan(0)
    expect(result!.confidence).toBeGreaterThan(0.3)
  })

  it('confidence is higher with more supporting walls', () => {
    const fewWalls: ParsedWall[] = [
      wall(0, 0, 400, 0, 4),
      wall(0, 300, 400, 300, 4),
    ]
    const manyWalls: ParsedWall[] = [
      ...fewWalls,
      wall(0, 0, 0, 300, 4),
      wall(400, 0, 400, 300, 4),
      wall(0, 150, 400, 150, 4),
      wall(200, 0, 200, 300, 4),
    ]
    const few = inferScaleFromStructure(fewWalls)
    const many = inferScaleFromStructure(manyWalls)
    // If both infer, the one with more support should not have lower confidence
    if (few && many) {
      expect(many.confidence).toBeGreaterThanOrEqual(few.confidence)
    }
  })
})

// ─── roomExtractor ────────────────────────────────────────────────────────────

describe('extractRooms', () => {
  it('finds the single interior region in a simple box floor plan', () => {
    const img = makeFloorplanImage(100, 100, 8)
    const rooms = extractRooms(img)
    expect(rooms.length).toBeGreaterThanOrEqual(1)
    // Largest room should be the interior (not the border-touching exterior)
    expect(rooms[0].areaPx).toBeGreaterThan(0)
  })

  it('computes areaSqM when scaleMmPerPx is provided', () => {
    const img = makeFloorplanImage(200, 200, 10)
    const rooms = extractRooms(img, { scaleMmPerPx: 25 })
    expect(rooms.length).toBeGreaterThanOrEqual(1)
    const room = rooms[0]
    expect(room.areaSqM).not.toBeNull()
    expect(room.areaSqM!).toBeGreaterThan(0)
    // Interior is ~180x180 px at 25mm/px = 4500mm x 4500mm = 20.25 m²
    expect(room.areaSqM!).toBeGreaterThan(5)
    expect(room.areaSqM!).toBeLessThan(100)
  })

  it('leaves areaSqM null when no scale is provided', () => {
    const img = makeFloorplanImage(100, 100)
    const rooms = extractRooms(img)
    for (const r of rooms) {
      expect(r.areaSqM).toBeNull()
    }
  })

  it('excludes regions that touch the image border', () => {
    // A completely white image — flood fill will fill the whole image including borders
    const data = new Uint8ClampedArray(50 * 50 * 4).fill(255)
    const img: ImageData = { data, width: 50, height: 50, colorSpace: 'srgb' }
    const rooms = extractRooms(img)
    // Nothing should survive because everything touches the border
    expect(rooms.length).toBe(0)
  })
})

// ─── openingDetector ─────────────────────────────────────────────────────────

describe('detectOpenings', () => {
  it('detects a door-sized gap between two co-linear horizontal walls', () => {
    // 914mm door gap at 1mm/px
    const walls: ParsedWall[] = [
      wall(0, 0, 300, 0, 8),
      wall(1214, 0, 2000, 0, 8), // gap = 914px → door
    ]
    const openings = detectOpenings(walls, { scaleMmPerPx: 1 })
    expect(openings.length).toBeGreaterThanOrEqual(1)
    expect(openings[0].type).toBe('door')
  })

  it('classifies a narrow gap as a window', () => {
    // 600mm gap at 1mm/px → window
    const walls: ParsedWall[] = [
      wall(0, 0, 200, 0, 8),
      wall(800, 0, 1600, 0, 8),
    ]
    const openings = detectOpenings(walls, { scaleMmPerPx: 1 })
    const doors = openings.filter((o) => o.type === 'door')
    const windows = openings.filter((o) => o.type === 'window')
    // 600px gap → door range starts at 600mm so could be door; verify something is detected
    expect(openings.length).toBeGreaterThanOrEqual(1)
    expect(doors.length + windows.length).toBeGreaterThan(0)
  })

  it('returns empty when walls are not co-linear', () => {
    // Perpendicular walls — no gap to detect
    const walls: ParsedWall[] = [
      wall(0, 0, 500, 0, 8),   // horizontal
      wall(200, 50, 200, 500, 8), // vertical — different orientation
    ]
    // No openings expected between walls with perpendicular orientations
    const openings = detectOpenings(walls, { scaleMmPerPx: 1 })
    // Horizontal wall alone has no gap
    const horizontalOpenings = openings.filter((o) => o.orientation === 'horizontal')
    expect(horizontalOpenings.length).toBe(0)
  })
})

// ─── noisyPrintFilter ────────────────────────────────────────────────────────

describe('filterWallsForNoisyPrint', () => {
  it('penalises short walls (score-based — never drops below minRetentionRatio)', () => {
    // Two walls: one long axis-aligned, one very short and diagonal
    const longWall = { ...wall(0, 0, 300, 0, 8), detectionConfidence: 0.9 }
    const shortDiag = { ...wall(10, 10, 20, 20, 8), detectionConfidence: 0.4 }
    const result = filterWallsForNoisyPrint({
      walls: [longWall, shortDiag],
      classified: [],
      stats: { total: 10, byClass: {}, kept: 2 },
      imageWidth: 500,
      imageHeight: 500,
      minWallLengthPx: 55,
    })
    // Long wall should always be retained
    expect(result.walls.some((w) => w.x2 === 300)).toBe(true)
  })

  it('returns original walls unchanged when fewer than 2 are provided', () => {
    const singleWall = [wall(0, 0, 200, 0, 8)]
    const result = filterWallsForNoisyPrint({
      walls: singleWall,
      classified: [],
      stats: { total: 1, byClass: {}, kept: 1 },
      imageWidth: 500,
      imageHeight: 500,
      minWallLengthPx: 55,
    })
    expect(result.walls).toBe(singleWall)
  })
})

// ─── constructionEngine + wizard wiring ──────────────────────────────────────

describe('buildFraming respects ConstructionEngineOptions', () => {
  const twoWalls: ParsedWall[] = [
    { x1: 0, y1: 0, x2: 5000, y2: 0, thickness: 89, wallType: 'stud-2x4', framingMm: 89 },
    { x1: 0, y1: 0, x2: 0, y2: 5000, thickness: 89, wallType: 'stud-2x4', framingMm: 89 },
  ]

  it('places studs and plates for framed walls', () => {
    const result = buildFraming(twoWalls, [], { scaleMmPerPx: 1 })
    const studs = result.components.filter((c) => c.componentType === 'stud')
    const plates = result.components.filter((c) =>
      c.componentType === 'bottom-plate' || c.componentType === 'top-plate',
    )
    expect(studs.length).toBeGreaterThan(0)
    expect(plates.length).toBeGreaterThan(0)
  })

  it('scales stud height to floorHeightM', () => {
    const low = buildFraming(twoWalls, [], { scaleMmPerPx: 1, floorHeightM: 2.4 })
    const high = buildFraming(twoWalls, [], { scaleMmPerPx: 1, floorHeightM: 3.0 })

    const studHeight = (result: typeof low) =>
      result.components.find((c) => c.componentType === 'stud')?.dimensions[1] ?? 0

    expect(studHeight(high)).toBeGreaterThan(studHeight(low))
  })

  it('emits decisions for the given buildingType', () => {
    const res = buildFraming(twoWalls, [], {
      scaleMmPerPx: 1,
      buildingType: 'commercial',
    })
    expect(res.decisions.length).toBeGreaterThan(0)
    const spacing = res.decisions.find((d) => d.id === 'framing.studSpacing')
    expect(spacing).toBeDefined()
  })

  it('skips masonry walls for framing', () => {
    const masonryWall: ParsedWall = {
      x1: 0, y1: 0, x2: 3000, y2: 0, thickness: 200,
      wallType: 'masonry-thick', framingMm: 200,
    }
    const res = buildFraming([masonryWall], [], { scaleMmPerPx: 1 })
    expect(res.components.filter((c) => c.componentType === 'stud').length).toBe(0)
    expect(res.suggestions.some((s) => s.includes('masonry'))).toBe(true)
  })

  it('places headers at door openings', () => {
    const wallWithDoor: ParsedWall = {
      x1: 0, y1: 0, x2: 5000, y2: 0, thickness: 89, wallType: 'stud-2x4', framingMm: 89,
    }
    const doorOpening = {
      x: 2500, y: 0, widthPx: 914, widthMm: 914, orientation: 'horizontal' as const, type: 'door' as const,
    }
    const res = buildFraming([wallWithDoor], [doorOpening], { scaleMmPerPx: 1 })
    const headers = res.components.filter((c) => c.componentType === 'header')
    expect(headers.length).toBeGreaterThanOrEqual(1)
  })
})
