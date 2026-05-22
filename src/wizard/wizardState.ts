import { wizardGroups, getStepsInGroup, type WizardGroup } from './wizardGroups'

export interface WizardNavigationState {
  currentGroupIndex: number
  currentStepIndexInGroup: number
}

export function createInitialWizardState(): WizardNavigationState {
  return { currentGroupIndex: 0, currentStepIndexInGroup: 0 }
}

export function getCurrentGroup(state: WizardNavigationState): WizardGroup {
  return wizardGroups[state.currentGroupIndex]
}

export function getCurrentStep(state: WizardNavigationState) {
  const group = getCurrentGroup(state)
  const steps = getStepsInGroup(group)
  return steps[state.currentStepIndexInGroup] ?? null
}

export function canGoBack(state: WizardNavigationState): boolean {
  return state.currentGroupIndex > 0 || state.currentStepIndexInGroup > 0
}

export function canGoForward(
  state: WizardNavigationState,
  answers: Record<string, string | boolean>,
): boolean {
  const step = getCurrentStep(state)
  if (!step) return false
  return step.subQuestions.every((sq) => answers[sq.id] !== undefined)
}

export function isLastStepInGroup(state: WizardNavigationState): boolean {
  const group = getCurrentGroup(state)
  const steps = getStepsInGroup(group)
  return state.currentStepIndexInGroup >= steps.length - 1
}

export function isFirstStep(state: WizardNavigationState): boolean {
  return state.currentGroupIndex === 0 && state.currentStepIndexInGroup === 0
}

export function isLastGroup(state: WizardNavigationState): boolean {
  return state.currentGroupIndex >= wizardGroups.length - 1
}

export function goNext(state: WizardNavigationState): WizardNavigationState {
  const group = getCurrentGroup(state)
  const steps = getStepsInGroup(group)

  if (state.currentStepIndexInGroup < steps.length - 1) {
    return { ...state, currentStepIndexInGroup: state.currentStepIndexInGroup + 1 }
  }

  if (state.currentGroupIndex < wizardGroups.length - 1) {
    return { currentGroupIndex: state.currentGroupIndex + 1, currentStepIndexInGroup: 0 }
  }

  return state
}

export function goBack(state: WizardNavigationState): WizardNavigationState {
  if (state.currentStepIndexInGroup > 0) {
    return { ...state, currentStepIndexInGroup: state.currentStepIndexInGroup - 1 }
  }

  if (state.currentGroupIndex > 0) {
    const prevGroup = wizardGroups[state.currentGroupIndex - 1]
    const prevSteps = getStepsInGroup(prevGroup)
    return { currentGroupIndex: state.currentGroupIndex - 1, currentStepIndexInGroup: prevSteps.length - 1 }
  }

  return state
}

export function getMissingFields(
  state: WizardNavigationState,
  answers: Record<string, string | boolean>,
): string[] {
  const step = getCurrentStep(state)
  if (!step) return []
  return step.subQuestions
    .filter((sq) => answers[sq.id] === undefined)
    .map((sq) => sq.label)
}
