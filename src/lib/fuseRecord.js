/**
 * F.U.S.E.™ — the family record.
 *
 * Seven apps run F.U.S.E. (CircuiTry3D, AutoMotive3D, ElectriMotive3D,
 * TheCell3D, ThePrints3D, AnyPlanet3D, TheOcean3D). They share one grading
 * vocabulary on purpose — the same five levels, the same 35/60/80/95 bands, the
 * same 70 % derating threshold — and until this file existed, not one of them
 * kept a single sentence the engine said. A verdict was computed, shown, and
 * forgotten when the tab closed.
 *
 * This is the spine: one record shape, one level vocabulary, one merge rule, so
 * that a part dying in the arena and a wall failing on a jobsite are rows in the
 * same history and can be counted together.
 *
 * ── WHY A COPIED FILE AND NOT A PACKAGE ──────────────────────────────────────
 * Each app is its own folder, its own build and its own repo. There is no
 * registry, no monorepo workspace and no server. The family already ports
 * F.U.S.E. itself this way — a faithful port per app, carrying the same
 * thresholds so "critical" means the same thing on a wall as on an alternator.
 * So the record module is one file, byte-identical everywhere, written by
 * `sync.mjs`, which reports a hash per copy. If two copies ever differ, the hash
 * says so; there is no silent drift.
 *
 * ── THE ORIGIN PROBLEM, STATED PLAINLY ───────────────────────────────────────
 * `localStorage` is scoped to an ORIGIN. circuitry3d.app cannot read
 * theprints3d.com's storage, and the Android APK is a different origin again
 * from both. There is no shared bucket to put this in, short of a server that
 * does not exist yet. So "linked" here means:
 *
 *   • the same schema — a row from any app has the same fields in the same order
 *   • the same level vocabulary — the shared axis everything can be queried on
 *   • `mergeLogs` — imports are a UNION BY ID, so merging is idempotent and two
 *     apps' bundles combine without duplicates or ordering surprises
 *
 * A bundle is a file (or a string) that leaves one app and is imported by
 * another. That is the link. It works with no server, and the same `mergeLogs`
 * is what a server would use later, unchanged.
 *
 * ── WHAT A RECORD MUST NOT DO ────────────────────────────────────────────────
 * A rated figure is the maker's own, and `basis` says who supplied it. The level
 * is F.U.S.E.'s judgement and says `model`, never `datasheet`. Nothing here
 * rounds a number to look neat: `rated: 0.25` stays 0.25 W.
 */

export const FUSE_RECORD_VERSION = 1;

/** How many records one app keeps. Enough for months of real use, small enough
 *  that a phone's localStorage quota is never in danger. */
export const FUSE_LOG_MAX = 400;

/** Per-app store key. Every app uses this exact string. */
export const FUSE_LOG_KEY = "fuse:log:v1";

/** App id → the domain it grades. One entry per app that runs F.U.S.E. */
export const FUSE_APPS = Object.freeze({
  circuitry3d: "electrical",
  automotive3d: "mechanical",
  electrimotive3d: "drivetrain",
  thecell3d: "cellular",
  theprints3d: "structural",
  anyplanet3d: "planetary",
  theocean3d: "marine",
});

/**
 * The family scale, best → worst.
 *
 * These five words are the shared axis. A query across apps asks about `level`,
 * never about a raw score, because the cores grade on different scales — 0–100
 * in the electrical line, 0–3 in mechanical, seconds-past-limit in
 * ElectriMotive3D — and pretending they convert would invent data. `severity`
 * and `severityScale` are carried for fidelity to the app that produced them;
 * `level` is what unifies them.
 */
export const FUSE_LEVELS = Object.freeze([
  "safe",
  "stressed",
  "warning",
  "critical",
  "failed",
]);

export function levelRank(level) {
  const index = FUSE_LEVELS.indexOf(level);
  return index < 0 ? 0 : index;
}

export function isLevel(value) {
  return typeof value === "string" && FUSE_LEVELS.includes(value);
}

/**
 * The five-level mapping for the 0–100 cores — the thresholds CircuiTry3D,
 * TheCell3D, AnyPlanet3D and TheOcean3D already grade on. Provided here so the
 * arena does not restate them; the 0–3 and seconds-based apps pass `level`
 * straight through instead of being forced through this curve.
 */
export function levelFromScore(score) {
  const s = Number(score);
  if (!Number.isFinite(s)) return "safe";
  if (s >= 95) return "failed";
  if (s >= 80) return "critical";
  if (s >= 60) return "warning";
  if (s >= 35) return "stressed";
  return "safe";
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * The 0–3 cores — AutoMotive3D's mechanical port, and anything else graded on
 * OK / Stressed / Critical / Destroyed.
 *
 * At 2 those cores declare the part FAILED, so 2 is `failed` here too: if this
 * mapped it to `critical`, the shared axis would file a dead motor as merely at
 * risk, and every cross-app count of failures would be short by the one thing it
 * is counting.
 */
export function levelFromSeverity3(severity) {
  const s = Number(severity);
  if (!Number.isFinite(s) || s <= 0) return "safe";
  if (s >= 2) return "failed";
  if (s >= 1) return "critical";
  return "stressed";
}

/**
 * The four-grade construction scale — ThePrints3D's `ok / watch / critical /
 * failed`. `watch` is the same statement as `stressed`: not broken, wearing.
 */
export function levelFromRisk4(level) {
  switch (level) {
    case "failed":
      return "failed";
    case "critical":
      return "critical";
    case "watch":
      return "stressed";
    case "ok":
      return "safe";
    default:
      return "safe";
  }
}

function isMetric(value) {
  return (
    !!value &&
    typeof value === "object" &&
    typeof value.key === "string" &&
    value.key.length > 0 &&
    isFiniteNumber(value.actual) &&
    (value.rated === null || isFiniteNumber(value.rated)) &&
    typeof value.unit === "string"
  );
}

function normaliseMetric(metric) {
  return {
    key: metric.key,
    rated: metric.rated === undefined ? null : metric.rated,
    actual: metric.actual,
    unit: metric.unit,
  };
}

let counter = 0;

/**
 * `app:time36:counter+random`.
 *
 * The app prefix means an id says where it came from even after it has been
 * merged into another app's log — which matters when a row is imported and the
 * only question worth asking is "whose verdict is this?". The time component
 * sorts, and the counter plus random tail keeps two records made in the same
 * millisecond distinct.
 */
function newId(app, at) {
  counter = (counter + 1) % 1679616; // 36^4
  const seq = counter.toString(36).padStart(4, "0");
  const tail = Math.random().toString(36).slice(2, 8).padEnd(6, "0");
  return `${app}:${Math.max(0, Math.floor(at)).toString(36)}:${seq}${tail}`;
}

/**
 * Build a record. Everything except `app` and `subject` is optional, because the
 * seven domains do not measure the same things — but the SHAPE is fixed, so a
 * reader never has to ask which app wrote a field.
 *
 * @param {object} input
 * @param {string} input.app            one of FUSE_APPS
 * @param {string} [input.domain]       defaults to FUSE_APPS[app]
 * @param {string} input.subject        the part / wall / cell / shell
 * @param {string|null} [input.family]  the engine's resolved family
 * @param {string} [input.level]        one of FUSE_LEVELS
 * @param {number|null} [input.severity]
 * @param {"0-3"|"0-100"|"seconds"|null} [input.severityScale]
 * @param {string|null} [input.failure] F.U.S.E.'s name for it, null if it held
 * @param {Array<{key:string,rated:number|null,actual:number,unit:string}>} [input.metrics]
 * @param {"datasheet"|"simulated"|"model"|"measured"} [input.basis]
 * @param {string|null} [input.note]
 * @param {string|null} [input.runId]   links to the app's own run/history record
 * @param {string|null} [input.manufacturer]
 * @param {string|null} [input.partNumber]
 * @param {number} [input.at]
 */
export function makeRecord(input) {
  const source = input && typeof input === "object" ? input : {};
  const app =
    typeof source.app === "string" && source.app.length > 0
      ? source.app
      : "unknown";
  const at = isFiniteNumber(source.at) ? source.at : Date.now();
  const severity = isFiniteNumber(source.severity) ? source.severity : null;
  const level = isLevel(source.level)
    ? source.level
    : severity !== null
      ? levelFromScore(severity)
      : "safe";
  const metrics = Array.isArray(source.metrics)
    ? source.metrics.filter(isMetric).map(normaliseMetric)
    : [];

  return {
    v: FUSE_RECORD_VERSION,
    id:
      typeof source.id === "string" && source.id.length > 0
        ? source.id
        : newId(app, at),
    app,
    domain:
      typeof source.domain === "string" && source.domain.length > 0
        ? source.domain
        : (FUSE_APPS[app] ?? "unknown"),
    at,
    subject:
      typeof source.subject === "string" && source.subject.length > 0
        ? source.subject
        : "unnamed",
    family: typeof source.family === "string" ? source.family : null,
    level,
    severity,
    severityScale:
      source.severityScale === "0-3" ||
      source.severityScale === "0-100" ||
      source.severityScale === "seconds"
        ? source.severityScale
        : severity !== null
          ? "0-100"
          : null,
    failure: typeof source.failure === "string" ? source.failure : null,
    metrics,
    basis:
      source.basis === "datasheet" ||
      source.basis === "simulated" ||
      source.basis === "measured"
        ? source.basis
        : "model",
    note: typeof source.note === "string" ? source.note : null,
    runId: typeof source.runId === "string" ? source.runId : null,
    manufacturer:
      typeof source.manufacturer === "string" ? source.manufacturer : null,
    partNumber:
      typeof source.partNumber === "string" ? source.partNumber : null,
  };
}

function isRecord(value) {
  return (
    !!value &&
    typeof value === "object" &&
    isFiniteNumber(value.v) &&
    value.v === FUSE_RECORD_VERSION &&
    typeof value.id === "string" &&
    value.id.length > 0 &&
    typeof value.app === "string" &&
    typeof value.at === "number" &&
    Number.isFinite(value.at) &&
    typeof value.subject === "string" &&
    isLevel(value.level) &&
    Array.isArray(value.metrics)
  );
}

/** Oldest first? No — newest first, so the head of the log is the last thing seen. */
function sortNewestFirst(records) {
  return [...records].sort((a, b) => b.at - a.at);
}

/**
 * Add one record, newest first, dropping the oldest past `max`.
 *
 * Idempotent on `id`: re-appending a record already present is a no-op. That is
 * what makes imports safe to repeat.
 */
export function appendRecord(records, record, max = FUSE_LOG_MAX) {
  const list = Array.isArray(records) ? records.filter(isRecord) : [];
  if (!isRecord(record)) return sortNewestFirst(list).slice(0, max);
  if (list.some((existing) => existing.id === record.id)) {
    return sortNewestFirst(list).slice(0, max);
  }
  return sortNewestFirst([...list, record]).slice(0, max);
}

/**
 * Union two logs by id, newest first.
 *
 * This is the whole linking mechanism. Because ids carry the app that wrote
 * them, importing ThePrints3D's bundle into CircuiTry3D adds its rows beside the
 * arena's and keeps both — no "which one wins" question, because they are
 * different records of different events. Duplicates are impossible.
 */
export function mergeLogs(current, incoming, max = FUSE_LOG_MAX) {
  const base = Array.isArray(current) ? current.filter(isRecord) : [];
  const extra = Array.isArray(incoming) ? incoming.filter(isRecord) : [];
  if (extra.length === 0) return sortNewestFirst(base).slice(0, max);

  const seen = new Set(base.map((record) => record.id));
  const merged = [...base];
  for (const record of extra) {
    if (seen.has(record.id)) continue;
    seen.add(record.id);
    merged.push(record);
  }
  return sortNewestFirst(merged).slice(0, max);
}

/** Read the log. A corrupt or foreign payload yields an empty list, never a throw. */
export function loadLog(storage) {
  if (!storage || typeof storage.getItem !== "function") return [];
  try {
    const raw = storage.getItem(FUSE_LOG_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return sortNewestFirst(parsed.filter(isRecord)).slice(0, FUSE_LOG_MAX);
  } catch {
    return [];
  }
}

/** Write the log. A full quota must never take the app down with it. */
export function saveLog(storage, records) {
  if (!storage || typeof storage.setItem !== "function") return;
  try {
    const list = Array.isArray(records)
      ? sortNewestFirst(records.filter(isRecord)).slice(0, FUSE_LOG_MAX)
      : [];
    storage.setItem(FUSE_LOG_KEY, JSON.stringify(list));
  } catch {
    /* quota, private mode, or a storage shim that refuses — the run stands */
  }
}

/**
 * The one call an app makes: build a record, append it, persist, return the log.
 * Every app's failure site should end up calling this rather than own its own
 * read-modify-write, so capping and ordering stay identical everywhere.
 */
export function record(storage, input, max = FUSE_LOG_MAX) {
  const next = appendRecord(loadLog(storage), makeRecord(input), max);
  saveLog(storage, next);
  return next;
}

/* ── The transition guard ────────────────────────────────────────────────────
 *
 * The engines are cheap and the panels re-run them at frame rate, so the only
 * question that matters for recording is WHEN. Not every render: that fills the
 * log in seconds with the same sentence repeated. Once per CHANGE.
 *
 * The previous level is remembered per subject in memory, seeded from the log
 * the first time an app asks — so a reload does not re-file a verdict the log
 * already holds. `resetLevelCache` exists for tests and for a "sign out"
 * style clear; nothing in normal use needs it.
 */
const lastSeen = new Map();
let seeded = false;

export function resetLevelCache() {
  lastSeen.clear();
  seeded = false;
}

/**
 * Record a verdict only if it is news for that subject.
 *
 * Skipped:
 *   • the same level AND the same failure name as last time — nothing changed
 *   • a subject with no history that is simply `safe` — nothing happened yet
 *
 * Recorded:
 *   • any first move off safe, every step worse, every change of failure name,
 *     and the return to safe after trouble ("it held again"), which is half of
 *     what a history is for
 *
 * @returns the resulting log, or null when nothing was worth writing.
 */
export function recordLevelChange(storage, input, max = FUSE_LOG_MAX) {
  const source = input && typeof input === "object" ? input : {};
  const app =
    typeof source.app === "string" && source.app.length > 0
      ? source.app
      : "unknown";
  const subject =
    typeof source.subject === "string" && source.subject.length > 0
      ? source.subject
      : "unnamed";
  const key = `${app}:${subject}`;

  if (!seeded) {
    for (const row of loadLog(storage)) {
      const rowKey = `${row.app}:${row.subject}`;
      if (!lastSeen.has(rowKey)) {
        lastSeen.set(rowKey, { level: row.level, failure: row.failure });
      }
    }
    seeded = true;
  }

  const level = isLevel(source.level) ? source.level : "safe";
  const failure = typeof source.failure === "string" ? source.failure : null;
  const previous = lastSeen.get(key);

  if (previous && previous.level === level && previous.failure === failure) {
    return null;
  }
  if (!previous && level === "safe" && failure === null) {
    return null;
  }

  lastSeen.set(key, { level, failure });
  return record(storage, { ...source, level, failure }, max);
}

/** A bundle: the portable form of a log, for moving between apps. */export function exportBundle(records, options = {}) {
  const list = Array.isArray(records)
    ? sortNewestFirst(records.filter(isRecord))
    : [];
  return {
    format: "fuse-log",
    v: FUSE_RECORD_VERSION,
    app: typeof options.app === "string" ? options.app : null,
    at: isFiniteNumber(options.at) ? options.at : Date.now(),
    count: list.length,
    records: list,
  };
}

/**
 * Read a bundle from a string or an already-parsed object.
 *
 * Returns what it could accept and how many it rejected, because a half-valid
 * import should land what is good rather than nothing — and the count is what
 * lets the UI say so instead of silently dropping rows.
 */
export function parseBundle(value) {
  let payload = value;
  if (typeof value === "string") {
    try {
      payload = JSON.parse(value);
    } catch {
      return { records: [], rejected: 0 };
    }
  }
  const list = Array.isArray(payload)
    ? payload
    : payload && typeof payload === "object" && Array.isArray(payload.records)
      ? payload.records
      : null;
  if (!list) return { records: [], rejected: 0 };

  const records = list.filter(isRecord);
  return {
    records: sortNewestFirst(records).slice(0, FUSE_LOG_MAX),
    rejected: list.length - records.length,
  };
}
