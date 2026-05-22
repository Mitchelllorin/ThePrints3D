import type { ParsedWall, ParsedRoom, ParsedOpening, ParsedSymbol } from '../types'
import { defaults } from './modelDefaults'

export interface ModelInputs {
  wallHeight?: number
  studSpacing?: number
  wallType?: string
  roomWidth?: number
  roomLength?: number
  drywallThickness?: number
  insulation?: string
  electrical?: { outlets: number; switches: number; lights?: number } | null
  plumbing?: { fixtures?: Array<{ type: string; x: number; y: number }> } | null
  hasHvac?: boolean
  ceilingHeight?: number
  units?: string
  wallMaterial?: string
  hasDoors?: boolean
  hasWindows?: boolean
  doorWidth?: number
  doorHeight?: number
  windowWidth?: number
  windowHeight?: number
  roomCount?: number
}

export interface GeneratedModelData {
  walls: ParsedWall[]
  rooms: ParsedRoom[]
  openings: ParsedOpening[]
  symbols: ParsedSymbol[]
  scaleMmPerPx: number
  cx: number
  cy: number
}

const PX_SCALE = 10
const PX_CX = 500
const PX_CY = 500

function inchesToPx(inches: number): number {
  return (inches * 25.4) / PX_SCALE
}

function inferFromWizardAnswers(answers: Record<string, string | boolean>): ModelInputs {
  const inputs: ModelInputs = {}
  const wallMat = answers['wall-material']
  if (wallMat) {
    inputs.wallMaterial = String(wallMat)
    inputs.wallType = String(wallMat)
  }
  if (answers['ceiling-height']) inputs.ceilingHeight = parseFloat(String(answers['ceiling-height']))
  const hasElec = answers['has-electrical']
  if (hasElec !== undefined) {
    if (hasElec === 'true') {
      const outlets = answers['outlet-count'] ? parseInt(String(answers['outlet-count']), 10) : 4
      const switches = answers['switch-count'] ? parseInt(String(answers['switch-count']), 10) : 2
      const lights = answers['light-count'] ? parseInt(String(answers['light-count']), 10) : 1
      inputs.electrical = { outlets, switches, lights }
    } else {
      inputs.electrical = null
    }
  }
  const hasPlumb = answers['has-plumbing']
  if (hasPlumb !== undefined) {
    if (hasPlumb === 'true') {
      const fixtures: Array<{ type: string; x: number; y: number }> = []
      if (answers['has-sink'] === 'true') fixtures.push({ type: 'sink', x: 0, y: 0 })
      if (answers['has-toilet'] === 'true') fixtures.push({ type: 'toilet', x: 1, y: 0 })
      if (answers['has-shower'] === 'true') fixtures.push({ type: 'shower', x: 2, y: 0 })
      inputs.plumbing = { fixtures }
    } else {
      inputs.plumbing = null
    }
  }
  if (answers['has-hvac'] !== undefined) inputs.hasHvac = answers['has-hvac'] === 'true'
  if (answers['has-structural'] !== undefined) {
    if (answers['has-structural'] === 'true') {
      inputs.wallType = 'steel'
    }
  }
  if (answers['wall-height']) inputs.wallHeight = parseInt(String(answers['wall-height']), 10)
  if (answers['stud-spacing']) inputs.studSpacing = parseInt(String(answers['stud-spacing']), 10)
  if (answers['room-width']) inputs.roomWidth = parseInt(String(answers['room-width']), 10)
  if (answers['room-length']) inputs.roomLength = parseInt(String(answers['room-length']), 10)
  if (answers['room-count-value']) inputs.roomCount = parseInt(String(answers['room-count-value']), 10)
  if (answers['has-doors'] !== undefined) inputs.hasDoors = answers['has-doors'] === 'true'
  if (answers['has-windows'] !== undefined) inputs.hasWindows = answers['has-windows'] === 'true'
  if (answers['door-width']) inputs.doorWidth = parseInt(String(answers['door-width']), 10)
  if (answers['door-height']) inputs.doorHeight = parseInt(String(answers['door-height']), 10)
  if (answers['window-width']) inputs.windowWidth = parseInt(String(answers['window-width']), 10)
  if (answers['window-height']) inputs.windowHeight = parseInt(String(answers['window-height']), 10)
  if (answers['insulation-type']) inputs.insulation = String(answers['insulation-type'])
  if (answers['drywall-thickness']) inputs.drywallThickness = parseFloat(String(answers['drywall-thickness']))
  return inputs
}

function generateWalls(roomW: number, roomD: number, roomCount: number, thicknessPx: number): ParsedWall[] {
  const walls: ParsedWall[] = []
  const wPx = inchesToPx(roomW)
  const dPx = inchesToPx(roomD)

  if (roomCount <= 1) {
    const x0 = PX_CX - wPx / 2
    const y0 = PX_CY - dPx / 2
    const x1 = PX_CX + wPx / 2
    const y1 = PX_CY + dPx / 2
    walls.push(
      { x1: x0, y1: y0, x2: x1, y2: y0, thickness: thicknessPx, source: 'auto', detectionConfidence: 0.9, wallType: 'exterior' as any },
      { x1: x1, y1: y0, x2: x1, y2: y1, thickness: thicknessPx, source: 'auto', detectionConfidence: 0.9, wallType: 'exterior' as any },
      { x1: x1, y1: y1, x2: x0, y2: y1, thickness: thicknessPx, source: 'auto', detectionConfidence: 0.9, wallType: 'exterior' as any },
      { x1: x0, y1: y1, x2: x0, y2: y0, thickness: thicknessPx, source: 'auto', detectionConfidence: 0.9, wallType: 'exterior' as any },
    )
  } else {
    const cols = Math.ceil(Math.sqrt(roomCount))
    const rows = Math.ceil(roomCount / cols)
    const cellW = wPx / cols
    const cellD = dPx / rows
    const gridX0 = PX_CX - (cols * cellW) / 2
    const gridY0 = PX_CY - (rows * cellD) / 2

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (r * cols + c >= roomCount) break
        const x0 = gridX0 + c * cellW
        const y0 = gridY0 + r * cellD
        const x1 = x0 + cellW
        const y1 = y0 + cellD
        const isInt = r < rows - 1 || c < cols - 1
        const wt: any = isInt ? 'interior' : 'exterior'
        const thick = isInt ? Math.max(2, thicknessPx * 0.6) : thicknessPx
        walls.push(
          { x1: x0, y1: y0, x2: x1, y2: y0, thickness: thick, source: 'auto', detectionConfidence: 0.9, wallType: wt },
          { x1: x1, y1: y0, x2: x1, y2: y1, thickness: thick, source: 'auto', detectionConfidence: 0.9, wallType: wt },
          { x1: x1, y1: y1, x2: x0, y2: y1, thickness: thick, source: 'auto', detectionConfidence: 0.9, wallType: wt },
          { x1: x0, y1: y1, x2: x0, y2: y0, thickness: thick, source: 'auto', detectionConfidence: 0.9, wallType: wt },
        )
      }
    }
  }
  return walls
}

function generateRooms(walls: ParsedWall[], roomCount: number): ParsedRoom[] {
  const rooms: ParsedRoom[] = []
  if (roomCount <= 1 && walls.length >= 4) {
    const xs = walls.map((w) => [w.x1, w.x2]).flat()
    const ys = walls.map((w) => [w.y1, w.y2]).flat()
    const minX = Math.min(...xs)
    const maxX = Math.max(...xs)
    const minY = Math.min(...ys)
    const maxY = Math.max(...ys)
    const w = maxX - minX, d = maxY - minY
    rooms.push({
      id: 'room-0',
      x1: minX, y1: minY, x2: maxX, y2: maxY,
      cx: (minX + maxX) / 2, cy: (minY + maxY) / 2,
      areaPx: w * d, areaSqM: null,
    })
  } else {
    const perRoom = walls.length / roomCount
    for (let i = 0; i < roomCount; i++) {
      const start = Math.floor(i * perRoom)
      const end = Math.floor((i + 1) * perRoom)
      const roomWalls = walls.slice(start, end)
      if (roomWalls.length === 0) continue
      const xs = roomWalls.map((w) => [w.x1, w.x2]).flat()
      const ys = roomWalls.map((w) => [w.y1, w.y2]).flat()
      const minX = Math.min(...xs)
      const maxX = Math.max(...xs)
      const minY = Math.min(...ys)
      const maxY = Math.max(...ys)
      const w = maxX - minX, d = maxY - minY
      rooms.push({
        id: `room-${i}`,
        x1: minX, y1: minY, x2: maxX, y2: maxY,
        cx: (minX + maxX) / 2, cy: (minY + maxY) / 2,
        areaPx: w * d, areaSqM: null,
      })
    }
  }
  return rooms
}

function generateOpenings(walls: ParsedWall[], hasDoors: boolean, hasWindows: boolean, dw: number, _dh: number, ww: number, _wh: number): ParsedOpening[] {
  const openings: ParsedOpening[] = []
  if (!hasDoors && !hasWindows) return openings

  for (let i = 0; i < walls.length && openings.length < wallOpeningLimit(walls.length, hasDoors, hasWindows); i++) {
    const w = walls[i]
    const dx = w.x2 - w.x1
    const dy = w.y2 - w.y1
    const len = Math.sqrt(dx * dx + dy * dy)
    if (len < 20) continue

    const midX = (w.x1 + w.x2) / 2
    const midY = (w.y1 + w.y2) / 2
    const horizontal = Math.abs(dx) > Math.abs(dy)

    if (hasDoors && i % (walls.length / Math.max(1, wallOpeningLimit(walls.length, hasDoors, hasWindows))) === 0) {
      const doorW = inchesToPx(dw)
      openings.push({
        x: midX, y: midY,
        widthPx: Math.max(doorW, 10),
        widthMm: null,
        type: 'door',
        orientation: horizontal ? 'horizontal' : 'vertical',
      })
    } else if (hasWindows) {
      const windowW = inchesToPx(ww)
      openings.push({
        x: midX + (horizontal ? 0 : 15), y: midY + (horizontal ? 15 : 0),
        widthPx: Math.max(windowW, 10),
        widthMm: null,
        type: 'window',
        orientation: horizontal ? 'horizontal' : 'vertical',
      })
    }
  }
  return openings
}

function wallOpeningLimit(wallCount: number, doors: boolean, windows: boolean): number {
  const total = (doors ? 1 : 0) + (windows ? 1 : 0)
  return Math.max(1, Math.floor(wallCount / (total || 1)))
}

function generateSymbols(walls: ParsedWall[], electrical: { outlets: number; switches: number; lights?: number } | null, plumbing: { fixtures: Array<{ type: string }> } | null): ParsedSymbol[] {
  const symbols: ParsedSymbol[] = []

  if (electrical) {
    const wallMidpoints = walls.map((w) => ({
      x: (w.x1 + w.x2) / 2,
      y: (w.y1 + w.y2) / 2,
    }))

    for (let i = 0; i < Math.min(electrical.outlets, wallMidpoints.length); i++) {
      symbols.push({
        id: `gen-outlet-${i}`,
        symbolId: 'electrical-outlet',
        category: 'electrical',
        label: 'Outlet',
        x: Math.round(wallMidpoints[i].x + 20),
        y: Math.round(wallMidpoints[i].y + 10),
        confidence: 0.9,
        source: 'line_classifier',
      })
    }

    for (let i = 0; i < Math.min(electrical.switches, wallMidpoints.length); i++) {
      symbols.push({
        id: `gen-switch-${i}`,
        symbolId: 'electrical-switch',
        category: 'electrical',
        label: 'Switch',
        x: Math.round(wallMidpoints[i].x - 20),
        y: Math.round(wallMidpoints[i].y - 10),
        confidence: 0.9,
        source: 'line_classifier',
      })
    }

    const lights = electrical.lights ?? 1
    for (let i = 0; i < lights; i++) {
      symbols.push({
        id: `gen-light-${i}`,
        symbolId: 'electrical-light',
        category: 'electrical',
        label: 'LightFixture',
        x: Math.round(PX_CX + (i - lights / 2 + 0.5) * 80),
        y: Math.round(PX_CY),
        confidence: 0.85,
        source: 'line_classifier',
      })
    }
  }

  if (plumbing?.fixtures) {
    for (let i = 0; i < plumbing.fixtures.length; i++) {
      const f = plumbing.fixtures[i]
      symbols.push({
        id: `gen-plumb-${i}`,
        symbolId: `plumbing-${f.type}`,
        category: f.type === 'toilet' || f.type === 'bathtub' ? 'plumbing' : 'fixture',
        label: f.type.charAt(0).toUpperCase() + f.type.slice(1),
        x: Math.round(PX_CX + 80 * (i + 1)),
        y: Math.round(PX_CY - 60),
        confidence: 0.9,
        source: 'line_classifier',
      })
    }
  }

  return symbols
}

export function generateModelFromInputs(inputs: ModelInputs): GeneratedModelData {
  const merged = { ...defaults, ...inputs }
  const wallThicknessPx = merged.wallType === 'steel' ? 4 : 5
  const roomW = merged.roomWidth || defaults.roomWidth
  const roomD = merged.roomLength || defaults.roomLength
  const roomCount = Math.max(1, merged.roomCount ?? 1)
  const hasDoors = merged.hasDoors ?? true
  const hasWindows = merged.hasWindows ?? true
  const dw = merged.doorWidth || defaults.doorWidth
  const dh = merged.doorHeight || defaults.doorHeight
  const ww = merged.windowWidth || defaults.windowWidth
  const wh = merged.windowHeight || defaults.windowHeight
  const elec = merged.electrical
  const plumbRaw = merged.plumbing
  const plumbFixtures: Array<{ type: string }> = plumbRaw && typeof plumbRaw === 'object' && 'fixtures' in plumbRaw
    ? (plumbRaw as any).fixtures ?? []
    : []
  const plumb = plumbFixtures.length > 0 ? { fixtures: plumbFixtures } : null

  const walls = generateWalls(roomW, roomD, roomCount, wallThicknessPx)
  const rooms = generateRooms(walls, roomCount)
  const openings = generateOpenings(walls, hasDoors, hasWindows, dw, dh, ww, wh)
  const symbols = generateSymbols(walls, elec, plumb)

  return {
    walls,
    rooms,
    openings,
    symbols,
    scaleMmPerPx: PX_SCALE,
    cx: PX_CX,
    cy: PX_CY,
  }
}

export function generateModelFromWizardAnswers(answers: Record<string, string | boolean>): GeneratedModelData {
  const inputs = inferFromWizardAnswers(answers)
  return generateModelFromInputs(inputs)
}

export function generateSingleRoomPreset(): GeneratedModelData {
  return generateModelFromInputs({})
}

export function fillMissingInputs(inputs: ModelInputs): Required<ModelInputs> {
  return {
    wallHeight: inputs.wallHeight ?? defaults.wallHeight,
    studSpacing: inputs.studSpacing ?? defaults.studSpacing,
    wallType: inputs.wallType ?? defaults.wallType,
    roomWidth: inputs.roomWidth ?? defaults.roomWidth,
    roomLength: inputs.roomLength ?? defaults.roomLength,
    drywallThickness: inputs.drywallThickness ?? defaults.drywallThickness,
    insulation: inputs.insulation ?? defaults.insulation,
    electrical: inputs.electrical ?? defaults.electrical,
    plumbing: inputs.plumbing ?? defaults.plumbing,
    hasHvac: inputs.hasHvac ?? defaults.hasHvac,
    ceilingHeight: inputs.ceilingHeight ?? defaults.ceilingHeight,
    units: inputs.units ?? defaults.units,
    wallMaterial: inputs.wallMaterial ?? defaults.wallType,
    hasDoors: inputs.hasDoors ?? true,
    hasWindows: inputs.hasWindows ?? true,
    doorWidth: inputs.doorWidth ?? defaults.doorWidth,
    doorHeight: inputs.doorHeight ?? defaults.doorHeight,
    windowWidth: inputs.windowWidth ?? defaults.windowWidth,
    windowHeight: inputs.windowHeight ?? defaults.windowHeight,
    roomCount: inputs.roomCount ?? 1,
  }
}
