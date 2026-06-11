/**
 * Onboarding wizard types
 * -----------------------
 * Lightweight project metadata captured by the tap-to-confirm wizard.
 * The wizard NEVER asks for free-text. Every field is either:
 *   - auto-detected from the uploaded prints (sheet numbers, scale notation,
 *     discipline gating) and just CONFIRMED with a tap, or
 *   - chosen from 2-4 big-button options.
 *
 * The two systems coexist: the legacy free-text panel is still rendered on
 * the model view for power users; the visual wizard is the default entry
 * flow for the upload view.
 */

export type WizardStep = 'upload' | 'confirm' | 'framing' | 'review' | 'done'

export type BuildingType =
  | 'residential-single'
  | 'residential-multi'
  | 'commercial'
  | 'industrial'
  | 'institutional'
  | 'unknown'

export type FramingMaterial = 'wood' | 'steel' | 'mixed' | 'unknown'
export type DrywallConfig = 'single-layer' | 'double-layer' | 'no-drywall' | 'mixed'
export type UnitSystem = 'metric' | 'imperial' | 'mixed'

export interface ProjectMeta {
  name: string | null
  address: string | null
  buildingType: BuildingType
  unitSystem: UnitSystem
  floorCount: number | null
  floorHeightM: number
  framing: FramingMaterial
  drywall: DrywallConfig
  updatedAt: number
}

export interface WizardInference {
  detected: Partial<Pick<ProjectMeta,
    'name' | 'address' | 'buildingType' | 'unitSystem' | 'floorCount' | 'framing' | 'drywall' | 'floorHeightM'
  >>
  confidence: number
  reasons: string[]
  sheetSummary: {
    total: number
    architectural: number
    structural: number
    skipped: number
  }
}

export interface OnboardingWizardState {
  step: WizardStep
  skipped: boolean
  meta: ProjectMeta
  lastInference: WizardInference | null
}

export const DEFAULT_PROJECT_META: ProjectMeta = {
  name: null,
  address: null,
  buildingType: 'unknown',
  unitSystem: 'metric',
  floorCount: null,
  floorHeightM: 2.7,
  framing: 'wood',
  drywall: 'single-layer',
  updatedAt: 0,
}

export const DEFAULT_WIZARD_STATE: OnboardingWizardState = {
  step: 'upload',
  skipped: false,
  meta: { ...DEFAULT_PROJECT_META },
  lastInference: null,
}
