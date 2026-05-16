import { describe, expect, it } from 'vitest'
import { classifyLines } from './lineClassifier'

function makeImageData(width: number, height: number, background = 235): ImageData {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = background
    data[i * 4 + 1] = background
    data[i * 4 + 2] = background
    data[i * 4 + 3] = 255
  }
  return { data, width, height } as ImageData
}

function drawHorizontalLine(
  imageData: ImageData,
  y: number,
  startX: number,
  endX: number,
  brightness: number,
  thickness = 1,
) {
  for (let dy = 0; dy < thickness; dy++) {
    for (let x = startX; x <= endX; x++) {
      const idx = ((y + dy) * imageData.width + x) * 4
      imageData.data[idx] = brightness
      imageData.data[idx + 1] = brightness
      imageData.data[idx + 2] = brightness
      imageData.data[idx + 3] = 255
    }
  }
}

describe('classifyLines', () => {
  it('classifies faint but continuous walls using adaptive brightness thresholds', () => {
    const image = makeImageData(160, 60, 232)
    drawHorizontalLine(image, 24, 20, 140, 168, 2)

    const { classified } = classifyLines(image, [
      { x1: 20, y1: 24, x2: 140, y2: 24, thickness: 4 },
    ], {
      minWallLengthPx: 60,
      minWallThicknessPx: 3,
    })

    expect(classified).toHaveLength(1)
    expect(classified[0].classification).toBe('wall')
    expect(classified[0].confidence).toBeGreaterThan(0.55)
  })
})
