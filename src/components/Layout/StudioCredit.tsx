/**
 * The one place ThePrints3D's own web address — and its sibling apps' — live.
 *
 * Inside the Play/APK build there is no URL bar, so a user who wants the
 * website has no way to find it. This is that way.
 *
 * "More from the 3D family" is the same list, in the same order, with the same
 * one-liners as CircuiTry3D's help sheet. Every sibling links to its own site,
 * never its store listing. ThePrints3D is listed but not linked, so the set
 * reads as complete. A sibling with no live site yet is listed without a link.
 *
 * Containerless: no card, no border, no fill. The surface it sits on supplies
 * the background; this supplies only text.
 */

import styles from './StudioCredit.module.css'

/** This app's own site — shown above the family list in the "full" variant. */
const OWN_SITE = {
  label: 'theprints3d.com',
  href: 'https://theprints3d.com',
} as const

type SiblingApp = {
  name: string
  line: string
  /** The app's own site. Omit until it is live. */
  href?: string
  current?: boolean
}

const FAMILY: SiblingApp[] = [
  { name: 'CircuiTry3D', line: 'Circuits in 3D, and what happens when they fail.', href: 'https://circuitry3d.app' },
  { name: 'ThePrints3D', line: 'Drawing sets turned into a 3D building, layer by layer.', current: true },
  { name: 'AutoMotive3D', line: 'An engine you can take apart.', href: 'https://automotive3d.ca' },
  { name: 'AnyBody3D', line: 'The human body, in 3D.' },
  { name: 'TheCell3D', line: 'A cell you can take apart.' },
  { name: 'ThePyramids3D', line: 'The pyramids, taken apart course by course.' },
  { name: 'AnyPlanet3D', line: 'A planet you can take apart, core to sky.' },
  { name: 'LearnIT3D', line: 'Trade courses — Electrical Foundations, HVAC Apprentice Prep.' },
]

type Props = {
  className?: string
  /** "full" is the site link plus the family list; "site" is the site link alone. */
  variant?: 'full' | 'site'
}

export default function StudioCredit({ className, variant = 'full' }: Props) {
  return (
    <div className={[styles.credit, className].filter(Boolean).join(' ')}>
      <a className={styles.site} href={OWN_SITE.href} target="_blank" rel="noopener noreferrer">
        {OWN_SITE.label}
      </a>

      {variant === 'full' && (
        <>
          <p className={styles.lead}>More from the 3D family</p>
          <ul className={styles.list}>
            {FAMILY.map((app) => (
              <li key={app.name} className={styles.item}>
                {app.href && !app.current ? (
                  <a className={styles.appLink} href={app.href} target="_blank" rel="noopener noreferrer">
                    {app.name}
                  </a>
                ) : (
                  <span className={styles.appName}>{app.name}</span>
                )}
                <span className={styles.line}>
                  {app.line}
                  {app.current ? " You're here." : !app.href ? ' Coming.' : ''}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
