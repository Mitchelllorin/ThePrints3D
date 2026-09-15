/**
 * TRIM PROFILES — the cross-sections, as data.
 *
 * Every piece of trim on a house is one shape dragged along one edge. Corner
 * boards are stock run up a corner; casing is stock run round an opening; base
 * is stock run along the floor line; a frieze is stock run along the wall/soffit
 * line. Six "features" in every competitor's UI, one operation underneath.
 *
 * So none of them are builders here. They are a PROFILE plus an EDGE, and this
 * file is the profile half — pure numbers, no geometry, no THREE. Adding
 * craftsman casing or a 5/4 corner board is an entry in a table, not a new
 * module, which is the only way a trim library gets to the size the competition
 * ships (2,100 materials and 2,400 objects in Live Home 3D against our 12 and
 * 40) without 2,000 hand-written builders.
 *
 * PROFILE COORDINATES
 *
 *   x  ACROSS the run, lying in the surface  — the "width" of the board as you
 *      see it on the wall. x = 0 is the edge the run is registered to (the
 *      corner, the edge of the opening, the floor line); +x moves away from it.
 *   y  OUT of the surface — how proud the trim stands. y = 0 is the wall face;
 *      +y is towards the viewer.
 *
 * Outlines are listed counter-clockwise in that (x, y) plane and are CLOSED
 * implicitly — do not repeat the first point.
 *
 * Dimensions are real milled sizes, not nominal ones. 1× stock is 3/4" thick
 * and a 1×4 is 3-1/2" wide, for the same reason a 2×8 is 7-1/4" here: a takeoff
 * built on nominal numbers is wrong by an inch a board, and this geometry is
 * also what the material report counts.
 */

/** Inches → metres. Trim is specified in inches everywhere it is sold. */
const IN = 0.0254

export type TrimKind =
  | 'corner-board'
  | 'casing'
  | 'sill'
  | 'apron'
  | 'frieze'
  | 'band'
  | 'base'
  | 'shoe'
  | 'crown'
  | 'drip-cap'
  | 'batten'
  | 'rake'

export interface TrimProfile {
  /** Stable key — what a saved project stores. */
  id: string
  /** What a human calls it, with its milled size. */
  label: string
  /** Which run it is normally used for; drives the default offered per edge. */
  kind: TrimKind
  /** Cross-section outline, counter-clockwise, in metres. See file header. */
  points: ReadonlyArray<readonly [number, number]>
  /** Where it is sold from, for the takeoff line. */
  stock?: string
}

/** A plain rectangle of stock: `w` across the face, `t` proud of the wall. */
function flat(w: number, t: number): Array<readonly [number, number]> {
  return [[0, 0], [w, 0], [w, t], [0, t]]
}

/**
 * Flat stock with a stepped outer edge — the "backband" look that makes
 * Craftsman casing read as Craftsman rather than as a plank. The step is what
 * catches the light; without it a 1×4 and a Craftsman casing render identically.
 */
function backbanded(w: number, t: number, bandW: number, bandT: number): Array<readonly [number, number]> {
  return [
    [0, 0], [w, 0],
    [w, t + bandT], [w - bandW, t + bandT],
    [w - bandW, t], [0, t],
  ]
}

/**
 * A stepped ogee approximated in four facets.
 *
 * Real colonial trim is a continuous curve. Four facets is a deliberate floor,
 * not a shortcut: the profile is swept along every corner and opening in the
 * house, so its vertex count is multiplied by every run in the model, and at
 * the size trim occupies on screen the silhouette and the two highlight lines
 * are the whole of what reads. Bump the facet count here if close-up renders
 * ever become the point.
 */
function ogee(w: number, t: number): Array<readonly [number, number]> {
  return [
    [0, 0], [w, 0],
    [w, t * 0.55],
    [w * 0.72, t * 0.62],
    [w * 0.58, t * 0.95],
    [w * 0.30, t],
    [w * 0.16, t * 0.72],
    [0, t * 0.66],
  ]
}

/**
 * Quarter-round / shoe: flat against the wall, flat on the floor, convex face
 * to the room. Traced corner → up the wall → round the arc → back, so it winds
 * counter-clockwise like every other profile here.
 */
function quarterRound(r: number): Array<readonly [number, number]> {
  const pts: Array<readonly [number, number]> = [[0, 0]]
  for (let i = 0; i <= 6; i++) {
    const a = (Math.PI / 2) * (i / 6)
    pts.push([r * Math.cos(a), r * Math.sin(a)])
  }
  return pts
}

/**
 * Crown, which is the one profile that is not applied flat.
 *
 * Crown is SPRUNG: it bridges the wall and the ceiling at an angle instead of
 * lying against either, so its cross-section is a triangle with a decorated
 * face, and the two legs (wall and ceiling) are what the nominal size refers
 * to. A 3-5/8" crown at the usual 38°/52° spring covers about 2-1/4" of wall
 * and 2-7/8" of ceiling. Modelled here with x running UP the wall and y coming
 * off it, so the same sweep code handles it with no special case.
 */
function crown(wallLeg: number, ceilLeg: number): Array<readonly [number, number]> {
  return [
    [0, 0],                              // foot, against the wall
    [wallLeg, 0],                        // up the wall to the ceiling corner
    [wallLeg, ceilLeg],                  // out along the ceiling
    [wallLeg * 0.62, ceilLeg * 0.55],    // decorated face, back down in two facets
    [wallLeg * 0.30, ceilLeg * 0.42],
  ]
}

export const TRIM_PROFILES: readonly TrimProfile[] = [
  // ── Exterior: corner boards ────────────────────────────────────────────────
  { id: 'corner-1x4',  label: 'Corner board 1×4 (3½")',  kind: 'corner-board', points: flat(3.5 * IN, 0.75 * IN), stock: '1× pine/PVC' },
  { id: 'corner-1x6',  label: 'Corner board 1×6 (5½")',  kind: 'corner-board', points: flat(5.5 * IN, 0.75 * IN), stock: '1× pine/PVC' },
  { id: 'corner-5/4x4', label: 'Corner board 5/4×4',     kind: 'corner-board', points: flat(3.5 * IN, 1.0 * IN),  stock: '5/4 stock' },

  // ── Exterior + interior: casing ────────────────────────────────────────────
  { id: 'casing-flat-1x4',   label: 'Casing, flat 1×4',        kind: 'casing', points: flat(3.5 * IN, 0.75 * IN), stock: '1× stock' },
  { id: 'casing-craftsman',  label: 'Casing, Craftsman 3½"',   kind: 'casing', points: backbanded(3.5 * IN, 0.75 * IN, 0.75 * IN, 0.3 * IN), stock: '1× + backband' },
  { id: 'casing-colonial',   label: 'Casing, Colonial 2¼"',    kind: 'casing', points: ogee(2.25 * IN, 0.6875 * IN), stock: 'moulded' },
  { id: 'casing-colonial-35', label: 'Casing, Colonial 3½"',   kind: 'casing', points: ogee(3.5 * IN, 0.6875 * IN),  stock: 'moulded' },

  // ── Exterior: openings and bands ───────────────────────────────────────────
  { id: 'sill-2x6',    label: 'Window sill, 2× sloped',  kind: 'sill',     points: [[0, 0], [5.5 * IN, 0], [5.5 * IN, 1.0 * IN], [0, 1.5 * IN]], stock: '2× stock' },
  { id: 'apron-1x4',   label: 'Apron 1×4',               kind: 'apron',    points: flat(3.5 * IN, 0.75 * IN), stock: '1× stock' },
  { id: 'drip-cap',    label: 'Drip cap',                kind: 'drip-cap', points: [[0, 0], [1.75 * IN, 0], [1.75 * IN, 0.4 * IN], [0, 1.1 * IN]], stock: 'alum/PVC' },
  { id: 'frieze-1x6',  label: 'Frieze board 1×6',        kind: 'frieze',   points: flat(5.5 * IN, 0.75 * IN), stock: '1× stock' },
  { id: 'frieze-1x8',  label: 'Frieze board 1×8 (7¼")',  kind: 'frieze',   points: flat(7.25 * IN, 0.75 * IN), stock: '1× stock' },
  { id: 'band-1x4',    label: 'Band board 1×4',          kind: 'band',     points: flat(3.5 * IN, 0.75 * IN), stock: '1× stock' },
  { id: 'batten-1x3',  label: 'Batten 1×3 (2½")',        kind: 'batten',   points: flat(2.5 * IN, 0.75 * IN), stock: '1× stock' },
  { id: 'rake-1x6',    label: 'Rake board 1×6',          kind: 'rake',     points: flat(5.5 * IN, 0.75 * IN), stock: '1× stock' },

  // ── Interior: base and crown ───────────────────────────────────────────────
  { id: 'base-ranch',     label: 'Base, Ranch 3¼"',      kind: 'base',  points: ogee(3.25 * IN, 0.4375 * IN), stock: 'moulded' },
  { id: 'base-colonial',  label: 'Base, Colonial 4¼"',   kind: 'base',  points: ogee(4.25 * IN, 0.5 * IN),    stock: 'moulded' },
  { id: 'base-flat-1x6',  label: 'Base, flat 1×6',       kind: 'base',  points: flat(5.5 * IN, 0.75 * IN),    stock: '1× stock' },
  { id: 'shoe-quarter',   label: 'Shoe, quarter round ¾"', kind: 'shoe', points: quarterRound(0.75 * IN),     stock: 'moulded' },
  { id: 'crown-358',      label: 'Crown 3⅝" (38°/52°)',  kind: 'crown', points: crown(2.25 * IN, 2.875 * IN), stock: 'moulded' },
  { id: 'crown-525',      label: 'Crown 5¼"',            kind: 'crown', points: crown(3.25 * IN, 4.125 * IN), stock: 'moulded' },
]

const BY_ID = new Map(TRIM_PROFILES.map((p) => [p.id, p]))

export function trimProfile(id: string): TrimProfile | null {
  return BY_ID.get(id) ?? null
}

/** Every profile normally used for a given run — what a picker offers. */
export function profilesOfKind(kind: TrimKind): TrimProfile[] {
  return TRIM_PROFILES.filter((p) => p.kind === kind)
}

/**
 * WHAT THIS PROFILE COSTS PER METRE OF RUN.
 *
 * The cross-section area, by the shoelace formula. Trim is sold by the linear
 * foot, so the takeoff wants length — but the area is what tells the material
 * report how much timber is in it, and it is the cheap way to catch a profile
 * somebody typed backwards: a clockwise outline comes back negative and would
 * otherwise sweep into a solid with its faces inside out.
 */
export function profileAreaM2(p: TrimProfile): number {
  const pts = p.points
  let a = 0
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i]
    const [x2, y2] = pts[(i + 1) % pts.length]
    a += x1 * y2 - x2 * y1
  }
  return a / 2
}

/** How far the profile stands off the wall — what has to clear the cladding. */
export function profileProudM(p: TrimProfile): number {
  return Math.max(...p.points.map(([, y]) => y))
}

/** How much face it covers — what has to fit between an opening and a corner. */
export function profileWidthM(p: TrimProfile): number {
  return Math.max(...p.points.map(([x]) => x))
}
