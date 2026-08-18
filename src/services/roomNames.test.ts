import { describe, it, expect } from 'vitest'
import { roomKindOf, looksLikeRoomName, cleanRoomLabel, statedAreaSqM } from './roomNames'
import { isWetRoom } from './wetWalls'

describe('roomKindOf', () => {
  it('reads the labels on the ADU screenshot, which are not ALL CAPS', () => {
    // The caps-only test rejected every one of these.
    expect(roomKindOf('Bathroom')).toBe('bathroom')
    expect(roomKindOf('Living Area')).toBe('living')
    expect(roomKindOf('Entry Hall')).toBe('hall')
    expect(roomKindOf('Bedroom')).toBe('bedroom')
    expect(roomKindOf('Kitchen & Dining Area')).toBe('kitchen')
  })

  it('reads the ALL CAPS labels on the studio screenshot too', () => {
    expect(roomKindOf('LIVING ROOM AREA')).toBe('living')
    expect(roomKindOf('BEDROOM')).toBe('bedroom')
    expect(roomKindOf('KITCHEN')).toBe('kitchen')
    expect(roomKindOf('FULL BATHROOM')).toBe('bathroom')
    expect(roomKindOf('WALK - IN CLOSET')).toBe('closet')
    expect(roomKindOf('WASHER DRYER')).toBeNull()   // an appliance, not a room
  })

  it('handles the abbreviations plans actually use', () => {
    expect(roomKindOf('MBR')).toBe('bedroom')
    expect(roomKindOf('W.I.C.')).toBe('closet')
    expect(roomKindOf('PWDR')).toBe('bathroom')
    expect(roomKindOf('UTIL')).toBe('laundry')
    expect(roomKindOf('living rm')).toBe('living')
  })

  it('survives the area printed alongside the name', () => {
    expect(roomKindOf('Bathroom 4,5 m²')).toBe('bathroom')
    expect(roomKindOf('Living Area 21,4 m²')).toBe('living')
  })

  it('says nothing about text that is not a room', () => {
    expect(roomKindOf('TOTAL AREA = 71 m²')).toBeNull()
    expect(roomKindOf('5,37 m')).toBeNull()
    expect(roomKindOf('R/F')).toBeNull()
    expect(roomKindOf('')).toBeNull()
    expect(roomKindOf(undefined)).toBeNull()
  })

  it('takes the word that comes first when two appear', () => {
    expect(roomKindOf('Kitchen & Dining Area')).toBe('kitchen')
    expect(roomKindOf('Dining / Kitchen')).toBe('dining')
  })

  it('agrees with the wet-room rule that decides tile backer', () => {
    // The whole point of naming a room: wetWalls reads the name.
    for (const label of ['Bathroom', 'FULL BATHROOM', 'PWDR', 'ensuite']) {
      expect(roomKindOf(label)).toBe('bathroom')
      expect(isWetRoom(label)).toBe(true)
    }
    expect(isWetRoom('Bedroom')).toBe(false)
  })
})

describe('looksLikeRoomName', () => {
  it('is what promotes a text token to a room tag', () => {
    expect(looksLikeRoomName('Bathroom')).toBe(true)
    expect(looksLikeRoomName('TOTAL AREA = 71 m²')).toBe(false)
  })
})

describe('cleanRoomLabel', () => {
  it('drops the measurement and keeps the name', () => {
    expect(cleanRoomLabel('Bathroom 4,5 m²')).toBe('Bathroom')
    expect(cleanRoomLabel('Living Area 21,4 m²')).toBe('Living Area')
    expect(cleanRoomLabel('KITCHEN 120 SF')).toBe('KITCHEN')
  })

  it('leaves a bare name alone', () => {
    expect(cleanRoomLabel('BEDROOM')).toBe('BEDROOM')
  })
})

describe('statedAreaSqM', () => {
  it('reads a metric area, comma decimal included', () => {
    expect(statedAreaSqM('Bathroom 4,5 m²')).toBeCloseTo(4.5, 6)
    expect(statedAreaSqM('Living Area 21.4 m2')).toBeCloseTo(21.4, 6)
    expect(statedAreaSqM('TOTAL AREA = 71 m²')).toBeCloseTo(71, 6)
  })

  it('converts an imperial area', () => {
    expect(statedAreaSqM('KITCHEN 120 SF')!).toBeCloseTo(11.148, 2)
  })

  it('survives OCR turning the superscript into junk', () => {
    // Literally what Tesseract returns for the ADU capture's total line.
    expect(statedAreaSqM('TOTAL AREA = 71 m?')).toBeCloseTo(71, 6)
    expect(statedAreaSqM('TOTAL AREA = 71 m')).toBeCloseTo(71, 6)
    expect(statedAreaSqM('Living Area 21,4 m*')).toBeCloseTo(21.4, 6)
  })

  it('does NOT read a bare length as an area', () => {
    // "5,37 m" is a dimension along the bottom of the same drawing. Reading it
    // as 5.37 m2 would put the scale out by a factor of four.
    expect(statedAreaSqM('5,37 m')).toBeNull()
    expect(statedAreaSqM('3,68 m')).toBeNull()
    expect(statedAreaSqM('2.78 m')).toBeNull()
  })

  it('returns null when no area is stated', () => {
    expect(statedAreaSqM('BEDROOM')).toBeNull()
    expect(statedAreaSqM('5,37 m')).toBeNull()
  })
})
