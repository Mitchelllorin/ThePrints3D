import { describe, it, expect } from 'vitest'
import { inferDiscipline, shouldDetectWalls } from './sheetDiscipline'

describe('inferDiscipline', () => {
  describe('sheet number prefixes', () => {
    it('recognises architectural', () => {
      expect(inferDiscipline('A-2.7 - 6TH LEVEL PLAN.pdf')).toBe('architectural')
      expect(inferDiscipline('A101.pdf')).toBe('architectural')
      expect(inferDiscipline('A_101.dwg')).toBe('architectural')
    })

    it('recognises structural', () => {
      expect(inferDiscipline('S-201 framing plan.pdf')).toBe('structural')
    })

    it('recognises plumbing', () => {
      expect(inferDiscipline('P-101.pdf')).toBe('plumbing')
    })

    it('recognises electrical', () => {
      expect(inferDiscipline('E-301.pdf')).toBe('electrical')
    })

    it('recognises mechanical', () => {
      expect(inferDiscipline('M-201 hvac.pdf')).toBe('mechanical')
    })

    it('recognises fire-protection over architectural', () => {
      // FP- should win over the F-... fallback
      expect(inferDiscipline('FP-101.pdf')).toBe('fire-protection')
    })
  })

  describe('keyword fallback', () => {
    it('detects plumbing by keyword', () => {
      expect(inferDiscipline('plumbing-rough-in.jpg')).toBe('plumbing')
    })

    it('detects architectural by "floor plan"', () => {
      expect(inferDiscipline('first floor plan.jpg')).toBe('architectural')
    })

    it('detects mechanical by HVAC', () => {
      expect(inferDiscipline('HVAC layout.pdf')).toBe('mechanical')
    })
  })

  it('returns unknown for unrecognised input', () => {
    expect(inferDiscipline('IMG_20240509_145107689.jpg')).toBe('unknown')
    expect(inferDiscipline('scan.pdf')).toBe('unknown')
  })
})

describe('shouldDetectWalls', () => {
  it('runs walls on architectural, structural, interiors, unknown', () => {
    expect(shouldDetectWalls('architectural')).toBe(true)
    expect(shouldDetectWalls('structural')).toBe(true)
    expect(shouldDetectWalls('interiors')).toBe(true)
    expect(shouldDetectWalls('unknown')).toBe(true) // benefit of the doubt on phone snaps
  })

  it('skips M/E/P/C/L/F/T sheets', () => {
    expect(shouldDetectWalls('mechanical')).toBe(false)
    expect(shouldDetectWalls('electrical')).toBe(false)
    expect(shouldDetectWalls('plumbing')).toBe(false)
    expect(shouldDetectWalls('civil')).toBe(false)
    expect(shouldDetectWalls('landscape')).toBe(false)
    expect(shouldDetectWalls('fire-protection')).toBe(false)
    expect(shouldDetectWalls('telecom')).toBe(false)
  })
})
