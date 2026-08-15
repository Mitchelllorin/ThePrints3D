/**
 * Has this person been shown around yet?
 *
 * One boolean, kept out of the stores on purpose: it has to be readable while
 * the very first frame is deciding what to offer, before any state has loaded.
 *
 * It is set when the tour STARTS, not when it finishes. Someone who takes the
 * tour and bails three steps in has made their choice — re-offering it on every
 * launch would be nagging, and the tour is still one tap away in Settings.
 */
const KEY = 'theprints3d.toured'

export function hasToured(): boolean {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    // Storage off or full. Treat as "seen" rather than showing the invitation
    // forever to someone who cannot dismiss it.
    return true
  }
}

export function markToured(): void {
  try {
    localStorage.setItem(KEY, '1')
  } catch {
    /* nothing to do — the invitation simply shows again next launch */
  }
}
