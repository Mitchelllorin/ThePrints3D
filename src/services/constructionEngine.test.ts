import { describe, it, expect, beforeEach } from 'vitest'
import { buildFraming, _resetIdCounter } from './constructionEngine'
import type { ParsedWall, ParsedOpening } from '../types'
import { orderDecisions, shouldSmartSkip } from './decisions'

// ─── Fixtures ───────────────────────────────────────────────────────────────

/** 10 m horizontal wall (10 000 px at 1 mm/px scale) */
function makeWall(overrides: Partial<ParsedWall> = {}): ParsedWall {
  return {
    x1: 0,
    y1: 0,
    x2: 10000,
    y2: 0,
    thickness: 89,
    wallType: 'stud-2x4',
    framingMm: 89,
    ...overrides,
  }
}

/** Two walls forming an L-shape (horizontal + vertical, meeting at origin) */
function makeLShape(): ParsedWall[] {
  return [
    makeWall({ x1: 0, y1: 0, x2: 5000, y2: 0 }),
    makeWall({ x1: 0, y1: 0, x2: 0, y2: 5000 }),
  ]
}

function makeDoorOpening(overrides: Partial<ParsedOpening> = {}): ParsedOpening {
  return {
    x: 5000,
    y: 0,
    widthPx: 914,
    widthMm: 914,
    orientation: 'horizontal',
    type: 'door',
    ...overrides,
  }
}

function makeWindowOpening(overrides: Partial<ParsedOpening> = {}): ParsedOpening {
  return {
    x: 3000,
    y: 0,
    widthPx: 1200,
    widthMm: 1200,
    orientation: 'horizontal',
    type: 'window',
    ...overrides,
  }
}

const DEFAULT_OPTIONS = {
  scaleMmPerPx: 1,
  floorHeightM: 2.7,
  buildingType: 'residential-single' as const,
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('constructionEngine – buildFraming', () => {
  beforeEach(() => {
    _resetIdCounter()
  })

  it('places studs along a single wall at 16" OC', () => {
    const walls = [makeWall()]
    const result = buildFraming(walls, [], DEFAULT_OPTIONS)

    const studs = result.components.filter((c) => c.componentType === 'stud')
    expect(studs.length).toBeGreaterThan(0)

    // 10m wall ≈ 10000mm. At 406.4mm OC → ~24 studs + end stud
    expect(studs.length).toBeGreaterThanOrEqual(24)

    // All studs should be on layer 'framing'
    for (const s of studs) {
      expect(s.layer).toBe('framing')
    }
  })

  it('places top and bottom plates', () => {
    const walls = [makeWall()]
    const result = buildFraming(walls, [], DEFAULT_OPTIONS)

    const topPlates = result.components.filter((c) => c.componentType === 'top-plate')
    const bottomPlates = result.components.filter((c) => c.componentType === 'bottom-plate')

    expect(topPlates.length).toBe(2) // double top plate
    expect(bottomPlates.length).toBe(1) // single bottom plate

    // Plates span the full wall length
    for (const plate of [...topPlates, ...bottomPlates]) {
      expect(plate.dimensions[0]).toBeCloseTo(10, 0) // ~10m
    }
  })

  it('frames a door opening with king studs, jack studs, and header', () => {
    const walls = [makeWall()]
    const openings = [makeDoorOpening()]
    const result = buildFraming(walls, openings, DEFAULT_OPTIONS)

    const kings = result.components.filter((c) => c.componentType === 'king-stud')
    const jacks = result.components.filter((c) => c.componentType === 'jack-stud')
    const headers = result.components.filter((c) => c.componentType === 'header')

    expect(kings.length).toBe(2) // one each side
    expect(jacks.length).toBe(2) // one each side
    expect(headers.length).toBe(1)

    // Header width should approximate door width
    expect(headers[0].dimensions[0]).toBeCloseTo(0.914, 1)
  })

  it('frames a window opening with cripple studs below sill', () => {
    const walls = [makeWall()]
    const openings = [makeWindowOpening()]
    const result = buildFraming(walls, openings, DEFAULT_OPTIONS)

    const headers = result.components.filter((c) => c.componentType === 'header')
    const cripples = result.components.filter((c) => c.componentType === 'cripple-stud')

    expect(headers.length).toBe(1)
    // Window should have cripples (above header and/or below sill)
    expect(cripples.length).toBeGreaterThan(0)
  })

  it('detects corner assemblies at L-shaped wall junctions', () => {
    const walls = makeLShape()
    const result = buildFraming(walls, [], DEFAULT_OPTIONS)

    const corners = result.components.filter((c) => c.componentType === 'corner-assembly')
    expect(corners.length).toBe(1)
    expect(corners[0].label).toContain('Corner assembly')
  })

  it('skips masonry walls (no framing placed)', () => {
    const walls = [makeWall({ wallType: 'masonry-thick', framingMm: 305 })]
    const result = buildFraming(walls, [], DEFAULT_OPTIONS)

    // No studs on masonry walls
    const studs = result.components.filter((c) => c.componentType === 'stud')
    expect(studs.length).toBe(0)

    // Should emit suggestion about skipped masonry
    expect(result.suggestions.some((s) => /masonry/i.test(s))).toBe(true)
  })

  it('uses 2x6 studs for commercial building type', () => {
    const walls = [makeWall({ wallType: 'stud-2x6', framingMm: 140 })]
    const result = buildFraming(walls, [], {
      ...DEFAULT_OPTIONS,
      buildingType: 'commercial',
    })

    const studs = result.components.filter((c) => c.componentType === 'stud')
    expect(studs.length).toBeGreaterThan(0)
    expect(studs[0].label).toContain('2x6')
  })

  it('skips tiny wall segments (<0.3m)', () => {
    const walls = [makeWall({ x2: 200 })] // 200px = 0.2m at 1mm/px
    const result = buildFraming(walls, [], DEFAULT_OPTIONS)

    // Too short to frame
    const studs = result.components.filter((c) => c.componentType === 'stud')
    expect(studs.length).toBe(0)
  })

  it('emits framing decisions with valid structure', () => {
    const walls = [makeWall()]
    const openings = [makeDoorOpening()]
    const result = buildFraming(walls, openings, DEFAULT_OPTIONS)

    expect(result.decisions.length).toBeGreaterThanOrEqual(4)

    // Every decision should have required fields
    for (const d of result.decisions) {
      expect(d.id).toBeTruthy()
      expect(d.layer).toBe('framing')
      expect(d.question).toBeTruthy()
      expect(d.options.length).toBeGreaterThan(0)
      expect(d.confidence).toBeGreaterThanOrEqual(0)
      expect(d.confidence).toBeLessThanOrEqual(1)
    }

    // Should include stud size and spacing decisions
    expect(result.decisions.some((d) => d.id === 'framing.studSize')).toBe(true)
    expect(result.decisions.some((d) => d.id === 'framing.studSpacing')).toBe(true)
    expect(result.decisions.some((d) => d.id === 'framing.headerDoublePly')).toBe(true)
  })

  it('handles empty wall input gracefully', () => {
    const result = buildFraming([], [], DEFAULT_OPTIONS)
    expect(result.components.length).toBe(0)
    expect(result.decisions.length).toBeGreaterThan(0) // still emits defaults
    expect(result.suggestions.length).toBe(0)
  })

  it('assigns unique IDs to all components', () => {
    const walls = makeLShape()
    const openings = [makeDoorOpening({ x: 2500, y: 0 })]
    const result = buildFraming(walls, openings, DEFAULT_OPTIONS)

    const ids = result.components.map((c) => c.id)
    const uniqueIds = new Set(ids)
    expect(uniqueIds.size).toBe(ids.length)
  })
})

describe('decisions – ordering & smart-skip', () => {
  it('orders decisions by layer rank then dependency', () => {
    const walls = [makeWall()]
    const { decisions } = buildFraming(walls, [makeDoorOpening()], DEFAULT_OPTIONS)

    const ordered = orderDecisions(decisions)
    // All framing — ordering should respect dependsOn
    const studSizeIdx = ordered.findIndex((d) => d.id === 'framing.studSize')
    const spacingIdx = ordered.findIndex((d) => d.id === 'framing.studSpacing')
    expect(studSizeIdx).toBeLessThan(spacingIdx)
  })

  it('smart-skips high-confidence decisions', () => {
    const walls = [makeWall()]
    const { decisions } = buildFraming(walls, [], DEFAULT_OPTIONS)

    // Top plate count has 0.95 confidence → should be skipped
    const topPlate = decisions.find((d) => d.id === 'framing.topPlateCount')
    expect(topPlate).toBeDefined()
    expect(shouldSmartSkip(topPlate!)).toBe(true)

    // Stud size has 0.85 confidence → should NOT be skipped
    const studSize = decisions.find((d) => d.id === 'framing.studSize')
    expect(studSize).toBeDefined()
    expect(shouldSmartSkip(studSize!)).toBe(false)
  })
})
