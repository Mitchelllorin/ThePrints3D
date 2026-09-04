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
import { startCorpusCapture } from './services/corpusWiring'

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
  // Stroke-width normalisation, exposed so it can be measured against the real
  // corpus rather than only against synthetic test images.
  ;(window as unknown as Record<string, unknown>).__measureStroke = async (img: unknown) => {
    const { measureStroke, normalizeStrokeScale } = await import('./services/spatialNormalize')
    return { measured: measureStroke(img as never), normalized: normalizeStrokeScale(img as never) }
  }
  // Threshold sweep in canonical (stroke-normalised) space. The point is to find
  // ONE pass that matches the hand-tuned three-pass ladder, so the ladder can be
  // deleted rather than extended.
  ;(window as unknown as Record<string, unknown>).__sweep = async (img: unknown, configs: unknown[], target?: number) => {
    const { normalizeStrokeScale } = await import('./services/spatialNormalize')
    const { normalizeForDetection } = await import('./services/rasterNormalize')
    const { detectWalls } = await import('./services/wallDetector')
    const toned = normalizeForDetection(img as never)
    const base = toned.adjusted ? toned.image : (img as never)
    const norm = normalizeStrokeScale(base as never, target)
    const src = norm.image
    const image = new ImageData(
      new Uint8ClampedArray(src.data), src.width, src.height,
    )
    const rows = (configs as Record<string, number | boolean>[]).map((c) => {
      const r = detectWalls(image, c as never)
      return { cfg: c, walls: r.walls.length }
    })
    return { stroke: norm.measured.strokePx, adjusted: norm.adjusted,
             size: [image.width, image.height], inv: norm.inverseFactor, rows }
  }
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

/**
 * KEEP EVERY PRINT AND EVERY CORRECTION.
 *
 * Started before render, so a drawing that is already on screen when the app
 * comes back — or one dropped in the first second — is captured too. It only
 * ever watches the store; it changes nothing, and every failure inside it is
 * swallowed, so it cannot delay or break the workspace. See `corpus`.
 */
startCorpusCapture()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// The one-time Pro unlock, reconciled with the Play Store once the app is up.
// Deliberately after render and deliberately unawaited: the store already opened
// with the cached answer, so this can only ever improve what we know, and a slow
// or missing network must never hold up the workspace. refreshEntitlement()
// returns null when it could not ask — on the web build, or offline — and null
// leaves the cached entitlement exactly where it was.
void (async () => {
  const { refreshEntitlement } = await import('./services/billing')
  const isPro = await refreshEntitlement()
  if (isPro !== null) useAppStore.getState().setPro(isPro)
})()
