/**
 * Where to look when F.U.S.E. says something has gone.
 *
 * A verdict that can only be read is half a verdict — "OSB roof deck, gone in
 * year 19" is useless if you then have to find the roof. This is the arithmetic
 * that turns a layer's own `look` (see building.AssemblyLook) into a camera
 * pose, and it is a separate file for the same reason reviewFocus is: it is
 * arithmetic over plain numbers, so it can be tested without a scene.
 *
 * Two rules, and they are the whole design:
 *
 *   • THE SHOT SHOWS THE LAYER. A wall with failed sheathing is behind its own
 *     siding, so flying to the wall and leaving the cladding drawn shows you
 *     nothing. `uncoverFor` returns the model's own visibility switches that
 *     take the covering off — the same switches the Layers panel drives, so the
 *     user can see exactly what changed and put it back.
 *
 *   • THE SHOT IS ALWAYS THE SAME SHAPE. A wall gets the same three-quarter
 *     view every time and the roof gets the same look down at it, so the second
 *     assembly looks like the first one did and you never re-orient after a
 *     jump. Same rule as the build review, deliberately.
 */

import type { CameraPose, FocusScene } from '../reviewFocus'
import type { AssemblyLook, HiddenLayer } from './building'

/** The visibility switches F.U.S.E. is allowed to touch — all of them belong to
 *  the model's own Layers controls, so nothing here is a setting of its own. */
export interface Uncover {
  claddingVisible?: boolean
  wrapVisible?: boolean
  sheathingVisible?: boolean
  drywallVisible?: boolean
}

/**
 * What to switch on to see the layer being talked about.
 *
 * Returning `undefined` for a flag means "leave it alone": a user who has the
 * drywall drawn on purpose keeps it, and a layer nobody turned on stays off
 * until a verdict about it is the thing on screen.
 */
export function uncoverFor(reveal: HiddenLayer | null): Uncover {
  switch (reveal) {
    // The cladding itself: show it, and stop claiming to look at what is under
    // it. Turning the wrap and the sheathing off here is what makes the shot
    // read as a wall rather than a section.
    case 'cladding': return { claddingVisible: true, wrapVisible: false, sheathingVisible: false }
    // The barrier: it only exists as a layer you can see with the cladding off
    // it, which is also the only way to inspect it in the field.
    case 'wrap': return { wrapVisible: true, claddingVisible: false, sheathingVisible: true }
    // Sheathing: the cladding and the wrap come off, the studs stay covered —
    // this is the shot of the panel, not of the frame.
    case 'sheathing': return { sheathingVisible: true, claddingVisible: false, wrapVisible: false, drywallVisible: false }
    // Board: the interior face, from inside the room.
    case 'drywall': return { drywallVisible: true }
    default: return {}
  }
}

/** Degrees above the horizon, per view. A wall is looked at, not looked down on. */
const ELEVATION_DEG = { wall: 22, inside: 14, above: 52 } as const

export interface AssemblyShotOptions {
  /** Storeys in the model — how tall the roof actually is. */
  storeys?: number
  /** Storey to stand on, 0 = ground. */
  level?: number
}

/**
 * The pose that shows an assembly.
 *
 * Stand-off is the layer's own close-work distance, floored by the building's
 * own size: six metres is a good look at a wall until the wall is eighteen
 * metres long, at which point it is a look at one stud.
 */
export function cameraForAssembly(
  look: AssemblyLook,
  scene: FocusScene,
  opts: AssemblyShotOptions = {},
): CameraPose {
  const storeys = Math.max(1, opts.storeys ?? 1)
  const level = Math.max(0, opts.level ?? 0)
  const roofY = storeys * scene.storeyHeight
  const wide = Math.max(look.standoffM, scene.center.radius * 0.95)
  const el = (ELEVATION_DEG[look.from] * Math.PI) / 180
  const distance = look.from === 'above' ? Math.max(look.standoffM, scene.center.radius * 1.2) : wide
  const horizontal = Math.cos(el) * distance
  const run = horizontal / Math.SQRT2

  // The roof is aimed at from over the building; everything else is aimed at on
  // its own storey, at the height the layer sits at.
  const aimY = look.from === 'above'
    ? roofY
    : level * scene.storeyHeight + look.aimM

  const aim: [number, number, number] = [scene.center.x, aimY, scene.center.z]
  return {
    target: aim,
    position: [
      aim[0] + run,
      aim[1] + Math.sin(el) * distance,
      aim[2] + run,
    ],
  }
}
