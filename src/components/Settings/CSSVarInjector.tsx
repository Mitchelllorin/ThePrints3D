import { useEffect } from 'react'
import { useUISettingsStore } from '../../store/useUISettingsStore'

/** "#0f172a" → "15, 23, 42" (the r,g,b body of an rgba()). */
function hexToRgbTriplet(hex: string): string | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`
}

export default function CSSVarInjector() {
  const topbarOpacity  = useUISettingsStore((s) => s.topbarOpacity)
  const sidebarOpacity = useUISettingsStore((s) => s.sidebarOpacity)
  const panelOpacity   = useUISettingsStore((s) => s.panelOpacity)
  const panelColor     = useUISettingsStore((s) => s.panelColor)
  const textColor      = useUISettingsStore((s) => s.textColor)
  const logoOpacity    = useUISettingsStore((s) => s.logoOpacity)
  const logoSize       = useUISettingsStore((s) => s.logoSize)
  const accentColor    = useUISettingsStore((s) => s.accentColor)

  useEffect(() => {
    const r = document.documentElement
    r.style.setProperty('--bp-topbar-opacity',  String(topbarOpacity))
    r.style.setProperty('--bp-sidebar-opacity', String(sidebarOpacity))
    r.style.setProperty('--bp-panel-opacity',   String(panelOpacity))
    const rgb = hexToRgbTriplet(panelColor)
    if (rgb) r.style.setProperty('--bp-panel-rgb', rgb)
    r.style.setProperty('--bp-text', textColor)
    r.style.setProperty('--bp-logo-opacity',    String(logoOpacity))
    r.style.setProperty('--bp-logo-scale',      String(logoSize))
    r.style.setProperty('--bp-accent',          accentColor)
  }, [topbarOpacity, sidebarOpacity, panelOpacity, panelColor, textColor, logoOpacity, logoSize, accentColor])

  return null
}
