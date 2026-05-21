import type { WizardGroupId } from '../../types'

export interface ProjectContextData {
  set1BuildingBasics: string
  set1Clarifications: string
  set2StructuralDetails: string
  set2Clarifications: string
  set3FinishingDetails: string
  set3Clarifications: string
}

export interface WizardFieldConfig {
  key: keyof ProjectContextData
  label: string
  placeholder: string
  rows: number
  subQuestions: string[]
}

export interface WizardGroupConfig {
  id: WizardGroupId
  title: string
  subtitle: string
  fields: WizardFieldConfig[]
}

export const DEFAULT_PROJECT_CONTEXT_DATA: ProjectContextData = {
  set1BuildingBasics: '',
  set1Clarifications: '',
  set2StructuralDetails: '',
  set2Clarifications: '',
  set3FinishingDetails: '',
  set3Clarifications: '',
}

export const WIZARD_GROUPS: WizardGroupConfig[] = [
  {
    id: 'group1',
    title: 'Set 1 · Building Basics',
    subtitle: 'Define dimensions, wall heights, floor count, and baseline footprint assumptions first.',
    fields: [
      {
        key: 'set1BuildingBasics',
        label: 'Building basics',
        placeholder: 'e.g. 28m x 18m footprint, wall height 3.2m, 2 floors with basement',
        rows: 4,
        subQuestions: [
          'What are the overall building dimensions?',
          'What is the standard wall height per level?',
          'How many floors (including basements/mezzanines)?',
          'Any major grid/module spacing constraints?',
        ],
      },
      {
        key: 'set1Clarifications',
        label: 'Set 1 clarifying notes',
        placeholder: 'Add clarifications if dimensions vary by zone or floor.',
        rows: 3,
        subQuestions: [
          'Do any levels have different floor-to-floor heights?',
          'Any irregular geometry the model should prioritize?',
        ],
      },
    ],
  },
  {
    id: 'group2',
    title: 'Set 2 · Structural Details',
    subtitle: 'Capture doors, windows, openings, and load-bearing constraints before refinement.',
    fields: [
      {
        key: 'set2StructuralDetails',
        label: 'Structural details',
        placeholder: 'e.g. load-bearing walls on axis A/C, door swings required, window opening widths',
        rows: 4,
        subQuestions: [
          'Which walls are load-bearing vs partition?',
          'Where are major doors, windows, and openings?',
          'Any openings to exclude from framing interpretation?',
        ],
      },
      {
        key: 'set2Clarifications',
        label: 'Set 2 clarifying notes',
        placeholder: 'Add clarifications for ambiguous openings and structural intent.',
        rows: 3,
        subQuestions: [
          'Which opening symbols are critical for extraction?',
          'Any discipline conflicts to resolve first?',
        ],
      },
    ],
  },
  {
    id: 'group3',
    title: 'Set 3 · Finishing Details',
    subtitle: 'Capture materials, thicknesses, and special finish conditions.',
    fields: [
      {
        key: 'set3FinishingDetails',
        label: 'Finishing details',
        placeholder: 'e.g. gypsum + tile finish in wet rooms, slab thickening at core walls',
        rows: 4,
        subQuestions: [
          'What finishing materials should be applied by area?',
          'Are there required thickness overrides?',
          'Any special features (soffits, reveals, bulkheads, niches)?',
        ],
      },
      {
        key: 'set3Clarifications',
        label: 'Set 3 clarifying notes',
        placeholder: 'Add unresolved finish clarifications and follow-up checks.',
        rows: 3,
        subQuestions: [
          'Which finish assumptions are tentative?',
          'What should reviewers verify after generation?',
        ],
      },
    ],
  },
]

export function getWizardGroupIndex(groupId: WizardGroupId): number {
  return WIZARD_GROUPS.findIndex((group) => group.id === groupId)
}

export function getNextWizardGroup(groupId: WizardGroupId): WizardGroupId | null {
  const index = getWizardGroupIndex(groupId)
  if (index < 0 || index >= WIZARD_GROUPS.length - 1) return null
  return WIZARD_GROUPS[index + 1].id
}

export function getPreviousWizardGroup(groupId: WizardGroupId): WizardGroupId | null {
  const index = getWizardGroupIndex(groupId)
  if (index <= 0) return null
  return WIZARD_GROUPS[index - 1].id
}
