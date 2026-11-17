/**
 * F.U.S.E. sync — sends this app's failure records to the family collector.
 * (Same as fuse-collector/client/fuseSync.js; keep the two in step.)
 *
 * Reads the spine's log ('fuse:log:v1') and never changes it. Remembers which
 * ids the collector has accepted ('fuse:sent:v1'), so each record goes up once.
 * Offline, or the collector down: nothing is lost, the next call tries again.
 */
const LOG_KEY = 'fuse:log:v1';
const SENT_KEY = 'fuse:sent:v1';
const SENT_MAX = 2000;
const BATCH = 200;

function read(storage: Storage, key: string): unknown[] {
  try {
    const v = JSON.parse(storage.getItem(key) || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export async function syncFuseLog({
  endpoint,
  enabled,
  storage = globalThis.localStorage,
  fetch: f = globalThis.fetch,
}: {
  endpoint: string;
  enabled: boolean;
  storage?: Storage;
  fetch?: typeof fetch;
}): Promise<{ sent: number; skipped?: string }> {
  if (!enabled) return { sent: 0, skipped: 'disabled' };
  if (!endpoint || !storage || !f) return { sent: 0, skipped: 'unavailable' };
  const sent = new Set(read(storage, SENT_KEY) as string[]);
  const pending = read(storage, LOG_KEY).filter(
    (r): r is { id: string } => !!r && typeof (r as { id?: unknown }).id === 'string' && !sent.has((r as { id: string }).id),
  );
  if (pending.length === 0) return { sent: 0 };
  let total = 0;
  for (let i = 0; i < pending.length; i += BATCH) {
    const chunk = pending.slice(i, i + BATCH);
    try {
      const res = await f(endpoint.replace(/\/$/, '') + '/v1/records', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ records: chunk }),
      });
      if (!res.ok) break;
      const body = (await res.json()) as { accepted?: string[] };
      for (const id of body.accepted || []) sent.add(id);
      total += (body.accepted || []).length;
    } catch {
      break;
    }
  }
  try {
    storage.setItem(SENT_KEY, JSON.stringify([...sent].slice(-SENT_MAX)));
  } catch {
    /* quota */
  }
  return { sent: total };
}
