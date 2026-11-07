/**
 * Types for fuseRecord.js.
 *
 * The implementation is the single JS file beside this one — copied into every
 * app by sync.mjs — and this declaration is the typed face of it for the
 * TypeScript apps (CircuiTry3D, ThePrints3D). Keep the two in step: the shapes
 * here and the objects `makeRecord` returns are the same shape.
 */

export type FuseLevel = "safe" | "stressed" | "warning" | "critical" | "failed";

export type FuseSeverityScale = "0-3" | "0-100" | "seconds";

export type FuseMetric = {
  key: string;
  rated: number | null;
  actual: number;
  unit: string;
};

export type FuseBasis = "datasheet" | "simulated" | "model" | "measured";

export type FuseRecord = {
  v: number;
  id: string;
  app: string;
  domain: string;
  at: number;
  subject: string;
  family: string | null;
  level: FuseLevel;
  severity: number | null;
  severityScale: FuseSeverityScale | null;
  failure: string | null;
  metrics: FuseMetric[];
  basis: FuseBasis;
  note: string | null;
  runId: string | null;
  manufacturer: string | null;
  partNumber: string | null;
};

export type FuseRecordInput = {
  app: string;
  subject: string;
  domain?: string;
  family?: string | null;
  level?: FuseLevel;
  severity?: number | null;
  severityScale?: FuseSeverityScale | null;
  failure?: string | null;
  metrics?: FuseMetric[];
  basis?: FuseBasis;
  note?: string | null;
  runId?: string | null;
  manufacturer?: string | null;
  partNumber?: string | null;
  at?: number;
  id?: string;
};

export type FuseLogBundle = {
  format: "fuse-log";
  v: number;
  app: string | null;
  at: number;
  count: number;
  records: FuseRecord[];
};

export const FUSE_RECORD_VERSION: number;
export const FUSE_LOG_MAX: number;
export const FUSE_LOG_KEY: string;
export const FUSE_APPS: Readonly<Record<string, string>>;
export const FUSE_LEVELS: readonly FuseLevel[];

export function levelRank(level: string): number;
export function isLevel(value: unknown): value is FuseLevel;
export function levelFromScore(score: number): FuseLevel;
/** The 0–3 cores (AutoMotive3D). 2 is that scale's failure, so 2 is `failed`. */
export function levelFromSeverity3(severity: number): FuseLevel;
/** The four-grade construction scale (ThePrints3D): watch → stressed. */
export function levelFromRisk4(
  level: "ok" | "watch" | "critical" | "failed" | string,
): FuseLevel;

export function makeRecord(input: FuseRecordInput): FuseRecord;
export function appendRecord(
  records: FuseRecord[],
  record: FuseRecord,
  max?: number,
): FuseRecord[];
export function mergeLogs(
  current: FuseRecord[],
  incoming: FuseRecord[],
  max?: number,
): FuseRecord[];

export function loadLog(storage: Storage | null | undefined): FuseRecord[];
export function saveLog(
  storage: Storage | null | undefined,
  records: FuseRecord[],
): void;
export function record(
  storage: Storage | null | undefined,
  input: FuseRecordInput,
  max?: number,
): FuseRecord[];

/** Forget the in-memory previous-level cache. Tests, and a full clear. */
export function resetLevelCache(): void;

/**
 * Record only when the verdict is news for that subject: a change of level or of
 * failure name. Returns null when nothing was worth writing.
 */
export function recordLevelChange(
  storage: Storage | null | undefined,
  input: FuseRecordInput,
  max?: number,
): FuseRecord[] | null;

export function exportBundle(  records: FuseRecord[],
  options?: { app?: string | null; at?: number },
): FuseLogBundle;

export function parseBundle(value: unknown): {
  records: FuseRecord[];
  rejected: number;
};
