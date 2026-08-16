/**
 * The gate. One helper, used everywhere a feature is Pro-only, so the rule lives
 * in a single place instead of eight `if (isPro)` branches drifting apart.
 *
 * requirePro(reason, action) either runs the action or opens the upgrade sheet
 * naming the reason. Call sites read as the thing they are doing —
 * requirePro('Editing walls', () => setEditMode(true)) — which keeps the gate
 * from turning into the subject of the code around it.
 */
import { useCallback } from 'react'
import { billingAvailable } from '../../services/billing'
import { useAppStore } from '../../store/useAppStore'
import { useFloorplanLocalStore } from '../../store/useFloorplanLocalStore'

/**
 * NO STORE, NO PAYWALL.
 *
 * A gate is only fair while there is something to buy. Until the RevenueCat key
 * is configured, `billingAvailable()` is false everywhere — so a locked feature
 * shows an upgrade sheet with a dead button and no way through. That is not a
 * paywall, it is a broken feature, and it would have shipped that way in the
 * first build whose entire purpose is letting people learn the app.
 *
 * So the gates arm themselves the moment the store is reachable, and stay open
 * until then. Nothing to remember at release time; setting the key turns the
 * paywall on by itself.
 */
export function useIsPro(): boolean {
  const owned = useAppStore((s) => s.isPro)
  return owned || !billingAvailable()
}

export function useRequirePro(): (reason: string, action: () => void) => void {
  const isPro = useIsPro()
  const openUpgrade = useFloorplanLocalStore((s) => s.openUpgrade)
  return useCallback(
    (reason, action) => {
      if (isPro) action()
      else openUpgrade(reason)
    },
    [isPro, openUpgrade],
  )
}

/**
 * The same gate outside React — inside a store action, an event handler bound
 * once, a service. Reads the stores directly rather than through hooks.
 */
export function requirePro(reason: string, action: () => void): void {
  if (useAppStore.getState().isPro || !billingAvailable()) action()
  else useFloorplanLocalStore.getState().openUpgrade(reason)
}
