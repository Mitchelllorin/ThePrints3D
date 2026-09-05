/**
 * The one place ThePrints3D's own web address — and its sibling apps' — live.
 *
 * Inside the Play/APK build there is no URL bar, so a user who wants the
 * website has no way to find it. This is that way. It doubles as the studio
 * credit: CircuiTry3D and Automotive3D are the same maker, not sponsors, so
 * they read as one quiet "from the makers of" line, never a second call to
 * action competing with Build.
 *
 * Containerless by house rule: no card, no border, no fill. The surface it
 * sits on supplies the background; this supplies only text.
 *
 * A store link is only rendered once that app is actually published — a link
 * to a listing that isn't live yet is worse than no link at all. Flip `store`
 * on when the listing goes live; that is the only edit needed.
 */

import styles from './StudioCredit.module.css'

const playUrl = (pkg: string) => `https://play.google.com/store/apps/details?id=${pkg}`

/** This app's own site — shown above the credit in the "full" variant. */
const OWN_SITE = {
  label: 'theprints3d.com',
  href: 'https://theprints3d.com',
} as const

type SiblingApp = {
  name: string
  site: string
  href: string
  /** Play Store package, once the listing is public. Omit until it is. */
  store?: string
  /** Shown in place of a store link while the listing is still private. */
  storeNote?: string
}

const SIBLING_APPS: SiblingApp[] = [
  {
    name: 'CircuiTry3D',
    site: 'circuitry3d.app',
    href: 'https://circuitry3d.app',
    store: 'com.circuitry3d.app',
  },
  {
    name: 'Automotive3D',
    site: 'automotive3d.ca',
    href: 'https://automotive3d.ca',
    // Listing lands shortly — swap the note for `store: 'com.automotive3d.app'`.
    storeNote: 'on Google Play soon',
  },
]

type Props = {
  className?: string
  /** "full" leads with this app's own site; "credit" is the sibling line alone. */
  variant?: 'full' | 'credit'
}

export default function StudioCredit({ className, variant = 'full' }: Props) {
  return (
    <div className={[styles.credit, className].filter(Boolean).join(' ')}>
      {variant === 'full' && (
        <a className={styles.site} href={OWN_SITE.href} target="_blank" rel="noopener noreferrer">
          {OWN_SITE.label}
        </a>
      )}

      <p className={styles.lead}>From the makers of</p>

      <ul className={styles.list}>
        {SIBLING_APPS.map((app) => (
          <li key={app.href} className={styles.item}>
            <span className={styles.appName}>{app.name}</span>
            {/* One ROW of links, not a stack. On phones mobile.css gives every
                a[href] a 44px minimum box; stacked, two of those turned this
                into a wall of whitespace. Side by side they share one row. */}
            <span className={styles.links}>
              <a className={styles.metaLink} href={app.href} target="_blank" rel="noopener noreferrer">
                {app.site}
              </a>
              {app.store ? (
                <a
                  className={styles.metaLink}
                  href={playUrl(app.store)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Google Play
                </a>
              ) : (
                <span className={styles.metaSoon}>{app.storeNote}</span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
