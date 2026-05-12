/**
 * Service-worker registration + update prompt.
 *
 * Vite-plugin-pwa generates `virtual:pwa-register` for us. We use the
 * `autoUpdate` strategy: when a new SW is detected it activates immediately
 * (skipWaiting + clientsClaim under the hood). For the user this means the
 * app refreshes seamlessly when we ship a new version while they had it open.
 */
import { registerSW } from 'virtual:pwa-register'

export function setupPwa() {
  if (!('serviceWorker' in navigator)) return

  registerSW({
    immediate: true,
    onRegisteredSW(swUrl, reg) {
      // Optional: light heartbeat in dev
      // console.log('SW registered:', swUrl, reg)
    },
    onOfflineReady() {
      console.log('[pwa] app is ready to work offline')
    },
    onNeedRefresh() {
      // We're on autoUpdate so this rarely fires, but kept for clarity.
      console.log('[pwa] new content available — refreshing')
    },
  })
}
