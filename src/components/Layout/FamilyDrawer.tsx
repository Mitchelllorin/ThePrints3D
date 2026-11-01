/**
 * The 3D Learning Family — its own button and its own drawer.
 *
 * The same drawer, with the same words in the same order, opens from the same
 * small button beside the gear in ThePrints3D, CircuiTry3D and AutoMotive3D.
 * src/data/family.json is the list and FamilyDrawer.css the look; both are
 * identical in all three apps, and tests/family.test.ts holds the lists
 * together. It replaced the family list that used to sit in StudioCredit at the
 * foot of Settings; StudioCredit keeps just theprints3d.com.
 *
 * Quiet on purpose: a credit and a way out to the sites, never a cross-sell. The
 * family's site in the header, the apps people can use now (each linked to its
 * own site, never a store listing), the rest by name, and who made it.
 *
 * Transient: opened by the button, gone on ✕, Escape or a tap outside it. Glass,
 * so the building stays in view behind it. Portalled to <body> so no transformed
 * ancestor in the rail can trap it.
 */

import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import family from '../../data/family.json'
import './FamilyDrawer.css'

export const FAMILY_SELF = 'ThePrints3D'

type FamilyApp = { name: string; site: string | null; line: string; live: boolean }
const APPS: FamilyApp[] = family.apps
const LIVE = APPS.filter((app) => app.live)
const SOON = APPS.filter((app) => !app.live)

type Props = {
  open: boolean
  onClose: () => void
}

export default function FamilyDrawer({ open, onClose }: Props) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <>
      <div className="fd-catch" onClick={onClose} aria-hidden="true" />
      <aside className="fd-drawer" role="dialog" aria-label={family.name}>
        <header className="fd-head">
          <h2 className="fd-title">
            <a href={family.home} target="_blank" rel="noopener noreferrer">{family.name}</a>
          </h2>
          <button type="button" className="fd-close" onClick={onClose} aria-label={`Close ${family.name}`}>✕</button>
        </header>
        <div className="fd-body">
          <ul className="fd-list">
            {LIVE.map((app) => (
              <li key={app.name}>
                {app.name === FAMILY_SELF || !app.site ? (
                  <div className="fd-row" aria-current={app.name === FAMILY_SELF ? 'page' : undefined}>
                    <span className="fd-name">{app.name}</span>
                    <span className="fd-line">{app.line}</span>
                    {app.name === FAMILY_SELF && <span className="fd-here">You&rsquo;re here</span>}
                  </div>
                ) : (
                  <a className="fd-row fd-row--link" href={app.site} target="_blank" rel="noopener noreferrer">
                    <span className="fd-name">{app.name}</span>
                    <span className="fd-line">{app.line}</span>
                  </a>
                )}
              </li>
            ))}
          </ul>
          {/* Not out yet: by name only, no link. */}
          <ul className="fd-list fd-list--soon">
            {SOON.map((app) => (
              <li key={app.name} className="fd-row fd-row--soon">{app.name}</li>
            ))}
          </ul>
        </div>
        <p className="fd-foot">By {family.maker}</p>
      </aside>
    </>,
    document.body,
  )
}

/** Three stacked layers — the family mark, the same one on every family site. */
export function FamilyGlyph() {
  return (
    <svg
      viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor"
      strokeWidth="1.6" strokeLinejoin="round" aria-hidden
    >
      <path d="M12 3 21 7 12 11 3 7Z" />
      <path d="M3 12 12 16 21 12" />
      <path d="M3 17 12 21 21 17" />
    </svg>
  )
}
