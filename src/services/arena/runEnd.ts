/**
 * runEnd — the bench runs that end without a break go into the spine too.
 *
 * A break files itself (history.ts recordBenchRun). A member that carried the
 * load to the top of the ramp, or a run put away part-way, used to file
 * nothing, so the log only ever held failures and nothing could be counted
 * against anything. This files those: held or stopped, how far it got, and the
 * job it was carrying, as metrics (the collector keeps metrics; it drops the
 * free-text note and runId).
 */
import { record } from '../../lib/fuseRecord'
import type { BenchSetup } from './stress'

export function fileBenchEnd(specimenId: string | null, setup: BenchSetup, multiple: number, held: boolean): void {
  if (!specimenId || !(multiple > 1)) return
  try {
    const storage = typeof window === 'undefined' ? null : window.localStorage
    record(storage, {
      app: 'theprints3d',
      subject: specimenId,
      family: 'run',
      level: 'safe',
      severity: 0,
      severityScale: '0-100',
      failure: null,
      metrics: [
        { key: 'multiple', rated: null, actual: Math.round(multiple * 100) / 100, unit: 'x' },
        { key: held ? 'held' : 'stopped', rated: null, actual: 1, unit: 'flag' },
        { key: 'spanFt', rated: null, actual: setup.spanFt, unit: 'ft' },
        { key: 'spacingFt', rated: null, actual: setup.spacingFt, unit: 'ft' },
        { key: 'liveLoadPsf', rated: null, actual: setup.liveLoadPsf, unit: 'psf' },
        { key: 'deadLoadPsf', rated: null, actual: setup.deadLoadPsf, unit: 'psf' },
      ],
      basis: 'model',
      runId: 'bench:end',
      note: held ? `Held to ${multiple}× load.` : `Stopped at ${multiple}× load.`,
    })
  } catch {
    /* a full quota must not take the bench down */
  }
}
