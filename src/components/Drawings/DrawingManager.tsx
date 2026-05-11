import { useState } from 'react'
import { useAppStore } from '../../store/useAppStore'
import type { Drawing, DrawingType } from '../../types'
import ScaleCalibrator from './ScaleCalibrator'
import { buildPilotSnapshot, downloadPilotMetricsCsv } from '../../services/pilotMetrics'
import { logEvent } from '../../services/logger'
import styles from './DrawingManager.module.css'

const DRAWING_TYPES: { value: DrawingType; label: string }[] = [
  { value: 'floor-plan', label: 'Floor Plan' },
  { value: 'rcp', label: 'RCP' },
  { value: 'architectural', label: 'Architectural' },
  { value: 'structural', label: 'Structural' },
  { value: 'electrical', label: 'Electrical' },
  { value: 'plumbing', label: 'Plumbing' },
  { value: 'mechanical', label: 'Mechanical / HVAC' },
  { value: 'civil', label: 'Civil' },
  { value: 'other', label: 'Other' },
]

const TYPE_COLORS: Record<DrawingType, string> = {
  'floor-plan': '#38bdf8',
  rcp: '#a78bfa',
  architectural: '#34d399',
  structural: '#94a3b8',
  electrical: '#fbbf24',
  plumbing: '#60a5fa',
  mechanical: '#c084fc',
  civil: '#f97316',
  other: '#64748b',
}

const STATUS_ICON: Record<string, string> = {
  pending: '⏳',
  processing: '⚙',
  ready: '✓',
  error: '✗',
}

export default function DrawingManager() {
  const drawings = useAppStore((s) => s.drawings)
  const removeDrawing = useAppStore((s) => s.removeDrawing)
  const setDrawingType = useAppStore((s) => s.setDrawingType)
  const selectDrawing = useAppStore((s) => s.selectDrawing)
  const selectedDrawingId = useAppStore((s) => s.selectedDrawingId)
  const buildModel = useAppStore((s) => s.buildModel)
  const processDrawing = useAppStore((s) => s.processDrawing)
  const setDrawingScale = useAppStore((s) => s.setDrawingScale)

  const [calibratingId, setCalibratingId] = useState<string | null>(null)
  const selected = drawings.find((d) => d.id === selectedDrawingId) ?? null
  const calibrating = drawings.find((d) => d.id === calibratingId) ?? null

  const processAll = () => {
    for (const d of drawings) {
      if (d.status === 'pending') processDrawing(d.id)
    }
  }

  const exportPilotMetrics = () => {
    const snapshot = buildPilotSnapshot(drawings)
    downloadPilotMetricsCsv([snapshot])
    logEvent('pilot.metrics.exported', {
      drawingCount: drawings.length,
      readyCount: drawings.filter((d) => d.status === 'ready').length,
    })
  }

  const anyPending = drawings.some((d) => d.status === 'pending')
  const anyProcessing = drawings.some((d) => d.status === 'processing')
  const readyCount = drawings.filter((d) => d.status === 'ready').length

  return (
    <div className={styles.page}>
      <div className={styles.list}>
        <div className={styles.listHeader}>
          <h2 className={styles.listTitle}>Drawing Set ({drawings.length})</h2>
          <div className={styles.listActions}>
            {anyPending && !anyProcessing && (
              <button className={styles.processBtn} onClick={processAll} title="Process all unprocessed drawings">
                ⚙ Analyse All
              </button>
            )}
            {anyProcessing && (
              <span className={styles.processingBadge}>⚙ Analysing…</span>
            )}
            <button className={styles.buildBtn} onClick={buildModel}>
              ⬡ Build 3D
            </button>
            <button className={styles.processBtn} onClick={exportPilotMetrics} title="Export pilot metrics CSV">
              ⬇ Export Pilot CSV
            </button>
          </div>
        </div>

        {readyCount > 0 && (
          <div className={styles.readySummary}>
            {readyCount} drawing{readyCount !== 1 ? 's' : ''} analysed — {drawings.reduce((n, d) => n + d.parsedWalls.length, 0)} wall segments detected
            {(() => {
              const totals = drawings.reduce(
                (acc, d) => {
                  const s = d.lineClassificationStats
                  if (!s) return acc
                  acc.dimension += s.dimension
                  acc.dashed += s.dashed
                  acc.dotted += s.dotted
                  acc.leader += s.leader
                  acc.unknown += s.unknown
                  return acc
                },
                { dimension: 0, dashed: 0, dotted: 0, leader: 0, unknown: 0 },
              )
              const filteredTotal = totals.dimension + totals.dashed + totals.dotted + totals.leader + totals.unknown
              if (filteredTotal === 0) return null
              return (
                <span style={{ display: 'block', marginTop: 6, fontSize: 12, opacity: 0.85 }}>
                  Filtered out:{' '}
                  {totals.dimension > 0 && <span style={{ marginRight: 8 }}>{totals.dimension} dimension</span>}
                  {totals.dashed > 0 && <span style={{ marginRight: 8 }}>{totals.dashed} dashed</span>}
                  {totals.dotted > 0 && <span style={{ marginRight: 8 }}>{totals.dotted} dotted/overhead</span>}
                  {totals.leader > 0 && <span style={{ marginRight: 8 }}>{totals.leader} leader/short</span>}
                  {totals.unknown > 0 && <span style={{ marginRight: 8 }}>{totals.unknown} unclassified</span>}
                </span>
              )
            })()}
          </div>
        )}

        <div className={styles.cards}>
          {drawings.map((d) => (
            <DrawingCard
              key={d.id}
              drawing={d}
              isSelected={d.id === selectedDrawingId}
              onSelect={() => selectDrawing(d.id === selectedDrawingId ? null : d.id)}
              onRemove={() => removeDrawing(d.id)}
              onTypeChange={(type) => setDrawingType(d.id, type)}
              onProcess={() => processDrawing(d.id)}
            />
          ))}
        </div>
      </div>

      <div className={styles.preview}>
        {selected ? (
          <DrawingPreview
            drawing={selected}
            onProcess={() => processDrawing(selected.id)}
            onCalibrate={() => setCalibratingId(selected.id)}
          />
        ) : (
          <div className={styles.noSelection}>
            <span>👆</span>
            <p>Select a drawing to preview it</p>
          </div>
        )}
      </div>

      {calibrating && (
        <ScaleCalibrator
          imageUrl={calibrating.rasterUrl ?? calibrating.previewUrl ?? ''}
          imageWidth={calibrating.rasterWidth ?? 800}
          imageHeight={calibrating.rasterHeight ?? 600}
          existingMmPerPx={calibrating.scaleMmPerPx}
          onCalibrate={(mmPerPx, notation) => {
            setDrawingScale(calibrating.id, mmPerPx, notation)
            setCalibratingId(null)
          }}
          onClose={() => setCalibratingId(null)}
        />
      )}
    </div>
  )
}

interface CardProps {
  drawing: Drawing
  isSelected: boolean
  onSelect: () => void
  onRemove: () => void
  onTypeChange: (type: DrawingType) => void
  onProcess: () => void
}

function DrawingCard({ drawing, isSelected, onSelect, onRemove, onTypeChange, onProcess }: CardProps) {
  return (
    <div
      className={`${styles.card} ${isSelected ? styles.cardSelected : ''}`}
      onClick={onSelect}
    >
      <div
        className={styles.cardThumb}
        style={{ borderLeftColor: TYPE_COLORS[drawing.type] }}
      >
        {(drawing.rasterUrl ?? drawing.previewUrl) && (
          <img src={drawing.rasterUrl ?? drawing.previewUrl!} alt={drawing.name} className={styles.thumb} />
        )}
        <span
          className={`${styles.statusDot} ${styles['status_' + drawing.status]}`}
          title={drawing.status}
        >
          {STATUS_ICON[drawing.status]}
        </span>
      </div>

      <div className={styles.cardBody}>
        <p className={styles.cardName} title={drawing.name}>
          {drawing.name}
        </p>

        <select
          className={styles.typeSelect}
          value={drawing.type}
          onChange={(e) => {
            e.stopPropagation()
            onTypeChange(e.target.value as DrawingType)
          }}
          onClick={(e) => e.stopPropagation()}
          style={{ borderColor: TYPE_COLORS[drawing.type] + '66' }}
        >
          {DRAWING_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>

        {drawing.status === 'processing' && (
          <div className={styles.progressBar}>
            <div className={styles.progressFill} style={{ width: `${drawing.parseProgress}%` }} />
          </div>
        )}

        {drawing.status === 'ready' && drawing.parsedWalls.length > 0 && (
          <p className={styles.wallCount}>{drawing.parsedWalls.length} walls · {drawing.scaleNotation ?? 'uncalibrated'}</p>
        )}
      </div>

      <div className={styles.cardActions}>
        {drawing.status === 'pending' && (
          <button
            className={styles.processBtn2}
            onClick={(e) => { e.stopPropagation(); onProcess() }}
            title="Analyse drawing"
          >
            ⚙
          </button>
        )}
        <button
          className={styles.removeBtn}
          onClick={(e) => { e.stopPropagation(); onRemove() }}
          title="Remove drawing"
        >
          ✕
        </button>
      </div>
    </div>
  )
}

interface PreviewProps {
  drawing: Drawing
  onProcess: () => void
  onCalibrate: () => void
}

function DrawingPreview({ drawing, onProcess, onCalibrate }: PreviewProps) {
  const [scale, setScale] = useState(1)
  const previewSrc = drawing.rasterUrl ?? drawing.previewUrl

  return (
    <div className={styles.previewInner}>
      <div className={styles.previewHeader}>
        <h3 className={styles.previewTitle}>{drawing.name}</h3>
        <div className={styles.previewMeta}>
          <span
            className={styles.typeBadge}
            style={{ background: TYPE_COLORS[drawing.type] + '22', color: TYPE_COLORS[drawing.type] }}
          >
            {DRAWING_TYPES.find((t) => t.value === drawing.type)?.label}
          </span>
          {drawing.floorNumber !== null && (
            <span className={styles.floorBadge}>
              {drawing.floorNumber === 0 ? 'Ground' : drawing.floorNumber < 0 ? 'Basement' : `Level ${drawing.floorNumber}`}
            </span>
          )}
        </div>

        <div className={styles.previewActions}>
          {drawing.status === 'pending' && (
            <button className={styles.actionBtn} onClick={onProcess}>
              ⚙ Analyse
            </button>
          )}
          {drawing.status === 'ready' && (
            <button className={styles.actionBtn} onClick={onCalibrate}>
              📏 Calibrate Scale
            </button>
          )}
        </div>

        <div className={styles.zoomControls}>
          <button onClick={() => setScale((s) => Math.max(0.25, s - 0.25))}>−</button>
          <span>{Math.round(scale * 100)}%</span>
          <button onClick={() => setScale((s) => Math.min(4, s + 0.25))}>+</button>
          <button onClick={() => setScale(1)}>Reset</button>
        </div>
      </div>

      {drawing.status === 'processing' && (
        <div className={styles.processingBar}>
          <div className={styles.processingFill} style={{ width: `${drawing.parseProgress}%` }} />
          <span className={styles.processingLabel}>Analysing… {drawing.parseProgress}%</span>
        </div>
      )}

      <div className={styles.previewCanvas}>
        <div style={{ transform: `scale(${scale})`, transformOrigin: 'top left', transition: 'transform 0.15s', position: 'relative' }}>
          {previewSrc ? (
            <img
              src={previewSrc}
              alt={drawing.name}
              className={styles.previewImg}
              draggable={false}
            />
          ) : (
            <div className={styles.noPreview}>
              <p>Preview loading…</p>
            </div>
          )}
        </div>
      </div>

      <div className={styles.scaleInfo}>
        <span>📏</span>
        {drawing.scaleNotation ? (
          <>
            <span>Scale: <strong>{drawing.scaleNotation}</strong></span>
            {drawing.scaleMmPerPx && (
              <span className={styles.hint}> · {drawing.scaleMmPerPx.toFixed(3)} mm/px</span>
            )}
          </>
        ) : (
          <span className={styles.hint}>
            Scale not detected — {drawing.status === 'ready'
              ? 'click "Calibrate Scale" to set it manually'
              : 'analyse the drawing first'}
          </span>
        )}
        {drawing.parsedWalls.length > 0 && (
          <span className={styles.wallBadge}>{drawing.parsedWalls.length} walls detected</span>
        )}
      </div>
    </div>
  )
}
