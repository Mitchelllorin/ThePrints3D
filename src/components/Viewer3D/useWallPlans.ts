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
import { planWalls, type PlannedWall } from '../../services/wallFramingPlan'

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
  return useMemo(() => planWalls({
    drawings, overlay, placedObjects,
    ceilingM, storeyM: ceilingM + FLOOR_ASSEMBLY_H,
    framingMaterial, steelGauge, steelTrackTop, steelDeflectionGapMm, studSpacingIn,
  }), [drawings, overlay, placedObjects, ceilingM, framingMaterial, steelGauge, steelTrackTop, steelDeflectionGapMm, studSpacingIn])
}
