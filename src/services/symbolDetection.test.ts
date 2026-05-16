import { describe, expect, it } from 'vitest'
import { detectSemanticEntities } from './symbolDetection'

describe('detectSemanticEntities', () => {
  it('maps openings to glossary-backed door/window symbols', () => {
    const result = detectSemanticEntities({
      classifiedLines: [],
      walls: [],
      openings: [
        { x: 120, y: 80, widthPx: 40, widthMm: 900, orientation: 'horizontal', type: 'door' },
        { x: 220, y: 90, widthPx: 30, widthMm: 1200, orientation: 'vertical', type: 'window' },
      ],
      rooms: [],
      textTokens: [],
    })

    expect(result.symbols.some((s) => s.category === 'opening' && /door/i.test(s.label))).toBe(true)
    expect(result.symbols.some((s) => s.category === 'opening' && /window/i.test(s.label))).toBe(true)
  })

  it('extracts text entities and annotation candidates from text tokens', () => {
    const result = detectSemanticEntities({
      classifiedLines: [],
      walls: [],
      openings: [],
      rooms: [],
      textTokens: [
        { text: 'KITCHEN', x: 100, y: 200, confidence: 0.9 },
        { text: '1200 mm', x: 210, y: 120, confidence: 0.9 },
      ],
    })

    expect(result.text.some((t) => t.kind === 'room_tag' && t.text === 'KITCHEN')).toBe(true)
    expect(result.text.some((t) => t.kind === 'dimension' && t.text === '1200 mm')).toBe(true)
    expect(result.annotations.length).toBeGreaterThanOrEqual(2)
  })

  it('adds a room-tag symbol when room and room-tag text align', () => {
    const result = detectSemanticEntities({
      classifiedLines: [],
      walls: [],
      openings: [],
      rooms: [
        { id: 'room-1', cx: 150, cy: 150, x1: 120, y1: 120, x2: 180, y2: 180, areaPx: 3000, areaSqM: null },
      ],
      textTokens: [
        { text: 'OFFICE', x: 160, y: 140, confidence: 0.88 },
      ],
    })

    expect(result.symbols.some((s) => s.category === 'annotation' && /room/i.test(s.label))).toBe(true)
    expect(result.annotations.some((a) => a.kind === 'room_tag' && a.source === 'room')).toBe(true)
  })
})
