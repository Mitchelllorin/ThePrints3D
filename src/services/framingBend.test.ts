import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { buildWallFraming } from './framingGeometry'

/**
 * A CURVED WALL IS A RUN OF BENDS.
 *
 * It is not a row of corners: the run carries on round the arc, so nothing
 * arrives at right angles and there is no corner post to build. A break gets
 * one stud — the one the chord before it already placed — rather than one from
 * each side of the joint.
 */
const base = { length: 0.5, height: 2.44, thickness: 0.09, material: 'wood' as const }

/** Every piece of stock the wall stands up — plates, studs, backers. */
function meshes(g: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = []
  g.traverse((o) => { if ((o as THREE.Mesh).isMesh) out.push(o as THREE.Mesh) })
  return out
}

/**
 * Where the STUDS stand, along the wall. A stud is the only member that is a
 * full-height box, which is how these are picked out from plates and blocking
 * rather than by guessing its width.
 */
function studXs(g: THREE.Object3D): number[] {
  const out: number[] = []
  g.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh) return
    if ((m.geometry as THREE.BoxGeometry).parameters.height > 1) out.push(m.position.x)
  })
  return out.sort((a, b) => a - b)
}

describe('a bend in a curved wall', () => {
  it('does not frame a corner post: a bend is not a corner', () => {
    const plain = meshes(buildWallFraming({ ...base }))
    const bent = meshes(buildWallFraming({ ...base, bend: true }))
    // Neither end carries its doubled stud — two members fewer, one per end.
    expect(bent.length).toBe(plain.length - 2)
  })

  it('frames the break once, in the chord that reached it first', () => {
    const own = studXs(buildWallFraming({ ...base, bend: true }))
    const shared = studXs(buildWallFraming({ ...base, bend: true, sharedStartStud: true }))
    expect(shared).toHaveLength(own.length - 1)
    // The one left out is the one at this chord's own start, where the chord
    // before it has already stood a stud up — one stud at the break, not two.
    expect(shared.some((x) => Math.abs(x - own[0]) < 1e-6)).toBe(false)
    expect(shared).toContain(own[own.length - 1])
  })

  it('ignores a corner lap on a bend, because nothing butts in to tie to', () => {
    // A 'lap' would build a backer turned across the wall. There is no corner
    // here to tie, so the bend looks the same however the ends are described.
    const lapped = meshes(buildWallFraming({ ...base, bend: true, capLap: { start: 'lap', end: 'lap' } }))
    const bent = meshes(buildWallFraming({ ...base, bend: true }))
    expect(lapped.length).toBe(bent.length)
  })

  it('keeps the plates and track the full length of the chord', () => {
    // One bay is one stud plus its top and bottom plates — the smallest piece of
    // wall there is — so a bend trims nothing off at either end.
    const bent = meshes(buildWallFraming({ ...base, bend: true, capLap: { start: 'back', end: 'back' } }))
    const full = meshes(buildWallFraming({ ...base, bend: true }))
    expect(bent.length).toBe(full.length)
    const longestOf = (g: THREE.Mesh[]) => Math.max(...g.map((m) => (m.geometry as THREE.BoxGeometry).parameters.width))
    expect(longestOf(bent)).toBeCloseTo(base.length, 6)
  })
})
