import { describe, it, expect } from 'vitest'
import { readSheetTitle, isBuildableSheet, wrongSheetMessage } from './sheetTitle'

/**
 * The cases are the real corpus, not invented ones. Each string below is the
 * shape of what pdf.js actually hands back for that page — the keyword counts
 * were measured off data/test-prints/ before a line of this was written.
 */
describe('reading what a sheet says it is', () => {
  it('calls the LA County floor plan page a floor plan', () => {
    // Page 2: FLOOR PLAN three times, plus its schedules.
    const t = `KITCHEN (10'-0" x 9'-6") DINING ROOM LIVING ROOM FLOOR PLAN NOTES
      WINDOW SCHEDULE DOOR SCHEDULE WALL LEGEND FLOOR PLAN 3/8" = 1'-0" FLOOR PLAN`
    const r = readSheetTitle(t)
    expect(r.kind).toBe('floor-plan')
    expect(r.weight).toBeGreaterThan(1)
  })

  it('calls the electrical sheet services, which is the page we were picking', () => {
    // Page 3 of the same set: the same walls with wiring drawn over them, which
    // is exactly why the pixel scorer liked it.
    const r = readSheetTitle('UTILITY PLAN NOTES 200 AMP ELECTRICAL PANEL ELECTRICAL S.D C.O')
    expect(r.kind).toBe('services')
    expect(r.weight).toBeLessThan(1)
  })

  it('calls the elevation sheets elevations', () => {
    expect(readSheetTitle('FINISHED GRADE TOP PLATE WEST Elevation NORTH Elevation').kind)
      .toBe('elevation')
  })

  it('does not mistake a floor plan for a foundation sheet because its notes say FOUNDATION', () => {
    // Every plan in the corpus mentions the word somewhere. Only FOUNDATION
    // PLAN names the sheet.
    const r = readSheetTitle('FLOOR PLAN. SEE FOUNDATION FOR SLAB EDGE. CONC. FOOTING PER DETAIL')
    expect(r.kind).toBe('floor-plan')
  })

  it('reads PLAN VIEW as a floor plan — that is the Ukiah set’s name for it', () => {
    expect(readSheetTitle('A1.0 PLAN VIEW Scale: 1/4" = 1\'-0" LIVING ROOM MASTER BEDROOM').kind)
      .toBe('floor-plan')
  })

  /**
   * THE INDEX TRAP. LA County's page 1 is the loudest floor-plan-sounding page
   * in the set, because listing every sheet is its job.
   */
  it('sees through the index page that names every sheet in the set', () => {
    const r = readSheetTitle(`TITLE SHEET PLOT PLAN SITE PLAN FLOOR PLAN ELECTRICAL
      ELEVATIONS ROOF PLAN CROSS SECTION FOUNDATION PLAN FRAMING PLAN INDEX OF DRAWINGS`)
    expect(r.kind).toBe('index')
    expect(r.weight).toBeLessThan(1)
    expect(r.distinctKinds).toBeGreaterThanOrEqual(5)
  })

  it('stays neutral on a sheet with no text at all — the scanned case', () => {
    // The pixel scorer exists for exactly this and must be left to do its job.
    const r = readSheetTitle('')
    expect(r.kind).toBe('unknown')
    expect(r.weight).toBe(1)
  })

  /**
   * Portland page 4 is prose ABOUT floor plans with no drawing on it. The words
   * are perfect, which is why this returns a weight and not a verdict — the
   * pixel score is what notices there is nothing drawn there.
   */
  it('gives prose about floor plans the same weight as a floor plan, and says so', () => {
    const r = readSheetTitle(`The location, size and type of each window must be shown on
      the floor plan. A floor plan for each level must show the location of all walls.
      floor plan floor plan floor plan`)
    expect(r.kind).toBe('floor-plan')
    expect(r.weight).toBeGreaterThan(1)
  })
})

describe('the scope line — one sheet, and it has to be a floor plan', () => {
  it('builds from a floor plan', () => {
    expect(isBuildableSheet(readSheetTitle('FLOOR PLAN'))).toBe(true)
  })

  it('builds from a sheet that says nothing, rather than refusing on silence', () => {
    expect(isBuildableSheet(readSheetTitle(''))).toBe(true)
  })

  it('will not pretend an elevation is a house', () => {
    const r = readSheetTitle('WEST Elevation EAST Elevation LAP SIDING')
    expect(isBuildableSheet(r)).toBe(false)
    expect(wrongSheetMessage(r)).toContain('elevation')
    expect(wrongSheetMessage(r)).toContain('floor plan sheet')
  })

  it('says nothing when there is nothing to complain about', () => {
    expect(wrongSheetMessage(readSheetTitle('FLOOR PLAN'))).toBeNull()
  })
})
