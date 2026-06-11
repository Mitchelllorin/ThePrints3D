/**
 * Onboarding wizard persistence — localStorage-backed for now.
 * Will move to the IndexedDB project library in v14 once PR #18 merges.
 */
import {
  DEFAULT_PROJECT_META,
  DEFAULT_WIZARD_STATE,
  type OnboardingWizardState,
  type ProjectMeta,
} from './types'

const KEY = 'bp3d-onboarding-wizard'

export function loadWizardState(): OnboardingWizardState {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...DEFAULT_WIZARD_STATE, meta: { ...DEFAULT_PROJECT_META } }
    const parsed = JSON.parse(raw) as Partial<OnboardingWizardState>
    return {
      step: parsed.step ?? DEFAULT_WIZARD_STATE.step,
      skipped: parsed.skipped ?? false,
      lastInference: parsed.lastInference ?? null,
      meta: { ...DEFAULT_PROJECT_META, ...(parsed.meta ?? {}) },
    }
  } catch {
    return { ...DEFAULT_WIZARD_STATE, meta: { ...DEFAULT_PROJECT_META } }
  }
}

export function saveWizardState(state: OnboardingWizardState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state))
  } catch {
    /* non-fatal — private browsing etc. */
  }
}

export function clearWizardState(): void {
  try { localStorage.removeItem(KEY) } catch { /* noop */ }
}

export function mergeMeta(current: ProjectMeta, patch: Partial<ProjectMeta>): ProjectMeta {
  return { ...current, ...patch, updatedAt: Date.now() }
}
