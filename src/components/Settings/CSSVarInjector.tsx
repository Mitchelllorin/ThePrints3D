import { useEffect } from 'react'
import { useUISettingsStore } from '../../store/useUISettingsStore'

/** Writes UI settings as CSS custom properties on :root so all CSS modules pick them up. */
export default function CSSVarInjector() {
  const s = useUISettingsStore()

  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty('--bp-topbar-opacity', String(s.topbarOpacity))
    root.style.setProperty('--bp-sidebar-opacity', String(s.sidebarOpacity))
    root.style.setProperty('--bp-panel-opacity', String(s.panelOpacity))
    root.style.setProperty('--bp-logo-opacity', String(s.logoOpacity))
    root.style.setProperty('--bp-logo-scale', String(s.logoSize))
    root.style.setProperty('--bp-accent', s.accentColor)
  }, [
    s.topbarOpacity,
    s.sidebarOpacity,
    s.panelOpacity,
    s.logoOpacity,
    s.logoSize,
    s.accentColor,
  ])

  return null
}
