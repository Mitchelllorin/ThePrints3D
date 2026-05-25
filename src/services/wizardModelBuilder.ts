import type { Wall3D, PlacedComponent } from '../types'

export interface WizardBuildResult {
  walls: Wall3D[]
  components: PlacedComponent[]
  tradeLayerUpdates: { id: string; visible: boolean; opacity: number }[]
  boundingBox: { width: number; depth: number; height: number }
}

function n(answers: Record<string, string>, key: string, fallback: number): number {
  const v = Number(answers[key])
  return isFinite(v) && v > 0 ? v : fallback
}

export function buildModelFromWizard(answers: Record<string, string>): WizardBuildResult {
  // ─── Read all answers with defaults ─────────────────────────────────
  const foundationType = answers['foundation-type'] || 'monolithic-slab'
  const bldgLen = n(answers, 'building-length', 240)
  const bldgWd = n(answers, 'building-width', 180)
  const slabThk = n(answers, 'slab-thickness', 4)
  const fndWallHt = n(answers, 'foundation-wall-height', 48)
  const fndWallThk = n(answers, 'foundation-wall-thickness', 8)

  const wallMat = answers['wall-material'] || 'wood'
  const studSpacing = answers['stud-spacing'] || '16'
  const wallHt = n(answers, 'wall-height', 96)
  const wallThk = n(answers, 'wall-thickness', 4.5)
  const hasDoors = answers['has-doors'] !== 'false'
  const doorW = n(answers, 'door-width', 36)
  const doorH = n(answers, 'door-height', 80)
  const hasWindows = answers['has-windows'] !== 'false'
  const winW = n(answers, 'window-width', 48)
  const winH = n(answers, 'window-height', 36)
  const winSill = n(answers, 'window-sill', 36)
  const roofType = answers['roof-type'] || 'flat'
  const roofPitch = n(answers, 'roof-pitch', 4)
  const roofOverhang = n(answers, 'roof-overhang', 12)

  const hasElec = answers['has-electrical'] !== 'false'
  const outletCnt = Math.min(n(answers, 'outlet-count', 4), 20)
  const switchCnt = Math.min(n(answers, 'switch-count', 2), 10)
  const lightCnt = Math.min(n(answers, 'light-count', 1), 10)

  const hasPlumb = answers['has-plumbing'] === 'true'
  const hasSink = answers['has-sink'] === 'true'
  const hasToilet = answers['has-toilet'] === 'true'
  const hasShower = answers['has-shower'] === 'true'
  const hasTub = answers['has-tub'] === 'true'

  const hasHvac = answers['has-hvac'] === 'true'
  const hvacVents = n(answers, 'hvac-vents', 2)
  const hvacReturns = n(answers, 'hvac-returns', 1)

  const insulType = answers['insulation-type'] || 'batt'

  const drywallThk = answers['drywall-thickness'] || '0.5'
  const hasFlooring = answers['has-flooring'] !== 'false'
  const hasAppliances = answers['has-appliances'] === 'true'

  const walls: Wall3D[] = []
  const components: PlacedComponent[] = []
  const tradeLayerUpdates: { id: string; visible: boolean; opacity: number }[] = []

  // ─── Color maps ─────────────────────────────────────────────────────
  const wallColor: Record<string, string> = {
    wood: '#d97706', steel: '#94a3b8', concrete: '#64748b', icf: '#a78bfa',
  }
  const color = wallColor[wallMat] || '#d97706'

  // ─── Foundation: footings ───────────────────────────────────────────
  // Footings are wider than foundation walls
  const hasFootings = foundationType === 'footings-walls' || foundationType === 'stem-wall-slab'
  const footingW = fndWallThk + 8  // 4" on each side
  const footingD = 12  // typical 12" deep

  if (hasFootings) {
    // 4 footing segments under perimeter
    const fSegs: [number, number, number, number][] = [
      [0, 0, bldgLen, 0],
      [bldgLen, 0, bldgLen, bldgWd],
      [bldgLen, bldgWd, 0, bldgWd],
      [0, bldgWd, 0, 0],
    ]
    for (const [x1, z1, x2, z2] of fSegs) {
      const fx = (x1 + x2) / 2, fz = (z1 + z2) / 2
      const flen = Math.sqrt((x2 - x1) ** 2 + (z2 - z1) ** 2)
      walls.push({
        id: '', start: [fx - flen / 2, -footingD, fz], end: [fx + flen / 2, -footingD, fz],
        height: footingD, thickness: footingW, color: '#78716c', layer: 'structure', type: 'block',
      })
    }
  }

  // ─── Foundation: monolithic slab ────────────────────────────────────
  if (foundationType === 'monolithic-slab') {
    walls.push({
      id: '', start: [0, 0, 0], end: [bldgLen, 0, 0],
      height: slabThk, thickness: bldgWd, color: '#78716c', layer: 'structure', type: 'block',
    })
    tradeLayerUpdates.push({ id: 'flooring', visible: true, opacity: 0.4 })
  }

  // ─── Foundation: stem wall + slab ───────────────────────────────────
  if (foundationType === 'stem-wall-slab') {
    // Stem walls around perimeter
    const perimWalls: [number, number, number, number][] = [
      [0, 0, bldgLen, 0], [bldgLen, 0, bldgLen, bldgWd],
      [bldgLen, bldgWd, 0, bldgWd], [0, bldgWd, 0, 0],
    ]
    for (const [x1, z1, x2, z2] of perimWalls) {
      const mx = (x1 + x2) / 2, mz = (z1 + z2) / 2
      const len = Math.sqrt((x2 - x1) ** 2 + (z2 - z1) ** 2)
      walls.push({
        id: '', start: [mx - len / 2, 0, mz], end: [mx + len / 2, 0, mz],
        height: fndWallHt, thickness: fndWallThk, color: '#78716c', layer: 'structure', type: 'block',
      })
    }
    // Slab on top
    walls.push({
      id: '', start: [0, fndWallHt, 0], end: [bldgLen, fndWallHt, 0],
      height: slabThk, thickness: bldgWd, color: '#a8a29e', layer: 'structure', type: 'block',
    })
    tradeLayerUpdates.push({ id: 'flooring', visible: true, opacity: 0.4 })
  }

  // ─── Foundation: foundation walls (for footings-walls) ──────────────
  if (foundationType === 'footings-walls' || foundationType === 'crawlspace') {
    const perimWalls: [number, number, number, number][] = [
      [0, 0, bldgLen, 0], [bldgLen, 0, bldgLen, bldgWd],
      [bldgLen, bldgWd, 0, bldgWd], [0, bldgWd, 0, 0],
    ]
    for (const [x1, z1, x2, z2] of perimWalls) {
      const mx = (x1 + x2) / 2, mz = (z1 + z2) / 2
      const len = Math.sqrt((x2 - x1) ** 2 + (z2 - z1) ** 2)
      walls.push({
        id: '', start: [mx - len / 2, 0, mz], end: [mx + len / 2, 0, mz],
        height: fndWallHt, thickness: fndWallThk, color: '#78716c', layer: 'structure', type: 'block',
      })
    }
  }

  // ─── Foundation: pier / post ────────────────────────────────────────
  if (foundationType === 'pier') {
    const pierSpacing = 72  // 6ft spacing
    for (let x = 0; x < bldgLen; x += pierSpacing) {
      for (let z = 0; z < bldgWd; z += pierSpacing) {
        walls.push({
          id: '', start: [x, 0, z], end: [x + 12, 0, z],
          height: fndWallHt, thickness: 12, color: '#78716c', layer: 'structure', type: 'block',
        })
      }
    }
  }

  // ─── Framing: perimeter and interior walls ──────────────────────────
  const floorOffset = foundationType === 'monolithic-slab' ? slabThk : fndWallHt + (foundationType === 'stem-wall-slab' ? slabThk : 0)
  const actualFloor = Math.max(floorOffset, 0)

  // Exterior walls
  const extWalls: [number, number, number, number, string][] = [
    [0, 0, bldgLen, 0, 'front'],
    [bldgLen, 0, bldgLen, bldgWd, 'right'],
    [bldgLen, bldgWd, 0, bldgWd, 'back'],
    [0, bldgWd, 0, 0, 'left'],
  ]

  let wallIdx = 0
  for (const [x1, z1, x2, z2, side] of extWalls) {
    const mx = (x1 + x2) / 2, mz = (z1 + z2) / 2
    const len = Math.sqrt((x2 - x1) ** 2 + (z2 - z1) ** 2)
    const opens = []
    // Front wall gets a door
    if (side === 'front' && hasDoors && wallIdx === 0) {
      opens.push({ id: '', wallId: '', type: 'door' as const, pos: 0.5, width: doorW, height: doorH, sillHeight: 0 })
    }
    // Back wall gets a window
    if (side === 'back' && hasWindows) {
      opens.push({ id: '', wallId: '', type: 'window' as const, pos: 0.4, width: winW, height: winH, sillHeight: winSill })
    }
    walls.push({
      id: '', start: [mx - len / 2, actualFloor, mz], end: [mx + len / 2, actualFloor, mz],
      height: wallHt, thickness: wallThk, color, layer: 'structure', type: wallMat === 'concrete' ? 'block' : 'stud',
      openings: opens,
    })
    wallIdx++
  }

  // Interior partition (middle)
  walls.push({
    id: '', start: [0, actualFloor, bldgWd / 2], end: [bldgLen * 0.6, actualFloor, bldgWd / 2],
    height: wallHt, thickness: wallThk * 0.7, color: '#d97706', layer: 'structure', type: 'stud',
    openings: hasDoors ? [{ id: '', wallId: '', type: 'door' as const, pos: 0.5, width: doorW - 4, height: doorH, sillHeight: 0 }] : [],
  })

  // ─── Roof structure ─────────────────────────────────────────────────
  const roofHt = roofType === 'flat' ? 6 : (roofPitch / 12) * (bldgLen / 2)
  const totalHt = actualFloor + wallHt
  const overhang = roofOverhang

  if (roofType === 'flat') {
    // Flat roof: shallow box on top
    walls.push({
      id: '', start: [-overhang, totalHt, -overhang], end: [bldgLen + overhang, totalHt, -overhang],
      height: 4, thickness: bldgWd + overhang * 2, color: '#57534e', layer: 'structure', type: 'custom',
    })
  } else if (roofType === 'gable') {
    // Gable: ridge line + two sloped sides (visual ridge beam)
    walls.push({
      id: '', start: [bldgLen / 2 - 2, totalHt, -overhang], end: [bldgLen / 2 - 2, totalHt, bldgWd + overhang],
      height: roofHt, thickness: 4, color: '#57534e', layer: 'structure', type: 'custom',
    })
  }

  // ─── Components: doors ──────────────────────────────────────────────
  if (hasDoors) {
    components.push({
      id: '', type: 'door', label: 'Front Door',
      position: [bldgLen / 2, actualFloor + 1, 0], rotation: 0,
      scale: [1, 1, 1], color: '#8B4513',
    })
    components.push({
      id: '', type: 'door', label: 'Interior Door',
      position: [bldgLen * 0.3, actualFloor + 1, bldgWd / 2], rotation: 0,
      scale: [1, 1, 1], color: '#a0522d',
    })
  }

  // ─── Components: windows ────────────────────────────────────────────
  if (hasWindows) {
    components.push({
      id: '', type: 'window', label: 'Window',
      position: [bldgLen * 0.4, actualFloor + winSill + winH / 2, bldgWd], rotation: 0,
      scale: [1, 1, 1], color: '#7dd3fc',
    })
    components.push({
      id: '', type: 'window', label: 'Window',
      position: [bldgLen * 0.7, actualFloor + winSill + winH / 2, bldgWd], rotation: 0,
      scale: [1, 1, 1], color: '#7dd3fc',
    })
  }

  // ─── MEP: Electrical ────────────────────────────────────────────────
  if (hasElec) {
    for (let i = 0; i < outletCnt; i++) {
      components.push({
        id: '', type: 'fixture', label: 'Outlet',
        position: [(i % 2) * bldgLen, actualFloor + 18, Math.floor(i / 2) % 3 * (bldgWd / 3)],
        rotation: 0, scale: [1, 1, 1], color: '#fbbf24',
      })
    }
    for (let i = 0; i < switchCnt; i++) {
      components.push({
        id: '', type: 'fixture', label: 'Switch',
        position: [(i % 2) * bldgLen, actualFloor + 48, Math.floor(i / 2) % 2 * bldgWd],
        rotation: 0, scale: [1, 1, 1], color: '#f59e0b',
      })
    }
    for (let i = 0; i < lightCnt; i++) {
      components.push({
        id: '', type: 'fixture', label: 'Ceiling Light',
        position: [bldgLen / 2, actualFloor + wallHt - 2, bldgWd / 2],
        rotation: 0, scale: [1, 1, 1], color: '#fef3c7',
      })
    }
    tradeLayerUpdates.push({ id: 'electrical', visible: true, opacity: 0.5 })
  }

  // ─── MEP: Plumbing ──────────────────────────────────────────────────
  if (hasPlumb) {
    if (hasSink) {
      components.push({
        id: '', type: 'fixture', label: 'Sink',
        position: [bldgLen * 0.2, actualFloor + 32, bldgWd * 0.3],
        rotation: 0, scale: [1.5, 1, 1], color: '#e2e8f0',
      })
    }
    if (hasToilet) {
      components.push({
        id: '', type: 'fixture', label: 'Toilet',
        position: [bldgLen * 0.8, actualFloor + 16, bldgWd * 0.3],
        rotation: 0, scale: [1, 1, 1], color: '#f8fafc',
      })
    }
    if (hasShower) {
      components.push({
        id: '', type: 'fixture', label: 'Shower',
        position: [bldgLen * 0.8, actualFloor + 6, bldgWd * 0.7],
        rotation: 0, scale: [1.2, 1, 1.2], color: '#bae6fd',
      })
    }
    if (hasTub) {
      components.push({
        id: '', type: 'fixture', label: 'Bathtub',
        position: [bldgLen * 0.2, actualFloor + 6, bldgWd * 0.7],
        rotation: 0, scale: [1.8, 1, 1], color: '#f0f9ff',
      })
    }
    tradeLayerUpdates.push({ id: 'plumbing', visible: true, opacity: 0.5 })
  }

  // ─── MEP: HVAC ──────────────────────────────────────────────────────
  if (hasHvac) {
    for (let i = 0; i < hvacVents; i++) {
      components.push({
        id: '', type: 'fixture', label: 'HVAC Supply',
        position: [(i + 1) * bldgLen / (hvacVents + 1), actualFloor + wallHt - 4, bldgWd / 2],
        rotation: 0, scale: [0.8, 0.8, 0.8], color: '#a78bfa',
      })
    }
    for (let i = 0; i < hvacReturns; i++) {
      components.push({
        id: '', type: 'fixture', label: 'HVAC Return',
        position: [bldgLen / 2, actualFloor + wallHt - 4, bldgWd * 0.2],
        rotation: 0, scale: [0.8, 0.8, 0.8], color: '#c4b5fd',
      })
    }
    tradeLayerUpdates.push({ id: 'hvac', visible: true, opacity: 0.5 })
  }

  // ─── Insulation layer ────────────────────────────────────────────────
  if (insulType !== 'none') {
    tradeLayerUpdates.push({ id: 'insulation', visible: true, opacity: 0.5 })
  }

  // ─── Drywall layer ──────────────────────────────────────────────────
  if (drywallThk !== '0') {
    tradeLayerUpdates.push({ id: 'drywall', visible: true, opacity: 0.3 })
  }

  // ─── Studs layer ─────────────────────────────────────────────────────
  if (studSpacing !== 'none') {
    tradeLayerUpdates.push({ id: 'studs', visible: true, opacity: 0.4 })
  }

  // ─── Finishes: flooring ──────────────────────────────────────────────
  if (hasFlooring) {
    tradeLayerUpdates.push({ id: 'flooring', visible: true, opacity: 0.5 })
  }

  // ─── Finishes: furniture placeholder if appliances ───────────────────
  if (hasAppliances) {
    components.push({
      id: '', type: 'appliance', label: 'Refrigerator',
      position: [bldgLen * 0.15, actualFloor + 18, bldgWd * 0.1],
      rotation: 0, scale: [1, 1, 1], color: '#e2e8f0',
    })
    components.push({
      id: '', type: 'appliance', label: 'Range',
      position: [bldgLen * 0.15, actualFloor + 18, bldgWd * 0.85],
      rotation: 0, scale: [1, 1, 1], color: '#334155',
    })
  }

  return {
    walls,
    components,
    tradeLayerUpdates,
    boundingBox: { width: bldgLen, depth: bldgWd, height: totalHt + roofHt },
  }
}

export function applyDefaultsForMissing(answers: Record<string, string>): Record<string, string> {
  const r = { ...answers }
  const defaults: [string, string][] = [
    ['foundation-type', 'monolithic-slab'],
    ['building-length', '240'],
    ['building-width', '180'],
    ['slab-thickness', '4'],
    ['foundation-wall-height', '48'],
    ['foundation-wall-thickness', '8'],
    ['has-floorplan', 'false'],
    ['floorplan-rotation', '0'],
    ['floorplan-opacity', '60'],
    ['wall-material', 'wood'],
    ['stud-spacing', '16'],
    ['wall-height', '96'],
    ['wall-thickness', '4.5'],
    ['has-doors', 'true'],
    ['door-width', '36'],
    ['door-height', '80'],
    ['door-swing', 'inward'],
    ['has-windows', 'true'],
    ['window-width', '48'],
    ['window-height', '36'],
    ['window-sill', '36'],
    ['roof-type', 'flat'],
    ['roof-pitch', '4'],
    ['roof-overhang', '12'],
    ['has-electrical', 'true'],
    ['outlet-count', '4'],
    ['switch-count', '2'],
    ['light-count', '1'],
    ['has-plumbing', 'false'],
    ['has-sink', 'false'],
    ['has-toilet', 'false'],
    ['has-shower', 'false'],
    ['has-tub', 'false'],
    ['has-hvac', 'false'],
    ['hvac-vents', '2'],
    ['hvac-returns', '1'],
    ['insulation-type', 'batt'],
    ['insulation-rvalue', 'r13'],
    ['drywall-thickness', '0.5'],
    ['drywall-layers', 'single'],
    ['drywall-moisture', 'true'],
    ['has-paint', 'true'],
    ['paint-color', 'white'],
    ['has-flooring', 'true'],
    ['flooring-type', 'vinyl'],
    ['has-trim', 'true'],
    ['has-appliances', 'false'],
  ]
  for (const [key, val] of defaults) {
    if (r[key] === undefined || r[key] === '') {
      r[key] = val
    }
  }
  return r
}
