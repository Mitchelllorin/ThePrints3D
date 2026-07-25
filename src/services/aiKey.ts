// aiKey — own-key-on-device storage for the Ask AI brain.
//
// The user pastes THEIR OWN Anthropic API key; it lives only in this device's
// localStorage and is sent only to api.anthropic.com when they ask a question.
// No backend, no proxy — the fast path for a solo builder / demo. (For a public
// Play Store release we'd move to a tiny proxy so the key isn't on-device; this
// is the deliberate interim.)

const STORAGE_KEY = 'bp3d-anthropic-key'

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
