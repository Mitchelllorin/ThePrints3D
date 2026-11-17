/**
 * THE LEADERBOARD — run history and personal bests, read from the spine.
 *
 * The spine (`src/lib/fuseRecord.js`) is the family's one record of what F.U.S.E.
 * judged, and it already holds a row per verdict with an app, a subject, a level
 * and a set of metrics. Nothing is kept anywhere else: a run that is not in the
 * log did not happen, and a leaderboard that invented its own storage would be a
 * second history that drifts from the first.
 *
 * WHAT IS READ. Rows this app wrote with a `runId` — the bench writes the
 * specimen id there, so a run can always be found again by part even if its
 * label is retitled. `app` is `theprints3d`, set by the writer below; a row from
 * CircuiTry3D or TheCell3D that found its way into the log through an import is
 * not one of our runs and is skipped.
 *
 * NO RANKING ACROSS MAKERS. A personal best is per part: the heaviest total
 * load that member has been broken under, with the span it was on. The list is
 * returned in catalogue order, never sorted by score, because sorting would turn
 * "your best" into "which maker's product is better" — the one comparison the
 * bench exists to refuse. Makers did not enter a competition, and the numbers
 * are only comparable on one basis anyway.
 *
 * WHAT A BEST MEANS. The load on the member at the break, in plf — the total
 * specified load it was carrying when it reached factored resistance. Higher is
 * a bigger break, which is the only sense in which one run beats another here.
 * It is not a strength claim about the product: a longer span breaks at a
 * smaller load, and the span is printed beside every best so nobody reads it as
 * one.
 */

import { loadLog, record, type FuseRecord, type FuseRecordInput } from '../../lib/fuseRecord'
import type { BenchBreak } from './bench'

/** One run, as the log holds it and the list shows it. */
export interface BenchRun {
  id: string
  /** The specimen the run was on — the log row's runId. */
  specimenId: string
  label: string
  manufacturer: string | null
  partNumber: string | null
  /** F.U.S.E.'s name for what happened: 'Bending rupture at midspan'. */
  mode: string | null
  /** Ramp multiple at the break. */
  multiple: number
  spanFt: number
  /** Total load on the member at the break, plf. */
  loadPlf: number
  at: number
}

/** The metric keys the bench writes. Their order is part of the record. */
export const RUN_METRIC_KEYS = ['multiple', 'span', 'load'] as const

/**
 * The row the bench writes when a part reaches factored resistance.
 *
 * `level` is `failed` because it did: a strength limit state was reached. The
 * metrics carry the setting the run was on, which is what makes the history a
 * record of runs rather than of one subject's latest state, and `basis` is
 * `simulated` — this happened in the model, at numbers that are the maker's.
 */
export function benchRecordInput(
  b: BenchBreak,
  extra: { loadPlf?: number; spanFt?: number } = {},
): FuseRecordInput {
  return {
    app: 'theprints3d',
    domain: 'structural',
    subject: b.label,
    family: b.check,
    level: 'failed',
    failure: b.mode,
    metrics: [
      { key: 'multiple', rated: null, actual: b.multiple, unit: '×' },
      { key: 'span', rated: null, actual: extra.spanFt ?? b.spanFt, unit: 'ft' },
      { key: 'load', rated: null, actual: extra.loadPlf ?? b.loadPlf, unit: 'plf' },
    ],
    basis: 'simulated',
    note: `broke at ${b.multiple.toFixed(2)}× — ${formatReading(b)} against ${formatLimit(b)}`,
    runId: b.specimenId,
    manufacturer: b.manufacturer,
    partNumber: b.partNumber,
    at: b.at,
  }
}

function formatReading(b: BenchBreak): string {
  return b.readingUnit === 'psi'
    ? `${Math.round(b.reading).toLocaleString('en-CA')} psi`
    : `${Math.round(b.reading).toLocaleString('en-CA')} lb`
}

function formatLimit(b: BenchBreak): string {
  return b.limitOwner === 'maker'
    ? `${Math.round(b.limit).toLocaleString('en-CA')} ${b.readingUnit} factored resistance (maker)`
    : `${Math.round(b.limit).toLocaleString('en-CA')} ${b.readingUnit} (app)`
}

/** Write one run to the spine. Returns the whole log, newest first. */
export function recordBenchRun(storage: Storage | null | undefined, b: BenchBreak): FuseRecord[] {
  return record(storage, benchRecordInput(b))
}

function metric(rec: FuseRecord, key: string): number | null {
  const hit = rec.metrics.find((m) => m.key === key)
  return hit && Number.isFinite(hit.actual) ? hit.actual : null
}

/**
 * The bench rows out of a log, newest first.
 *
 * A row is ours when this app wrote it, it names a specimen in `runId`, and it
 * carries the ramp multiple. That last test is what keeps F.U.S.E.'s years panel
 * rows out — those are verdicts about assemblies, not runs on the bench.
 */
export function runsFrom(records: FuseRecord[]): BenchRun[] {
  const out: BenchRun[] = []
  for (const rec of records) {
    if (rec.app !== 'theprints3d') continue
    if (typeof rec.runId !== 'string' || rec.runId.length === 0) continue
    const multiple = metric(rec, 'multiple')
    if (multiple == null) continue
    out.push({
      id: rec.id,
      specimenId: rec.runId,
      label: rec.subject,
      manufacturer: rec.manufacturer,
      partNumber: rec.partNumber,
      mode: rec.failure,
      multiple,
      spanFt: metric(rec, 'span') ?? 0,
      loadPlf: metric(rec, 'load') ?? 0,
      at: rec.at,
    })
  }
  return out
}

/** Read the bench's runs straight off the device's spine. */
export function readRuns(storage: Storage | null | undefined): BenchRun[] {
  return runsFrom(loadLog(storage))
}

export interface PersonalBest {
  specimenId: string
  label: string
  /** The biggest break on this part, or null when it has never broken. */
  best: BenchRun | null
  /** How many runs this part has on the log. */
  breaks: number
}

/**
 * Personal bests, one per part, in the order given.
 *
 * The order is the catalogue's — the caller passes the roster, so the list
 * never re-sorts itself by score. A part with no runs keeps its place and says
 * so, which is what makes the list read as a set of records rather than a
 * scoreboard of whoever is winning.
 */
export function personalBests(
  records: FuseRecord[],
  parts: Array<{ id: string; label: string }>,
): PersonalBest[] {
  const runs = runsFrom(records)
  return parts.map((p) => {
    const mine = runs.filter((r) => r.specimenId === p.id)
    const best = mine.reduce<BenchRun | null>(
      (top, r) => (top == null || r.loadPlf > top.loadPlf ? r : top),
      null,
    )
    return { specimenId: p.id, label: p.label, best, breaks: mine.length }
  })
}

/** '12 Nov · 14:03' — a run's when, for a 208 px column. */
export function runWhen(at: number): string {
  const d = new Date(at)
  const day = d.getDate()
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()]
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${day} ${month} · ${hh}:${mm}`
}
