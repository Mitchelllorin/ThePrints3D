import { describe, expect, it } from 'vitest'
import { floorToElevation, groupByFloor, inferFloorNumber } from './sheetParser'

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
  it('groups drawing ids and defaults missing floor to 0', () => {
    const grouped = groupByFloor([
      { id: 'd1', name: 'A-101', floorNumber: 1 },
      { id: 'd2', name: 'A-102', floorNumber: 1 },
      { id: 'd3', name: 'unknown', floorNumber: null },
    ])

    expect(grouped.get(1)).toEqual(['d1', 'd2'])
    expect(grouped.get(0)).toEqual(['d3'])
  })
})

describe('floorToElevation', () => {
  it('converts floor number to elevation', () => {
    expect(floorToElevation(0)).toBe(0)
    expect(floorToElevation(2)).toBe(6.4)
    expect(floorToElevation(-1)).toBe(-3.2)
  })
})
