/**
 * The gate. One helper, used everywhere a feature is Pro-only, so the rule lives
 * in a single place instead of eight `if (isPro)` branches drifting apart.
 *
 * They had drifted: six screens read the raw `isPro` flag and ignored this rule
 * entirely, so while the store was not live those screens stayed locked behind
 * a dead button — the very thing the rule below exists to prevent. They all go
 * through `useIsPro` now. The two places that read the flag raw are the ones
 * that report whether a PURCHASE exists (ProSection, the Settings title): those
 * must not claim a sale that never happened.
 *
 * requirePro(reason, action) either runs the action or opens the upgrade sheet
 * naming the reason. Call sites read as the thing they are doing —
 * requirePro('The measuring tape', () => setMeasureMode(true)) — which keeps the gate
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
/**
 * FREE FOR EVERYONE WHILE THE CLOSED TEST RUNS.
 *
 * Mitchell, 21 Sep 2026: the closed testers get lifetime access anyway, so
 * nothing should be locked while the test is on — every tester sees every
 * feature. Pricing gets set when the test is over; THAT is when this goes to
 * false. After that the gates still stay open until Play answers with a live
 * product (the rule below), so turning this off cannot strand anyone behind a
 * dead upgrade button.
 *
 * Typed `boolean`, not the literal, so flipping it is a one-word change that
 * no linter argues with.
 */
export const PRO_FREE_FOR_EVERYONE: boolean = true

export function useIsPro(): boolean {
  const owned = useAppStore((s) => s.isPro)
  return PRO_FREE_FOR_EVERYONE || owned || !billingAvailable()
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
  // Same three reasons as useIsPro. PRO_FREE_FOR_EVERYONE was missing here, so
  // editing, the tape, product placement and the trade layers would have locked
  // for closed testers the moment the Play product went live.
  if (PRO_FREE_FOR_EVERYONE || useAppStore.getState().isPro || !billingAvailable()) action()
  else useFloorplanLocalStore.getState().openUpgrade(reason)
}
