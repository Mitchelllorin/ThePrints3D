import { useState } from 'react'
import styles from './FeedbackButton.module.css'

const FEEDBACK_EMAIL = 'circuitry3dsim@gmail.com'

/**
 * Floating "Send feedback" button. Visible everywhere in the app.
 * Tap → opens mailto: with device info auto-filled so testers don't have
 * to describe their environment for every bug report.
 */
export default function FeedbackButton() {
  const [open, setOpen] = useState(false)

  const sendFeedback = (kind: 'bug' | 'idea' | 'praise') => {
    const v = (import.meta.env.VITE_APP_VERSION as string | undefined) ?? 'dev'
    const body = encodeURIComponent(
      `[Type] ${kind}

[What happened or what you wish would happen]


───────────────────────
Device:   ${navigator.userAgent}
Screen:   ${window.innerWidth}x${window.innerHeight}
Version:  ${v}
Time:     ${new Date().toISOString()}
URL:      ${window.location.href}`,
    )
    const subject = encodeURIComponent(`[BluePrint3D ${kind}] `)
    window.location.href = `mailto:${FEEDBACK_EMAIL}?subject=${subject}&body=${body}`
    setOpen(false)
  }

  return (
    <>
      {open && (
        <div className={styles.sheet} role="dialog" aria-label="Send feedback">
          <button className={styles.option} onClick={() => sendFeedback('bug')} data-testid="feedback-bug-btn">
            <span className={styles.optIcon}>🐞</span>
            <div>
              <div className={styles.optTitle}>Report a bug</div>
              <div className={styles.optSub}>Something didn't work right</div>
            </div>
          </button>
          <button className={styles.option} onClick={() => sendFeedback('idea')} data-testid="feedback-idea-btn">
            <span className={styles.optIcon}>💡</span>
            <div>
              <div className={styles.optTitle}>Suggest an idea</div>
              <div className={styles.optSub}>What would make this better?</div>
            </div>
          </button>
          <button className={styles.option} onClick={() => sendFeedback('praise')} data-testid="feedback-praise-btn">
            <span className={styles.optIcon}>⭐</span>
            <div>
              <div className={styles.optTitle}>I like it</div>
              <div className={styles.optSub}>Tell us what's working</div>
            </div>
          </button>
          <button className={styles.cancel} onClick={() => setOpen(false)} data-testid="feedback-cancel-btn">
            Cancel
          </button>
        </div>
      )}
      <button
        className={styles.fab}
        onClick={() => setOpen((v) => !v)}
        title="Send feedback"
        aria-label="Send feedback"
        data-testid="feedback-fab"
      >
        <span className={styles.fabIcon}>💬</span>
      </button>
    </>
  )
}
