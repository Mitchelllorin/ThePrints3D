import type { Drawing } from '../types'

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

export function buildPilotSnapshot(drawings: Drawing[]): PilotMetricRow {
  const ready = drawings.filter((d) => d.status === 'ready')
  const errored = drawings.filter((d) => d.status === 'error')
  const calibrated = drawings.filter((d) => d.scaleMmPerPx !== null)
  const images = drawings.filter((d) => d.file.type.startsWith('image/'))
  const pdfs = drawings.filter(
    (d) => d.file.type === 'application/pdf' || d.name.toLowerCase().endsWith('.pdf')
  )

  const now = new Date()
  const projectId = `AUTO-${now.toISOString().replaceAll(':', '').replaceAll('.', '')}`
  const inputType =
    pdfs.length > 0 && images.length > 0 ? 'mixed' : pdfs.length > 0 ? 'pdf' : 'image'

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
    time_to_usable_3d_min: '',
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
