/**
 * The Pro section of Settings: what state the unlock is in, and the two things
 * you might need from it — buy it, or get it back.
 *
 * Restore lives here rather than only in the upgrade sheet on purpose. Someone
 * who has already paid, on a new phone, should not have to walk up to a price
 * tag to find the button that says "I already own this".
 */
import { useState } from 'react'
import { useAppStore } from '../../store/useAppStore'
import { useFloorplanLocalStore } from '../../store/useFloorplanLocalStore'
import { billingAvailable, restorePro } from '../../services/billing'
import { readTestUnlock, revokeTestUnlock, testUnlockAvailable, tryTestUnlock } from '../../services/testUnlock'
import { PRO_REASON_GENERAL } from './UpgradeSheet'

export default function ProSection() {
  const isPro = useAppStore((s) => s.isPro)
  const setPro = useAppStore((s) => s.setPro)
  const openUpgrade = useFloorplanLocalStore((s) => s.openUpgrade)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  // Test unlock — see services/testUnlock. Both false in a store build.
  const testUnlock = testUnlockAvailable()
  const testUnlocked = testUnlock && readTestUnlock()
  const [code, setCode] = useState('')

  const restore = async () => {
    setBusy(true)
    setNote(null)
    const result = await restorePro()
    setBusy(false)
    if (result.status === 'restored') {
      setPro(result.isPro)
      setNote(result.isPro ? 'Restored — Pro is unlocked.' : 'No previous purchase on this Google account.')
    } else if (result.status === 'unavailable') {
      setNote('Only available in the Play Store build.')
    } else {
      setNote(result.message)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12, color: '#cbd5e1' }}>
      <p style={{ margin: 0, lineHeight: 1.45 }}>
        {isPro
          ? 'Unlimited saved jobs, the full cut list and takeoff with export, the measuring tape, trade layers, and clean exports. Yours — one payment, no subscription.'
          : 'Free covers scan, draw, edit, build and explode. Pro adds unlimited saved jobs, the full cut list and takeoff with export, the measuring tape, trade layers, and exports without the watermark.'}
      </p>

      {!isPro && !testUnlocked && (
        <button
          onClick={() => openUpgrade(PRO_REASON_GENERAL)}
          style={{
            padding: '9px 12px', border: 'none', borderRadius: 9,
            background: 'var(--bp-accent, #38bdf8)', color: '#06121f',
            fontSize: 12, fontWeight: 700, cursor: 'pointer',
          }}
        >Unlock Pro</button>
      )}

      <button
        onClick={restore}
        disabled={busy || !billingAvailable()}
        style={{
          padding: '8px 12px', background: 'none',
          border: '1px solid rgba(148,163,184,0.35)', borderRadius: 9,
          color: '#cbd5e1', fontSize: 11.5, fontWeight: 700,
          cursor: busy || !billingAvailable() ? 'default' : 'pointer',
          opacity: busy || !billingAvailable() ? 0.55 : 1,
        }}
      >{busy ? 'Checking…' : 'Restore purchase'}</button>

      {/* TEST UNLOCK — a code, not a purchase. Only present in a build flagged
          with VITE_TEST_UNLOCK=1 (or the dev server); a store build compiles the
          whole row away. See services/testUnlock. */}
      {testUnlock && !testUnlocked && (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (tryTestUnlock(code)) {
              setCode('')
              setPro(true)
              setNote('Test unlock accepted — the Pro features are open.')
            } else {
              setNote('That code does not match this build.')
            }
          }}
          style={{ display: 'flex', gap: 6 }}
        >
          <input
            type="password"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Test unlock code"
            autoComplete="off"
            spellCheck={false}
            style={{
              flex: 1, minWidth: 0, padding: '8px 10px',
              background: 'rgba(15,23,42,0.6)',
              border: '1px solid rgba(148,163,184,0.35)', borderRadius: 8,
              color: '#e2e8f0', fontSize: 12,
            }}
          />
          <button
            type="submit"
            disabled={code.trim() === ''}
            style={{
              padding: '8px 12px', border: '1px dashed rgba(250,204,21,0.55)',
              background: 'none', borderRadius: 8,
              color: '#facc15', fontSize: 11, fontWeight: 700,
              cursor: code.trim() === '' ? 'default' : 'pointer',
              opacity: code.trim() === '' ? 0.5 : 1,
            }}
          >Unlock</button>
        </form>
      )}

      {testUnlocked && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <p style={{ margin: 0, fontSize: 11, color: '#facc15', lineHeight: 1.45 }}>
            Test unlock active on this build — the Pro features are open. This is
            not a Play purchase.
          </p>
          <button
            onClick={() => {
              revokeTestUnlock()
              setPro(false)
              setNote('Test unlock cleared.')
            }}
            style={{
              alignSelf: 'flex-start', padding: '6px 10px', background: 'none',
              border: '1px dashed rgba(250,204,21,0.55)', borderRadius: 8,
              color: '#facc15', fontSize: 10.5, fontWeight: 700, cursor: 'pointer',
            }}
          >Lock again</button>
        </div>
      )}

      {/* DEV ONLY — flip the entitlement by hand.
          Without this the gates are untestable on the bench: there is no Play
          Billing on the dev server, so every Pro feature opens a sheet with a
          disabled buy button and no way through. Stripped from production
          builds by import.meta.env.DEV, so it cannot become a free unlock. */}
      {import.meta.env.DEV && (
        <button
          onClick={() => setPro(!isPro)}
          style={{
            padding: '6px 10px', background: 'none',
            border: '1px dashed rgba(250,204,21,0.55)', borderRadius: 8,
            color: '#facc15', fontSize: 10.5, fontWeight: 700, cursor: 'pointer',
          }}
        >DEV: turn Pro {isPro ? 'off' : 'on'}</button>
      )}

      {note && <p style={{ margin: 0, fontSize: 11, color: '#94a3b8' }}>{note}</p>}
      {!billingAvailable() && (
        <p style={{ margin: 0, fontSize: 10.5, color: '#6b7280' }}>
          Purchases run through Google Play, so they only work in the Play Store build.
        </p>
      )}
    </div>
  )
}
