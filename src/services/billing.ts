/**
 * BILLING — one purchase, forever, and everything the app needs to know about it.
 *
 * ThePrints3D sells a single non-consumable unlock, not a subscription. That
 * shapes every decision in here: there is one entitlement to check, no renewal
 * to track, no expiry to watch, and the only two verbs are "buy it" and "I
 * already bought it, give it back".
 *
 * RevenueCat wraps Play Billing, so this file never touches a purchase token or
 * a receipt. What it adds on top is the part that actually matters on a job
 * site: the entitlement is CACHED. A tradesperson standing in a basement with
 * no signal has already paid, and the app must not act like they haven't. So
 * the last known answer is written to localStorage and trusted until the store
 * contradicts it — a network failure is never allowed to revoke Pro.
 *
 * Nothing here throws at the caller. Every function returns a plain result the
 * UI can act on, because a billing library failing is not a reason for the
 * workspace to fall over.
 */
import { Capacitor } from '@capacitor/core'

/** Play Console product ID. Must match the console and the RevenueCat product. */
export const PRO_PRODUCT_ID = 'theprints3d_pro_unlock'

/** RevenueCat entitlement name. Must match the dashboard. */
export const PRO_ENTITLEMENT = 'pro'

/** Where the last known entitlement is kept so it survives relaunch and offline. */
const CACHE_KEY = 'theprints3d.pro'

/** The price is the store's to state, never ours. Shown only once we have it. */
type Price = string | null

export type PurchaseOutcome =
  | { status: 'purchased'; isPro: true }
  | { status: 'cancelled' }
  | { status: 'unavailable' }
  | { status: 'error'; message: string }

export type RestoreOutcome =
  | { status: 'restored'; isPro: boolean }
  | { status: 'unavailable' }
  | { status: 'error'; message: string }

/** The plugin's type surface, imported lazily — see loadPurchases(). */
type PurchasesModule = typeof import('@revenuecat/purchases-capacitor')

let configuring: Promise<boolean> | null = null
let configured = false

/**
 * Billing exists only where there is a store to buy from. On the web build (the
 * dev server, and anything running in a browser) there is no Play Billing at
 * all, and without an API key RevenueCat cannot be configured — in both cases
 * the app runs fully, it just cannot sell anything. Gated features stay gated
 * and the upgrade surface says so rather than opening a dead purchase flow.
 */
export function billingAvailable(): boolean {
  return Capacitor.getPlatform() === 'android' && !!rcKey()
}

/** The public SDK key. Build-time config like every other VITE_ var here. */
function rcKey(): string {
  return (import.meta.env.VITE_RC_ANDROID_KEY as string | undefined)?.trim() ?? ''
}

/**
 * Imported at call time, not at module load. The plugin's web implementation
 * rejects every method as unimplemented, and pulling it into the initial bundle
 * would cost every user — most of whom are mid-trace, not mid-purchase — the
 * download for a screen they may never open.
 */
async function loadPurchases(): Promise<PurchasesModule['Purchases'] | null> {
  try {
    const mod = await import('@revenuecat/purchases-capacitor')
    return mod.Purchases
  } catch {
    return null
  }
}

/** The last answer the store gave us. Survives relaunch, and outlives signal. */
export function readCachedPro(): boolean {
  try {
    return localStorage.getItem(CACHE_KEY) === '1'
  } catch {
    return false
  }
}

function writeCachedPro(isPro: boolean): void {
  try {
    localStorage.setItem(CACHE_KEY, isPro ? '1' : '0')
  } catch {
    /* private mode, quota, a browser with storage off — not worth a crash */
  }
}

/**
 * Configure once per launch. Concurrent callers share the one attempt rather
 * than racing two configure() calls into the SDK.
 */
async function ensureConfigured(): Promise<boolean> {
  if (configured) return true
  if (!billingAvailable()) return false
  if (configuring) return configuring

  configuring = (async () => {
    const Purchases = await loadPurchases()
    if (!Purchases) return false
    try {
      await Purchases.configure({ apiKey: rcKey() })
      configured = true
      return true
    } catch {
      return false
    } finally {
      configuring = null
    }
  })()

  return configuring
}

/**
 * Ask the store what this user owns.
 *
 * Returns null — NOT false — when the question could not be asked: no billing
 * on this platform, or the call failed. Null means "no new information", and
 * the caller keeps whatever it already believed. Returning false here would
 * mean an aircraft-mode launch silently locks a paying user out of the features
 * they bought, which is the single worst thing this file could do.
 */
export async function refreshEntitlement(): Promise<boolean | null> {
  if (!(await ensureConfigured())) return null
  const Purchases = await loadPurchases()
  if (!Purchases) return null

  try {
    const info = await Purchases.getCustomerInfo()
    const isPro = !!info.customerInfo.entitlements.active[PRO_ENTITLEMENT]
    writeCachedPro(isPro)
    return isPro
  } catch {
    return null
  }
}

/**
 * The price string as the store words it — "$14.99", "£11.99", "CA$19.99" —
 * localised and currency-correct because it comes from Play, not from us.
 * A hardcoded price in the UI is a lie the moment it is read outside the US.
 */
export async function getProPrice(): Promise<Price> {
  if (!(await ensureConfigured())) return null
  const Purchases = await loadPurchases()
  if (!Purchases) return null

  try {
    const offerings = await Purchases.getOfferings()
    return findProPackage(offerings)?.product.priceString ?? null
  } catch {
    return null
  }
}

/**
 * The unlock, wherever it sits in the offering. Prefer the package whose
 * product is ours by ID; fall back to the current offering's first package so a
 * dashboard rename cannot take the buy button down.
 */
function findProPackage(offerings: Awaited<ReturnType<PurchasesModule['Purchases']['getOfferings']>>) {
  const current = offerings.current
  if (!current) return null
  return (
    current.availablePackages.find((p) => p.product.identifier === PRO_PRODUCT_ID)
    ?? current.availablePackages[0]
    ?? null
  )
}

/**
 * Buy it. A cancel is a normal outcome, not an error — the user changed their
 * mind, and the UI should close quietly rather than apologise.
 */
export async function purchasePro(): Promise<PurchaseOutcome> {
  if (!(await ensureConfigured())) return { status: 'unavailable' }
  const Purchases = await loadPurchases()
  if (!Purchases) return { status: 'unavailable' }

  try {
    const offerings = await Purchases.getOfferings()
    const pkg = findProPackage(offerings)
    if (!pkg) return { status: 'error', message: 'That upgrade is not available right now.' }

    const result = await Purchases.purchasePackage({ aPackage: pkg })
    const isPro = !!result.customerInfo.entitlements.active[PRO_ENTITLEMENT]
    writeCachedPro(isPro)
    return isPro
      ? { status: 'purchased', isPro: true }
      : { status: 'error', message: 'The purchase went through but the unlock has not arrived yet.' }
  } catch (err) {
    if (isUserCancelled(err)) return { status: 'cancelled' }
    return { status: 'error', message: describeError(err) }
  }
}

/**
 * Reinstalls, new phones, cleared data. One tap, no second charge — Play knows
 * the purchase, so this is a lookup rather than a transaction.
 */
export async function restorePro(): Promise<RestoreOutcome> {
  if (!(await ensureConfigured())) return { status: 'unavailable' }
  const Purchases = await loadPurchases()
  if (!Purchases) return { status: 'unavailable' }

  try {
    const info = await Purchases.restorePurchases()
    const isPro = !!info.customerInfo.entitlements.active[PRO_ENTITLEMENT]
    writeCachedPro(isPro)
    return { status: 'restored', isPro }
  } catch (err) {
    return { status: 'error', message: describeError(err) }
  }
}

/**
 * The SDK reports a cancel as a rejection carrying userCancelled — checked
 * defensively, since the flag arrives on the error itself on some platforms and
 * nested on others, and a missed cancel shows the user an error they caused on
 * purpose.
 */
function isUserCancelled(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const e = err as { userCancelled?: boolean; code?: string | number; message?: string }
  if (e.userCancelled === true) return true
  if (typeof e.code === 'string' && e.code.toUpperCase().includes('CANCEL')) return true
  return typeof e.message === 'string' && /cancel/i.test(e.message)
}

function describeError(err: unknown): string {
  if (err && typeof err === 'object' && typeof (err as { message?: string }).message === 'string') {
    return (err as { message: string }).message
  }
  return 'Something went wrong talking to the Play Store.'
}
