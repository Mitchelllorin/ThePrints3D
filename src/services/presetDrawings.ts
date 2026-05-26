import type { Drawing, ParsedOpening, ParsedRoom, ParsedWall, WorkspaceWizardInputs } from '../types'

export type PresetDifficulty = 'easy' | 'medium' | 'hard'

interface PresetDefinition {
  id: PresetDifficulty
  name: string
  widthPx: number
  heightPx: number
  mmPerPx: number
  walls: ParsedWall[]
  openings: ParsedOpening[]
  rooms: ParsedRoom[]
  wizardInputs: WorkspaceWizardInputs
}

function rectWalls(x1: number, y1: number, x2: number, y2: number, thickness = 10): ParsedWall[] {
  return [
    { x1, y1, x2, y2: y1, thickness, source: 'auto', detectionConfidence: 1 },
    { x1: x2, y1, x2, y2, thickness, source: 'auto', detectionConfidence: 1 },
    { x1: x2, y1: y2, x2: x1, y2, thickness, source: 'auto', detectionConfidence: 1 },
    { x1, y1: y2, x2: x1, y2: y1, thickness, source: 'auto', detectionConfidence: 1 },
  ]
}

const EASY_WALLS: ParsedWall[] = [
  ...rectWalls(120, 120, 1080, 780, 12),
  { x1: 600, y1: 120, x2: 600, y2: 520, thickness: 10, source: 'auto', detectionConfidence: 1 },
  { x1: 120, y1: 430, x2: 600, y2: 430, thickness: 10, source: 'auto', detectionConfidence: 1 },
]

const MEDIUM_WALLS: ParsedWall[] = [
  ...rectWalls(100, 100, 1180, 820, 12),
  ...rectWalls(100, 100, 360, 300, 10),
  { x1: 360, y1: 300, x2: 720, y2: 300, thickness: 10, source: 'auto', detectionConfidence: 1 },
  { x1: 720, y1: 300, x2: 720, y2: 620, thickness: 10, source: 'auto', detectionConfidence: 1 },
  { x1: 360, y1: 620, x2: 980, y2: 620, thickness: 10, source: 'auto', detectionConfidence: 1 },
  { x1: 980, y1: 360, x2: 980, y2: 820, thickness: 10, source: 'auto', detectionConfidence: 1 },
]

const HARD_WALLS: ParsedWall[] = [
  ...rectWalls(80, 80, 1220, 860, 12),
  { x1: 420, y1: 80, x2: 420, y2: 520, thickness: 10, source: 'auto', detectionConfidence: 1 },
  { x1: 760, y1: 80, x2: 760, y2: 640, thickness: 10, source: 'auto', detectionConfidence: 1 },
  { x1: 80, y1: 340, x2: 420, y2: 340, thickness: 10, source: 'auto', detectionConfidence: 1 },
  { x1: 420, y1: 520, x2: 980, y2: 520, thickness: 10, source: 'auto', detectionConfidence: 1 },
  { x1: 760, y1: 260, x2: 1220, y2: 260, thickness: 10, source: 'auto', detectionConfidence: 1 },
  { x1: 980, y1: 520, x2: 980, y2: 860, thickness: 10, source: 'auto', detectionConfidence: 1 },
  { x1: 320, y1: 700, x2: 980, y2: 700, thickness: 10, source: 'auto', detectionConfidence: 1 },
  { x1: 320, y1: 700, x2: 320, y2: 860, thickness: 10, source: 'auto', detectionConfidence: 1 },
]

function createRooms(idPrefix: string, rooms: Array<[number, number, number, number]>): ParsedRoom[] {
  return rooms.map(([x1, y1, x2, y2], index) => ({
    id: `${idPrefix}-room-${index + 1}`,
    cx: (x1 + x2) / 2,
    cy: (y1 + y2) / 2,
    x1,
    y1,
    x2,
    y2,
    areaPx: Math.max(1, (x2 - x1) * (y2 - y1)),
    areaSqM: null,
  }))
}

const PRESET_DEFINITIONS: Record<PresetDifficulty, PresetDefinition> = {
  easy: {
    id: 'easy',
    name: 'Easy Starter Cottage',
    widthPx: 1200,
    heightPx: 900,
    mmPerPx: 10,
    walls: EASY_WALLS,
    openings: [
      { x: 360, y: 120, widthPx: 110, widthMm: 1100, orientation: 'horizontal', type: 'window' },
      { x: 840, y: 430, widthPx: 100, widthMm: 1000, orientation: 'horizontal', type: 'door' },
    ],
    rooms: createRooms('easy', [
      [120, 120, 600, 430],
      [600, 120, 1080, 430],
      [120, 430, 600, 780],
      [600, 430, 1080, 780],
    ]),
    wizardInputs: {
      set1BuildingBasics: '12m x 8m footprint, wall height 3m, 1 floor, slab foundation',
      set1Clarifications: 'Simple starter layout with straight exterior walls.',
      set2StructuralDetails: 'One load-bearing central partition, 1 main entry door, 1 large front window.',
      set2Clarifications: 'Keep partitions aligned to the print for clean snapping.',
      set3FinishingDetails: 'Concrete block exterior, painted gypsum interior, 200mm wall thickness.',
      set3Clarifications: 'No special finish overrides.',
      completedGroup: 'group3',
      completedAt: Date.now(),
    },
  },
  medium: {
    id: 'medium',
    name: 'Medium Family House',
    widthPx: 1280,
    heightPx: 920,
    mmPerPx: 12,
    walls: MEDIUM_WALLS,
    openings: [
      { x: 260, y: 100, widthPx: 120, widthMm: 1440, orientation: 'horizontal', type: 'window' },
      { x: 1120, y: 480, widthPx: 110, widthMm: 1320, orientation: 'vertical', type: 'door' },
      { x: 720, y: 620, widthPx: 90, widthMm: 1080, orientation: 'horizontal', type: 'door' },
    ],
    rooms: createRooms('medium', [
      [100, 100, 360, 300],
      [360, 100, 1180, 300],
      [100, 300, 720, 620],
      [720, 300, 980, 620],
      [100, 620, 980, 820],
      [980, 100, 1180, 820],
    ]),
    wizardInputs: {
      set1BuildingBasics: '18m x 11m footprint, wall height 3.2m, 2 floors, slab foundation',
      set1Clarifications: 'Upper floor repeats most of the lower footprint except the rear service zone.',
      set2StructuralDetails: 'Load-bearing walls along the main axes, multiple door and window openings.',
      set2Clarifications: 'Keep opening markers visible for jamb alignment.',
      set3FinishingDetails: 'Brick exterior, gypsum interior, 220mm wall thickness, soffit over entry.',
      set3Clarifications: 'Review the soffit and stair opening after generation.',
      completedGroup: 'group3',
      completedAt: Date.now(),
    },
  },
  hard: {
    id: 'hard',
    name: 'Hard Mixed-Use Core',
    widthPx: 1300,
    heightPx: 940,
    mmPerPx: 14,
    walls: HARD_WALLS,
    openings: [
      { x: 180, y: 80, widthPx: 130, widthMm: 1820, orientation: 'horizontal', type: 'window' },
      { x: 1080, y: 260, widthPx: 100, widthMm: 1400, orientation: 'horizontal', type: 'window' },
      { x: 980, y: 760, widthPx: 110, widthMm: 1540, orientation: 'vertical', type: 'door' },
      { x: 540, y: 700, widthPx: 90, widthMm: 1260, orientation: 'horizontal', type: 'door' },
    ],
    rooms: createRooms('hard', [
      [80, 80, 420, 340],
      [420, 80, 760, 260],
      [760, 80, 1220, 260],
      [80, 340, 420, 860],
      [420, 260, 760, 520],
      [760, 260, 1220, 520],
      [420, 520, 980, 700],
      [320, 700, 980, 860],
      [980, 520, 1220, 860],
    ]),
    wizardInputs: {
      set1BuildingBasics: '22m x 14m footprint, wall height 3.6m, 3 floors with basement, raft foundation',
      set1Clarifications: 'Core walls and stair zones stack through the building.',
      set2StructuralDetails: 'Several load-bearing walls, mixed office and residential openings, stair and service shafts.',
      set2Clarifications: 'Preserve the service core, stair, and corridor walls during tracing.',
      set3FinishingDetails: 'Concrete and glass exterior, gypsum interior, 250mm wall thickness, bulkheads and reveals.',
      set3Clarifications: 'Special attention to stair bulkheads and storefront glazing.',
      completedGroup: 'group3',
      completedAt: Date.now(),
    },
  },
}

function drawSvg(definition: PresetDefinition): string {
  const wallLines = definition.walls.map((wall) => `
    <line x1="${wall.x1}" y1="${wall.y1}" x2="${wall.x2}" y2="${wall.y2}" stroke="#111827" stroke-width="${wall.thickness}" stroke-linecap="round" />
  `).join('')
  const roomLabels = definition.rooms.map((room, index) => `
    <text x="${room.cx}" y="${room.cy}" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="26" fill="#64748b">R${index + 1}</text>
  `).join('')
  const openings = definition.openings.map((opening) => {
    const half = opening.widthPx / 2
    if (opening.orientation === 'horizontal') {
      return `<line x1="${opening.x - half}" y1="${opening.y}" x2="${opening.x + half}" y2="${opening.y}" stroke="${opening.type === 'door' ? '#0ea5e9' : '#38bdf8'}" stroke-width="8" stroke-dasharray="18 10" />`
    }
    return `<line x1="${opening.x}" y1="${opening.y - half}" x2="${opening.x}" y2="${opening.y + half}" stroke="${opening.type === 'door' ? '#0ea5e9' : '#38bdf8'}" stroke-width="8" stroke-dasharray="18 10" />`
  }).join('')

  return `
  <svg xmlns="http://www.w3.org/2000/svg" width="${definition.widthPx}" height="${definition.heightPx}" viewBox="0 0 ${definition.widthPx} ${definition.heightPx}">
    <rect width="100%" height="100%" fill="#f8fafc" />
    <rect x="24" y="24" width="${definition.widthPx - 48}" height="${definition.heightPx - 48}" rx="18" fill="none" stroke="#cbd5e1" stroke-width="4" />
    ${wallLines}
    ${openings}
    ${roomLabels}
    <text x="50" y="${definition.heightPx - 40}" font-family="Inter, Arial, sans-serif" font-size="22" fill="#334155">${definition.name} · Trace on the 3D grid</text>
  </svg>`
}

function createPresetFile(svg: string, difficulty: PresetDifficulty): File {
  try {
    return new File([svg], `${difficulty}-preset.svg`, { type: 'image/svg+xml' })
  } catch {
    const fallback = new Blob([svg], { type: 'image/svg+xml' }) as Blob & { name?: string; lastModified?: number }
    fallback.name = `${difficulty}-preset.svg`
    fallback.lastModified = Date.now()
    return fallback as File
  }
}

export function listPresetDefinitions() {
  return (Object.keys(PRESET_DEFINITIONS) as PresetDifficulty[]).map((id) => ({
    id,
    name: PRESET_DEFINITIONS[id].name,
  }))
}

export function createPresetDrawing(difficulty: PresetDifficulty, practiceMode: boolean): Pick<Drawing, 'name' | 'file' | 'pageCount' | 'currentPage' | 'previewUrl' | 'rasterUrl' | 'rasterWidth' | 'rasterHeight' | 'parsedWalls' | 'parsedRooms' | 'parsedOpenings' | 'parsedText' | 'parsedSymbols' | 'parsedAnnotationCandidates' | 'parseProgress' | 'floorNumber' | 'status' | 'scaleMmPerPx' | 'scaleNotation' | 'scaleConfidence' | 'uploadedAt' | 'type'> & { wizardInputs: WorkspaceWizardInputs; overlayScale: [number, number] } {
  const definition = PRESET_DEFINITIONS[difficulty]
  const svg = drawSvg(definition)
  const file = createPresetFile(svg, difficulty)
  const url = URL.createObjectURL(file)
  const worldWidthM = (definition.widthPx * definition.mmPerPx) / 1000
  const worldDepthM = (definition.heightPx * definition.mmPerPx) / 1000

  return {
    name: `${definition.name}${practiceMode ? ' (Practice)' : ''}`,
    file,
    pageCount: 1,
    currentPage: 1,
    previewUrl: url,
    rasterUrl: url,
    rasterWidth: definition.widthPx,
    rasterHeight: definition.heightPx,
    parsedWalls: practiceMode ? [] : definition.walls,
    parsedRooms: practiceMode ? [] : definition.rooms,
    parsedOpenings: practiceMode ? [] : definition.openings,
    parsedText: [],
    parsedSymbols: [],
    parsedAnnotationCandidates: [],
    parseProgress: 100,
    floorNumber: 0,
    status: 'ready',
    scaleMmPerPx: definition.mmPerPx,
    scaleNotation: `1:${Math.round(definition.mmPerPx * 10)}`,
    scaleConfidence: 'parsed',
    uploadedAt: Date.now(),
    type: 'floor-plan',
    wizardInputs: {
      ...definition.wizardInputs,
      completedAt: Date.now(),
    },
    overlayScale: [Math.max(4, worldWidthM), Math.max(4, worldDepthM)],
  }
}
