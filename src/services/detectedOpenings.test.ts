import { describe, it, expect } from 'vitest'
import { detectedOpeningsToFrame } from './detectedOpenings'
import type { Drawing, ParsedOpening, ParsedWall } from '../types'

const wall = (x1: number, y1: number, x2: number, y2: number, source: 'auto' | 'user'): ParsedWall => ({
  x1, y1, x2, y2, thickness: 8, source,
})
const door = (x: number, y: number): ParsedOpening => ({
  x, y, widthPx: 40, widthMm: 900, orientation: 'horizontal', type: 'door',
} as ParsedOpening)

const sheet = (walls: ParsedWall[], openings: ParsedOpening[], extra: Partial<Drawing> = {}): Drawing => ({
  parsedWalls: walls, parsedOpenings: openings, scaleConfidence: 'parsed', ...extra,
} as Drawing)

describe('detectedOpeningsToFrame', () => {
  it('keeps a door the reader found in a wall it also read', () => {
    const d = sheet([wall(0, 0, 1000, 0, 'auto')], [door(500, 0)])
    expect(detectedOpeningsToFrame(d)).toHaveLength(1)
  })

  it('drops a detected door that sits in a wall you drew', () => {
    const d = sheet([wall(0, 0, 1000, 0, 'user')], [door(500, 0)])
    expect(detectedOpeningsToFrame(d)).toHaveLength(0)
  })

  it('drops it when the read walls are not built (Trace my own walls)', () => {
    const d = sheet([wall(0, 0, 1000, 0, 'auto'), wall(0, 0, 1000, 0, 'user')], [door(500, 0)])
    expect(detectedOpeningsToFrame(d, { tracedOnly: true })).toHaveLength(0)
  })

  it('drops it when the scale is not known, so the read walls are only suggestions', () => {
    const d = sheet([wall(0, 0, 1000, 0, 'auto')], [door(500, 0)], { scaleConfidence: null })
    expect(detectedOpeningsToFrame(d)).toHaveLength(0)
  })

  it('drops a door off every wall', () => {
    const d = sheet([wall(0, 0, 1000, 0, 'auto')], [door(500, 300)])
    expect(detectedOpeningsToFrame(d)).toHaveLength(0)
  })
})
