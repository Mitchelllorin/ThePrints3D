/**
 * The one place ThePrints3D's own web address lives.
 *
 * Inside the Play/APK build there is no URL bar, so a user who wants the
 * website has no way to find it. This is that way.
 *
 * The sibling apps used to be listed here too. They live in the 3D Learning
 * Family drawer now (FamilyDrawer, from the button beside Settings), the same
 * drawer in every family app.
 *
 * Containerless: no card, no border, no fill. The surface it sits on supplies
 * the background; this supplies only text.
 */

import styles from './StudioCredit.module.css'

/** This app's own site. */
const OWN_SITE = {
  label: 'theprints3d.com',
  href: 'https://theprints3d.com',
} as const

type Props = {
  className?: string
}

export default function StudioCredit({ className }: Props) {
  return (
    <div className={[styles.credit, className].filter(Boolean).join(' ')}>
      <a className={styles.site} href={OWN_SITE.href} target="_blank" rel="noopener noreferrer">
        {OWN_SITE.label}
      </a>
    </div>
  )
}
