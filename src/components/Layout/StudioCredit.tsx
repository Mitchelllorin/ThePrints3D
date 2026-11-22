/**
 * The one place ThePrints3D's own web address lives, plus the sibling line.
 *
 * Inside the Play/APK build there is no URL bar, so a user who wants the
 * website has no way to find it. This is that way. It doubles as the studio
 * credit: the other apps are the same maker, not sponsors, so they read as one
 * quiet "from the makers of" line rather than a second call to action.
 *
 * The three names are this app's siblings — never itself — and each one links
 * to that app's own site, never to a store listing. The addresses come from
 * data/family.json, the same list the family drawer reads, so the two can never
 * disagree about where a sibling lives.
 *
 * Containerless: no card, no border, no fill. The surface it sits on supplies
 * the background; this supplies only text.
 */

import family from '../../data/family.json'
import styles from './StudioCredit.module.css'

/** This app's own site. */
const OWN_SITE = {
  label: 'theprints3d.com',
  href: 'https://theprints3d.com',
} as const

/** This app, in family.json. The list below leaves it out. */
const SELF = 'ThePrints3D'
/** The siblings that ship: same four apps, same order, on every landing page. */
const SIBLINGS = ['CircuiTry3D', 'AutoMotive3D', 'TheCell3D']

type FamApp = { name: string; site: string | null }
const APPS = (family.apps as FamApp[]).filter(
  (app): app is { name: string; site: string } =>
    Boolean(app.site) && app.name !== SELF && SIBLINGS.includes(app.name),
)

type Props = {
  className?: string
}

export default function StudioCredit({ className }: Props) {
  return (
    <div className={[styles.credit, className].filter(Boolean).join(' ')}>
      <a className={styles.site} href={OWN_SITE.href} target="_blank" rel="noopener noreferrer">
        {OWN_SITE.label}
      </a>
      <p className={styles.makers}>
        <span className={styles.lead}>From the makers of </span>
        {APPS.map((app, index) => (
          <span key={app.name}>
            {index > 0 && (
              <span className={styles.sep} aria-hidden="true">
                {' · '}
              </span>
            )}
            <a className={styles.makerLink} href={app.site} target="_blank" rel="noopener noreferrer">
              {app.name}
            </a>
          </span>
        ))}
      </p>
    </div>
  )
}
