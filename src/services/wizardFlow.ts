export interface SubQuestion {
  id: string
  label: string
  type: 'boolean' | 'select' | 'number' | 'text'
  options?: { label: string; value: string }[]
  hint?: string
  defaultValue?: string | number | boolean
}

export interface WizardStep {
  id: string
  question: string
  icon: string
  subQuestions: SubQuestion[]
}

export const wizardSteps: WizardStep[] = [
  {
    id: 'layout',
    question: 'What is the building layout?',
    icon: '📐',
    subQuestions: [
      {
        id: 'room-count',
        label: 'Single room or multiple rooms?',
        type: 'select',
        options: [
          { label: 'Single room', value: 'single' },
          { label: 'Multiple rooms', value: 'multiple' },
        ],
        defaultValue: 'single',
      },
      {
        id: 'room-width',
        label: 'Room width (inches)?',
        type: 'number',
        hint: 'Standard room ~120" (10ft)',
        defaultValue: 120,
      },
      {
        id: 'room-length',
        label: 'Room length (inches)?',
        type: 'number',
        hint: 'Standard room ~120" (10ft)',
        defaultValue: 120,
      },
      {
        id: 'room-count-value',
        label: 'How many rooms?',
        type: 'number',
        hint: 'Minimum 1',
        defaultValue: 1,
      },
    ],
  },
  {
    id: 'wallStructure',
    question: 'What type of walls?',
    icon: '🧱',
    subQuestions: [
      {
        id: 'wall-material',
        label: 'What material?',
        type: 'select',
        options: [
          { label: 'Wood stud', value: 'wood' },
          { label: 'Steel stud', value: 'steel' },
          { label: 'Concrete', value: 'concrete' },
          { label: 'Masonry', value: 'masonry' },
        ],
        defaultValue: 'wood',
      },
      {
        id: 'stud-spacing',
        label: 'Stud spacing?',
        type: 'select',
        options: [
          { label: '16" OC (standard)', value: '16' },
          { label: '24" OC (commercial)', value: '24' },
          { label: '12" OC (heavy)', value: '12' },
        ],
        defaultValue: '16',
      },
      {
        id: 'wall-height',
        label: 'Wall height?',
        type: 'select',
        options: [
          { label: '8 ft (standard)', value: '96' },
          { label: '9 ft', value: '108' },
          { label: '10 ft (commercial)', value: '120' },
        ],
        defaultValue: '96',
      },
    ],
  },
  {
    id: 'openings',
    question: 'Add doors and windows?',
    icon: '🚪',
    subQuestions: [
      {
        id: 'has-doors',
        label: 'Include doors?',
        type: 'boolean',
        defaultValue: true,
      },
      {
        id: 'door-width',
        label: 'Door width (inches)?',
        type: 'number',
        hint: 'Standard interior door: 32", exterior: 36"',
        defaultValue: 36,
      },
      {
        id: 'door-height',
        label: 'Door height (inches)?',
        type: 'number',
        hint: 'Standard: 80" (6\'8")',
        defaultValue: 80,
      },
      {
        id: 'has-windows',
        label: 'Include windows?',
        type: 'boolean',
        defaultValue: true,
      },
      {
        id: 'window-width',
        label: 'Window width (inches)?',
        type: 'number',
        hint: 'Standard: 48"',
        defaultValue: 48,
      },
      {
        id: 'window-height',
        label: 'Window height (inches)?',
        type: 'number',
        hint: 'Standard: 36"',
        defaultValue: 36,
      },
    ],
  },
  {
    id: 'electrical',
    question: 'Add electrical devices?',
    icon: '⚡',
    subQuestions: [
      {
        id: 'has-electrical',
        label: 'Include electrical?',
        type: 'boolean',
        defaultValue: true,
      },
      {
        id: 'outlet-count',
        label: 'How many outlets?',
        type: 'number',
        hint: 'Standard: 2 per wall, 4 per room',
        defaultValue: 4,
      },
      {
        id: 'switch-count',
        label: 'How many switches?',
        type: 'number',
        hint: 'Standard: 1 per room, 2 near entrance',
        defaultValue: 2,
      },
      {
        id: 'light-count',
        label: 'How many ceiling lights?',
        type: 'number',
        hint: 'Standard: 1 per room',
        defaultValue: 1,
      },
    ],
  },
  {
    id: 'plumbing',
    question: 'Add plumbing fixtures?',
    icon: '🔧',
    subQuestions: [
      {
        id: 'has-plumbing',
        label: 'Include plumbing?',
        type: 'boolean',
        defaultValue: false,
      },
      {
        id: 'has-sink',
        label: 'Include sink?',
        type: 'boolean',
        defaultValue: false,
      },
      {
        id: 'has-toilet',
        label: 'Include toilet?',
        type: 'boolean',
        defaultValue: false,
      },
      {
        id: 'has-shower',
        label: 'Include shower?',
        type: 'boolean',
        defaultValue: false,
      },
    ],
  },
  {
    id: 'insulation',
    question: 'Add insulation?',
    icon: '🛡️',
    subQuestions: [
      {
        id: 'insulation-type',
        label: 'What type?',
        type: 'select',
        options: [
          { label: 'Batt (standard)', value: 'batt' },
          { label: 'Spray foam', value: 'spray-foam' },
          { label: 'None', value: 'none' },
        ],
        defaultValue: 'batt',
      },
    ],
  },
  {
    id: 'drywall',
    question: 'Add drywall?',
    icon: '🧱',
    subQuestions: [
      {
        id: 'drywall-thickness',
        label: 'Drywall thickness?',
        type: 'select',
        options: [
          { label: '½" (standard)', value: '0.5' },
          { label: '⅝" (fire-rated)', value: '0.625' },
        ],
        defaultValue: '0.5',
      },
      {
        id: 'drywall-moisture',
        label: 'Moisture-resistant in bathrooms?',
        type: 'boolean',
        defaultValue: true,
      },
    ],
  },
  {
    id: 'finishes',
    question: 'Add finishes?',
    icon: '🎨',
    subQuestions: [
      {
        id: 'has-paint',
        label: 'Include paint?',
        type: 'boolean',
        defaultValue: true,
      },
      {
        id: 'has-flooring',
        label: 'Include flooring?',
        type: 'boolean',
        defaultValue: true,
      },
      {
        id: 'flooring-type',
        label: 'Flooring material?',
        type: 'select',
        options: [
          { label: 'Vinyl (standard)', value: 'vinyl' },
          { label: 'Hardwood', value: 'hardwood' },
          { label: 'Tile', value: 'tile' },
          { label: 'Carpet', value: 'carpet' },
        ],
        defaultValue: 'vinyl',
      },
    ],
  },
]

export const STEP_ORDER = wizardSteps.map((s) => s.id)

export function findStepById(id: string): WizardStep | undefined {
  return wizardSteps.find((s) => s.id === id)
}

export function getNextStepId(currentId: string): string | null {
  const idx = STEP_ORDER.indexOf(currentId)
  if (idx === -1 || idx >= STEP_ORDER.length - 1) return null
  return STEP_ORDER[idx + 1]
}

export function getPrevStepId(currentId: string): string | null {
  const idx = STEP_ORDER.indexOf(currentId)
  if (idx <= 0) return null
  return STEP_ORDER[idx - 1]
}
