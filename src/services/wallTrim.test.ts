import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { buildWallTrim, wallTrimIsEmpty, DEFAULT_WALL_TRIM } from './wallTrim'
import { trimTakeoff } from './trimRun'
import { profileWidthM, trimProfile } from './trimProfiles'
import type { WallOpening } from './framingGeometry'

const WALL = { lengthM: 6, heightM: 2.44, standoffM: 0.1, outward: 1 as const }
const window1: WallOpening = { centerM: 0, widthM: 1.2, type: 'window', sillM: 0.9, heightM: 1.2 }
const door1: WallOpening = { centerM: 2, widthM: 0.9, type: 'door' }

const bounds = (g: THREE.Object3D) => new THREE.Box3().setFromObject(g)

describe('buildWallTrim', () => {
  it('dresses a bare wall with corners and a frieze', () => {
    const g = buildWallTrim(WALL)
    const t = trimTakeoff(g)
    expect(t.get('corner-1x4')).toBeCloseTo(2.44 * 2, 2)
    expect(t.has('frieze-1x6')).toBe(true)
  })

  it('keeps every board inside the wall it belongs to', () => {
    // A corner board driven the wrong way grows off the end of the wall into
    // thin air. It is the single most obvious trim bug and it is invisible in a
    // takeoff, so it gets measured here instead.
    const g = buildWallTrim({ ...WALL, openings: [window1, door1] })
    const b = bounds(g)
    expect(b.min.x).toBeGreaterThanOrEqual(-WALL.lengthM / 2 - 1e-6)
    expect(b.max.x).toBeLessThanOrEqual(WALL.lengthM / 2 + 1e-6)
    expect(b.min.y).toBeGreaterThanOrEqual(-1e-6)
    expect(b.max.y).toBeLessThanOrEqual(WALL.heightM + 1e-6)
  })

  it('puts the trim on the outward face, and follows it when that flips', () => {
    const out = buildWallTrim(WALL)
    const inn = buildWallTrim({ ...WALL, outward: -1 })
    expect(bounds(out).min.z).toBeGreaterThan(0)
    expect(bounds(inn).max.z).toBeLessThan(0)
  })

  it('runs the frieze between the corner boards, not across them', () => {
    // Butting the bands into the corner boards is how they are cut; crossing in
    // front of them is visible from any angle.
    const corner = trimProfile('corner-1x4')!
    const g = buildWallTrim({ ...WALL, choice: { casing: null, frieze: 'frieze-1x6' } })
    const t = trimTakeoff(g)
    expect(t.get('frieze-1x6')).toBeCloseTo(WALL.lengthM - profileWidthM(corner) * 2, 2)
  })

  it('gives a window a sill and an apron, and a door neither', () => {
    const win = buildWallTrim({ ...WALL, openings: [window1] })
    const door = buildWallTrim({ ...WALL, openings: [door1] })
    expect(trimTakeoff(win).has('sill-2x6')).toBe(true)
    expect(trimTakeoff(win).has('apron-1x4')).toBe(true)
    expect(trimTakeoff(door).has('sill-2x6')).toBe(false)
    expect(trimTakeoff(door).has('apron-1x4')).toBe(false)
  })

  it('drops the casing leg under a window that has a real sill', () => {
    // Three legs plus a sill, not four legs and a sill stacked on each other.
    const withSill = buildWallTrim({ ...WALL, openings: [window1] })
    const noSill = buildWallTrim({ ...WALL, openings: [window1], choice: { sill: null, apron: null } })
    const casing = (g: THREE.Group) => trimTakeoff(g).get('casing-flat-1x4')!
    expect(casing(withSill)).toBeLessThan(casing(noSill))
  })

  it('runs the sill past the casing on both sides', () => {
    // A sill cut flush with the opening reads as unfinished.
    const g = buildWallTrim({ ...WALL, openings: [window1] })
    const sillLen = trimTakeoff(g).get('sill-2x6')!
    expect(sillLen).toBeGreaterThan(window1.widthM + profileWidthM(trimProfile('casing-flat-1x4')!) * 2)
  })

  it('only boards the corners it is told turn', () => {
    // A wall mid-run has no corner at its ends; boarding both would put a board
    // in the middle of a flat elevation.
    const both = buildWallTrim(WALL)
    const one = buildWallTrim({ ...WALL, corners: { end: false } })
    expect(trimTakeoff(one).get('corner-1x4')).toBeCloseTo(
      trimTakeoff(both).get('corner-1x4')! / 2, 2,
    )
    const none = buildWallTrim({ ...WALL, corners: { start: false, end: false } })
    expect(trimTakeoff(none).has('corner-1x4')).toBe(false)
  })

  it('builds nothing from a wall too small to dress', () => {
    expect(buildWallTrim({ ...WALL, lengthM: 0.01 }).children).toHaveLength(0)
    expect(buildWallTrim({ ...WALL, heightM: 0.05 }).children).toHaveLength(0)
  })

  it('ignores an opening with no size', () => {
    const g = buildWallTrim({ ...WALL, openings: [{ centerM: 0, widthM: 0, type: 'window' }] })
    expect(trimTakeoff(g).has('casing-flat-1x4')).toBe(false)
  })

  it('turns off cleanly, one slot at a time and all at once', () => {
    const noCorners = buildWallTrim({ ...WALL, choice: { corner: null } })
    expect(trimTakeoff(noCorners).has('corner-1x4')).toBe(false)

    const nothing = { corner: null, casing: null, sill: null, apron: null, frieze: null, band: null }
    expect(wallTrimIsEmpty(nothing)).toBe(true)
    expect(wallTrimIsEmpty(DEFAULT_WALL_TRIM)).toBe(false)
    expect(buildWallTrim({ ...WALL, openings: [window1], choice: nothing }).children).toHaveLength(0)
  })

  it('totals a real elevation for the takeoff', () => {
    // Two windows and a door on a 9 m wall — the number a trim order is placed
    // from, and it has to come off what was actually built.
    const g = buildWallTrim({
      ...WALL, lengthM: 9,
      openings: [
        { centerM: -3, widthM: 1.2, type: 'window', sillM: 0.9, heightM: 1.2 },
        { centerM: 0, widthM: 0.9, type: 'door' },
        { centerM: 3, widthM: 1.5, type: 'window', sillM: 0.9, heightM: 1.2 },
      ],
      choice: { ...DEFAULT_WALL_TRIM, band: 'band-1x4' },
    })
    const t = trimTakeoff(g)
    expect(t.get('corner-1x4')).toBeCloseTo(4.88, 2)
    expect(t.get('sill-2x6')).toBeGreaterThan(0)
    expect(t.get('band-1x4')).toBeCloseTo(9 - profileWidthM(trimProfile('corner-1x4')!) * 2, 2)
    // Everything chosen actually produced something — a silent zero here is a
    // slot wired up wrong, which is exactly what a takeoff would hide.
    for (const id of ['corner-1x4', 'casing-flat-1x4', 'sill-2x6', 'apron-1x4', 'frieze-1x6', 'band-1x4']) {
      expect(t.get(id) ?? 0, id).toBeGreaterThan(0)
    }
  })
})
