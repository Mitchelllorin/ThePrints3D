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
import {
  placeBoxes, footprintOutline, insetOutline, outlineBounds, translateOutline,
  type FootprintBox, type Point,
} from './footprint'

/** Millimetres per sheet pixel. Matches the practice plans, so both paths draw alike. */
export const DRAWN_MM_PER_PX = 10
/** Blank paper around the building, in millimetres — room for dimensions. */
const MARGIN_MM = 1219.2   // 4 ft

const MM_PER_FT = 304.8
const MM_PER_IN = 25.4

export type FloorChoice = 'slab' | 'joists' | 'none'

export interface DrawnProjectSpec {
  /** Outside face to outside face, millimetres. The MAIN box. */
  widthMm: number
  depthMm: number
  /**
   * The rest of the building. A house is a series of boxes — an L off the back,
   * a garage on the side, a bump-out for the dining room — and each of these
   * hangs off a side of the main box. Left out, it is the plain rectangle.
   * See services/footprint for how they become one outline.
   */
  wings?: FootprintBox[]
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
    | 'uploadedAt' | 'type' | 'source'>
  /** Metres, for the overlay that lays the sheet on the ground. */
  overlayScale: [number, number]
  /** The floor under it — one rectangle per box, empty when left for later. */
  floorAreas: TracedLine[]
  /** The outside face of the building, in sheet pixels, for anyone drawing it. */
  outlinePx: Point[]
  wizardInputs: WorkspaceWizardInputs
}

/** The shell wall's real thickness in millimetres, from the catalogue. */
export function shellThicknessMm(wallTypeKey: string): number {
  const type = getWallType(wallTypeKey)
  const member = type ? getMember(type.studMemberId) : undefined
  return (member?.depthIn ?? 5.5) * MM_PER_IN
}

/**
 * Is this Draw it's blank sheet rather than a print?
 *
 * It matters because the detection tools — Find the rest — read a PRINT for
 * walls you have not traced yet. On a blank grid there is nothing to find, and
 * offering it is a button that does nothing but look broken.
 *
 * New drawn sheets say so (`source: 'drawn'`). Ones started before that flag
 * existed were saved as `source: 'preset'`, so they are told apart from the
 * real sample plans the way they actually differ: a sample plan carries a
 * difficulty, a drawn sheet never has one, and a drawn sheet is always at the
 * one scale Draw it draws at.
 */
export function isDrawnSheet(d: { source?: string; presetDifficulty?: string; scaleMmPerPx?: number | null } | null | undefined): boolean {
  if (!d) return false
  if (d.source === 'drawn') return true
  return d.source === 'preset' && d.presetDifficulty == null && d.scaleMmPerPx === DRAWN_MM_PER_PX
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
function sheetSvg(spec: DrawnProjectSpec, wPx: number, hPx: number, outline: readonly Point[], tPx: number, sizeMm: { w: number; d: number }): string {
  const grid = MM_PER_FT / DRAWN_MM_PER_PX
  const label = `${ftIn(sizeMm.w)} × ${ftIn(sizeMm.d)}`
  const path = outline.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ') + ' Z'
  const bounds = outlineBounds(outline)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${wPx}" height="${hPx}" viewBox="0 0 ${wPx} ${hPx}">
    <defs>
      <pattern id="ft" width="${grid}" height="${grid}" patternUnits="userSpaceOnUse">
        <path d="M ${grid} 0 L 0 0 0 ${grid}" fill="none" stroke="#dbe3ec" stroke-width="0.6"/>
      </pattern>
    </defs>
    <rect width="${wPx}" height="${hPx}" fill="#f8fafc"/>
    <rect width="${wPx}" height="${hPx}" fill="url(#ft)"/>
    <path d="${path}" fill="none" stroke="#0f172a" stroke-width="${tPx}" stroke-linejoin="miter"/>
    <text x="${wPx / 2}" y="${bounds.y1 - 10}" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="14" font-weight="600" fill="#334155">${ftIn(sizeMm.w)}</text>
    <text x="${bounds.x1 - 12}" y="${hPx / 2}" text-anchor="middle" transform="rotate(-90 ${bounds.x1 - 12} ${hPx / 2})" font-family="Inter, Arial, sans-serif" font-size="14" font-weight="600" fill="#334155">${ftIn(sizeMm.d)}</text>
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
export function shellWalls(spec: DrawnProjectSpec, centreline: readonly Point[], tPx: number): ParsedWall[] {
  const wall = (a: Point, b: Point): ParsedWall => ({
    x1: a.x, y1: a.y, x2: b.x, y2: b.y,
    thickness: tPx,
    source: 'user',
    framingType: spec.wallTypeKey,
    wallRole: 'exterior-bearing',
    level: 0,
  } as ParsedWall)
  const out: ParsedWall[] = []
  for (let i = 0; i < centreline.length; i++) {
    const a = centreline[i]
    const b = centreline[(i + 1) % centreline.length]
    // A wing flush with a corner leaves no wall along that edge; skip the
    // zero-length run rather than framing a stud cage with nothing in it.
    if (Math.hypot(b.x - a.x, b.y - a.y) < 1e-6) continue
    out.push(wall(a, b))
  }
  return out
}

/** Every box of the building, main first, in the shape the footprint service takes. */
export function specBoxes(spec: DrawnProjectSpec): FootprintBox[] {
  return [{ widthMm: spec.widthMm, depthMm: spec.depthMm }, ...(spec.wings ?? [])]
}

/** Feet, from millimetres, for the wizard summary lines. */
const ftOf = (mm: number): string => `${Math.round((mm / MM_PER_FT) * 10) / 10}ft`

export function createDrawnProject(spec: DrawnProjectSpec): DrawnProject {
  const tMm = shellThicknessMm(spec.wallTypeKey)
  const px = (mm: number) => mm / DRAWN_MM_PER_PX

  // Every box, unioned into one outside face. A shared edge between two boxes is
  // not a wall — you do not frame the join between a house and its own wing.
  const rects = placeBoxes(specBoxes(spec))
  const raw = footprintOutline(rects)
  const bounds = outlineBounds(raw)
  const sizeMm = { w: bounds.x2 - bounds.x1, d: bounds.y2 - bounds.y1 }
  const wPx = Math.round(px(sizeMm.w + MARGIN_MM * 2))
  const hPx = Math.round(px(sizeMm.d + MARGIN_MM * 2))
  const tPx = px(tMm)

  // Onto the sheet: the outside face in pixels, margin included, then the wall
  // centrelines half a thickness inside it.
  const toSheet = (poly: readonly Point[]) =>
    translateOutline(poly.map((p) => ({ x: px(p.x), y: px(p.y) })), px(MARGIN_MM - bounds.x1), px(MARGIN_MM - bounds.y1))
  const outlinePx = toSheet(raw)
  const centreline = insetOutline(outlinePx, tPx / 2)

  const svg = sheetSvg(spec, wPx, hPx, outlinePx, tPx, sizeMm)
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
  // One rectangle per box, because a floor area is a rectangle: an L gets two,
  // which lay down as one continuous floor.
  const stamp = Date.now()
  const floorAreas: TracedLine[] = spec.floor === 'none' ? [] : rects.map((r, i) => ({
    id: `floor-drawn-${stamp}-${i}`,
    x1: px(r.x1 - bounds.x1 + MARGIN_MM),
    y1: px(r.y1 - bounds.y1 + MARGIN_MM),
    x2: px(r.x2 - bounds.x1 + MARGIN_MM),
    y2: px(r.y2 - bounds.y1 + MARGIN_MM),
    elementType: spec.floor === 'slab' ? 'Concrete Slab' : '2x10',
    size: spec.floor === 'slab' ? '4in' : '2x10',
    material: spec.floor === 'slab' ? 'Concrete' : 'Wood',
    level: 0,
  }))

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
      parsedWalls: shellWalls(spec, centreline, tPx),
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
      source: 'drawn',
    },
    overlayScale: [(wPx * DRAWN_MM_PER_PX) / 1000, (hPx * DRAWN_MM_PER_PX) / 1000],
    floorAreas,
    outlinePx,
    wizardInputs: {
      set1BuildingBasics: `${ftOf(sizeMm.w)} x ${ftOf(sizeMm.d)} footprint, 8ft ceiling, 1 floor, ${spec.floor === 'slab' ? 'slab' : spec.floor === 'joists' ? 'crawlspace' : 'foundation not chosen'}`,
      set1Clarifications: `Drawn to typed sizes rather than traced from a print.${(spec.wings?.length ?? 0) > 0 ? ` ${(spec.wings ?? []).length + 1} sections.` : ''}`,
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
