import type { Drawing } from '../types'
import { inferFloorNumber } from './sheetParser'

// ─── Session Summary ───────────────────────────────────────────────────────────

/** Scale-calibration confidence breakdown across drawings in a session. */
export interface ScaleConfidenceDistribution {
  /** Drawings whose scale was auto-detected from a notation string (e.g. "1:100"). */
  auto: number
  /** Drawings whose scale was set by the user without a recognised notation. */
  manual: number
  /** Drawings with no scale information at all. */
  none: number
}

/** Aggregated telemetry for a single processing session. */
export interface SessionSummary {
  /** Total number of sheets (drawings) in the session. */
  sheetCount: number
  /** Total detected wall segments across all ready drawings. */
  wallCount: number
  /** Number of distinct floor levels represented by the drawing set. */
  floorCount: number
  /** How scale calibration confidence is distributed across sheets. */
  scaleConfidenceDistribution: ScaleConfidenceDistribution
  /** Elapsed time from triggering "Build 3D" to the model becoming ready, in ms. */
  renderTimeMs: number
}

/**
 * Derive a {@link SessionSummary} from the current drawing set.
 *
 * @param drawings  The full drawing array from the app store.
 * @param renderTimeMs  Elapsed milliseconds between the user triggering
 *   "Build 3D" and the model status reaching `'ready'`.  Pass `0` when the
 *   render has not completed yet.
 */
export function sessionSummary(drawings: Drawing[], renderTimeMs: number): SessionSummary {
  const wallCount = drawings.reduce((sum, d) => sum + d.parsedWalls.length, 0)

  const floorSet = new Set<number>()
  for (const d of drawings) {
    const floor = d.floorNumber ?? inferFloorNumber(d.name) ?? 0
    floorSet.add(floor)
  }
  const floorCount = floorSet.size

  const scaleConfidenceDistribution: ScaleConfidenceDistribution = { auto: 0, manual: 0, none: 0 }
  for (const d of drawings) {
    if (d.scaleMmPerPx !== null && d.scaleNotation !== null) {
      scaleConfidenceDistribution.auto++
    } else if (d.scaleMmPerPx !== null) {
      scaleConfidenceDistribution.manual++
    } else {
      scaleConfidenceDistribution.none++
    }
  }

  return {
    sheetCount: drawings.length,
    wallCount,
    floorCount,
    scaleConfidenceDistribution,
    renderTimeMs,
  }
}

// ─── Pilot Metric Row (CSV schema) ────────────────────────────────────────────

export interface PilotMetricRow {
  project_id: string
  project_type: string
  input_type: string
  sheet_count: number
  upload_ok: string
  analyze_ok: string
  calibration_ok: string
  build3d_ok: string
  layers_ok: string
  measure_ok: string
  crash_or_blocker: string
  wall_correctness_pct: string
  measurement_error_pct: string
  symbol_text_false_positive_count: string
  time_to_usable_3d_min: string
  wall_count: number
  floor_count: number
  scale_confidence_auto: number
  scale_confidence_manual: number
  scale_confidence_none: number
  render_time_ms: number
  top_issue: string
  correction_made: string
  notes: string
  reviewer: string
  review_date: string
}

const HEADER_ORDER: Array<keyof PilotMetricRow> = [
  'project_id',
  'project_type',
  'input_type',
  'sheet_count',
  'upload_ok',
  'analyze_ok',
  'calibration_ok',
  'build3d_ok',
  'layers_ok',
  'measure_ok',
  'crash_or_blocker',
  'wall_correctness_pct',
  'measurement_error_pct',
  'symbol_text_false_positive_count',
  'time_to_usable_3d_min',
  'wall_count',
  'floor_count',
  'scale_confidence_auto',
  'scale_confidence_manual',
  'scale_confidence_none',
  'render_time_ms',
  'top_issue',
  'correction_made',
  'notes',
  'reviewer',
  'review_date',
]

function csvEscape(value: string | number): string {
  const text = String(value ?? '')
  if (!text.includes(',') && !text.includes('"') && !text.includes('\n')) return text
  return `"${text.replaceAll('"', '""')}"`
}

/**
 * Build a {@link PilotMetricRow} from the current drawing set.
 *
 * @param drawings     Full drawing array from the app store.
 * @param renderTimeMs Optional elapsed render time in ms (see {@link sessionSummary}).
 *                     When omitted, `render_time_ms` is recorded as `0`.
 */
export function buildPilotSnapshot(drawings: Drawing[], renderTimeMs = 0): PilotMetricRow {
  const ready = drawings.filter((d) => d.status === 'ready')
  const errored = drawings.filter((d) => d.status === 'error')
  const calibrated = drawings.filter((d) => d.scaleMmPerPx !== null)
  const images = drawings.filter((d) => d.file.type.startsWith('image/'))
  const pdfs = drawings.filter(
    (d) => d.file.type === 'application/pdf' || d.name.toLowerCase().endsWith('.pdf')
  )

  const now = new Date()
  const iso = now.toISOString()
  const compactDate = iso.slice(0, 10).replaceAll('-', '')
  const compactTime = iso.slice(11, 19).replaceAll(':', '')
  const projectId = `AUTO-${compactDate}-${compactTime}`
  const inputType =
    pdfs.length > 0 && images.length > 0 ? 'mixed' : pdfs.length > 0 ? 'pdf' : 'image'

  const summary = sessionSummary(drawings, renderTimeMs)
  const renderMin = renderTimeMs > 0 ? (renderTimeMs / 60_000).toFixed(2) : ''

  return {
    project_id: projectId,
    project_type: 'unknown',
    input_type: inputType,
    sheet_count: drawings.length,
    upload_ok: drawings.length > 0 ? 'yes' : 'no',
    analyze_ok: drawings.length > 0 && errored.length === 0 && ready.length > 0 ? 'yes' : 'no',
    calibration_ok: calibrated.length > 0 ? 'yes' : 'no',
    build3d_ok: ready.length > 0 ? 'yes' : 'no',
    layers_ok: 'manual_check',
    measure_ok: 'manual_check',
    crash_or_blocker: errored.length > 0 ? 'yes' : 'no',
    wall_correctness_pct: '',
    measurement_error_pct: '',
    symbol_text_false_positive_count: '',
    time_to_usable_3d_min: renderMin,
    wall_count: summary.wallCount,
    floor_count: summary.floorCount,
    scale_confidence_auto: summary.scaleConfidenceDistribution.auto,
    scale_confidence_manual: summary.scaleConfidenceDistribution.manual,
    scale_confidence_none: summary.scaleConfidenceDistribution.none,
    render_time_ms: summary.renderTimeMs,
    top_issue: errored.length > 0 ? 'upload_parse_failure' : '',
    correction_made: 'no',
    notes: 'Auto-generated snapshot from current drawing set.',
    reviewer: '',
    review_date: now.toISOString().slice(0, 10),
  }
}

export function serializePilotRows(rows: PilotMetricRow[]): string {
  const header = HEADER_ORDER.join(',')
  const lines = rows.map((row) => HEADER_ORDER.map((key) => csvEscape(row[key])).join(','))
  return [header, ...lines].join('\n')
}

export function downloadPilotMetricsCsv(rows: PilotMetricRow[], filename = 'pilot_metrics_export.csv') {
  const csv = serializePilotRows(rows)
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
