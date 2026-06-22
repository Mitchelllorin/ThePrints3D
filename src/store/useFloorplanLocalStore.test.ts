import { describe, it, expect, beforeEach } from 'vitest'
import { useFloorplanLocalStore } from './useFloorplanLocalStore'

const s = () => useFloorplanLocalStore.getState()

describe('useFloorplanLocalStore — active level vs trace layer', () => {
  beforeEach(() => {
    s().setActiveLevel(0)
    s().setActiveTraceLayer('framing')
  })

  it('keeps the active level when switching trace layers', () => {
    // Lay a 2nd-floor floor: pick the floors layer, set the storey to 2nd floor.
    s().setActiveTraceLayer('floors')
    s().setActiveLevel(1)
    expect(s().activeLevel).toBe(1)

    // Switch to framing to build the walls on that floor — the storey MUST stick,
    // or the walls drop to the ground ("walls build on the ground, not the deck").
    s().setActiveTraceLayer('framing')
    expect(s().activeTraceLayer).toBe('framing')
    expect(s().activeLevel).toBe(1)
  })

  it('still clears the pending trace anchor on a layer switch', () => {
    s().setActiveLevel(2)
    // simulate an in-progress trace anchor
    useFloorplanLocalStore.setState({ traceStart: [10, 20] })
    s().setActiveTraceLayer('roof')
    expect(s().traceStart).toBeNull()
    expect(s().activeLevel).toBe(2) // level preserved, anchor dropped
  })
})
