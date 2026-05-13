import { describe, expect, it } from 'vitest'
import { floorToElevation, groupByFloor, groupByFloorWithLog, inferFloorNumber } from './sheetParser'

describe('inferFloorNumber', () => {
  it('infers from sheet numbering', () => {
    expect(inferFloorNumber('A-101 Lobby Plan.pdf')).toBe(1)
    expect(inferFloorNumber('A-201 Office Plan.pdf')).toBe(2)
  })

  it('infers named floors', () => {
    expect(inferFloorNumber('Ground Floor Plan')).toBe(0)
    expect(inferFloorNumber('Basement Plan')).toBe(-1)
    expect(inferFloorNumber('Roof Plan')).toBe(99)
  })
})

describe('groupByFloor', () => {
  it('groups unknown floors into an explicit unknown bucket', () => {
    const grouped = groupByFloor([
      { id: 'd1', name: 'A-101', floorNumber: 1 },
      { id: 'd2', name: 'A-102', floorNumber: 1 },
      { id: 'd3', name: 'unknown', floorNumber: null },
    ])

    expect(grouped.get(1)).toEqual(['d1', 'd2'])
    expect(grouped.get('unknown')).toEqual(['d3'])
    expect(grouped.get(0)).toBeUndefined()
  })

  it('captures assignment source details in grouping log', () => {
    const { floorGroupingLog } = groupByFloorWithLog([
      { id: 'd1', name: 'A-101', floorNumber: 4 },
      { id: 'd2', name: 'Ground Floor Plan', floorNumber: null },
      { id: 'd3', name: 'MEP Sheet', floorNumber: null },
    ])

    expect(floorGroupingLog).toEqual([
      {
        drawingId: 'd1',
        drawingName: 'A-101',
        providedFloorNumber: 4,
        inferredFloorNumber: null,
        assignedBucket: 4,
        assignmentSource: 'provided',
      },
      {
        drawingId: 'd2',
        drawingName: 'Ground Floor Plan',
        providedFloorNumber: null,
        inferredFloorNumber: 0,
        assignedBucket: 0,
        assignmentSource: 'inferred',
      },
      {
        drawingId: 'd3',
        drawingName: 'MEP Sheet',
        providedFloorNumber: null,
        inferredFloorNumber: null,
        assignedBucket: 'unknown',
        assignmentSource: 'unknown',
      },
    ])
  })
})

describe('floorToElevation', () => {
  it('converts floor number to elevation', () => {
    expect(floorToElevation(0)).toBe(0)
    expect(floorToElevation(2)).toBe(6.4)
    expect(floorToElevation(-1)).toBe(-3.2)
  })
})
