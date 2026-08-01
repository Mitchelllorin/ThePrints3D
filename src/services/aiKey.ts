// aiKey — own-key-on-device storage for the Ask AI brain.
//
// The user pastes THEIR OWN free Google AI Studio (Gemini) key; it lives only in
// this device's localStorage and is sent only to Google when they ask a
// question. Gemini's free tier needs no credit card. No backend/proxy — the fast
// path for a solo builder / demo. (For a public release we'd move to a tiny
// proxy so the key isn't on-device; this is the deliberate interim.)

const STORAGE_KEY = 'bp3d-ai-key'

/**
 * A DEV-ONLY key from .env.local, so you stop retyping it.
 *
 * localStorage is per ORIGIN: http://localhost:5180 and http://192.168.1.63:5180
 * are different stores, so testing on desktop and then on the phone over the
 * network asked for the key twice, and clearing site data lost it again. For a
 * solo builder running the dev server all day that is pure friction.
 *
 * Put VITE_GEMINI_API_KEY in .env.local (already gitignored) and the dev build
 * picks it up with nothing to paste, on either origin.
 *
 * DEV ONLY, deliberately. import.meta.env inlines the value into the bundle at
 * build time, so honouring this in a production build would ship your key to
 * everyone who loads the app. Released builds keep asking for a key on the
 * device, which is the existing behaviour and the safe one.
 */
function devKey(): string {
  try {
    if (!import.meta.env.DEV) return ''
    return (import.meta.env.VITE_GEMINI_API_KEY as string | undefined)?.trim() ?? ''
  } catch {
    return ''
  }
}

export function getAiKey(): string {
  try {
    // A key pasted on the device still wins — you can override the dev default
    // without editing a file and restarting Vite.
    return localStorage.getItem(STORAGE_KEY) || devKey()
  } catch {
    return devKey()
  }
}

export function setAiKey(value: string): void {
  try {
    const v = value.trim()
    if (v) localStorage.setItem(STORAGE_KEY, v)
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* ignore */
  }
}

export function hasAiKey(): boolean {
  return getAiKey().length > 0
}
