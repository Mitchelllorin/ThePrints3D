import type { WizardGroupId } from '../../types'
import {
  DEFAULT_PROJECT_CONTEXT_DATA,
  getNextWizardGroup,
  type ProjectContextData,
} from './wizardGroups'

const STORAGE_KEY = 'blueprint3d-project-context-wizard-v2'

export interface ProjectContextWizardState {
  currentGroup: WizardGroupId
  completedGroups: WizardGroupId[]
  data: ProjectContextData
  savedAt: number | null
}

export const DEFAULT_WIZARD_STATE: ProjectContextWizardState = {
  currentGroup: 'group1',
  completedGroups: [],
  data: DEFAULT_PROJECT_CONTEXT_DATA,
  savedAt: null,
}

function dedupeGroups(groups: WizardGroupId[]): WizardGroupId[] {
  return Array.from(new Set(groups))
}

function normalizeData(raw?: Partial<ProjectContextData>): ProjectContextData {
  return {
    wallTypes: raw?.wallTypes ?? '',
    materials: raw?.materials ?? '',
    constructionMetrics: raw?.constructionMetrics ?? '',
    symbolTargets: raw?.symbolTargets ?? '',
    correctionNotes: raw?.correctionNotes ?? '',
  }
}

export function loadWizardState(): ProjectContextWizardState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_WIZARD_STATE
    const parsed = JSON.parse(raw) as Partial<ProjectContextWizardState>
    const currentGroup = parsed.currentGroup ?? 'group1'
    return {
      currentGroup,
      completedGroups: dedupeGroups(parsed.completedGroups ?? []),
      data: normalizeData(parsed.data),
      savedAt: typeof parsed.savedAt === 'number' ? parsed.savedAt : null,
    }
  } catch {
    return DEFAULT_WIZARD_STATE
  }
}

export function saveWizardState(next: ProjectContextWizardState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // ignore storage failures
  }
}

export function patchWizardData(
  prev: ProjectContextWizardState,
  partial: Partial<ProjectContextData>,
): ProjectContextWizardState {
  return {
    ...prev,
    data: {
      ...prev.data,
      ...partial,
    },
    savedAt: Date.now(),
  }
}

export function completeWizardGroup(
  prev: ProjectContextWizardState,
  groupId: WizardGroupId,
): ProjectContextWizardState {
  return {
    ...prev,
    completedGroups: dedupeGroups([...prev.completedGroups, groupId]),
    currentGroup: getNextWizardGroup(groupId) ?? groupId,
    savedAt: Date.now(),
  }
}
