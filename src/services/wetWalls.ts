/**
 * Which walls are WET WALLS — the ones that want a tile backer rather than
 * gypsum, because a bath or a shower is on the other side of them.
 *
 * Board is not one choice for a whole house. The wall behind a tub wants a
 * backer, the garage side of a separation wall wants 5/8" Type X, and the bedroom
 * next to both is happy with 1/2" gypsum. A single building-wide setting cannot
 * express a bathroom — which is most of what makes a plan a plan.
 *
 * The plan already knows. A room labelled BATH is a bathroom, and the walls that
 * bound it are the walls that get wet. So this reads the room names rather than
 * asking the user to remember which walls those were.
 *
 * A SUGGESTION, not a rule. It returns which walls look wet; whether to change
 * their board is the user's call, because a half bath with no shower does not
 * need backer on all four sides and only the person building it knows that.
 */
import type { ParsedRoom, ParsedWall } from '../types'
import { boardSpec, type BoardKind } from './constructionCode'

/**
 * HOW A WET WALL IS MADE WATERPROOF. There are two accepted answers and the
 * trade is split between them, so this is a choice rather than a fact.
 *
 * 'backer-board' is the assembly this app has always specified: a tile backer
 * on the studs, tile on the backer. Cement board or a glass-mat board like
 * DensShield. It is what a building department expects to see, because the
 * 2006 code revision named which boards may back tile in a wet area and a
 * listed board is the uncomplicated way to satisfy it.
 *
 * 'membrane-system' is the Schluter way, and it is now what a lot of tile
 * setters actually do: the orange stuff. A sheet-applied waterproofing
 * membrane — KERDI, a polyethylene core fleeced both faces — bonded with
 * thinset over ORDINARY GYPSUM, or KERDI-BOARD used as substrate and
 * waterproofing at once. The waterproofing is a continuous bonded layer rather
 * than a board that tolerates being wet, which is a different claim and a
 * better one.
 *
 * Neither is wrong. Schluter warrants KERDI over drywall; some inspectors
 * still read the gypsum as "the tile backer" and want a listed board anyway.
 * So the default stays backer-board — nobody's takeoff changes unless they ask
 * — and the user picks the system they actually build with.
 */
export type WetWallMethod = 'backer-board' | 'membrane-system'

/** Room names that mean water. Matched loosely — plans abbreviate. */
const WET_ROOM = /\b(bath|bathroom|ensuite|en-suite|shower|wc|powder|pwdr|washroom|utility|laundry)\b/i

/** Rooms where the water is INCIDENTAL — a splash, not a shower. */
const SPLASH_ONLY = /\b(powder|pwdr|wc|utility|laundry|kitchen)\b/i

export function isWetRoom(name?: string): boolean {
  return !!name && WET_ROOM.test(name)
}

/**
 * A wet room with no bathing in it. A powder room gets splashed; it does not get
 * a shower, so mould-resistant board is the honest answer there rather than a
 * full tile backer.
 */
export function isSplashOnly(name?: string): boolean {
  return !!name && SPLASH_ONLY.test(name)
}

/**
 * The board a room's walls want, or null when the room has no opinion.
 *
 *  full bath / shower / ensuite → the wet substrate for the chosen method
 *  powder / laundry / utility   → mould-resistant, splashed but not bathed in
 *  everything else              → null, use the building default
 *
 * A powder room gets mould-resistant board under BOTH methods. Nobody wraps a
 * hand basin in a shower system; the water there is a splash, and specifying a
 * waterproofing membrane for it would put a cost in the takeoff that the job
 * does not have.
 */
export function boardForRoom(
  name?: string,
  method: WetWallMethod = 'backer-board',
): BoardKind | null {
  if (!isWetRoom(name)) return null
  if (isSplashOnly(name)) return 'mold-resistant'
  return method === 'membrane-system' ? 'foam-waterproof' : 'glassmat-tile'
}

/** Does a wall run along the edge of this room's box? */
function boundsRoom(w: ParsedWall, r: ParsedRoom, tolPx: number): boolean {
  const rx1 = Math.min(r.x1, r.x2), rx2 = Math.max(r.x1, r.x2)
  const ry1 = Math.min(r.y1, r.y2), ry2 = Math.max(r.y1, r.y2)
  const within = (v: number, lo: number, hi: number) => v > lo - tolPx && v < hi + tolPx
  // Horizontal wall lying on the room's top or bottom edge.
  if (Math.abs(w.y1 - w.y2) < tolPx) {
    const onEdge = Math.abs(w.y1 - ry1) < tolPx || Math.abs(w.y1 - ry2) < tolPx
    return onEdge && within(w.x1, rx1, rx2) && within(w.x2, rx1, rx2)
  }
  // Vertical wall lying on the room's left or right edge.
  if (Math.abs(w.x1 - w.x2) < tolPx) {
    const onEdge = Math.abs(w.x1 - rx1) < tolPx || Math.abs(w.x1 - rx2) < tolPx
    return onEdge && within(w.y1, ry1, ry2) && within(w.y2, ry1, ry2)
  }
  return false
}

export interface WetWallSuggestion {
  /** Index into the wall list handed in. */
  index: number
  /** The board this wall's room wants. */
  boardKind: BoardKind
  /** The room that wants it, for the prompt copy. */
  roomName: string
}

/**
 * Walls that bound a wet room and are not already boarded for it.
 *
 * Only walls the user traced — an auto-detected line is a guess, and changing
 * its board would be a guess on a guess. A wall bounding two wet rooms is
 * reported once; the wetter requirement wins, since tile backer satisfies a
 * splash but not the other way round.
 */
export function suggestWetWalls(
  walls: ParsedWall[],
  rooms: ParsedRoom[],
  method: WetWallMethod = 'backer-board',
  tolPx = 14,
): WetWallSuggestion[] {
  const wet = rooms.filter((r) => isWetRoom(r.name))
  if (wet.length === 0) return []

  const out = new Map<number, WetWallSuggestion>()
  walls.forEach((w, index) => {
    if (w.source !== 'user') return
    for (const r of wet) {
      if (!boundsRoom(w, r, tolPx)) continue
      const boardKind = boardForRoom(r.name, method)
      if (!boardKind || w.boardKind === boardKind) continue
      const prev = out.get(index)
      // A wet-rated substrate outranks mould-resistant: it satisfies a splash
      // too. Asked of the board itself rather than named here, so the ranking
      // stays right whichever method chose it.
      if (prev && boardSpec(prev.boardKind).wetRated) continue
      out.set(index, { index, boardKind, roomName: r.name ?? 'wet room' })
    }
  })
  return [...out.values()].sort((a, b) => a.index - b.index)
}
