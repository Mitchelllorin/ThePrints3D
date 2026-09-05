/**
 * WHEN DOES A FLOATING NAMEPLATE EARN ITS PLACE ON THE MODEL?
 *
 * Every built element used to carry its metrics in the air above it, all the
 * time. On one wall that is helpful. On a finished storey it is a wall of
 * floating text with the building somewhere behind it — the model is the thing
 * you came to look at, and the labels were taking it away.
 *
 * So the rule is: the thing you are WORKING ON says what it is, and everything
 * else stays quiet. Which is a setting, because it is a preference and not a
 * fact — some people want every dimension on screen while they take off
 * quantities, and that is legitimate too. See `dimensionsMode`.
 */
import { useUISettingsStore } from '../../store/useUISettingsStore'
import { useFloorplanLocalStore } from '../../store/useFloorplanLocalStore'

/**
 * Should this area's nameplate be drawn?
 *
 * `kind`/`id` identify the element so 'selected' can ask whether it is the one
 * currently picked. An element with no id can never be the selection, so under
 * 'selected' it stays quiet rather than defaulting to visible — the whole point
 * is that silence is the resting state.
 */
export function useAreaNameplateVisible(kind: 'floor' | 'roof', id: string | undefined): boolean {
  const mode = useUISettingsStore((s) => s.dimensionsMode)
  const selectedArea = useFloorplanLocalStore((s) => s.selectedArea)
  if (mode === 'off') return false
  if (mode === 'always') return true
  return !!id && selectedArea?.kind === kind && selectedArea.id === id
}

/**
 * Should a WALL's length nameplate be drawn?
 *
 * Walls are already scoped: the plate shows only while the wall is unbuilt,
 * which is exactly the moment you are laying it out and want to read its
 * length off the screen. That IS the "working on it" case, so 'selected' keeps
 * it — this hook exists so 'off' can still silence it, and so every nameplate
 * in the app answers to one setting instead of some of them.
 */
export function useWallNameplateVisible(): boolean {
  return useUISettingsStore((s) => s.dimensionsMode) !== 'off'
}
