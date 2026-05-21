import type { WizardGroupId } from '../../types'

export interface ProjectContextData {
  wallTypes: string
  materials: string
  constructionMetrics: string
  symbolTargets: string
  correctionNotes: string
}

export interface WizardFieldConfig {
  key: keyof ProjectContextData
  label: string
  placeholder: string
  rows: number
}

export interface WizardGroupConfig {
  id: WizardGroupId
  title: string
  subtitle: string
  fields: WizardFieldConfig[]
}

export const DEFAULT_PROJECT_CONTEXT_DATA: ProjectContextData = {
  wallTypes: '',
  materials: '',
  constructionMetrics: '',
  symbolTargets: '',
  correctionNotes: '',
}

export const WIZARD_GROUPS: WizardGroupConfig[] = [
  {
    id: 'group1',
    title: 'Group 1 · Core Assemblies',
    subtitle: 'Define known wall systems and primary materials before the first 3D pass.',
    fields: [
      {
        key: 'wallTypes',
        label: 'Wall types / assemblies',
        placeholder: 'e.g. 6 inch exterior CMU, 3-5/8 inch metal stud interior',
        rows: 3,
      },
      {
        key: 'materials',
        label: 'Materials',
        placeholder: 'e.g. drywall layers, glazing type, framing material',
        rows: 3,
      },
    ],
  },
  {
    id: 'group2',
    title: 'Group 2 · Build Calibration Targets',
    subtitle: 'Capture construction metrics and priority symbols for extraction + alignment.',
    fields: [
      {
        key: 'constructionMetrics',
        label: 'Construction metrics',
        placeholder: 'e.g. floor-to-floor height, module spacing, tolerance assumptions',
        rows: 3,
      },
      {
        key: 'symbolTargets',
        label: 'Symbol targets (doors/windows/sweeps/fixtures)',
        placeholder: 'e.g. prioritize door swings, storefront windows, floor sweeps',
        rows: 3,
      },
    ],
  },
  {
    id: 'group3',
    title: 'Group 3 · Correction Loop',
    subtitle: 'Capture post-build corrections so the 2D trace and 3D model stay aligned.',
    fields: [
      {
        key: 'correctionNotes',
        label: 'Post-3D edits / correction notes',
        placeholder: 'e.g. fix missed openings on level 2 west wall',
        rows: 4,
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
