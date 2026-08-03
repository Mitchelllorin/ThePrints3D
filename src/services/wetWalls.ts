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
 *  full bath / shower / ensuite → tile backer, because tile goes on it
 *  powder / laundry / utility   → mould-resistant, splashed but not bathed in
 *  everything else              → null, use the building default
 */
export function boardForRoom(name?: string): string | null {
  if (!isWetRoom(name)) return null
  return isSplashOnly(name) ? 'mold-resistant' : 'glassmat-tile'
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
  boardKind: string
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
  tolPx = 14,
): WetWallSuggestion[] {
  const wet = rooms.filter((r) => isWetRoom(r.name))
  if (wet.length === 0) return []

  const out = new Map<number, WetWallSuggestion>()
  walls.forEach((w, index) => {
    if (w.source !== 'user') return
    for (const r of wet) {
      if (!boundsRoom(w, r, tolPx)) continue
      const boardKind = boardForRoom(r.name)
      if (!boardKind || w.boardKind === boardKind) continue
      const prev = out.get(index)
      // Tile backer outranks mould-resistant: it satisfies a splash too.
      if (prev && prev.boardKind === 'glassmat-tile') continue
      out.set(index, { index, boardKind, roomName: r.name ?? 'wet room' })
    }
  })
  return [...out.values()].sort((a, b) => a.index - b.index)
}
