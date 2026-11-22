/**
 * WHAT HAPPENED TO THE PRINT — said once, after a cold start that cut an
 * import short. See services/importTrail for how the app knows.
 *
 * Transient: it says what went wrong and what to do, and one tap puts it away.
 * It is a toast (z 30), on the bottom edge, never over the middle.
 */
import styles from './ImportNotice.module.css'

export type ImportNoticeKind = 'resumed' | 'lost-in-picker' | 'gave-up'

const COPY: Record<ImportNoticeKind, string> = {
  'resumed': 'The phone closed the app while the print was loading. Picked it back up.',
  'lost-in-picker': 'The phone closed the app while the file picker was open, so the print never arrived. Close other apps and pick it again.',
  'gave-up': 'This print closed the app twice while loading. Try a smaller photo, or a PDF of the sheet.',
}

export default function ImportNotice({ kind, onClose }: { kind: ImportNoticeKind; onClose: () => void }) {
  return (
    <div className={styles.wrap} role="status">
      <p className={styles.text}>{COPY[kind]}</p>
      <button type="button" className={styles.close} onClick={onClose} aria-label="Dismiss">✕</button>
    </div>
  )
}
