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
import { useAppStore } from '../../store/useAppStore'
import { useFloorplanLocalStore } from '../../store/useFloorplanLocalStore'

/**
 * NO STORE, NO PAYWALL.
 *
 * A gate is only fair while there is something to buy. Until Play answers with
 * a live product, `billingLive` in the app store is false everywhere — so a locked feature
 * shows an upgrade sheet with a dead button and no way through. That is not a
 * paywall, it is a broken feature, and it would have shipped that way in the
 * first build whose entire purpose is letting people learn the app.
 *
 * So the gates arm themselves the moment the store is reachable, and stay open
 * until then. Nothing to remember at release time; setting the key turns the
 * paywall on by itself.
 */
/**
 * THE PAYWALL IS ON.
 *
 * Mitchell, 21 Sep 2026: everything was free while the closed test ran.
 * Mitchell, 23 Oct 2026: that is over, Pro is for sale. The gates still stay
 * open until Play answers with a live product (the rule above), so this cannot
 * strand anyone behind a dead upgrade button. Testers promised lifetime access
 * get it through Play Console promo codes for theprints3d_pro_unlock, not by
 * leaving this on.
 *
 * Typed `boolean`, not the literal, so flipping it is a one-word change that
 * no linter argues with.
 */
export const PRO_FREE_FOR_EVERYONE: boolean = false

export function useIsPro(): boolean {
  const owned = useAppStore((s) => s.isPro)
  const live = useAppStore((s) => s.billingLive)
  return PRO_FREE_FOR_EVERYONE || owned || !live
}

/** Whether to show a way to buy: not owned yet, and there is something to buy. */
export function useCanBuyPro(): boolean {
  const owned = useAppStore((s) => s.isPro)
  const live = useAppStore((s) => s.billingLive)
  return !PRO_FREE_FOR_EVERYONE && !owned && live
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
  const { isPro, billingLive } = useAppStore.getState()
  if (PRO_FREE_FOR_EVERYONE || isPro || !billingLive) action()
  else useFloorplanLocalStore.getState().openUpgrade(reason)
}
