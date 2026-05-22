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
  // ─── Stage 1: Foundation ────────────────────────────────────────────────
  {
    id: 'foundation-type',
    question: 'Select foundation type',
    icon: '🏗️',
    subQuestions: [
      {
        id: 'foundation-type',
        label: 'Foundation type',
        type: 'select',
        options: [
          { label: 'Footings + Foundation Walls', value: 'footings-walls' },
          { label: 'Monolithic Slab (Slab-on-Grade)', value: 'monolithic-slab' },
          { label: 'Stem Wall + Slab', value: 'stem-wall-slab' },
          { label: 'Crawlspace', value: 'crawlspace' },
          { label: 'Pier / Post Foundation', value: 'pier' },
        ],
        defaultValue: 'monolithic-slab',
      },
    ],
  },
  {
    id: 'foundation-dims',
    question: 'Foundation dimensions',
    icon: '📏',
    subQuestions: [
      {
        id: 'building-length',
        label: 'Building length (inches)?',
        type: 'number',
        hint: 'Standard: 240" (20ft)',
        defaultValue: 240,
      },
      {
        id: 'building-width',
        label: 'Building width (inches)?',
        type: 'number',
        hint: 'Standard: 180" (15ft)',
        defaultValue: 180,
      },
      {
        id: 'slab-thickness',
        label: 'Slab thickness (inches)?',
        type: 'number',
        hint: 'Standard: 4"',
        defaultValue: 4,
      },
      {
        id: 'foundation-wall-height',
        label: 'Foundation wall height (inches)?',
        type: 'number',
        hint: 'Standard: 48" (4ft)',
        defaultValue: 48,
      },
      {
        id: 'foundation-wall-thickness',
        label: 'Foundation wall thickness (inches)?',
        type: 'number',
        hint: 'Standard: 8"',
        defaultValue: 8,
      },
    ],
  },
  {
    id: 'foundation-calibrate',
    question: 'Calibrate floorplan',
    icon: '📐',
    subQuestions: [
      {
        id: 'has-floorplan',
        label: 'Do you have a floorplan image?',
        type: 'boolean',
        defaultValue: false,
      },
      {
        id: 'floorplan-rotation',
        label: 'Floorplan rotation (degrees)?',
        type: 'number',
        hint: 'Adjust to align with grid',
        defaultValue: 0,
      },
      {
        id: 'floorplan-opacity',
        label: 'Floorplan opacity (%)?',
        type: 'number',
        hint: '0-100',
        defaultValue: 60,
      },
    ],
  },

  // ─── Stage 2: Framing ──────────────────────────────────────────────────
  {
    id: 'wall-structure',
    question: 'Wall structure type',
    icon: '🧱',
    subQuestions: [
      {
        id: 'wall-material',
        label: 'Wall material',
        type: 'select',
        options: [
          { label: 'Wood stud', value: 'wood' },
          { label: 'Steel stud', value: 'steel' },
          { label: 'Concrete block', value: 'concrete' },
          { label: 'ICF', value: 'icf' },
        ],
        defaultValue: 'wood',
      },
      {
        id: 'stud-spacing',
        label: 'Stud spacing',
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
        label: 'Wall height',
        type: 'select',
        options: [
          { label: '8 ft (standard)', value: '96' },
          { label: '9 ft', value: '108' },
          { label: '10 ft (commercial)', value: '120' },
        ],
        defaultValue: '96',
      },
      {
        id: 'wall-thickness',
        label: 'Wall thickness (inches)?',
        type: 'number',
        hint: 'Standard: 4.5" for 2x4, 6.5" for 2x6',
        defaultValue: 4.5,
      },
    ],
  },
  {
    id: 'openings',
    question: 'Doors and windows',
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
        hint: 'Standard interior: 32", exterior: 36"',
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
        id: 'door-swing',
        label: 'Door swing direction?',
        type: 'select',
        options: [
          { label: 'Inward (standard)', value: 'inward' },
          { label: 'Outward', value: 'outward' },
        ],
        defaultValue: 'inward',
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
      {
        id: 'window-sill',
        label: 'Window sill height (inches)?',
        type: 'number',
        hint: 'Standard: 36" from floor',
        defaultValue: 36,
      },
    ],
  },
  {
    id: 'roof',
    question: 'Roof structure',
    icon: '🏠',
    subQuestions: [
      {
        id: 'roof-type',
        label: 'Roof type',
        type: 'select',
        options: [
          { label: 'Flat', value: 'flat' },
          { label: 'Gable', value: 'gable' },
          { label: 'Hip', value: 'hip' },
          { label: 'Shed', value: 'shed' },
        ],
        defaultValue: 'flat',
      },
      {
        id: 'roof-pitch',
        label: 'Roof pitch (rise:12)?',
        type: 'select',
        options: [
          { label: 'Low slope (2:12)', value: '2' },
          { label: 'Standard (4:12)', value: '4' },
          { label: 'Steeper (6:12)', value: '6' },
          { label: 'Steep (8:12)', value: '8' },
        ],
        defaultValue: '4',
      },
      {
        id: 'roof-overhang',
        label: 'Roof overhang (inches)?',
        type: 'number',
        hint: 'Standard: 12"',
        defaultValue: 12,
      },
    ],
  },

  // ─── Stage 3: Rough-ins (MEP) ──────────────────────────────────────────
  {
    id: 'electrical',
    question: 'Electrical rough-in',
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
        label: 'How many outlets per room?',
        type: 'number',
        hint: 'Standard: 4 outlets per room',
        defaultValue: 4,
      },
      {
        id: 'switch-count',
        label: 'How many switches per room?',
        type: 'number',
        hint: 'Standard: 1-2',
        defaultValue: 2,
      },
      {
        id: 'light-count',
        label: 'How many ceiling lights per room?',
        type: 'number',
        hint: 'Standard: 1',
        defaultValue: 1,
      },
    ],
  },
  {
    id: 'plumbing',
    question: 'Plumbing rough-in',
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
      {
        id: 'has-tub',
        label: 'Include bathtub?',
        type: 'boolean',
        defaultValue: false,
      },
    ],
  },
  {
    id: 'hvac',
    question: 'HVAC rough-in',
    icon: '🌀',
    subQuestions: [
      {
        id: 'has-hvac',
        label: 'Include HVAC?',
        type: 'boolean',
        defaultValue: false,
      },
      {
        id: 'hvac-vents',
        label: 'How many supply vents per room?',
        type: 'number',
        hint: 'Standard: 2',
        defaultValue: 2,
      },
      {
        id: 'hvac-returns',
        label: 'How many return vents per room?',
        type: 'number',
        hint: 'Standard: 1',
        defaultValue: 1,
      },
    ],
  },

  // ─── Stage 4: Insulation ───────────────────────────────────────────────
  {
    id: 'insulation',
    question: 'Insulation',
    icon: '🛡️',
    subQuestions: [
      {
        id: 'insulation-type',
        label: 'Insulation type',
        type: 'select',
        options: [
          { label: 'Batt (standard)', value: 'batt' },
          { label: 'Spray foam', value: 'spray-foam' },
          { label: 'None', value: 'none' },
        ],
        defaultValue: 'batt',
      },
      {
        id: 'insulation-rvalue',
        label: 'R-value?',
        type: 'select',
        options: [
          { label: 'Standard (R-13)', value: 'r13' },
          { label: 'Enhanced (R-19)', value: 'r19' },
          { label: 'Custom', value: 'custom' },
        ],
        defaultValue: 'r13',
      },
    ],
  },

  // ─── Stage 5: Drywall ──────────────────────────────────────────────────
  {
    id: 'drywall',
    question: 'Drywall',
    icon: '🧱',
    subQuestions: [
      {
        id: 'drywall-thickness',
        label: 'Drywall thickness',
        type: 'select',
        options: [
          { label: '½" (standard)', value: '0.5' },
          { label: '⅝" (fire-rated)', value: '0.625' },
        ],
        defaultValue: '0.5',
      },
      {
        id: 'drywall-layers',
        label: 'Layers?',
        type: 'select',
        options: [
          { label: 'Single layer (standard)', value: 'single' },
          { label: 'Double layer (sound-rated)', value: 'double' },
        ],
        defaultValue: 'single',
      },
      {
        id: 'drywall-moisture',
        label: 'Moisture-resistant in bathrooms?',
        type: 'boolean',
        defaultValue: true,
      },
    ],
  },

  // ─── Stage 6: Finishes ─────────────────────────────────────────────────
  {
    id: 'finishes',
    question: 'Interior finishes',
    icon: '🎨',
    subQuestions: [
      {
        id: 'has-paint',
        label: 'Include paint?',
        type: 'boolean',
        defaultValue: true,
      },
      {
        id: 'paint-color',
        label: 'Wall paint color preference?',
        type: 'select',
        options: [
          { label: 'White/Off-white', value: 'white' },
          { label: 'Warm tone', value: 'warm' },
          { label: 'Cool tone', value: 'cool' },
          { label: 'Bold accent', value: 'bold' },
        ],
        defaultValue: 'white',
      },
      {
        id: 'has-flooring',
        label: 'Include flooring?',
        type: 'boolean',
        defaultValue: true,
      },
      {
        id: 'flooring-type',
        label: 'Flooring material',
        type: 'select',
        options: [
          { label: 'Vinyl (standard)', value: 'vinyl' },
          { label: 'Hardwood', value: 'hardwood' },
          { label: 'Tile', value: 'tile' },
          { label: 'Carpet', value: 'carpet' },
          { label: 'Polished concrete', value: 'concrete' },
        ],
        defaultValue: 'vinyl',
      },
      {
        id: 'has-trim',
        label: 'Include trim/baseboards?',
        type: 'boolean',
        defaultValue: true,
      },
      {
        id: 'has-appliances',
        label: 'Include appliances?',
        type: 'boolean',
        defaultValue: false,
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
