/**
 * UPGRADE — what Pro is, what it costs, and one button.
 *
 * Deliberately NOT a centred modal. The workspace rule in this app is absolute:
 * the middle of the screen belongs to the model, and chrome lives on the
 * perimeter. So the pitch arrives as a slim sheet on the bottom edge, capped
 * well short of the model, and it says what the user just reached for rather
 * than opening with a generic sales page — they tapped a specific locked thing,
 * and the answer should be about that thing.
 *
 * The price is never written down here. It is read from the store offering, so
 * it is localised, current, and correct in every country. Until it arrives the
 * button says "Unlock Pro" and nothing else — better silent than wrong.
 */
import { useEffect, useState } from 'react'
import { useAppStore } from '../../store/useAppStore'
import { useFloorplanLocalStore } from '../../store/useFloorplanLocalStore'
import { billingAvailable, getProPrice, purchasePro, restorePro } from '../../services/billing'
import styles from './UpgradeSheet.module.css'

/** What the unlock buys. Kept short — a list you can read at arm's length. */
const PRO_FEATURES = [
  'Unlimited saved projects',
  'Full material takeoff, with CSV export',
  'Edit and refine walls, and the measuring tape',
  'Trade layers and product placement',
  'Exports without the watermark',
]

type Busy = null | 'buying' | 'restoring'

export default function UpgradeSheet() {
  const reason = useFloorplanLocalStore((s) => s.upgradeReason)
  const closeUpgrade = useFloorplanLocalStore((s) => s.closeUpgrade)
  const setPro = useAppStore((s) => s.setPro)
  const [price, setPrice] = useState<string | null>(null)
  const [busy, setBusy] = useState<Busy>(null)
  const [note, setNote] = useState<string | null>(null)

  const open = reason !== null

  // Ask the store what it costs, but only once the sheet is actually open —
  // there is no reason to talk to billing during a trace.
  useEffect(() => {
    if (!open) return
    let live = true
    void getProPrice().then((p) => {
      if (live) setPrice(p)
    })
    return () => {
      live = false
    }
  }, [open])

  // Escape closes it, like every other surface here.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeUpgrade()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, closeUpgrade])

  if (!open) return null

  const buy = async () => {
    setBusy('buying')
    setNote(null)
    const result = await purchasePro()
    setBusy(null)
    if (result.status === 'purchased') {
      setPro(true)
      closeUpgrade()
    } else if (result.status === 'cancelled') {
      // Their decision, not a failure. Close quietly rather than apologise.
      closeUpgrade()
    } else if (result.status === 'unavailable') {
      setNote('The Play Store is not reachable from this build.')
    } else {
      setNote(result.message)
    }
  }

  const restore = async () => {
    setBusy('restoring')
    setNote(null)
    const result = await restorePro()
    setBusy(null)
    if (result.status === 'restored' && result.isPro) {
      setPro(true)
      closeUpgrade()
    } else if (result.status === 'restored') {
      setNote('No previous purchase found on this Google account.')
    } else if (result.status === 'unavailable') {
      setNote('The Play Store is not reachable from this build.')
    } else {
      setNote(result.message)
    }
  }

  return (
    <div className={styles.sheet} role="dialog" aria-label="Unlock Pro">
      <div className={styles.head}>
        <span className={styles.reason}>{reason} is part of Pro</span>
        <button className={styles.close} onClick={closeUpgrade} aria-label="Close">✕</button>
      </div>

      <ul className={styles.list}>
        {PRO_FEATURES.map((f) => (
          <li key={f} className={styles.item}>{f}</li>
        ))}
      </ul>

      <div className={styles.actions}>
        <button className={styles.buy} onClick={buy} disabled={busy !== null || !billingAvailable()}>
          {busy === 'buying' ? 'Opening Play…' : price ? `Unlock Pro — ${price}` : 'Unlock Pro'}
        </button>
        <button className={styles.restore} onClick={restore} disabled={busy !== null || !billingAvailable()}>
          {busy === 'restoring' ? 'Checking…' : 'Restore purchase'}
        </button>
      </div>

      <p className={styles.terms}>
        {billingAvailable()
          ? 'One payment, yours for good. No subscription.'
          : 'Buying is only available in the Play Store build.'}
      </p>
      {note && <p className={styles.note}>{note}</p>}
    </div>
  )
}
