declare module 'virtual:pwa-register' {
  export interface RegisterSWOptions {
    immediate?: boolean
    onRegisteredSW?: (swUrl: string, reg: ServiceWorkerRegistration | undefined) => void
    onRegisterError?: (error: any) => void
    onOfflineReady?: () => void
    onNeedRefresh?: () => void
  }
  export function registerSW(options?: RegisterSWOptions): (reloadPage?: boolean) => Promise<void>
}
