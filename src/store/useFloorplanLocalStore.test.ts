import { describe, it, expect, beforeEach } from 'vitest'
import { useFloorplanLocalStore, defaultWallTypeForRole } from './useFloorplanLocalStore'
import { WALL_THICKNESS_M } from '../services/constructionCode'

const s = () => useFloorplanLocalStore.getState()

describe('stud size follows the wall role', () => {
  beforeEach(() => {
    useFloorplanLocalStore.setState({
      activeWallRole: 'exterior-bearing',
      activeWallType: defaultWallTypeForRole('exterior-bearing'),
      wallTypeChosen: false,
    })
  })

  it('defaults exterior to 2x8 and interior to 2x4', () => {
    expect(defaultWallTypeForRole('exterior-bearing')).toBe('wood-2x8')
    expect(defaultWallTypeForRole('interior-bearing')).toBe('wood-2x4')
    expect(defaultWallTypeForRole('interior-non-bearing')).toBe('wood-2x4')
    expect(defaultWallTypeForRole('partition')).toBe('wood-2x4')
  })

  it('starts a session on 2x8, because the default role is exterior', () => {
    expect(s().activeWallRole).toBe('exterior-bearing')
    expect(s().activeWallType).toBe('wood-2x8')
  })

  it('re-defaults the size when the role changes', () => {
    s().setActiveWallRole('partition')
    expect(s().activeWallType).toBe('wood-2x4')
    s().setActiveWallRole('exterior-bearing')
    expect(s().activeWallType).toBe('wood-2x8')
  })

  it('stops overriding once a size is picked by hand', () => {
    s().setActiveWallType('wood-2x6')       // explicit choice
    s().setActiveWallRole('partition')      // role change must NOT undo it
    expect(s().activeWallType).toBe('wood-2x6')
  })

  it('renders those defaults at real thickness, so the model stays to scale', () => {
    // 2x8 = 7.5" = 0.1905 m, 2x4 = 3.5" = 0.0889 m. An exterior wall must come
    // out visibly thicker than an interior one.
    const ext = WALL_THICKNESS_M[defaultWallTypeForRole('exterior-bearing')]
    const int = WALL_THICKNESS_M[defaultWallTypeForRole('partition')]
    expect(ext).toBeCloseTo(0.1905, 4)
    expect(int).toBeCloseTo(0.0889, 4)
    expect(ext).toBeGreaterThan(int)
  })
})

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
