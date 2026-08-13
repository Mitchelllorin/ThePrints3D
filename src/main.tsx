import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { extend } from '@react-three/fiber'
import * as THREE from 'three'
import './index.css'
import './styles/mobile.css'
import App from './App.tsx'
import { useAppStore } from './store/useAppStore'
import { useFloorplanLocalStore } from './store/useFloorplanLocalStore'
import { useUISettingsStore } from './store/useUISettingsStore'

// Dev-only: expose the stores so verification scripts can inject state (e.g. a
// roof area) and read it back without driving the full trace UI. Stripped in prod.
if (import.meta.env.DEV) {
  ;(window as unknown as Record<string, unknown>).__appStore = useAppStore
  ;(window as unknown as Record<string, unknown>).__floorplanLocalStore = useFloorplanLocalStore
  // The finishes live here — sheathing, cladding, board, X-ray timing. Half of
  // what is worth measuring only exists once finishes are on, so verifying it
  // meant hand-driving the Settings drawer first. Now it does not.
  ;(window as unknown as Record<string, unknown>).__uiSettingsStore = useUISettingsStore
  // A ruler for the detector. Run `__scorePrints()` in the console to put all
  // four real drawing sets through the whole pipeline and print the numbers —
  // so a change to detection can be measured instead of squinted at. Loaded
  // lazily so the corpus code never reaches a production bundle.
  ;(window as unknown as Record<string, unknown>).__scorePrints = async (only?: string[]) => {
    const { scorePrints } = await import('./dev/scorePrints')
    return scorePrints(only)
  }
}

// Dev self-heal: the production build ships a PWA service worker that precaches
// the app shell. If a built/preview version was ever served on this origin, that
// service worker keeps serving the OLD cached app over the dev server — so live
// code edits (e.g. new Settings) never appear. In dev we proactively unregister
// any service worker and drop its caches so the dev server is always authoritative.
if (import.meta.env.DEV && 'serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((regs) => regs.forEach((r) => r.unregister()))
  if ('caches' in window) caches.keys().then((keys) => keys.forEach((k) => caches.delete(k)))
}

// R3F v9 requires explicit registration of Three.js classes for JSX usage.
// This registers the entire THREE namespace so elements like <mesh>,
// <boxGeometry>, <meshStandardMaterial>, etc. are recognised by the reconciler.
extend(THREE as any) // eslint-disable-line @typescript-eslint/no-explicit-any

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
