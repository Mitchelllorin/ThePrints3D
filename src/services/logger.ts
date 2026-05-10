type LogLevel = 'info' | 'warn' | 'error'

interface LogRecord {
  ts: string
  level: LogLevel
  event: string
  context?: Record<string, unknown>
}

const LOG_STORAGE_KEY = 'blueprint3d.logs'
const MAX_LOG_RECORDS = 1000

function appendRecord(record: LogRecord) {
  try {
    const existingRaw = localStorage.getItem(LOG_STORAGE_KEY)
    const existing = existingRaw ? (JSON.parse(existingRaw) as LogRecord[]) : []
    existing.push(record)
    const trimmed = existing.slice(-MAX_LOG_RECORDS)
    localStorage.setItem(LOG_STORAGE_KEY, JSON.stringify(trimmed))
  } catch {
    // Best effort only.
  }
}

export function logEvent(event: string, context?: Record<string, unknown>, level: LogLevel = 'info') {
  const record: LogRecord = {
    ts: new Date().toISOString(),
    level,
    event,
    context,
  }
  appendRecord(record)

  if (level === 'error') console.error('[BluePrint3D]', record)
  else if (level === 'warn') console.warn('[BluePrint3D]', record)
  else console.info('[BluePrint3D]', record)
}

export function logError(event: string, error: unknown, context?: Record<string, unknown>) {
  const detail = error instanceof Error ? error.message : String(error)
  logEvent(event, { ...context, error: detail }, 'error')
}

export function getLogs(): LogRecord[] {
  try {
    const existingRaw = localStorage.getItem(LOG_STORAGE_KEY)
    return existingRaw ? (JSON.parse(existingRaw) as LogRecord[]) : []
  } catch {
    return []
  }
}
