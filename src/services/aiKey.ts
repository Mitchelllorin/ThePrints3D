// aiKey — own-key-on-device storage for the Ask AI brain.
//
// The user pastes THEIR OWN free Google AI Studio (Gemini) key; it lives only in
// this device's localStorage and is sent only to Google when they ask a
// question. Gemini's free tier needs no credit card. No backend/proxy — the fast
// path for a solo builder / demo. (For a public release we'd move to a tiny
// proxy so the key isn't on-device; this is the deliberate interim.)

const STORAGE_KEY = 'bp3d-ai-key'

export function getAiKey(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? ''
  } catch {
    return ''
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
