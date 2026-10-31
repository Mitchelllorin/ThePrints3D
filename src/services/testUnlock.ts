/**
 * TEST UNLOCK — a code that turns Pro on in a build you are testing, without a
 * purchase, and that cannot exist in the build that ships.
 *
 * Why it is needed: the Pro gates are real now, and Play is the only thing that
 * can say "owned". On the bench there is no product to buy, and on a
 * closed-testing install there is one but no way to say yes to it — so the
 * gated half of the app is unreadable exactly when it most needs reading.
 *
 * TWO CONDITIONS, BOTH AT BUILD TIME. `VITE_TEST_UNLOCK=1` flags the build, and
 * `VITE_TEST_UNLOCK_CODE` is the code. A normal `npm run build` sets neither,
 * so the flag check is false, the branch is dead, and the code is stripped with
 * it — not hidden, gone. A dev server always has it, with the code `bench`.
 *
 * The comparison lives here rather than in the UI so there is one place to
 * change it, and nothing is written to storage until a code matches.
 *
 * This is a bench tool, not an entitlement: it opens the gates, it does not
 * make the app report a Play purchase (see components/Pro/ProSection).
 */
const STORAGE_KEY = 'theprints3d.testUnlock'

function expectedCode(): string {
  const fromEnv = (import.meta.env.VITE_TEST_UNLOCK_CODE as string | undefined)?.trim() ?? ''
  if (fromEnv) return fromEnv
  // A dev server has nothing to buy, so this is mostly for an Android dev build
  // where Play can answer while the code is still ours. Never reaches a release.
  return import.meta.env.DEV ? 'bench' : ''
}

/**
 * Whether this build has a test unlock at all: it is flagged AND there is a code
 * to type. A flagged build with no code is not a backdoor, it is a switch that
 * is off.
 */
export function testUnlockAvailable(): boolean {
  const flagged = import.meta.env.DEV || import.meta.env.VITE_TEST_UNLOCK === '1'
  return flagged && expectedCode() !== ''
}

/** Whether the code has already been accepted on this device. */
export function readTestUnlock(): boolean {
  if (!testUnlockAvailable()) return false
  try {
    return localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

/** Check the code, and only on a match remember it. */
export function tryTestUnlock(input: string): boolean {
  if (!testUnlockAvailable()) return false
  if (input.trim().toLowerCase() !== expectedCode().toLowerCase()) return false
  try {
    localStorage.setItem(STORAGE_KEY, '1')
  } catch {
    /* private mode, storage off — the unlock still holds for this session */
  }
  return true
}

/** Undo it, so the locked states can be tested again without clearing site data. */
export function revokeTestUnlock(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* nothing to remove */
  }
}
