import { describe, it, expect } from 'vitest'
import { deriveWorkspaceSceneConfig, DEFAULT_WORKSPACE_SCENE_CONFIG } from './workspaceScene'
import type { WorkspaceWizardInputs } from '../types'

const blank: WorkspaceWizardInputs = {
  set1BuildingBasics: '',
  set1Clarifications: '',
  set2StructuralDetails: '',
  set2Clarifications: '',
  set3FinishingDetails: '',
  set3Clarifications: '',
  completedGroup: 'group1',
  completedAt: 0,
}
const withText = (over: Partial<WorkspaceWizardInputs>): WorkspaceWizardInputs => ({ ...blank, ...over })

describe('wall height — a house is not a lobby', () => {
  it('frames a house at 8 foot when nobody has said otherwise', () => {
    expect(deriveWorkspaceSceneConfig(blank).wallHeightM).toBeCloseTo(2.44, 6)
  })

  it('does the same with no wizard text at all', () => {
    expect(deriveWorkspaceSceneConfig(null).wallHeightM).toBeCloseTo(2.44, 6)
  })

  it('keeps the taller generic default for a commercial shell', () => {
    const cfg = deriveWorkspaceSceneConfig(null, { buildType: 'commercial-retail' })
    expect(cfg.wallHeightM).toBeCloseTo(DEFAULT_WORKSPACE_SCENE_CONFIG.wallHeightM, 6)
  })
})

describe('wall height — precedence', () => {
  it('a stated height beats the default', () => {
    expect(deriveWorkspaceSceneConfig(blank, { ceilingM: 2.7 }).wallHeightM).toBeCloseTo(2.7, 6)
  })

  it('a stated height beats text scraped from the wizard', () => {
    const inputs = withText({ set1BuildingBasics: 'wall height 3.5m throughout' })
    expect(deriveWorkspaceSceneConfig(inputs).wallHeightM).toBeCloseTo(3.5, 6)
    expect(deriveWorkspaceSceneConfig(inputs, { ceilingM: 2.44 }).wallHeightM).toBeCloseTo(2.44, 6)
  })

  it('a stated height beats the build-type default', () => {
    const cfg = deriveWorkspaceSceneConfig(null, { ceilingM: 3.0, buildType: 'residential-single' })
    expect(cfg.wallHeightM).toBeCloseTo(3.0, 6)
  })

  it('falls through to parsed text when nothing is stated', () => {
    const inputs = withText({ set2StructuralDetails: 'wall height 9 ft' })
    expect(deriveWorkspaceSceneConfig(inputs).wallHeightM).toBeCloseTo(9 * 0.3048, 6)
  })

  it('shows why prose is not a good place to keep a number', () => {
    // The regex wants the literal phrase "wall height". Written the way a
    // builder writes it, the height is silently lost and the model frames at
    // the default — which is the whole argument for asking a typed question.
    const natural = withText({ set1BuildingBasics: '9 foot ceilings throughout' })
    expect(deriveWorkspaceSceneConfig(natural).wallHeightM).toBeCloseTo(2.44, 6)
  })

  it('treats a null override as "not stated" rather than zero', () => {
    expect(deriveWorkspaceSceneConfig(blank, { ceilingM: null }).wallHeightM).toBeCloseTo(2.44, 6)
  })
})

describe('everything else is untouched', () => {
  it('still parses footprint, floors and foundation as before', () => {
    const cfg = deriveWorkspaceSceneConfig(
      withText({ set1BuildingBasics: '28m x 18m footprint, 2 floors, foundation slab' }),
    )
    expect(cfg.footprintWidthM).toBe(28)
    expect(cfg.footprintDepthM).toBe(18)
    expect(cfg.floorCount).toBe(2)
    expect(cfg.foundationType).toBe('slab')
  })
})
