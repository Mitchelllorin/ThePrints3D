/**
 * fuseShare — when this app sends its spine to the family collector.
 *
 * The endpoint comes from the build (VITE_FUSE_ENDPOINT, set in CI once the
 * collector is deployed). With no endpoint nothing is sent and nothing breaks:
 * every run is still written to the spine on the device and goes up the first
 * time a build with the endpoint runs. 'fuse:share' = '0' turns sharing off.
 * A record says what part did what, never who was holding it.
 */
import { syncFuseLog } from './fuseSync';

const SHARE_KEY = 'fuse:share';
const EVERY_MS = 30000;

export const FUSE_ENDPOINT: string = import.meta.env?.VITE_FUSE_ENDPOINT ?? '';

export function shareEnabled(storage: Storage | undefined = globalThis.localStorage): boolean {
  try {
    return storage?.getItem(SHARE_KEY) !== '0';
  } catch {
    return true;
  }
}

export function setShareEnabled(on: boolean, storage: Storage | undefined = globalThis.localStorage): void {
  try {
    storage?.setItem(SHARE_KEY, on ? '1' : '0');
  } catch {
    /* ignore */
  }
  if (on) void syncNow();
}

let busy = false;
export async function syncNow(): Promise<{ sent: number; skipped?: string }> {
  if (busy || !FUSE_ENDPOINT) return { sent: 0, skipped: FUSE_ENDPOINT ? 'busy' : 'no endpoint' };
  busy = true;
  try {
    return await syncFuseLog({ endpoint: FUSE_ENDPOINT, enabled: shareEnabled() });
  } finally {
    busy = false;
  }
}

let started = false;
/** Start once at launch: now, every 30 s, on going to the background, and when the network comes back. */
export function startFuseSync(): void {
  if (started || typeof window === 'undefined' || !FUSE_ENDPOINT) return;
  started = true;
  void syncNow();
  window.setInterval(() => void syncNow(), EVERY_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void syncNow();
  });
  window.addEventListener('online', () => void syncNow());
}
