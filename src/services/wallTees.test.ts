import { describe, it, expect } from 'vitest'
import { teesForWalls } from './wallTees'
import type { ParsedWall } from '../types'

const wall = (x1: number, y1: number, x2: number, y2: number, extra: Partial<ParsedWall> = {}): ParsedWall =>
  ({ id: `${x1},${y1}-${x2},${y2}`, x1, y1, x2, y2, thickness: 8, source: 'user', ...extra }) as ParsedWall

describe('teesForWalls', () => {
  it('reports the hit against the wall being MET, not the one arriving', () => {
    const run = wall(100, 300, 700, 300)
    const partition = wall(400, 300, 400, 600)
    const [onRun, onPartition] = teesForWalls([run, partition])
    expect(onRun).toHaveLength(1)
    expect(onRun[0]).toBeCloseTo(0.5, 6)
    expect(onPartition).toEqual([])   // its own end is not a tee on itself
  })

  it('does not call a corner a tee', () => {
    // Ends meeting at a shared point is a corner, and corners are framed already.
    const a = wall(100, 300, 700, 300)
    const b = wall(700, 300, 700, 600)
    expect(teesForWalls([a, b])).toEqual([[], []])
  })

  it('ignores an end that lands near the line but not on it', () => {
    const run = wall(100, 300, 700, 300)
    const away = wall(400, 340, 400, 600)    // 40px off the face
    expect(teesForWalls([run, away])[0]).toEqual([])
  })

  it('ignores a wall on another storey standing over this one', () => {
    const ground = wall(100, 300, 700, 300)
    const upstairs = wall(400, 300, 400, 600, { level: 1 })
    expect(teesForWalls([ground, upstairs])[0]).toEqual([])
  })

  it('records both tees when two walls land on the same run', () => {
    const run = wall(0, 0, 1000, 0)
    const p1 = wall(250, 0, 250, 400)
    const p2 = wall(750, 0, 750, 400)
    const [onRun] = teesForWalls([run, p1, p2])
    expect(onRun).toHaveLength(2)
    expect(onRun[0]).toBeCloseTo(0.25, 6)
    expect(onRun[1]).toBeCloseTo(0.75, 6)
  })
})
