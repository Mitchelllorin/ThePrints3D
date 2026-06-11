import { useEffect } from 'react'
import { useUISettingsStore } from '../../store/useUISettingsStore'

export default function CSSVarInjector() {
  const topbarOpacity  = useUISettingsStore((s) => s.topbarOpacity)
  const sidebarOpacity = useUISettingsStore((s) => s.sidebarOpacity)
  const panelOpacity   = useUISettingsStore((s) => s.panelOpacity)
  const logoOpacity    = useUISettingsStore((s) => s.logoOpacity)
  const logoSize       = useUISettingsStore((s) => s.logoSize)
  const accentColor    = useUISettingsStore((s) => s.accentColor)

  useEffect(() => {
    const r = document.documentElement
    r.style.setProperty('--bp-topbar-opacity',  String(topbarOpacity))
    r.style.setProperty('--bp-sidebar-opacity', String(sidebarOpacity))
    r.style.setProperty('--bp-panel-opacity',   String(panelOpacity))
    r.style.setProperty('--bp-logo-opacity',    String(logoOpacity))
    r.style.setProperty('--bp-logo-scale',      String(logoSize))
    r.style.setProperty('--bp-accent',          accentColor)
  }, [topbarOpacity, sidebarOpacity, panelOpacity, logoOpacity, logoSize, accentColor])

  return null
}
