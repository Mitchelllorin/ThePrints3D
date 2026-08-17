/**
 * BILLING — one purchase, forever, straight through Google Play.
 *
 * ThePrints3D sells a single non-consumable unlock, not a subscription. That
 * shapes every decision here: one product to check, no renewal, no expiry, and
 * only two verbs — buy it, and give it back to me on my new phone.
 *
 * NO MIDDLEMAN. This talks to Play Billing directly through
 * cordova-plugin-purchase (MIT, no revenue share). Google takes their standard
 * Play cut and that is the only cut there is.
 *
 * Two things a billing wrapper would otherwise have done for us, done here:
 *
 *  1. ACKNOWLEDGE THE PURCHASE. Play auto-refunds any purchase that is not
 *     acknowledged within three days. `finish()` is that acknowledgement, and
 *     forgetting it means selling something, taking the money, and quietly
 *     handing it back — the single most expensive mistake available in this
 *     file. It is called on every approved transaction, always.
 *
 *  2. CACHE THE ENTITLEMENT. A tradesperson standing in a basement with no
 *     signal has already paid, and the app must not act like they haven't. The
 *     last known answer is written to localStorage and trusted until Play
 *     contradicts it — a network failure never revokes Pro.
 *
 * Nothing here throws at the caller. Every function returns a plain result the
 * UI can act on, because billing failing is not a reason for the workspace to
 * fall over.
 */
/// <reference types="cordova-plugin-purchase" />
import { Capacitor } from '@capacitor/core'

/** Play Console product ID. Must match the console exactly. */
export const PRO_PRODUCT_ID = 'theprints3d_pro_unlock'

/** Where the last known entitlement is kept so it survives relaunch and offline. */
const CACHE_KEY = 'theprints3d.pro'

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

/**
 * The plugin publishes itself on `window` as a GLOBAL NAMESPACE — its .d.ts is
 * ambient declarations, not an ES module, so it cannot be imported. Referenced
 * through the global type instead, which is how the plugin is meant to be used
 * and keeps the native code out of the web bundle entirely.
 */
function cdv(): typeof CdvPurchase | null {
  const g = (window as unknown as { CdvPurchase?: typeof CdvPurchase }).CdvPurchase
  return g ?? null
}

let readying: Promise<boolean> | null = null
let ready = false
/**
 * Whether Play actually knows about our product.
 *
 * This is the "is there a store" signal, and it is deliberately about the
 * PRODUCT rather than the platform. Before the Play Console entry exists (or
 * while it is still in review) the store returns nothing for it — and gating
 * features behind a product nobody can buy is a broken app, not a paywall. So
 * the gates stay open until Play answers, and arm themselves the moment it
 * does, with nothing to remember at release time. See components/Pro/usePro.
 */
let productLive = false

export function billingAvailable(): boolean {
  return Capacitor.getPlatform() === 'android' && productLive
}

/** The last answer Play gave us. Survives relaunch, and outlives signal. */
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
    /* private mode, quota, storage off — not worth a crash */
  }
}

/**
 * Register the product and open the connection to Play, once per launch.
 * Concurrent callers share the one attempt rather than racing two initialize()
 * calls into the plugin.
 */
async function ensureReady(): Promise<boolean> {
  if (ready) return true
  if (Capacitor.getPlatform() !== 'android') return false
  if (readying) return readying

  readying = (async () => {
    const CP = cdv()
    if (!CP) return false
    try {
      const { store, ProductType, Platform } = CP

      store.register([{
        id: PRO_PRODUCT_ID,
        type: ProductType.NON_CONSUMABLE,
        platform: Platform.GOOGLE_PLAY,
      }])

      /**
       * THE ACKNOWLEDGEMENT PATH. An approved transaction must be finished or
       * Play refunds it after three days. There is no server-side receipt
       * check: for a one-time unlock, Play's own record of ownership IS the
       * proof, and it is re-read on every launch.
       */
      store.when()
        .approved((t) => { void t.finish() })
        .finished(() => { syncOwnership() })

      await store.initialize([Platform.GOOGLE_PLAY])
      ready = true
      syncOwnership()
      return true
    } catch {
      return false
    } finally {
      readying = null
    }
  })()

  return readying
}

/** Read ownership straight off the store's product list and cache it. */
function syncOwnership(): boolean | null {
  const CP = cdv()
  if (!CP) return null
  const product = CP.store.get(PRO_PRODUCT_ID, CP.Platform.GOOGLE_PLAY)
  if (!product) { productLive = false; return null }
  productLive = true
  const owned = !!product.owned
  writeCachedPro(owned)
  return owned
}

/**
 * Ask Play what this user owns.
 *
 * Returns null — NOT false — when the question could not be asked: no billing
 * on this platform, or the call failed. Null means "no new information", and
 * the caller keeps whatever it already believed. Returning false here would
 * mean an aircraft-mode launch silently locks a paying user out of what they
 * bought, which is the worst thing this file could do.
 */
export async function refreshEntitlement(): Promise<boolean | null> {
  if (!(await ensureReady())) return null
  try {
    return syncOwnership()
  } catch {
    return null
  }
}

/**
 * The price as Play words it — "$14.99", "£11.99", "CA$19.99" — localised and
 * currency-correct because it comes from the store, not from us. A hardcoded
 * price is a lie the moment it is read outside the country it was written in.
 */
export async function getProPrice(): Promise<Price> {
  if (!(await ensureReady())) return null
  const CP = cdv()
  if (!CP) return null
  try {
    const product = CP.store.get(PRO_PRODUCT_ID, CP.Platform.GOOGLE_PLAY)
    return product?.pricing?.price ?? null
  } catch {
    return null
  }
}

/** Buy it. A cancel is a normal outcome, not an error — close quietly. */
export async function purchasePro(): Promise<PurchaseOutcome> {
  if (!(await ensureReady())) return { status: 'unavailable' }
  const CP = cdv()
  if (!CP) return { status: 'unavailable' }

  try {
    const product = CP.store.get(PRO_PRODUCT_ID, CP.Platform.GOOGLE_PLAY)
    const offer = product?.getOffer()
    if (!offer) return { status: 'error', message: 'That upgrade is not available right now.' }

    const err = await CP.store.order(offer)
    if (err) {
      return isUserCancelled(err)
        ? { status: 'cancelled' }
        : { status: 'error', message: describeError(err) }
    }

    // order() resolves when the flow closes; ownership lands via the approved →
    // finished chain above, so re-read rather than assume.
    const owned = syncOwnership()
    return owned
      ? { status: 'purchased', isPro: true }
      : { status: 'error', message: 'The purchase went through but the unlock has not arrived yet.' }
  } catch (e) {
    return { status: 'error', message: describeError(e) }
  }
}

/**
 * Reinstalls, new phones, cleared data. One tap, no second charge — Play still
 * has the purchase on the account, so this is a lookup rather than a sale.
 */
export async function restorePro(): Promise<RestoreOutcome> {
  if (!(await ensureReady())) return { status: 'unavailable' }
  const CP = cdv()
  if (!CP) return { status: 'unavailable' }

  try {
    const err = await CP.store.restorePurchases()
    if (err) return { status: 'error', message: describeError(err) }
    return { status: 'restored', isPro: syncOwnership() === true }
  } catch (e) {
    return { status: 'error', message: describeError(e) }
  }
}

/** Play reports a user-cancelled flow as an ordinary error; it is not one. */
function isUserCancelled(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const e = err as { code?: number | string; message?: string }
  if (typeof e.code === 'number' && e.code === 6500) return true      // PAYMENT_CANCELLED
  if (typeof e.code === 'string' && e.code.toUpperCase().includes('CANCEL')) return true
  return typeof e.message === 'string' && /cancel/i.test(e.message)
}

function describeError(err: unknown): string {
  if (err && typeof err === 'object' && typeof (err as { message?: string }).message === 'string') {
    return (err as { message: string }).message
  }
  return 'Something went wrong talking to Google Play.'
}
