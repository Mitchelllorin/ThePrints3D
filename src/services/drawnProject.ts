/**
 * DRAW IT — a project that starts from typed sizes, not from a print.
 *
 * The other way in is a photo of a drawing, and everything downstream of that
 * is a guess: which lines are walls, how thick, and above all how many
 * millimetres a pixel is worth. Get the last one wrong and the building is the
 * wrong size, which is the failure that keeps coming back.
 *
 * Nothing here is inferred. You say 40 ft by 30 ft and the walls are 40 ft by
 * 30 ft, to the inch, because the number came from you.
 *
 * It still produces a DRAWING, because that is the one thing the whole app is
 * built around: walls live in sheet pixels, and the sheet says what a pixel is
 * worth. So this draws a blank sheet at a scale it CHOOSES (10 mm per pixel,
 * the same as the practice plans) and puts the footprint on it at that scale.
 * The scale is known rather than read, so it is marked 'parsed' — the same
 * standing as a number typed at calibration, and the standing detection needs
 * before anything is built from it (see modelWalls).
 *
 * FOOTPRINT IS OUTSIDE FACE TO OUTSIDE FACE, the way a builder quotes a slab
 * and the way a tape reads across a building. Walls are drawn on their
 * centrelines, so each centreline sits half a wall thickness inside the number
 * you typed — otherwise a "40 ft" house measures 40 ft 5-1/2" across the
 * outside and the slab under it is wrong by a wall.
 */
import type { Drawing, ParsedWall, TracedLine, WorkspaceWizardInputs } from '../types'
import { getWallType, getMember } from '../data/members'
import { formatFeetInches, parseFeetInches } from './unitConverter'

/** Millimetres per sheet pixel. Matches the practice plans, so both paths draw alike. */
export const DRAWN_MM_PER_PX = 10
/** Blank paper around the building, in millimetres — room for dimensions. */
const MARGIN_MM = 1219.2   // 4 ft

const MM_PER_FT = 304.8
const MM_PER_IN = 25.4

export type FloorChoice = 'slab' | 'joists' | 'none'

export interface DrawnProjectSpec {
  /** Outside face to outside face, millimetres. */
  widthMm: number
  depthMm: number
  /** Shell wall type, a key from the member catalogue's WALL_TYPES. */
  wallTypeKey: string
  /** What goes under it. 'none' leaves the floor for later — every step is optional. */
  floor: FloorChoice
  /** Name for the project. */
  name?: string
}

export interface DrawnProject {
  drawing: Pick<Drawing,
    | 'name' | 'file' | 'pageCount' | 'currentPage' | 'previewUrl' | 'rasterUrl'
    | 'rasterWidth' | 'rasterHeight' | 'parsedWalls' | 'parsedRooms' | 'parsedOpenings'
    | 'parsedText' | 'parsedSymbols' | 'parsedAnnotationCandidates' | 'parseProgress'
    | 'floorNumber' | 'status' | 'scaleMmPerPx' | 'scaleNotation' | 'scaleConfidence'
    | 'uploadedAt' | 'type'>
  /** Metres, for the overlay that lays the sheet on the ground. */
  overlayScale: [number, number]
  /** The floor area to lay under it, or null when the floor is left for later. */
  floorArea: TracedLine | null
  wizardInputs: WorkspaceWizardInputs
}

/** The shell wall's real thickness in millimetres, from the catalogue. */
export function shellThicknessMm(wallTypeKey: string): number {
  const type = getWallType(wallTypeKey)
  const member = type ? getMember(type.studMemberId) : undefined
  return (member?.depthIn ?? 5.5) * MM_PER_IN
}

/** Feet and inches for a label, the app's one formatter, to 1/16". */
export function ftIn(mm: number): string {
  return formatFeetInches(mm / MM_PER_IN, 16)
}

/**
 * A blank sheet with the footprint drawn on it and dimensioned, so the 2D print
 * under the model is a drawing of what you typed rather than an empty page. The
 * grid is at 1 ft, which is what makes it read as squared paper you can trace on.
 */
function sheetSvg(spec: DrawnProjectSpec, wPx: number, hPx: number, rect: { x1: number; y1: number; x2: number; y2: number }, tPx: number): string {
  const grid = MM_PER_FT / DRAWN_MM_PER_PX
  const label = `${ftIn(spec.widthMm)} × ${ftIn(spec.depthMm)}`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${wPx}" height="${hPx}" viewBox="0 0 ${wPx} ${hPx}">
    <defs>
      <pattern id="ft" width="${grid}" height="${grid}" patternUnits="userSpaceOnUse">
        <path d="M ${grid} 0 L 0 0 0 ${grid}" fill="none" stroke="#dbe3ec" stroke-width="0.6"/>
      </pattern>
    </defs>
    <rect width="${wPx}" height="${hPx}" fill="#f8fafc"/>
    <rect width="${wPx}" height="${hPx}" fill="url(#ft)"/>
    <rect x="${rect.x1}" y="${rect.y1}" width="${rect.x2 - rect.x1}" height="${rect.y2 - rect.y1}"
      fill="none" stroke="#0f172a" stroke-width="${tPx}"/>
    <text x="${wPx / 2}" y="${rect.y1 - 10}" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="14" font-weight="600" fill="#334155">${ftIn(spec.widthMm)}</text>
    <text x="${rect.x1 - 12}" y="${hPx / 2}" text-anchor="middle" transform="rotate(-90 ${rect.x1 - 12} ${hPx / 2})" font-family="Inter, Arial, sans-serif" font-size="14" font-weight="600" fill="#334155">${ftIn(spec.depthMm)}</text>
    <text x="14" y="${hPx - 14}" font-family="Inter, Arial, sans-serif" font-size="13" font-weight="600" fill="#334155">${spec.name ?? 'New project'}</text>
    <text x="${wPx - 14}" y="${hPx - 14}" text-anchor="end" font-family="Inter, Arial, sans-serif" font-size="12" fill="#64748b">Drawn to size · ${label}</text>
  </svg>`
}

/**
 * The four shell walls, as the user's own traced walls.
 *
 * 'user', not 'auto', and that is the whole point: nothing detected it, so
 * nothing has to be believed. They build straight away and they are editable
 * like any wall you drew yourself.
 */
export function shellWalls(spec: DrawnProjectSpec, rect: { x1: number; y1: number; x2: number; y2: number }, tPx: number): ParsedWall[] {
  const wall = (x1: number, y1: number, x2: number, y2: number): ParsedWall => ({
    x1, y1, x2, y2,
    thickness: tPx,
    source: 'user',
    framingType: spec.wallTypeKey,
    wallRole: 'exterior-bearing',
    level: 0,
  } as ParsedWall)
  return [
    wall(rect.x1, rect.y1, rect.x2, rect.y1),   // front
    wall(rect.x2, rect.y1, rect.x2, rect.y2),   // right
    wall(rect.x2, rect.y2, rect.x1, rect.y2),   // back
    wall(rect.x1, rect.y2, rect.x1, rect.y1),   // left
  ]
}

/** Feet, from millimetres, for the wizard summary lines. */
const ftOf = (mm: number): string => `${Math.round((mm / MM_PER_FT) * 10) / 10}ft`

export function createDrawnProject(spec: DrawnProjectSpec): DrawnProject {
  const tMm = shellThicknessMm(spec.wallTypeKey)
  const px = (mm: number) => mm / DRAWN_MM_PER_PX
  const wPx = Math.round(px(spec.widthMm + MARGIN_MM * 2))
  const hPx = Math.round(px(spec.depthMm + MARGIN_MM * 2))
  const tPx = px(tMm)
  // Centrelines, half a wall inside the outside face you typed.
  const rect = {
    x1: px(MARGIN_MM) + tPx / 2,
    y1: px(MARGIN_MM) + tPx / 2,
    x2: px(MARGIN_MM + spec.widthMm) - tPx / 2,
    y2: px(MARGIN_MM + spec.depthMm) - tPx / 2,
  }

  const svg = sheetSvg(spec, wPx, hPx, rect, tPx)
  let file: File
  try {
    file = new File([svg], 'drawn-project.svg', { type: 'image/svg+xml' })
  } catch {
    const blob = new Blob([svg], { type: 'image/svg+xml' })
    file = Object.assign(blob, { name: 'drawn-project.svg', lastModified: Date.now() }) as unknown as File
  }
  const url = typeof URL !== 'undefined' && URL.createObjectURL ? URL.createObjectURL(file) : ''

  // The floor covers the OUTSIDE of the shell — a slab is poured to the outside
  // face and joists run to the outside of the rim, so the footprint is the area.
  const floorArea: TracedLine | null = spec.floor === 'none' ? null : {
    id: `floor-drawn-${Date.now()}`,
    x1: px(MARGIN_MM),
    y1: px(MARGIN_MM),
    x2: px(MARGIN_MM + spec.widthMm),
    y2: px(MARGIN_MM + spec.depthMm),
    elementType: spec.floor === 'slab' ? 'Concrete Slab' : '2x10',
    size: spec.floor === 'slab' ? '4in' : '2x10',
    material: spec.floor === 'slab' ? 'Concrete' : 'Wood',
    level: 0,
  }

  const wallType = getWallType(spec.wallTypeKey)
  return {
    drawing: {
      name: spec.name ?? 'New project',
      file,
      pageCount: 1,
      currentPage: 1,
      previewUrl: url,
      rasterUrl: url,
      rasterWidth: wPx,
      rasterHeight: hPx,
      parsedWalls: shellWalls(spec, rect, tPx),
      parsedRooms: [],
      parsedOpenings: [],
      parsedText: [],
      parsedSymbols: [],
      parsedAnnotationCandidates: [],
      parseProgress: 100,
      floorNumber: 0,
      status: 'ready',
      scaleMmPerPx: DRAWN_MM_PER_PX,
      scaleNotation: '1:100',
      // Known, not guessed — this sheet was drawn at this scale on purpose.
      scaleConfidence: 'parsed',
      uploadedAt: Date.now(),
      type: 'floor-plan',
    },
    overlayScale: [(wPx * DRAWN_MM_PER_PX) / 1000, (hPx * DRAWN_MM_PER_PX) / 1000],
    floorArea,
    wizardInputs: {
      set1BuildingBasics: `${ftOf(spec.widthMm)} x ${ftOf(spec.depthMm)} footprint, 8ft ceiling, 1 floor, ${spec.floor === 'slab' ? 'slab' : spec.floor === 'joists' ? 'crawlspace' : 'foundation not chosen'}`,
      set1Clarifications: 'Drawn to typed sizes rather than traced from a print.',
      set2StructuralDetails: `Exterior ${wallType?.short ?? 'wood'} bearing walls.`,
      set2Clarifications: 'Interior partitions to be added.',
      set3FinishingDetails: 'Finishes not chosen yet.',
      set3Clarifications: '',
      completedGroup: 'group3',
      completedAt: Date.now(),
    } as WorkspaceWizardInputs,
  }
}

/**
 * Read a typed size into millimetres, in whichever way the trade writes it:
 * `40`, `40'`, `40' 6"`, `40-6`, `12.2m`, `480in`. Feet are the default for a
 * bare number, because that is what a footprint is quoted in on this continent
 * and the alternative — silently reading 40 as 40 mm — is a 300× mistake.
 */
export function parseSizeMm(input: string): number | null {
  const s = input.trim().toLowerCase()
  if (!s) return null
  const metric = s.match(/^(\d+(?:\.\d+)?)\s*(mm|cm|m)$/)
  if (metric) {
    const v = Number(metric[1])
    return metric[2] === 'mm' ? v : metric[2] === 'cm' ? v * 10 : v * 1000
  }
  const inches = s.match(/^(\d+(?:\.\d+)?)\s*(in|")$/)
  if (inches) return Number(inches[1]) * MM_PER_IN
  const feetOnly = s.match(/^(\d+(?:\.\d+)?)\s*(ft|feet|')?$/)
  if (feetOnly) return Number(feetOnly[1]) * MM_PER_FT
  const asFtIn = parseFeetInches(input)
  return asFtIn == null ? null : asFtIn * MM_PER_IN
}
