/**
 * DEV ONLY — a black box for the phone.
 *
 * The phone's console is out of reach without a cable, and the bug being
 * chased (an import that lands back on the front door) wipes the page that
 * would have shown the error. So every session writes its last few events to
 * localStorage as they happen, and the next boot shows the previous session's
 * trail on screen. Never in a production build.
 */
const KEY = 'tp3d.devPhoneLog'
const PREV = 'tp3d.devPhoneLogPrev'
const MAX = 40

type Entry = string

function read(key: string): Entry[] {
  try { return JSON.parse(localStorage.getItem(key) ?? '[]') as Entry[] } catch { return [] }
}

export function phoneLog(msg: string) {
  if (!import.meta.env.DEV) return
  try {
    const t = new Date()
    const stamp = `${t.getMinutes().toString().padStart(2, '0')}:${t.getSeconds().toString().padStart(2, '0')}.${Math.floor(t.getMilliseconds() / 100)}`
    const list = read(KEY)
    list.push(`${stamp} ${msg}`)
    localStorage.setItem(KEY, JSON.stringify(list.slice(-MAX)))
  } catch { /* storage blocked */ }
}

/** The previous session's trail, read once at boot. */
export function previousPhoneLog(): Entry[] {
  return read(PREV)
}

export function startPhoneLog() {
  if (!import.meta.env.DEV) return
  try {
    localStorage.setItem(PREV, localStorage.getItem(KEY) ?? '[]')
    localStorage.setItem(KEY, '[]')
  } catch { /* storage blocked */ }
  const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
  const mem = (performance as unknown as { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } }).memory
  phoneLog(`boot (${nav?.type ?? '?'})${mem ? ` heap ${Math.round(mem.usedJSHeapSize / 1e6)}/${Math.round(mem.jsHeapSizeLimit / 1e6)} MB` : ''}`)
  window.addEventListener('error', (e) => phoneLog(`ERROR ${e.message} @ ${(e.filename ?? '').split('/').pop()}:${e.lineno}`))
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason as { message?: string } | undefined
    phoneLog(`REJECT ${r?.message ?? String(e.reason)}`)
  })
  document.addEventListener('visibilitychange', () => phoneLog(`page ${document.visibilityState}`))
  window.addEventListener('pagehide', (e) => phoneLog(`pagehide persisted=${e.persisted}`))
  window.addEventListener('beforeunload', () => phoneLog('beforeunload'))
  document.addEventListener('click', (e) => {
    const el = e.target as HTMLInputElement
    if (el instanceof HTMLInputElement && el.type === 'file') phoneLog(`file input click accept="${el.accept}"`)
  }, true)
  document.addEventListener('change', (e) => {
    const el = e.target as HTMLInputElement
    if (el instanceof HTMLInputElement && el.type === 'file') {
      const f = el.files?.[0]
      phoneLog(f ? `picked ${f.name} ${f.type} ${Math.round(f.size / 1024)} KB` : 'picked nothing')
    }
  }, true)
  // Vite asking for a full reload shows up here, not as a page event.
  if (import.meta.hot) {
    import.meta.hot.on('vite:beforeFullReload', () => phoneLog('vite full reload'))
    import.meta.hot.on('vite:beforeUpdate', () => phoneLog('vite hot update'))
  }
}
