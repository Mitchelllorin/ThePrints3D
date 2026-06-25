// Roof-plane model — the keystone for the unified "auto-generate planes, then
// pull trusses & eaves" roof workflow. A roof is a SET OF PLANES (not one
// rectangle), each with a low eave edge (the pullable-overhang baseline and the
// start of a truss run), a high edge (a ridge segment or a hip apex), a pitch
// and a rise. Planes meet at ridge / hip / valley lines. Auto-generated from the
// building footprint + a chosen roof type; the user then pulls each plane's
// truss run and eave depth. Pure geometry (no THREE) so it's unit-testable and
// reusable by the renderer, the truss-run engine, and material takeoffs.

/** Plan-view point [x, z] in metres, centred on the footprint origin. */
export type Vec2 = [number, number]
/** World point [x, y, z] in metres. */
export type Vec3 = [number, number, number]

/** The high (upper) edge of a plane: a ridge segment, or a single hip apex. */
export type PlaneHigh =
  | { kind: 'ridge'; edge: [Vec2, Vec2] }
  | { kind: 'apex'; point: Vec2 }

export interface RoofPlane {
  id: string
  /** Plan-view polygon this plane covers (XZ), wound CCW. */
  footprint: Vec2[]
  /** Low edge — eave. The overhang pulls outward from here; truss runs start here. */
  eave: [Vec2, Vec2]
  /** Upper edge — ridge segment or hip apex. */
  high: PlaneHigh
  /** rise / run ratio (e.g. 0.5 = 6:12). */
  pitch: number
  /** Vertical rise (m) from eave (y=0) to the ridge/apex. */
  riseM: number
  /** Eave overhang depth (m) — the pullable bit. Default ~16" boxed eave. */
  overhangM: number
}

export type RoofEdgeKind = 'ridge' | 'hip' | 'valley'
export interface RoofEdge {
  kind: RoofEdgeKind
  a: Vec3
  b: Vec3
}

export interface RoofStructure {
  type: string
  planes: RoofPlane[]
  /** Ridge / hip / valley lines where planes meet (3D, eave plane at y=0). */
  edges: RoofEdge[]
}

export interface RoofFootprint {
  lenX: number
  lenZ: number
}

const DEFAULT_OVERHANG_M = 0.4 // ~16" boxed eave (12–24" typical)

function plane(
  id: string,
  footprint: Vec2[],
  eave: [Vec2, Vec2],
  high: PlaneHigh,
  pitch: number,
  riseM: number,
  overhangM: number,
): RoofPlane {
  return { id, footprint, eave, high, pitch, riseM, overhangM }
}

/**
 * Generate the roof planes + ridge/hip lines for a rectangular footprint and a
 * roof type. Built centred on origin with the eaves at y=0 (the caller seats the
 * whole roof on the wall top plate). Unknown types fall back to gable.
 */
export function generateRoofPlanes(
  footprint: RoofFootprint,
  type: string,
  pitch: number,
  overhangM: number = DEFAULT_OVERHANG_M,
): RoofStructure {
  const t = (type || '').trim().toLowerCase()
  const { lenX, lenZ } = footprint
  switch (t) {
    case 'flat': return flatRoof(lenX, lenZ, overhangM)
    case 'shed':
    case 'lean-to':
    case 'mono':
    case 'mono-pitch': return shedRoof(lenX, lenZ, pitch, overhangM)
    case 'hip': return hipRoof(lenX, lenZ, pitch, overhangM)
    case 'gable':
    case 'truss':
    case 'trusses':
    default: return gableRoof(t || 'gable', lenX, lenZ, pitch, overhangM)
  }
}

/** Two planes meeting at a central ridge along the LONGER side. */
function gableRoof(type: string, lenX: number, lenZ: number, pitch: number, overhangM: number): RoofStructure {
  const hx = lenX / 2, hz = lenZ / 2
  // Ridge runs along the longer side; span (and slope) is across the shorter.
  const ridgeAlongZ = lenX <= lenZ
  const span = ridgeAlongZ ? lenX : lenZ
  const riseM = Math.max(0.1, (span / 2) * pitch)

  if (ridgeAlongZ) {
    const ridge: [Vec2, Vec2] = [[0, -hz], [0, hz]]
    return {
      type,
      planes: [
        plane('gable-plane-px',
          [[0, -hz], [hx, -hz], [hx, hz], [0, hz]],
          [[hx, -hz], [hx, hz]], { kind: 'ridge', edge: ridge }, pitch, riseM, overhangM),
        plane('gable-plane-nx',
          [[0, hz], [-hx, hz], [-hx, -hz], [0, -hz]],
          [[-hx, -hz], [-hx, hz]], { kind: 'ridge', edge: ridge }, pitch, riseM, overhangM),
      ],
      edges: [{ kind: 'ridge', a: [0, riseM, -hz], b: [0, riseM, hz] }],
    } as RoofStructure
  }
  const ridge: [Vec2, Vec2] = [[-hx, 0], [hx, 0]]
  return {
    type,
    planes: [
      plane('gable-plane-pz',
        [[-hx, 0], [-hx, hz], [hx, hz], [hx, 0]],
        [[-hx, hz], [hx, hz]], { kind: 'ridge', edge: ridge }, pitch, riseM, overhangM),
      plane('gable-plane-nz',
        [[hx, 0], [hx, -hz], [-hx, -hz], [-hx, 0]],
        [[-hx, -hz], [hx, -hz]], { kind: 'ridge', edge: ridge }, pitch, riseM, overhangM),
    ],
    edges: [{ kind: 'ridge', a: [-hx, riseM, 0], b: [hx, riseM, 0] }],
  }
}

/** Four planes: two trapezoidal long-side slopes + two triangular hipped ends. */
function hipRoof(lenX: number, lenZ: number, pitch: number, overhangM: number): RoofStructure {
  const ridgeAlongX = lenX >= lenZ
  const L = Math.max(lenX, lenZ)
  const W = Math.min(lenX, lenZ)
  const half = W / 2
  const riseM = Math.max(0.1, half * pitch)
  const ridgeLen = Math.max(0, L - W) // hips eat half the width off each end
  const hr = ridgeLen / 2
  const hL = L / 2

  // Canonical: ridge along X. Map (a = along-ridge axis, b = across) to world.
  const toWorld = (a: number, b: number): Vec2 => (ridgeAlongX ? [a, b] : [b, a])
  const ridgeEdge: [Vec2, Vec2] = [toWorld(-hr, 0), toWorld(hr, 0)]

  const planes: RoofPlane[] = [
    // Long side +b (trapezoid)
    plane('hip-plane-side-a',
      [toWorld(-hL, half), toWorld(hL, half), toWorld(hr, 0), toWorld(-hr, 0)],
      [toWorld(-hL, half), toWorld(hL, half)], { kind: 'ridge', edge: ridgeEdge }, pitch, riseM, overhangM),
    // Long side -b (trapezoid)
    plane('hip-plane-side-b',
      [toWorld(hL, -half), toWorld(-hL, -half), toWorld(-hr, 0), toWorld(hr, 0)],
      [toWorld(-hL, -half), toWorld(hL, -half)], { kind: 'ridge', edge: ridgeEdge }, pitch, riseM, overhangM),
    // Hipped end +a (triangle → apex at ridge end)
    plane('hip-plane-end-a',
      [toWorld(hL, -half), toWorld(hL, half), toWorld(hr, 0)],
      [toWorld(hL, -half), toWorld(hL, half)], { kind: 'apex', point: toWorld(hr, 0) }, pitch, riseM, overhangM),
    // Hipped end -a (triangle)
    plane('hip-plane-end-b',
      [toWorld(-hL, half), toWorld(-hL, -half), toWorld(-hr, 0)],
      [toWorld(-hL, -half), toWorld(-hL, half)], { kind: 'apex', point: toWorld(-hr, 0) }, pitch, riseM, overhangM),
  ]

  // Ridge + four hip lines (each plan corner up to the nearest ridge end).
  const r3 = (p: Vec2, y: number): Vec3 => [p[0], y, p[1]]
  const corners: Array<[Vec2, Vec2]> = [
    [toWorld(hL, half), toWorld(hr, 0)],
    [toWorld(hL, -half), toWorld(hr, 0)],
    [toWorld(-hL, half), toWorld(-hr, 0)],
    [toWorld(-hL, -half), toWorld(-hr, 0)],
  ]
  const edges: RoofEdge[] = [{ kind: 'ridge', a: r3(ridgeEdge[0], riseM), b: r3(ridgeEdge[1], riseM) }]
  for (const [corner, ridgeEnd] of corners) {
    edges.push({ kind: 'hip', a: r3(corner, 0), b: r3(ridgeEnd, riseM) })
  }
  return { type: 'hip', planes, edges }
}

/** One plane sloping from a low eave up to the opposite (high) wall. */
function shedRoof(lenX: number, lenZ: number, pitch: number, overhangM: number): RoofStructure {
  const hx = lenX / 2, hz = lenZ / 2
  // Slope across the shorter side so the high wall is reasonable.
  const slopeAcrossZ = lenZ <= lenX
  const span = slopeAcrossZ ? lenZ : lenX
  const riseM = Math.max(0.1, span * pitch) // full-span rise (single slope)
  if (slopeAcrossZ) {
    return {
      type: 'shed',
      planes: [plane('shed-plane',
        [[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz]],
        [[-hx, -hz], [hx, -hz]], { kind: 'ridge', edge: [[-hx, hz], [hx, hz]] }, pitch, riseM, overhangM)],
      edges: [{ kind: 'ridge', a: [-hx, riseM, hz], b: [hx, riseM, hz] }],
    }
  }
  return {
    type: 'shed',
    planes: [plane('shed-plane',
      [[-hx, -hz], [-hx, hz], [hx, hz], [hx, -hz]],
      [[-hx, -hz], [-hx, hz]], { kind: 'ridge', edge: [[hx, -hz], [hx, hz]] }, pitch, riseM, overhangM)],
    edges: [{ kind: 'ridge', a: [hx, riseM, -hz], b: [hx, riseM, hz] }],
  }
}

/** A single horizontal plane (membrane roof). */
function flatRoof(lenX: number, lenZ: number, overhangM: number): RoofStructure {
  const hx = lenX / 2, hz = lenZ / 2
  return {
    type: 'flat',
    planes: [plane('flat-plane',
      [[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz]],
      [[-hx, -hz], [hx, -hz]], { kind: 'ridge', edge: [[-hx, hz], [hx, hz]] }, 0, 0, overhangM)],
    edges: [],
  }
}
