import { useMemo } from 'react'
import { deriveWorkspaceSceneConfig, type WorkspaceSceneConfig } from '../services/workspaceScene'
import { useConfigStore } from './useConfigStore'
import type { WorkspaceWizardInputs } from '../types'

/**
 * THE ONE PLACE THE CEILING HEIGHT IS DECIDED.
 *
 * `deriveWorkspaceSceneConfig` has accepted a stated ceiling since the intake
 * work, and nothing ever passed one: every layer called it with the wizard text
 * alone, so every build framed at the 8ft default and the Settings slider drove
 * nothing at all. The only other route in was the phrase "wall height 2.4m"
 * typed into a wizard textarea for a regex to find — and the wizard is gone.
 *
 * Walls, roof, floor joists, drywall, ceilings, the envelope, placed objects,
 * the edit gizmo and the takeoff must all agree on this number, or the model
 * comes apart at the storey line: walls at one height and the deck above them
 * at another. So they read it from here instead of each deriving its own.
 */
export function useSceneConfig(inputs: WorkspaceWizardInputs | null): WorkspaceSceneConfig {
  const ceilingM = useConfigStore((s) => s.ceilingHeightM)
  const buildType = useConfigStore((s) => s.buildType)
  // Bulkhead height and depth, so the drawn soffit is the one in Settings and
  // not a constant buried in the builder (see buildSpecialFeatures).
  const bulkheadDropIn = useConfigStore((s) => s.bulkheadDropIn)
  const bulkheadDepthIn = useConfigStore((s) => s.bulkheadDepthIn)
  return useMemo(
    () => deriveWorkspaceSceneConfig(inputs, {
      ceilingM, buildType,
      bulkheadDropM: bulkheadDropIn * 0.0254,
      bulkheadDepthM: bulkheadDepthIn * 0.0254,
    }),
    [inputs, ceilingM, buildType, bulkheadDropIn, bulkheadDepthIn],
  )
}
