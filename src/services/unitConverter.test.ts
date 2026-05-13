import { describe, expect, it } from 'vitest'
import {
  convertArea,
  convertLength,
  convertPressure,
  convertTemperature,
  convertValue,
  convertVolume,
  convertWeight,
  inchesToFeetInches,
  parseFeetInches,
} from './unitConverter'

describe('unitConverter', () => {
  it('converts metric length to feet/inches', () => {
    const inches = convertLength(3000, 'mm', 'in')
    expect(inches).toBeCloseTo(118.11, 2)
    expect(inchesToFeetInches(inches)).toContain("9'")
  })

  it('parses feet-inches notation', () => {
    expect(parseFeetInches("10' 6\"")).toBeCloseTo(126, 4)
    expect(parseFeetInches('10-6')).toBeCloseTo(126, 4)
    expect(parseFeetInches('126')).toBeCloseTo(126, 4)
  })

  it('converts area units', () => {
    expect(convertArea(100, 'm2', 'ft2')).toBeCloseTo(1076.39, 2)
  })

  it('converts volume units', () => {
    expect(convertVolume(1, 'yd3', 'ft3')).toBeCloseTo(27, 3)
  })

  it('converts weight, temperature, and pressure', () => {
    expect(convertWeight(10, 'kg', 'lb')).toBeCloseTo(22.046, 3)
    expect(convertTemperature(32, 'f', 'c')).toBeCloseTo(0, 4)
    expect(convertPressure(100, 'psi', 'kpa')).toBeCloseTo(689.47, 2)
  })

  it('converts through generic dispatcher', () => {
    expect(convertValue('length', 1, 'm', 'ft')).toBeCloseTo(3.2808, 4)
  })
})
