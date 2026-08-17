/**
 * PENETRATIONS — what a run is allowed to do to the framing it crosses.
 *
 * Pipes and wires do not go around a building's bones; they go through them.
 * That is what a hole hog is for. But not anywhere, and not any size: a stud
 * bored too deep stops carrying, and a joist notched in the wrong third breaks
 * where it bends. The trade knows this as a set of hard limits, and so does the
 * inspector.
 *
 * This module is those limits, as pure functions. Nothing here draws anything —
 * it answers questions:
 *
 *   Can I bore this member here, this big?  → borePlan()
 *   Can I notch it instead?                 → notchPlan()
 *   Does this cable need a nail plate?       → cableNeedsNailPlate()
 *
 * It is deliberately separate from the geometry that will render the holes,
 * because the answers are testable on their own and because the router needs to
 * ask BEFORE it commits to a route. A run that cannot legally cross a member is
 * a routing problem, not a drawing problem.
 *
 * Sources are recorded per rule in constructionKnowledge.ts (IRC R602.6 studs,
 * R502.8 joists, NEC 300.4 cables).
 */

/** What is being crossed. Studs and joists have different rules. */
export type MemberKind = 'stud' | 'joist'

/** Whether the member is carrying load — bearing walls are treated harder. */
export type LoadRole = 'bearing' | 'nonbearing'

export interface Member {
  kind: MemberKind
  role: LoadRole
  /** Across the face being bored — a stud's width, a joist's depth. mm. */
  widthMm: number
  /** For a joist: its clear span, so the middle third can be located. mm. */
  spanMm?: number
}

export interface BoreRequest {
  member: Member
  /** Outside diameter of the pipe or cable bundle. mm. */
  diameterMm: number
  /** Distance from the member's near edge to the hole CENTRE. mm. */
  fromEdgeMm: number
  /** For a joist: distance along the span to the hole. mm. */
  alongSpanMm?: number
}

export interface Verdict {
  ok: boolean
  /** Plain-language reason, written to be shown to a tradesperson as-is. */
  reason: string
  /** Set when the work is allowed but changes the framing. */
  requires?: 'doubled stud' | 'nail plate'
}

/** 1 1/4" — NEC's clearance before a cable needs protecting. */
export const NAIL_PLATE_CLEARANCE_MM = 31.75
/** 5/8" — IRC's minimum wood left at the edge of a bored stud. */
const STUD_EDGE_MIN_MM = 15.875
/** 2" — IRC's minimum clear above and below a bored joist hole. */
const JOIST_EDGE_MIN_MM = 50.8

/**
 * Bore a member.
 *
 * Studs: up to 60% of the width, but past 40% in a bearing wall the stud has to
 * be DOUBLED — allowed, not free, so it comes back as `requires`. Joists: a
 * third of the depth, kept 2" clear of both edges, and legal anywhere along the
 * span including the middle third, which is the part people get wrong (it is
 * NOTCHES that are barred from the middle).
 */
export function borePlan(req: BoreRequest): Verdict {
  const { member, diameterMm, fromEdgeMm } = req
  const pct = diameterMm / member.widthMm

  if (diameterMm <= 0) return { ok: false, reason: 'No hole to bore.' }

  if (member.kind === 'joist') {
    if (pct > 1 / 3) {
      return { ok: false, reason: `A joist takes a hole up to a third of its depth — that is ${Math.round(member.widthMm / 3)} mm here.` }
    }
    const edge = fromEdgeMm - diameterMm / 2
    const farEdge = member.widthMm - (fromEdgeMm + diameterMm / 2)
    if (edge < JOIST_EDGE_MIN_MM || farEdge < JOIST_EDGE_MIN_MM) {
      return { ok: false, reason: 'A bored joist needs 2" of solid wood above and below the hole.' }
    }
    return { ok: true, reason: 'Bored hole within limits — anywhere in the span is fine for a hole.' }
  }

  // Stud
  if (fromEdgeMm - diameterMm / 2 < STUD_EDGE_MIN_MM) {
    return { ok: false, reason: 'Keep 5/8" of wood between the hole and the edge of the stud.' }
  }
  if (pct > 0.6) {
    return { ok: false, reason: `A stud bores to 60% of its width — that is ${Math.round(member.widthMm * 0.6)} mm here.` }
  }
  if (pct > 0.4) {
    return member.role === 'bearing'
      ? { ok: true, reason: 'Over 40% in a bearing wall: allowed, but this stud must be doubled.', requires: 'doubled stud' }
      : { ok: true, reason: 'Bored hole within limits for a non-bearing stud.' }
  }
  return { ok: true, reason: 'Bored hole within limits.' }
}

/**
 * Notch a member — always the worse option, and sometimes forbidden outright.
 *
 * The middle third of a joist is where the bending stress lives, so a notch
 * there is not a "needs doubling" situation, it is a no.
 */
export function notchPlan(req: {
  member: Member
  depthMm: number
  lengthMm?: number
  alongSpanMm?: number
}): Verdict {
  const { member, depthMm, lengthMm = 0, alongSpanMm } = req
  const pct = depthMm / member.widthMm

  if (member.kind === 'joist') {
    if (pct > 1 / 6) return { ok: false, reason: 'A joist notch cannot exceed a sixth of its depth.' }
    if (lengthMm > member.widthMm / 3) return { ok: false, reason: 'A joist notch cannot be longer than a third of its depth.' }
    if (member.spanMm != null && alongSpanMm != null) {
      const third = member.spanMm / 3
      if (alongSpanMm > third && alongSpanMm < member.spanMm - third) {
        return { ok: false, reason: 'Never notch the middle third of a joist — bore it instead, which is allowed there.' }
      }
    }
    return { ok: true, reason: 'Notch within limits.' }
  }

  const cap = member.role === 'bearing' ? 0.25 : 0.4
  if (pct > cap) {
    return {
      ok: false,
      reason: member.role === 'bearing'
        ? 'A bearing-wall stud notches to 25% of its width. Bore it instead — that allows 60%.'
        : 'A non-bearing stud notches to 40% of its width.',
    }
  }
  return { ok: true, reason: 'Notch within limits.' }
}

/**
 * Does this cable need a nail plate?
 *
 * A 2x4 is 89 mm actual, so a hole dead in the centre leaves 31.75 mm each side
 * — exactly the clearance, to the millimetre. That is why a centred hole is the
 * one framers drill, and why anything off-centre, or any 2x3, gets a plate.
 */
export function cableNeedsNailPlate(args: {
  studWidthMm: number
  /** Distance from the stud FACE to the near edge of the hole. mm. */
  fromFaceMm: number
}): boolean {
  const { studWidthMm, fromFaceMm } = args
  const farSide = studWidthMm - fromFaceMm
  return Math.min(fromFaceMm, farSide) < NAIL_PLATE_CLEARANCE_MM - 0.01
}
