import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { extend } from '@react-three/fiber'
import * as THREE from 'three'
import './index.css'
import './styles/mobile.css'
import App from './App.tsx'

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
