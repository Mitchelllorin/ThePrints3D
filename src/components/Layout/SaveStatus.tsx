/**
 * A SAVE THAT FAILED HAS TO SAY SO — ANYWHERE IN THE APP.
 *
 * The autosave is meant to be invisible, and while it works it is: nothing here
 * renders. The failure is the case that matters. It used to be swallowed inside
 * `flushJob`, so a device out of room looked exactly like a saved job right up
 * until the app was reopened and the work was gone.
 *
 * This sits in the shell above the workspace, in normal flow rather than as a
 * floating toast: a failed save is worth one line of layout shifting, and an
 * overlay could end up behind a drawer or under a thumb. It clears itself on the
 * next successful save, and remembers being dismissed so a device that stays
 * full does not nag on every keystroke.
 */
import { useEffect, useState } from 'react'
import { onJobSaveState, readSaveState } from '../../services/currentJob'
import styles from './SaveStatus.module.css'

export default function SaveStatus({ onOpenJobs }: { onOpenJobs: () => void }) {
  const [message, setMessage] = useState<string | null>(() => {
    const state = readSaveState()
    return state?.status === 'error' ? state.message : null
  })
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => onJobSaveState((state) => {
    if (state.status === 'error') {
      setMessage(state.message)
      return
    }
    // Saved again: the warning is no longer true, and the next failure should be
    // allowed to speak even though this one was dismissed.
    setMessage(null)
    setDismissed(false)
  }), [])

  if (!message || dismissed) return null

  return (
    <div className={styles.strip} role="alert">
      <span className={styles.mark} aria-hidden>!</span>
      <span className={styles.text}>{message}</span>
      <button className={styles.action} onClick={onOpenJobs}>Jobs</button>
      <button
        className={styles.dismiss}
        onClick={() => setDismissed(true)}
        aria-label="Dismiss the save warning"
      >
        ×
      </button>
    </div>
  )
}
