import { wizardSteps, type WizardStep } from '../services/wizardFlow'

export interface WizardGroup {
  id: string
  title: string
  icon: string
  description: string
  stepIds: string[]
}

export const wizardGroups: WizardGroup[] = [
  {
    id: 'foundation',
    title: 'Foundation',
    icon: '🏗️',
    description: 'Footings, slabs, walls, and floorplan calibration',
    stepIds: ['foundation-type', 'foundation-dims', 'foundation-calibrate'],
  },
  {
    id: 'framing',
    title: 'Framing',
    icon: '🧱',
    description: 'Walls, studs, openings, and roof structure',
    stepIds: ['wall-structure', 'openings', 'roof'],
  },
  {
    id: 'mep',
    title: 'Rough-ins (MEP)',
    icon: '⚡',
    description: 'Electrical, plumbing, and HVAC rough-in',
    stepIds: ['electrical', 'plumbing', 'hvac'],
  },
  {
    id: 'insulation',
    title: 'Insulation',
    icon: '🛡️',
    description: 'Insulation type and R-value',
    stepIds: ['insulation'],
  },
  {
    id: 'drywall',
    title: 'Drywall',
    icon: '🧱',
    description: 'Drywall thickness and layers',
    stepIds: ['drywall'],
  },
  {
    id: 'finishes',
    title: 'Finishes',
    icon: '🎨',
    description: 'Paint, flooring, trim, appliances',
    stepIds: ['finishes'],
  },
]

export function getStepsInGroup(group: WizardGroup): WizardStep[] {
  return group.stepIds
    .map((id) => wizardSteps.find((s) => s.id === id))
    .filter(Boolean) as WizardStep[]
}

export function findGroupByStepId(stepId: string): WizardGroup | undefined {
  return wizardGroups.find((g) => g.stepIds.includes(stepId))
}

export function getGroupIndex(groupId: string): number {
  return wizardGroups.findIndex((g) => g.id === groupId)
}

export interface GroupProgress {
  answered: number
  total: number
  done: boolean
}

export function getGroupProgress(
  answers: Record<string, string | boolean>,
  group: WizardGroup,
): GroupProgress {
  const steps = getStepsInGroup(group)
  let answered = 0
  let total = 0
  for (const step of steps) {
    for (const sq of step.subQuestions) {
      total++
      if (answers[sq.id] !== undefined) answered++
    }
  }
  return { answered, total, done: total > 0 && answered === total }
}

export interface OverallProgress {
  answered: number
  total: number
  pct: number
}

export function getOverallProgress(
  answers: Record<string, string | boolean>,
): OverallProgress {
  let answered = 0
  let total = 0
  for (const group of wizardGroups) {
    const steps = getStepsInGroup(group)
    for (const step of steps) {
      for (const sq of step.subQuestions) {
        total++
        if (answers[sq.id] !== undefined) answered++
      }
    }
  }
  return { answered, total, pct: total > 0 ? Math.round((answered / total) * 100) : 0 }
}

export interface GroupStepProgress {
  done: boolean
  totalSteps: number
  completedSteps: number
}

export function getGroupStepProgress(
  answers: Record<string, string | boolean>,
  group: WizardGroup,
): GroupStepProgress {
  const steps = getStepsInGroup(group)
  let completedSteps = 0
  for (const step of steps) {
    const allAnswered = step.subQuestions.every((sq) => answers[sq.id] !== undefined)
    if (allAnswered) completedSteps++
  }
  return { done: completedSteps === steps.length, totalSteps: steps.length, completedSteps }
}
