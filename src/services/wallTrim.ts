/**
 * WALL TRIM — the edges of one wall, dressed.
 *
 * `trimRun` knows how to sweep a profile along a path. This decides WHICH
 * paths, for a wall, from what the model already holds: its length, its height,
 * where its openings are, and which way is out. That is the whole of the trim
 * layer — no new geometry, only edges handed to the sweeper.
 *
 * Built in the same LOCAL wall space every other skin builder uses, so the
 * caller positions it identically and nothing has to agree twice:
 *
 *   x   along the wall, −length/2 … +length/2
 *   y   up from the wall's own base, 0 … height
 *   z   out of the wall face, at `standoff` on the `outward` side
 *
 * WHAT GETS RUN, AND WHY THAT LIST
 *
 *   corner boards   the two vertical ends of the wall
 *   casing          round every opening
 *   sill + apron    under windows only — a door has neither
 *   frieze          the horizontal band at the top, under the soffit
 *   band            the horizontal band at the bottom, over the foundation
 *
 * Those five are what separates a sided box from a house in a screenshot, and
 * they are the layer we had none of while Chief Architect gives corner boards
 * their own Build ▸ Trim tool and Live Home 3D sets base and crown per wall
 * from an inspector.
 *
 * Every run is optional and every one is a profile ID, so the picker in the
 * Trim stop of the workflow is a list of these six slots against the profile
 * table — not six features to build.
 */
import * as THREE from 'three'
import { buildTrimRun, buildOpeningCasing } from './trimRun'
import { trimProfile, profileWidthM, type TrimProfile } from './trimProfiles'
import type { WallOpening } from './framingGeometry'

/** Which profile goes on which edge. `null` or absent leaves that edge bare. */
export interface WallTrimChoice {
  corner?: string | null
  casing?: string | null
  sill?: string | null
  apron?: string | null
  frieze?: string | null
  band?: string | null
}

/** A sensible dressed wall — what the Trim stop opens with. */
export const DEFAULT_WALL_TRIM: WallTrimChoice = {
  corner: 'corner-1x4',
  casing: 'casing-flat-1x4',
  sill: 'sill-2x6',
  apron: 'apron-1x4',
  frieze: 'frieze-1x6',
  band: null,
}

export interface WallTrimOpts {
  lengthM: number
  heightM: number
  /** Distance from the wall centreline out to the face the trim lands on. */
  standoffM: number
  outward: 1 | -1
  openings?: readonly WallOpening[]
  choice?: WallTrimChoice
  /** Trim is painted, and nearly always lighter than what it sits on. */
  color?: string
  opacity?: number
  /**
   * Run the vertical corner boards. A wall in the middle of a run has no
   * corner at its ends — only the ends that actually turn get boards, and the
   * caller is the only thing that knows which those are.
   */
  corners?: { start?: boolean; end?: boolean }
}

/** Default window sill height and opening heights, matching buildWallFraming. */
const DEFAULT_SILL_M = 0.9
const DOOR_H_M = 2.06
const WINDOW_H_M = 1.13

function openingBox(o: WallOpening): { cx: number; cy: number; w: number; h: number; isWindow: boolean } {
  const isWindow = o.type === 'window'
  const h = o.heightM ?? (isWindow ? WINDOW_H_M : DOOR_H_M)
  const sill = isWindow ? (o.sillM ?? DEFAULT_SILL_M) : 0
  return { cx: o.centerM, cy: sill + h / 2, w: o.widthM, h, isWindow }
}

/**
 * Dress one wall.
 *
 * Returns a Group in local wall space, or an empty one if nothing was chosen —
 * so a caller can always add it without checking, and turning all trim off
 * costs one empty group rather than a branch at every call site.
 */
export function buildWallTrim(opts: WallTrimOpts): THREE.Group {
  const {
    lengthM, heightM, standoffM, outward,
    openings = [], color = '#f4f1ea', opacity = 1,
  } = opts
  const choice = { ...DEFAULT_WALL_TRIM, ...(opts.choice ?? {}) }
  const corners = { start: true, end: true, ...(opts.corners ?? {}) }

  const g = new THREE.Group()
  if (lengthM < 0.05 || heightM < 0.2) return g

  const z = outward * standoffM
  const normal = new THREE.Vector3(0, 0, outward)
  const along = new THREE.Vector3(1, 0, 0)
  const up = new THREE.Vector3(0, 1, 0)
  const half = lengthM / 2
  const V = (x: number, y: number) => new THREE.Vector3(x, y, z)

  const pick = (id: string | null | undefined): TrimProfile | null => (id ? trimProfile(id) : null)
  const addRun = (p: TrimProfile, a: THREE.Vector3, b: THREE.Vector3, info: string) => {
    const run = buildTrimRun({ profile: p, path: [a, b], normal, color, opacity, info })
    if (run.children.length) g.add(run)
  }

  // ── corner boards ────────────────────────────────────────────────────────
  //
  // The profile grows along +x, which here is `normal × tangent` — so the
  // DIRECTION each board is driven decides which way it grows, and both have to
  // grow INWARD from the wall end. Driven the other way (the obvious way: both
  // bottom-to-top) each board hangs a full 3-1/2" off the end of the wall into
  // thin air. Run it up at the far end and down at the near one.
  const cornerP = pick(choice.corner)
  if (cornerP) {
    if (corners.start) addRun(cornerP, V(-half, heightM), V(-half, 0), `${cornerP.label} — corner`)
    if (corners.end) addRun(cornerP, V(half, 0), V(half, heightM), `${cornerP.label} — corner`)
  }

  // ── horizontal bands ─────────────────────────────────────────────────────
  //
  // The frieze is pulled DOWN by its own width so it sits under the top of the
  // wall rather than floating above it, and both bands stop short of the corner
  // boards so they die into them instead of crossing in front — which is how
  // they are actually cut, and the overlap is visible from any angle.
  const inset = cornerP ? profileWidthM(cornerP) : 0
  const friezeP = pick(choice.frieze)
  if (friezeP) {
    // Driven right-to-left, so it grows DOWN from the registration line — put
    // that line at the top of the wall and the board hangs just under it.
    addRun(friezeP, V(half - inset, heightM), V(-half + inset, heightM), `${friezeP.label} — frieze`)
  }
  const bandP = pick(choice.band)
  if (bandP) {
    addRun(bandP, V(-half + inset, 0), V(half - inset, 0), `${bandP.label} — band`)
  }

  // ── openings ─────────────────────────────────────────────────────────────
  const casingP = pick(choice.casing)
  const sillP = pick(choice.sill)
  const apronP = pick(choice.apron)

  for (const o of openings) {
    const { cx, cy, w, h, isWindow } = openingBox(o)
    if (w < 0.05 || h < 0.05) continue
    const center = new THREE.Vector3(cx, cy, z)

    if (casingP) {
      // A window that gets a real sill does not also get a casing leg under it —
      // the sill IS the bottom of the frame. A door gets nothing at the floor.
      const sill = isWindow ? !sillP : false
      const frame = buildOpeningCasing({
        profile: casingP, center, along, up, normal,
        widthM: w, heightM: h, sides: { sill }, color, opacity,
      })
      if (frame.children.length) g.add(frame)
    }

    if (!isWindow) continue

    // The sill runs past the casing on both sides — a sill cut flush with the
    // opening looks like a shelf someone forgot to finish. The apron tucks
    // under it, narrower, the way it is actually installed.
    const casingW = casingP ? profileWidthM(casingP) : 0
    const sillOver = casingW + 0.02
    if (sillP) {
      const y = cy - h / 2 - profileWidthM(sillP)
      addRun(sillP, V(cx - w / 2 - sillOver, y), V(cx + w / 2 + sillOver, y), `${sillP.label} — sill`)
    }
    if (apronP) {
      // Also driven right-to-left, so it grows down from under the sill.
      const y = cy - h / 2 - (sillP ? profileWidthM(sillP) : 0)
      addRun(apronP, V(cx + w / 2 + casingW, y), V(cx - w / 2 - casingW, y), `${apronP.label} — apron`)
    }
  }

  g.userData.trimAssembly = 'wall'
  return g
}

/**
 * Does this choice ask for anything at all?
 *
 * Lets a layer skip the whole build — and the memo, and the disposal — rather
 * than construct an empty group per wall per frame when trim is switched off.
 */
export function wallTrimIsEmpty(choice: WallTrimChoice | undefined): boolean {
  const c = { ...DEFAULT_WALL_TRIM, ...(choice ?? {}) }
  return !c.corner && !c.casing && !c.sill && !c.apron && !c.frieze && !c.band
}
