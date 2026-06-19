import { useEffect } from 'react'
import { useUISettingsStore } from '../../store/useUISettingsStore'

/** "#0f172a" → "15, 23, 42" (the r,g,b body of an rgba()). */
function hexToRgbTriplet(hex: string): string | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n))

/**
 * CSSVarInjector — pushes the appearance settings into CSS custom properties on
 * :root. It writes the *fully resolved* surface colours (e.g. "rgba(15,23,42,0.4)")
 * rather than leaving the browser to chain nested var()/calc() expressions, so a
 * change to the UI colour or opacity reliably repaints every themed surface.
 */
export default function CSSVarInjector() {
  const panelOpacity = useUISettingsStore((s) => s.panelOpacity)
  const panelColor   = useUISettingsStore((s) => s.panelColor)
  const textColor    = useUISettingsStore((s) => s.textColor)
  const textColorDim = useUISettingsStore((s) => s.textColorDim)
  const logoOpacity  = useUISettingsStore((s) => s.logoOpacity)
  const logoSize     = useUISettingsStore((s) => s.logoSize)
  const accentColor  = useUISettingsStore((s) => s.accentColor)

  useEffect(() => {
    const r = document.documentElement
    const rgb = hexToRgbTriplet(panelColor) ?? '15, 23, 42'
    const o = clamp01(panelOpacity)

    // Raw inputs (kept for anything that still references them directly).
    r.style.setProperty('--bp-panel-rgb', rgb)
    r.style.setProperty('--bp-panel-opacity', String(o))
    r.style.setProperty('--bp-topbar-opacity', String(o))
    r.style.setProperty('--bp-sidebar-opacity', String(o))

    // Fully-resolved surfaces — every chrome element references these, so
    // changing the UI colour or opacity updates the whole app at once.
    r.style.setProperty('--bp-surface',       `rgba(${rgb}, ${o})`)
    r.style.setProperty('--bp-surface-2',     `rgba(${rgb}, ${clamp01(o + 0.12)})`)
    r.style.setProperty('--bp-hover',         `rgba(${rgb}, ${clamp01(o + 0.22)})`)
    r.style.setProperty('--bp-surface-solid', `rgb(${rgb})`)
    // Borders & blur scale with opacity so surfaces go TRULY clear at 0%.
    r.style.setProperty('--bp-border',        `rgba(255, 255, 255, ${clamp01(o * 0.18)})`)
    r.style.setProperty('--bp-border-strong', `rgba(255, 255, 255, ${clamp01(o * 0.36)})`)
    r.style.setProperty('--bp-blur',          `${(o * 12).toFixed(1)}px`)

    r.style.setProperty('--bp-text', textColor)
    r.style.setProperty('--bp-text-dim', textColorDim)
    r.style.setProperty('--bp-logo-opacity', String(logoOpacity))
    r.style.setProperty('--bp-logo-scale', String(logoSize))
    r.style.setProperty('--bp-accent', accentColor)
  }, [panelOpacity, panelColor, textColor, textColorDim, logoOpacity, logoSize, accentColor])

  return null
}
