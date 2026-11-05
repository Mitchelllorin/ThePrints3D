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
import { sectionBearingPoints, studsUnderBearing, withBearingPacks } from './bearingPacks'
import { formatFeetInches, parseFeetInches } from './unitConverter'
import { SKID_FLOOR } from './framingGeometry'
import {
  placeBoxes, footprintOutline, insetOutline, outlineBounds, translateOutline,
  type FootprintBox, type Point,
} from './footprint'
import { inferCorners } from './wallTraceReducer'

/** Millimetres per sheet pixel. Matches the practice plans, so both paths draw alike. */
export const DRAWN_MM_PER_PX = 10
/** Blank paper around the building, in millimetres — room for dimensions. */
const MARGIN_MM = 1219.2   // 4 ft

const MM_PER_FT = 304.8
const MM_PER_IN = 25.4

/** 'skids' is a shed's: a 2×6 floor frame on treated runners, no foundation. */
export type FloorChoice = 'slab' | 'joists' | 'skids' | 'none'

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
  /**
   * The sheet it was drawn on, when it was drawn on one (Draw it): where the
   * main box's top-left corner sits on the page, and how big the page is, in
   * millimetres. Left out, the house gets a plain margin round it.
   */
  page?: { originMm: Point; wMm: number; dMm: number }
  /** Inside walls drawn on that sheet: centrelines, in page millimetres. */
  insideWalls?: Array<{ x1: number; y1: number; x2: number; y2: number }>
  /**
   * The outside face drawn at any angle, corner by corner, in PAGE millimetres
   * (the same space as `insideWalls`). When it is here it is the building; the
   * boxes only say how big the first one was.
   */
  outline?: Point[]
  /**
   * WALLS DRAWN ONE AT A TIME, in page millimetres, when the job is not a box:
   * a carport is three walls, a fence line is one, an addition is whatever the
   * print says. These ARE the building — nothing closes a loop round them and
   * no wall is invented to finish a rectangle. The boxes are then only a page
   * size; see createFreeWallsProject.
   */
  freeWalls?: Array<{ x1: number; y1: number; x2: number; y2: number }>
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
    <text x="${(bounds.x1 + bounds.x2) / 2}" y="${bounds.y1 - 10}" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="14" font-weight="600" fill="#334155">${ftIn(sizeMm.w)}</text>
    <text x="${bounds.x1 - 12}" y="${(bounds.y1 + bounds.y2) / 2}" text-anchor="middle" transform="rotate(-90 ${bounds.x1 - 12} ${(bounds.y1 + bounds.y2) / 2})" font-family="Inter, Arial, sans-serif" font-size="14" font-weight="600" fill="#334155">${ftIn(sizeMm.d)}</text>
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

/**
 * The inside walls drawn on the Draw it sheet, as walls. Same standing as one
 * traced in plan view: interior, and bearing until you say otherwise — wrong in
 * the recoverable direction, a heavier stud rather than a missing one — on 2x4.
 */
export function insideWalls(spec: DrawnProjectSpec): ParsedWall[] {
  const px = (mm: number) => mm / DRAWN_MM_PER_PX
  const tPx = px(shellThicknessMm('wood-2x4'))
  return (spec.insideWalls ?? []).map((w) => ({
    x1: px(w.x1), y1: px(w.y1), x2: px(w.x2), y2: px(w.y2),
    thickness: tPx,
    source: 'user',
    framingType: 'wood-2x4',
    wallRole: 'interior-bearing',
    level: 0,
  } as ParsedWall))
}

/**
 * HOW FAR A HAND-DRAWN WALL END CAN BE FROM WHAT IT MEANT TO MEET.
 *
 * The sheet is drawn at 10 mm per pixel, so 20 px is 200 mm — about a stud bay,
 * and inside what a drag with a finger misses by. Anything wider is a doorway
 * or a deliberate offset, and gets left alone.
 */
const DRAWN_JOINT_TOLERANCE_PX = 20

/**
 * CLOSE THE JOINTS THE FINGER MISSED.
 *
 * Inside walls used to be committed exactly where the drag ended and nothing
 * tied them in. Two perpendicular walls that stopped an inch short of each
 * other stayed an inch apart — so the framing saw two separate ends instead of
 * a corner, and the three-stud corner post a carpenter builds at a junction was
 * never placed. Drawing each new wall off the previous one's end helped, but
 * that is only one of the ways people draw a plan.
 *
 * So: every inside-wall end is carried onto the line of the wall it was clearly
 * heading for — the shell, or another inside wall it butts into — and then the
 * meeting ends are squared up into an exact corner. The end moves ALONG its own
 * wall's axis, so a square wall stays square; angled walls are left as drawn.
 * The traced path has had this for a while (snapTraceWallToExisting,
 * inferCorners); this is the same bargain for the drawn one.
 */
function closeDrawnJoints(inside: ParsedWall[], shell: ParsedWall[]): ParsedWall[] {
  if (inside.length === 0) return inside
  const all = [...shell, ...inside]
  const snapped = inside.map((w, i) => {
    const others = all.filter((_, j) => j !== shell.length + i)
    const horiz = Math.abs(w.y2 - w.y1) < Math.abs(w.x2 - w.x1)
    const move = (px: number, py: number) => {
      let best: { x: number; y: number; d: number } | null = null
      for (const o of others) {
        const oHoriz = Math.abs(o.y2 - o.y1) < Math.abs(o.x2 - o.x1)
        // Only a PERPENDICULAR wall is a tee. Parallel (and angled) ones are
        // skipped rather than projected onto, which would tilt the wall.
        if (oHoriz === horiz) continue
        const along = horiz ? py : px
        const [lo, hi] = horiz
          ? [Math.min(o.y1, o.y2), Math.max(o.y1, o.y2)]
          : [Math.min(o.x1, o.x2), Math.max(o.x1, o.x2)]
        if (along < lo - DRAWN_JOINT_TOLERANCE_PX || along > hi + DRAWN_JOINT_TOLERANCE_PX) continue
        const target = horiz ? o.x1 : o.y1
        const d = Math.abs((horiz ? px : py) - target)
        if (d === 0 || d > DRAWN_JOINT_TOLERANCE_PX) continue
        if (best && d >= best.d) continue
        best = horiz ? { x: target, y: py, d } : { x: px, y: target, d }
      }
      return best ? { x: best.x, y: best.y } : { x: px, y: py }
    }
    const s = move(w.x1, w.y1)
    const e = move(w.x2, w.y2)
    return { ...w, x1: s.x, y1: s.y, x2: e.x, y2: e.y }
  })
  // Then make the projected ends MEET: the exact intersection of the two lines,
  // which is the corner the person was drawing.
  return inferCorners([...shell, ...snapped], DRAWN_JOINT_TOLERANCE_PX).slice(shell.length)
}

/** Every box of the building, main first, in the shape the footprint service takes. */
export function specBoxes(spec: DrawnProjectSpec): FootprintBox[] {
  return [{ widthMm: spec.widthMm, depthMm: spec.depthMm }, ...(spec.wings ?? [])]
}

/** Feet, from millimetres, for the wizard summary lines. */
const ftOf = (mm: number): string => `${Math.round((mm / MM_PER_FT) * 10) / 10}ft`

export function createDrawnProject(spec: DrawnProjectSpec): DrawnProject {
  // Walls drawn one at a time are the building on their own. Everything below
  // this line assumes a closed footprint, which is the thing they do not have.
  if (spec.freeWalls?.length) return createFreeWallsProject(spec, spec.freeWalls)
  const tMm = shellThicknessMm(spec.wallTypeKey)
  const px = (mm: number) => mm / DRAWN_MM_PER_PX

  // Every box, unioned into one outside face. A shared edge between two boxes is
  // not a wall — you do not frame the join between a house and its own wing.
  // A shape drawn at any angle is already on the page; boxes are placed from
  // the main box's corner.
  const shaped = !!spec.outline && spec.outline.length >= 3
  const rects = shaped ? [] : placeBoxes(specBoxes(spec))
  const raw = shaped ? spec.outline! : footprintOutline(rects)
  const bounds = outlineBounds(raw)
  const sizeMm = { w: bounds.x2 - bounds.x1, d: bounds.y2 - bounds.y1 }
  // Where the footprint lands on the sheet, in millimetres. Drawn on a page,
  // it is where you put it; otherwise a plain margin round the house.
  const offX = spec.page ? (shaped ? 0 : spec.page.originMm.x) : MARGIN_MM - bounds.x1
  const offY = spec.page ? (shaped ? 0 : spec.page.originMm.y) : MARGIN_MM - bounds.y1
  const wPx = Math.round(px(spec.page ? spec.page.wMm : sizeMm.w + MARGIN_MM * 2))
  const hPx = Math.round(px(spec.page ? spec.page.dMm : sizeMm.d + MARGIN_MM * 2))
  const tPx = px(tMm)

  // Onto the sheet: the outside face in pixels, then the wall centrelines half
  // a thickness inside it.
  const toSheet = (poly: readonly Point[]) =>
    translateOutline(poly.map((p) => ({ x: px(p.x), y: px(p.y) })), px(offX), px(offY))
  const outlinePx = toSheet(raw)
  const centreline = insetOutline(outlinePx, tPx / 2)

  // THE PACKS THE SECTIONS ASK FOR. Each section leaves its join with the main
  // house open, so a beam has to carry across that gap and comes down at both
  // ends — see services/bearingPacks. Put in now, with the walls, so they are
  // there when you stand them; editable in the wall sheet like any other pack.
  const toSheetPt = (q: Point) => ({ x: px(q.x + offX), y: px(q.y + offY) })
  const bearing = sectionBearingPoints(rects).map((b) => ({
    ...toSheetPt(b), studs: studsUnderBearing(b.spanMm), along: b.along,
  }))
  const shell = withBearingPacks(shellWalls(spec, centreline, tPx), bearing, tPx * 0.75 + 1)
  const walls = [...shell, ...closeDrawnJoints(insideWalls(spec), shell)]

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
  const floorRects = shaped ? [bounds] : rects
  const floorAreas: TracedLine[] = spec.floor === 'none' ? [] : floorRects.map((r, i) => ({
    id: `floor-drawn-${stamp}-${i}`,
    x1: px(r.x1 + offX),
    y1: px(r.y1 + offY),
    x2: px(r.x2 + offX),
    y2: px(r.y2 + offY),
    elementType: spec.floor === 'slab' ? 'Concrete Slab' : spec.floor === 'skids' ? SKID_FLOOR : '2x10',
    size: spec.floor === 'slab' ? '4in' : spec.floor === 'skids' ? '16"' : '2x10',
    material: spec.floor === 'slab' ? 'Concrete' : 'Wood',
    level: 0,
    // An angled house's floor is its shape, not its bounding box.
    ...(shaped ? { shape: raw.map((q) => [
      (q.x - bounds.x1) / Math.max(1e-9, bounds.x2 - bounds.x1),
      (q.y - bounds.y1) / Math.max(1e-9, bounds.y2 - bounds.y1),
    ] as [number, number]) } : {}),
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
      parsedWalls: walls,
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
      set1BuildingBasics: `${ftOf(sizeMm.w)} x ${ftOf(sizeMm.d)} footprint, 8ft ceiling, 1 floor, ${spec.floor === 'slab' ? 'slab' : spec.floor === 'joists' ? 'crawlspace' : spec.floor === 'skids' ? 'on skids' : 'foundation not chosen'}`,
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
 * A BUILDING THAT IS ONLY WALLS.
 *
 * A footprint box cannot say "three walls" without inventing a fourth, so a
 * carport, a fence line, a partition run under an existing roof or the two
 * walls of an addition had no way in. Here the walls you drew are the building:
 * they are the user's own walls — nothing detected them, so nothing has to be
 * believed — they build the moment they land, and nothing is closed off around
 * them.
 *
 * There is no floor area, because a floor is a closed shape and this is not one.
 * Lay the floor after, on the model; that step is optional everywhere anyway.
 */
function createFreeWallsProject(
  spec: DrawnProjectSpec,
  free: NonNullable<DrawnProjectSpec['freeWalls']>,
): DrawnProject {
  const px = (mm: number) => mm / DRAWN_MM_PER_PX
  const tPx = px(shellThicknessMm(spec.wallTypeKey))
  const box = free.reduce(
    (a, w) => ({
      x1: Math.min(a.x1, w.x1, w.x2), y1: Math.min(a.y1, w.y1, w.y2),
      x2: Math.max(a.x2, w.x1, w.x2), y2: Math.max(a.y2, w.y1, w.y2),
    }),
    { x1: Infinity, y1: Infinity, x2: -Infinity, y2: -Infinity },
  )
  // On a page given to us, the walls are already in page millimetres; on a page
  // of their own, they get a plain margin round them.
  // THE PAGE HAS TO HOLD EVERY WALL ON IT. A sheet can carry more than one
  // structure — a house and the garage beside it, a deck off the back — and the
  // bounding box of all of them is what the page has to cover. A page taken
  // from the print (or the blank sheet) is a starting size, not a limit: if the
  // walls run past its edge the page grows to them, because the print the
  // workspace puts under the model is this page and a structure missing from it
  // is a structure the user cannot see or place against.
  const offX = spec.page ? Math.max(0, MARGIN_MM - box.x1) : MARGIN_MM - box.x1
  const offY = spec.page ? Math.max(0, MARGIN_MM - box.y1) : MARGIN_MM - box.y1
  const wMm = Math.max(spec.page?.wMm ?? 0, box.x2 + offX + MARGIN_MM)
  const dMm = Math.max(spec.page?.dMm ?? 0, box.y2 + offY + MARGIN_MM)
  const wPx = Math.max(1, Math.round(px(wMm)))
  const hPx = Math.max(1, Math.round(px(dMm)))

  const lines = free.map((w) => ({
    x1: px(w.x1 + offX), y1: px(w.y1 + offY), x2: px(w.x2 + offX), y2: px(w.y2 + offY),
  }))
  const walls: ParsedWall[] = lines.map((w) => ({
    ...w,
    thickness: tPx,
    source: 'user',
    framingType: spec.wallTypeKey,
    wallRole: 'exterior-bearing',
    level: 0,
  } as ParsedWall))

  const sizeMm = { w: box.x2 - box.x1, d: box.y2 - box.y1 }
  const svg = sheetWallsSvg(spec, wPx, hPx, lines, tPx, sizeMm)
  let file: File
  try {
    file = new File([svg], 'drawn-project.svg', { type: 'image/svg+xml' })
  } catch {
    const blob = new Blob([svg], { type: 'image/svg+xml' })
    file = Object.assign(blob, { name: 'drawn-project.svg', lastModified: Date.now() }) as unknown as File
  }
  const url = typeof URL !== 'undefined' && URL.createObjectURL ? URL.createObjectURL(file) : ''
  // The extent of the walls, as a rectangle, for anything that wants an outline
  // it can draw. It is not the building's shape — there is no shape — so it is
  // only ever used as a bounding box.
  const outlinePx = [
    { x: px(box.x1 + offX), y: px(box.y1 + offY) },
    { x: px(box.x2 + offX), y: px(box.y1 + offY) },
    { x: px(box.x2 + offX), y: px(box.y2 + offY) },
    { x: px(box.x1 + offX), y: px(box.y2 + offY) },
  ]

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
      parsedWalls: walls,
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
      scaleConfidence: 'parsed',
      uploadedAt: Date.now(),
      type: 'floor-plan',
      source: 'drawn',
    },
    overlayScale: [(wPx * DRAWN_MM_PER_PX) / 1000, (hPx * DRAWN_MM_PER_PX) / 1000],
    // No floor: a floor is a closed shape and these walls do not make one.
    floorAreas: [],
    outlinePx,
    wizardInputs: {
      set1BuildingBasics: `${free.length} wall${free.length === 1 ? '' : 's'} drawn one at a time, ${ftIn(sizeMm.w)} x ${ftIn(sizeMm.d)}, 8ft ceiling, 1 floor, floor not chosen`,
      set1Clarifications: 'Walls drawn to typed or printed sizes rather than closed from a footprint box.',
      set2StructuralDetails: `Exterior ${getWallType(spec.wallTypeKey)?.short ?? 'wood'} bearing walls, no closed footprint.`,
      set2Clarifications: 'Interior partitions to be added.',
      set3FinishingDetails: 'Finishes not chosen yet.',
      set3Clarifications: '',
      completedGroup: 'group3',
      completedAt: Date.now(),
    } as WorkspaceWizardInputs,
  }
}

/** The wall-only sheet: squared paper with the walls on it, and nothing else. */
function sheetWallsSvg(
  spec: DrawnProjectSpec, wPx: number, hPx: number,
  lines: ReadonlyArray<{ x1: number; y1: number; x2: number; y2: number }>,
  tPx: number, sizeMm: { w: number; d: number },
): string {
  const grid = MM_PER_FT / DRAWN_MM_PER_PX
  const paths = lines
    .map((w) => `<line x1="${w.x1.toFixed(2)}" y1="${w.y1.toFixed(2)}" x2="${w.x2.toFixed(2)}" y2="${w.y2.toFixed(2)}" stroke="#0f172a" stroke-width="${tPx.toFixed(2)}" stroke-linecap="square"/>`)
    .join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${wPx}" height="${hPx}" viewBox="0 0 ${wPx} ${hPx}">
    <defs>
      <pattern id="ft" width="${grid}" height="${grid}" patternUnits="userSpaceOnUse">
        <path d="M ${grid} 0 L 0 0 0 ${grid}" fill="none" stroke="#dbe3ec" stroke-width="0.6"/>
      </pattern>
    </defs>
    <rect width="${wPx}" height="${hPx}" fill="#f8fafc"/>
    <rect width="${wPx}" height="${hPx}" fill="url(#ft)"/>
    ${paths}
    <text x="14" y="${hPx - 14}" font-family="Inter, Arial, sans-serif" font-size="13" font-weight="600" fill="#334155">${spec.name ?? 'New project'}</text>
    <text x="${wPx - 14}" y="${hPx - 14}" text-anchor="end" font-family="Inter, Arial, sans-serif" font-size="12" fill="#64748b">Drawn to size · ${ftIn(sizeMm.w)} × ${ftIn(sizeMm.d)}</text>
  </svg>`
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
