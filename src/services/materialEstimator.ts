import type { ParsedWall } from '../types'
import type { WallType } from './wallTypeClassifier'

const INCHES_PER_FOOT = 12
const FEET_PER_YARD = 3
const CUBIC_FEET_PER_CUBIC_YARD = FEET_PER_YARD ** 3

export interface MaterialEstimateOptions {
  ceilingHeightFt?: number
  studSpacingIn?: 16 | 24
  wasteFactorPct?: number
  drywallSheetSize?: '4x8' | '4x12'
  itemUnitCosts?: Partial<Record<MaterialItem['id'], number>>
}

export interface MaterialItem {
  id:
    | 'wall-linear-feet'
    | 'stud-count'
    | 'plate-linear-feet'
    | 'drywall-sheets'
    | 'insulation-sqft'
    | 'masonry-volume-yd3'
    | 'cmu-block-count'
  label: string
  quantity: number
  unit: string
  unitCost?: number
  estimatedCost?: number
}

export interface MaterialReport {
  assumptions: {
    ceilingHeightFt: number
    studSpacingIn: 16 | 24
    wasteFactorPct: number
    drywallSheetSize: '4x8' | '4x12'
  }
  totals: {
    totalWallLengthFt: number
    framedWallLengthFt: number
    masonryWallLengthFt: number
    wallLengthByTypeFt: Partial<Record<WallType, number>>
    estimatedCost: number | null
  }
  items: MaterialItem[]
}

function wallLengthFt(wall: ParsedWall, scaleMmPerPx: number): number {
  const dx = wall.x2 - wall.x1
  const dy = wall.y2 - wall.y1
  const mm = Math.hypot(dx, dy) * scaleMmPerPx
  return mm / 304.8
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function isFramedType(type: WallType | undefined): boolean {
  const framedTypes: WallType[] = [
    'partition-thin',
    'stud-2x4',
    'stud-2x6',
    'stud-2x8',
    'stud-2x10',
    'stud-2x12',
    'unknown',
  ]
  return framedTypes.includes(type ?? 'unknown')
}

function averageMasonryThicknessFt(walls: ParsedWall[]): number {
  const candidates = walls
    .filter((w) => w.wallType === 'masonry-thick' && Number.isFinite(w.framingMm))
    .map((w) => Math.max((w.framingMm ?? 0) / 304.8 / INCHES_PER_FOOT, 0.5))
  if (candidates.length === 0) return 0.67
  return candidates.reduce((a, b) => a + b, 0) / candidates.length
}

export function estimateMaterials(
  walls: ParsedWall[],
  scaleMmPerPx: number,
  options: MaterialEstimateOptions = {},
): MaterialReport {
  const ceilingHeightFt = options.ceilingHeightFt ?? 9
  const studSpacingIn = options.studSpacingIn ?? 16
  const wasteFactorPct = options.wasteFactorPct ?? 10
  const drywallSheetSize = options.drywallSheetSize ?? '4x8'
  const wasteMultiplier = 1 + wasteFactorPct / 100

  const wallLengthByTypeFt: Partial<Record<WallType, number>> = {}
  let totalWallLengthFt = 0
  let framedWallLengthFt = 0
  let masonryWallLengthFt = 0

  for (const wall of walls) {
    const lengthFt = wallLengthFt(wall, scaleMmPerPx)
    if (!Number.isFinite(lengthFt) || lengthFt <= 0) continue

    totalWallLengthFt += lengthFt
    const type = wall.wallType ?? 'unknown'
    wallLengthByTypeFt[type] = (wallLengthByTypeFt[type] ?? 0) + lengthFt

    if (type === 'masonry-thick') {
      masonryWallLengthFt += lengthFt
    } else if (isFramedType(type)) {
      framedWallLengthFt += lengthFt
    }
  }

  const studCount = Math.ceil(((framedWallLengthFt * INCHES_PER_FOOT) / studSpacingIn) * wasteMultiplier)
  const plateLinearFeet = framedWallLengthFt * 3 * wasteMultiplier
  const wallAreaSqFt = framedWallLengthFt * ceilingHeightFt
  const drywallAreaSqFt = wallAreaSqFt * 2
  const sheetArea = drywallSheetSize === '4x12' ? 48 : 32
  const drywallSheets = Math.ceil((drywallAreaSqFt / sheetArea) * wasteMultiplier)
  const insulationSqFt = wallAreaSqFt * wasteMultiplier

  const masonryThicknessFt = averageMasonryThicknessFt(walls)
  const masonryVolumeYd3 = ((masonryWallLengthFt * ceilingHeightFt * masonryThicknessFt) / CUBIC_FEET_PER_CUBIC_YARD) * wasteMultiplier
  const masonryWallAreaSqFt = masonryWallLengthFt * ceilingHeightFt
  const cmuBlocks = Math.ceil((masonryWallAreaSqFt / 0.889) * wasteMultiplier)

  const itemDefinitions: Array<Omit<MaterialItem, 'unitCost' | 'estimatedCost'>> = [
    { id: 'wall-linear-feet', label: 'Wall Linear Footage', quantity: totalWallLengthFt, unit: 'lf' },
    { id: 'stud-count', label: `Studs (${studSpacingIn}" OC)`, quantity: studCount, unit: 'pcs' },
    { id: 'plate-linear-feet', label: 'Plates (top + bottom)', quantity: plateLinearFeet, unit: 'lf' },
    { id: 'drywall-sheets', label: `Drywall Sheets (${drywallSheetSize})`, quantity: drywallSheets, unit: 'sheets' },
    { id: 'insulation-sqft', label: 'Insulation Coverage', quantity: insulationSqFt, unit: 'sqft' },
    { id: 'masonry-volume-yd3', label: 'Masonry/Concrete Volume', quantity: masonryVolumeYd3, unit: 'yd³' },
    { id: 'cmu-block-count', label: 'CMU Block Count (8x8x16)', quantity: cmuBlocks, unit: 'blocks' },
  ]

  const items: MaterialItem[] = itemDefinitions.map((item) => {
    const unitCost = options.itemUnitCosts?.[item.id]
    const normalizedQty = Number.isInteger(item.quantity) ? item.quantity : round2(item.quantity)
    const estimatedCost = typeof unitCost === 'number' ? round2(normalizedQty * unitCost) : undefined
    return {
      ...item,
      quantity: normalizedQty,
      unitCost,
      estimatedCost,
    }
  })

  const totalCost = items.reduce<number>((sum, item) => sum + (item.estimatedCost ?? 0), 0)
  const hasAnyCost = items.some((item) => typeof item.estimatedCost === 'number')

  return {
    assumptions: {
      ceilingHeightFt,
      studSpacingIn,
      wasteFactorPct,
      drywallSheetSize,
    },
    totals: {
      totalWallLengthFt: round2(totalWallLengthFt),
      framedWallLengthFt: round2(framedWallLengthFt),
      masonryWallLengthFt: round2(masonryWallLengthFt),
      wallLengthByTypeFt: Object.fromEntries(
        Object.entries(wallLengthByTypeFt).map(([key, value]) => [key, round2(value)]),
      ) as Partial<Record<WallType, number>>,
      estimatedCost: hasAnyCost ? round2(totalCost) : null,
    },
    items,
  }
}

export function materialReportToCsv(report: MaterialReport): string {
  const header = 'Item,Quantity,Unit,Unit Cost,Estimated Cost\n'
  const body = report.items
    .map((item) => {
      const unitCost = typeof item.unitCost === 'number' ? item.unitCost.toFixed(2) : ''
      const estimatedCost = typeof item.estimatedCost === 'number' ? item.estimatedCost.toFixed(2) : ''
      return `"${item.label}",${item.quantity},${item.unit},${unitCost},${estimatedCost}`
    })
    .join('\n')
  return `${header}${body}\n`
}
