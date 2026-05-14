import { describe, it, expect } from 'vitest'
import { extractRooms } from './roomExtractor'

// ─── Test helpers ─────────────────────────────────────────────────────────────

/**
 * Build a minimal RGBA ImageData from a 2D array of brightness values (0=dark/wall, 255=light/open).
 * The outer ring will be dark (walls) unless specified otherwise.
 */
function makeImageData(pixels: number[][]): ImageData {
  const height = pixels.length
  const width = pixels[0].length
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = pixels[y][x]
      const i = (y * width + x) * 4
      data[i] = v
      data[i + 1] = v
      data[i + 2] = v
      data[i + 3] = 255
    }
  }
  return { data, width, height } as ImageData
}

const W = 0    // wall pixel (dark)
const R = 255  // room pixel (light)

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('extractRooms', () => {
  it('returns empty array for a completely white image (no enclosed region)', () => {
    // All white — every pixel touches the border, no enclosed room
    const img = makeImageData([
      [R, R, R, R, R],
      [R, R, R, R, R],
      [R, R, R, R, R],
      [R, R, R, R, R],
      [R, R, R, R, R],
    ])
    const rooms = extractRooms(img, { minAreaPx: 1 })
    expect(rooms).toHaveLength(0)
  })

  it('returns empty array for a completely black image', () => {
    const img = makeImageData([
      [W, W, W, W, W],
      [W, W, W, W, W],
      [W, W, W, W, W],
    ])
    const rooms = extractRooms(img, { minAreaPx: 1 })
    expect(rooms).toHaveLength(0)
  })

  it('detects a single enclosed room', () => {
    // 7x7 grid: black border, white interior
    const grid = [
      [W, W, W, W, W, W, W],
      [W, R, R, R, R, R, W],
      [W, R, R, R, R, R, W],
      [W, R, R, R, R, R, W],
      [W, R, R, R, R, R, W],
      [W, R, R, R, R, R, W],
      [W, W, W, W, W, W, W],
    ]
    const img = makeImageData(grid)
    const rooms = extractRooms(img, { minAreaPx: 1 })
    expect(rooms).toHaveLength(1)
    expect(rooms[0].id).toBe('room-0')
    expect(rooms[0].areaPx).toBeGreaterThan(0)
    // Centroid should be near the middle of the image
    expect(rooms[0].cx).toBeGreaterThan(1)
    expect(rooms[0].cy).toBeGreaterThan(1)
  })

  it('returns null areaSqM when scale is not provided', () => {
    const grid = [
      [W, W, W, W, W],
      [W, R, R, R, W],
      [W, R, R, R, W],
      [W, R, R, R, W],
      [W, W, W, W, W],
    ]
    const img = makeImageData(grid)
    const rooms = extractRooms(img, { minAreaPx: 1 })
    expect(rooms[0].areaSqM).toBeNull()
  })

  it('computes areaSqM when scale is provided', () => {
    const grid = [
      [W, W, W, W, W],
      [W, R, R, R, W],
      [W, R, R, R, W],
      [W, R, R, R, W],
      [W, W, W, W, W],
    ]
    const img = makeImageData(grid)
    // scaleMmPerPx = 10 → 1 px = 10 mm = 0.01 m
    const rooms = extractRooms(img, { minAreaPx: 1, scaleMmPerPx: 10 })
    expect(rooms[0].areaSqM).not.toBeNull()
    expect(rooms[0].areaSqM!).toBeGreaterThan(0)
  })

  it('filters out regions below minAreaPx', () => {
    // Single enclosed pixel (1x1 interior)
    const grid = [
      [W, W, W],
      [W, R, W],
      [W, W, W],
    ]
    const img = makeImageData(grid)
    // Require at least 100 px — the 1-pixel room should be filtered
    const rooms = extractRooms(img, { minAreaPx: 100 })
    expect(rooms).toHaveLength(0)
  })

  it('sorts rooms by area descending', () => {
    // Two separate enclosed rooms of different sizes, separated by a solid wall column.
    // 17x7 grid: left room (x=1..5), separator (x=6), right room (x=7..15)
    // With DOWNSAMPLE=2, the separator at sx=6 falls exactly on a downsampled pixel.
    const row = (pattern: number[]) => pattern
    const W = 0, R = 255
    const grid = [
      row([W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W]),
      row([W, R, R, R, R, R, W, R, R, R, R, R, R, R, R, R, W]),
      row([W, R, R, R, R, R, W, R, R, R, R, R, R, R, R, R, W]),
      row([W, R, R, R, R, R, W, R, R, R, R, R, R, R, R, R, W]),
      row([W, R, R, R, R, R, W, R, R, R, R, R, R, R, R, R, W]),
      row([W, R, R, R, R, R, W, R, R, R, R, R, R, R, R, R, W]),
      row([W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W]),
    ]
    const img = makeImageData(grid)
    const rooms = extractRooms(img, { minAreaPx: 1 })
    expect(rooms).toHaveLength(2)
    // Larger room should come first
    expect(rooms[0].areaPx).toBeGreaterThanOrEqual(rooms[1].areaPx)
  })

  it('provides bounding box coordinates', () => {
    // 7x7 grid: solid wall border, 5x5 interior room
    // With DOWNSAMPLE=2: room pixels land at dx=1,2 and dy=1,2 → distinct x1/x2 and y1/y2
    const W = 0, R = 255
    const grid = [
      [W, W, W, W, W, W, W],
      [W, R, R, R, R, R, W],
      [W, R, R, R, R, R, W],
      [W, R, R, R, R, R, W],
      [W, R, R, R, R, R, W],
      [W, R, R, R, R, R, W],
      [W, W, W, W, W, W, W],
    ]
    const img = makeImageData(grid)
    const rooms = extractRooms(img, { minAreaPx: 1 })
    expect(rooms).toHaveLength(1)
    const r = rooms[0]
    expect(r.x1).toBeGreaterThanOrEqual(0)
    expect(r.y1).toBeGreaterThanOrEqual(0)
    expect(r.x2).toBeGreaterThan(r.x1)
    expect(r.y2).toBeGreaterThan(r.y1)
  })
})
