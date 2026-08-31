/**
 * LaunchScreen — the app's front door.
 *
 * The first thing on screen at a cold start: the canonical lockup (building
 * mark + the real 3D wordmark), one button into the workspace, and the two
 * legal links Play requires a route to. It also carries the sibling-app links,
 * because inside a packaged build there is no URL bar and this is the calmest
 * place to put them — nobody is mid-trace here.
 *
 * It is a GATE, not a menu: one obvious action, and everything else quiet
 * around the edge. Tap Launch and it is gone for the session.
 */

import { useState } from 'react'
import Logo3DBadge from '../Layout/Logo3DBadge'
import StudioCredit from '../Layout/StudioCredit'
import PrivacyPolicy from '../Legal/PrivacyPolicy'
import styles from './LaunchScreen.module.css'

export default function LaunchScreen({ onLaunch }: { onLaunch: () => void }) {
  const [showPrivacy, setShowPrivacy] = useState(false)

  if (showPrivacy) return <PrivacyPolicy onClose={() => setShowPrivacy(false)} />

  return (
    <div className={styles.screen} role="dialog" aria-modal="true" aria-label="ThePrints3D">
      <div className={styles.stack}>
        <img className={styles.mark} src="/brand/mark.svg" alt="" aria-hidden="true" />

        {/* The real extruded wordmark, not a flat copy — this is the one screen
            that exists to show the brand, so it ignores the watermark toggle. */}
        <Logo3DBadge variant="launch" />

        <p className={styles.tagline}>
          Turn 2D prints into interactive, explodable 3D models — right on your phone.
        </p>

        <button type="button" className={styles.launch} onClick={onLaunch} autoFocus>
          Launch
        </button>

        <p className={styles.legal}>
          <button type="button" className={styles.legalLink} onClick={() => setShowPrivacy(true)}>
            Privacy Policy
          </button>
          <span className={styles.sep} aria-hidden="true">·</span>
          {/* Bundled with the app, so it still opens with no signal. */}
          <a className={styles.legalLink} href="/datasafety.html" target="_blank" rel="noopener noreferrer">
            Data Safety
          </a>
        </p>

        <StudioCredit />
      </div>
    </div>
  )
}
