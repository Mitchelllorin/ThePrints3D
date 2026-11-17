/**
 * A MANUFACTURER'S PART, MODELLED — not a box with their name on it.
 *
 * Every member in the app was a single tan box. That is fine for a stud, which
 * genuinely is one piece of timber, and wrong for the parts this app pitches: a
 * Nordic Lam beam IS twelve 1-1/2" laminations glued up, a West Fraser 1-3/4"
 * LVL IS a stack of veneers through its thickness, and Parallam's whole selling
 * point is that it has no plies at all. Drawing all four the same way throws
 * away the one difference a framer can see from across the yard.
 *
 * So the model is built the way the member is built:
 *
 *   glulam — one box per lamination, stacked through the DEPTH, glue line between.
 *   LVL    — one box per veneer, stacked through the THICKNESS.
 *   LSL    — one box. Strand board has no plies to stack; its strand surface
 *            comes from ./surface.
 *   PSL    — one box, for the same reason, and the surface runs long.
 *
 * DIMENSIONS COME FROM THE CATALOGUE, not from this file: the part points at a
 * `memberId`, the member carries the real section in inches, and the model is
 * that section in metres. A part whose model disagrees with its nameplate is the
 * one error that would end a pitch, so there is one source for the size.
 *
 * `spread` opens the layup — the plies separate along the axis they were glued
 * on, which is the explode this family uses everywhere else, applied to one
 * part instead of a wall.
 */

import * as THREE from 'three'
import type { ManufacturerPart } from '../../data/manufacturerParts'
import { getMember, memberSectionM } from '../../data/members'
import { brandSurfaceMaterial, laminationCount, surfaceKind } from './surface'

/** The glue line between two laminations, metres. Thin, but it has to read. */
const GLUE_GAP_M = 0.0016
/** Veneers are 1/8" nominal, so a 1-3/4" LVL is fourteen of them. */
const VENEER_IN = 0.125

export interface PartModelOpts {
  /** Length along X, metres. Default 2.4 (an 8 ft stick). */
  lengthM?: number
  /** 0 = glued up, 1 = plies pulled apart along their own glue line. */
  spread?: number
}

export interface PartModel {
  group: THREE.Group
  /** How many pieces the member is built from — 1 for a strand product. */
  plies: number
  /** Section the model was drawn at, metres. */
  widthM: number
  depthM: number
}

/**
 * The member's cross-section in metres. Returns null when the part's `memberId`
 * is not in the catalogue — a spec sheet the app cannot draw is not a model.
 */
function sectionOf(part: ManufacturerPart): { width: number; depth: number } | null {
  const member = getMember(part.memberId)
  if (!member) return null
  return memberSectionM(member)
}

/** How many pieces this part is built from, for the nameplate and the sheet. */
export function partPlyCount(part: ManufacturerPart): number {
  const kind = surfaceKind(part)
  if (kind === 'glulam') return laminationCount(part) ?? 1
  if (kind === 'lvl') {
    const section = sectionOf(part)
    if (!section) return 1
    return Math.max(1, Math.round(section.width / (VENEER_IN * 0.0254)))
  }
  return 1
}

/**
 * Build the part at the origin: length along X, depth along Y, thickness along Z,
 * so it drops into the same frame every other member in the scene uses.
 */
export function buildPartModel(part: ManufacturerPart, opts: PartModelOpts = {}): PartModel | null {
  const section = sectionOf(part)
  if (!section) return null
  const { width: widthM, depth: depthM } = section
  const lengthM = Math.max(0.1, opts.lengthM ?? 2.4)
  const spread = Math.max(0, Math.min(1, opts.spread ?? 0))
  const kind = surfaceKind(part)
  const plies = partPlyCount(part)

  const group = new THREE.Group()
  group.userData.brandPart = part.id
  group.userData.manufacturer = part.manufacturer
  group.userData.plyCount = plies

  // The maker's surface where there is a canvas to draw it on; a plain tone of
  // the same timber otherwise, so a headless build still produces geometry.
  const branded = brandSurfaceMaterial(part)
  const material = branded ?? new THREE.MeshStandardMaterial({
    color: new THREE.Color(kind === 'lsl' ? '#d0ba8e' : '#c9a068'),
    roughness: 0.75,
    metalness: 0.02,
  })

  const addPly = (geo: THREE.BufferGeometry, y: number, z: number) => {
    const mesh = new THREE.Mesh(geo, material)
    mesh.position.set(0, y, z)
    mesh.castShadow = true
    mesh.receiveShadow = true
    mesh.userData.brandPart = part.id
    mesh.userData.layer = 'framing'
    mesh.userData.info = `${part.manufacturer} ${part.product} ${part.designation}`
    group.add(mesh)
    return mesh
  }

  if (kind === 'glulam' && plies > 1) {
    // Stacked through the DEPTH: that is how a beam is laid up, and it is why
    // the end of a glulam reads as a ruler.
    const plyH = depthM / plies
    const geo = new THREE.BoxGeometry(lengthM, Math.max(0.002, plyH - GLUE_GAP_M), widthM)
    const push = (spread * Math.max(0, plyH)) / Math.max(1, plies - 1)
    for (let i = 0; i < plies; i++) {
      const y = -depthM / 2 + plyH * (i + 0.5)
      const dir = y >= 0 ? 1 : -1
      addPly(geo, y + dir * i * push, 0)
    }
  } else if (kind === 'lvl' && plies > 1) {
    // Stacked through the THICKNESS: veneers, so the lines are finer and there
    // are more of them.
    const plyT = widthM / plies
    const geo = new THREE.BoxGeometry(lengthM, depthM, Math.max(0.0015, plyT - GLUE_GAP_M))
    const push = (spread * Math.max(0, plyT)) / Math.max(1, plies - 1)
    for (let i = 0; i < plies; i++) {
      const z = -widthM / 2 + plyT * (i + 0.5)
      const dir = z >= 0 ? 1 : -1
      addPly(geo, 0, z + dir * i * push)
    }
  } else {
    // No plies to show: one billet, and the strand surface does the talking.
    addPly(new THREE.BoxGeometry(lengthM, depthM, widthM), 0, 0)
  }

  group.position.set(0, depthM / 2, 0)
  return { group, plies, widthM, depthM }
}
