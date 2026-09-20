/**
 * useWallPlans — the framing plan for the current project, from the stores.
 *
 * Its own file so both the 3D layer that stands the walls up and the cut list
 * that counts them read the same hook. See wallFramingPlan for what a plan is
 * and why it does not live inside the render layer any more.
 */
import { useMemo } from 'react'
import { useAppStore } from '../../store/useAppStore'
import { useConfigStore } from '../../store/useConfigStore'
import { useSceneConfig } from '../../store/useSceneConfig'
import { FLOOR_ASSEMBLY_H } from '../../services/framingGeometry'
import { planWalls, type PlannedWall, type WallPlanInput } from '../../services/wallFramingPlan'

/**
 * ONE COMPUTATION, HOWEVER MANY COMPONENTS ASK FOR IT.
 *
 * `useMemo` stops a component recomputing while nothing changed — it does not
 * stop FOUR components each computing the same thing the moment something does.
 * The walls layer, the plan sheet, the opening row and the cut list all want
 * this plan from the same store values, so dragging a wall re-planned the whole
 * building once per consumer, every frame of the drag. That is the kind of cost
 * an EliteBook notices and a fast machine never does.
 *
 * Deps are compared by identity, which is exactly right here: the store hands
 * back the same object until something really changed, and when it does every
 * consumer gets the same new one. So the first caller in a render pass computes
 * and the rest read the result.
 *
 * One entry, not a map — there is one building, and holding older plans would
 * pin whole drawings in memory for nothing.
 */
let lastInput: WallPlanInput | null = null
let lastPlans: PlannedWall[] = []
function sameInput(a: WallPlanInput, b: WallPlanInput): boolean {
  return a.drawings === b.drawings
    && a.overlay === b.overlay
    && a.placedObjects === b.placedObjects
    && a.ceilingM === b.ceilingM
    && a.storeyM === b.storeyM
    && a.framingMaterial === b.framingMaterial
    && a.steelGauge === b.steelGauge
    && a.steelTrackTop === b.steelTrackTop
    && a.steelDeflectionGapMm === b.steelDeflectionGapMm
    && a.studSpacingIn === b.studSpacingIn
}
function planFor(input: WallPlanInput): PlannedWall[] {
  if (lastInput && sameInput(lastInput, input)) return lastPlans
  lastInput = input
  lastPlans = planWalls(input)
  return lastPlans
}

export function useWallPlans(): PlannedWall[] {
  const drawings = useAppStore((s) => s.drawings)
  const overlay = useAppStore((s) => s.floorplanOverlay)
  const placedObjects = useAppStore((s) => s.placedObjects)
  const wizardInputs = useAppStore((s) => s.wizardInputs)
  const framingMaterial = useConfigStore((s) => s.framingMaterial)
  const steelGauge = useConfigStore((s) => s.steelGauge)
  const steelTrackTop = useConfigStore((s) => s.steelTrackTop)
  const steelDeflectionGapMm = useConfigStore((s) => s.steelDeflectionGapMm)
  const studSpacingIn = useConfigStore((s) => s.studSpacingIn)
  const ceilingM = useSceneConfig(wizardInputs).wallHeightM
  return useMemo(() => planFor({
    drawings, overlay, placedObjects,
    ceilingM, storeyM: ceilingM + FLOOR_ASSEMBLY_H,
    framingMaterial, steelGauge, steelTrackTop, steelDeflectionGapMm, studSpacingIn,
  }), [drawings, overlay, placedObjects, ceilingM, framingMaterial, steelGauge, steelTrackTop, steelDeflectionGapMm, studSpacingIn])
}
