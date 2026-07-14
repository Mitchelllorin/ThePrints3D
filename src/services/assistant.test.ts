import { describe, it, expect } from 'vitest'
import { nextSuggestion, type AssistantContext } from './assistant'

const base: AssistantContext = {
  hasPlan: true,
  status: 'ready',
  calibrationCleared: true,
  calibrationMode: false,
  hasFloor: true,
  hasWalls: false,
  userWallCount: 0,
  detectedScaleAvailable: false,
  detectedWallCount: 0,
  built: false,
  traceMode: false,
  tracePaused: false,
  activePanel: null,
  exteriorFinished: false,
  insulationFinished: false,
  drywallFinished: false,
}
const ctx = (over: Partial<AssistantContext>): AssistantContext => ({ ...base, ...over })

describe('nextSuggestion — busy gate (non-pushy)', () => {
  it('stays quiet with no plan', () => {
    expect(nextSuggestion(ctx({ hasPlan: false }))).toBeNull()
  })
  it('stays quiet while actively tracing', () => {
    expect(nextSuggestion(ctx({ traceMode: true, tracePaused: false }))).toBeNull()
  })
  it('speaks again when tracing is paused', () => {
    expect(nextSuggestion(ctx({ traceMode: true, tracePaused: true }))).not.toBeNull()
  })
  it('stays quiet during calibration', () => {
    expect(nextSuggestion(ctx({ calibrationMode: true }))).toBeNull()
  })
  it.each(['picker', 'object', 'wall', 'line', 'panelBoard'])('stays quiet while %s panel is open', (p) => {
    expect(nextSuggestion(ctx({ activePanel: p }))).toBeNull()
  })
  it('still speaks while browsing (catalog/layers/settings)', () => {
    expect(nextSuggestion(ctx({ activePanel: 'settings' }))).not.toBeNull()
  })
})

describe('nextSuggestion — decision tree (first match wins)', () => {
  it('processing → progress, no action', () => {
    const s = nextSuggestion(ctx({ status: 'processing' }))
    expect(s?.id).toBe('processing')
    expect(s?.actionKind).toBeUndefined()
  })
  it('uncalibrated WITH detected scale → useDetected', () => {
    const s = nextSuggestion(ctx({ calibrationCleared: false, detectedScaleAvailable: true }))
    expect(s?.id).toBe('useDetected')
    expect(s?.actionKind).toBe('useDetectedScale')
  })
  it('uncalibrated WITHOUT detected scale → calibrate', () => {
    const s = nextSuggestion(ctx({ calibrationCleared: false }))
    expect(s?.id).toBe('calibrate')
    expect(s?.actionKind).toBe('calibrate')
  })
  it('calibrated, no floor → layFloor', () => {
    const s = nextSuggestion(ctx({ hasFloor: false }))
    expect(s?.id).toBe('floor')
    expect(s?.actionKind).toBe('layFloor')
  })
  it('floor + detected walls, none traced → autoBuild', () => {
    const s = nextSuggestion(ctx({ hasWalls: true, detectedWallCount: 7 }))
    expect(s?.id).toBe('autoBuild')
    expect(s?.message).toContain('7')
  })
  it('floor + user-traced walls → build', () => {
    const s = nextSuggestion(ctx({ hasWalls: true, userWallCount: 3 }))
    expect(s?.id).toBe('build')
    expect(s?.message).toContain('3 walls')
  })
  it('floor, no walls at all → trace', () => {
    expect(nextSuggestion(ctx({ hasWalls: false }))?.id).toBe('trace')
  })
  it('built beats trace/build (success, no action)', () => {
    const s = nextSuggestion(ctx({ built: true, userWallCount: 3, hasWalls: true }))
    expect(s?.id).toBe('built')
    expect(s?.tone).toBe('success')
    expect(s?.actionKind).toBeUndefined()
  })
  it('singular wall copy', () => {
    expect(nextSuggestion(ctx({ hasWalls: true, userWallCount: 1 }))?.message).toContain('1 wall traced')
  })
})
