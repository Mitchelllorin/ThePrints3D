/**
 * buildFocus — where the build IS, in world metres.
 *
 * Both things that point the camera at a problem need the same two answers: the
 * world position of every wall and opening, and the building's own centre and
 * reach. The build review needs them for its findings and F.U.S.E. needs them
 * for its timeline, and if each of them built its own the two would disagree
 * the first time the overlay moved.
 *
 * It lives here rather than in either panel because it is arithmetic over
 * numbers the stores already hold: no scene, no store subscription, no React.
 * The caller passes what it has, and the transform is the same one the 3D
 * renders the plan with (planPlacement.drawingTransformFor), so a jump lands on
 * the wall you can see rather than a wall-shaped guess near it.
 */

import type { ParsedWall } from '../types'
import { drawingTransformFor, planPixelToWorld } from './planPlacement'
import type { FocusPlace, FocusScene } from './reviewFocus'

/** The wall/opening data both callers have — structurally, not by store type. */
export interface FocusSceneInput {
  drawings: Array<{
    id: string
    rasterWidth: number | null
    rasterHeight: number | null
    scaleMmPerPx: number | null
    parsedWalls: ParsedWall[]
  }>
  placedObjects: Array<{ type: string; x: number; z: number; level?: number }>
  overlay: {
    position: [number, number]
    scale: [number, number]
    rotationDeg: number
    drawingId?: string | null
  }
  /** Storey-to-storey rise, so a finding upstairs aims upstairs. */
  storeyHeightM: number
}

export interface BuildFocus {
  /** The camera's view of the build. */
  scene: FocusScene
  /** World midpoint of every wall, in the order the drawings were given. */
  walls: FocusPlace[]
  /** World position of every door and window. */
  openings: FocusPlace[]
}

/**
 * Only these two object types are openings. Anything else placed — a sofa, a
 * water heater — is furniture as far as framing and the envelope are concerned.
 */
const OPENING_TYPES = new Set(['door', 'window'])

export function focusSceneFor(input: FocusSceneInput): BuildFocus {
  const { drawings, placedObjects, overlay, storeyHeightM } = input

  // The drawing the overlay is actually registered to. Only that one gets the
  // overlay transform applied; the rest are placed by their own raster scale.
  const overlayDrawingId = overlay.drawingId ?? drawings[0]?.id ?? null

  const walls: FocusPlace[] = []
  for (const d of drawings) {
    const t = drawingTransformFor(
      {
        rasterWidth: d.rasterWidth,
        rasterHeight: d.rasterHeight,
        walls: d.parsedWalls,
        scaleMmPerPx: d.scaleMmPerPx,
      },
      { position: overlay.position, scale: overlay.scale, rotationDeg: overlay.rotationDeg },
      d.id === overlayDrawingId,
    )
    for (const w of d.parsedWalls) {
      const p = planPixelToWorld(t, (w.x1 + w.x2) / 2, (w.y1 + w.y2) / 2)
      walls.push({ x: p.x, z: p.z, level: w.level ?? 0 })
    }
  }

  const openingObjects = placedObjects.filter((o) => OPENING_TYPES.has(o.type))
  const openings: FocusPlace[] = openingObjects.map((o) => ({
    x: o.x,
    z: o.z,
    level: o.level ?? 0,
  }))

  // The whole build, for anything that is about the building rather than about
  // one wall: centre of the footprint, and how far it reaches.
  const xs = walls.map((p) => p.x)
  const zs = walls.map((p) => p.z)
  const center = walls.length > 0
    ? { x: (Math.min(...xs) + Math.max(...xs)) / 2, z: (Math.min(...zs) + Math.max(...zs)) / 2 }
    : { x: overlay.position[0], z: overlay.position[1] }
  const radius = Math.max(3, ...walls.map((p) => Math.hypot(p.x - center.x, p.z - center.z)))

  return {
    scene: { walls, openings, center: { ...center, radius }, storeyHeight: storeyHeightM },
    walls,
    openings,
  }
}
