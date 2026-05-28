import { useState } from 'react'
import { useAppStore } from '../../store/useAppStore'
import type { Drawing, DrawingType, ScaleConfidence } from '../../types'
import SymbolReferencePanel from './SymbolReferencePanel'
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

const CONFIDENCE_LABEL: Record<ScaleConfidence, string> = {
  parsed: '✓ auto-detected',
  inferred: '~ inferred',
  fallback: '⚠ needs 3D calibration',
}

const CONFIDENCE_CSS: Record<ScaleConfidence, string> = {
  parsed: styles.scaleConfParsed,
  inferred: styles.scaleConfInferred,
  fallback: styles.scaleConfFallback,
}

function ScaleConfBadge({ confidence }: { confidence: ScaleConfidence }) {
  return (
    <span className={`${styles.scaleConfBadge} ${CONFIDENCE_CSS[confidence]}`}>
      {CONFIDENCE_LABEL[confidence]}
    </span>
  )
}

export default function DrawingManager() {
  const drawings = useAppStore((s) => s.drawings)
  const removeDrawing = useAppStore((s) => s.removeDrawing)
  const setDrawingType = useAppStore((s) => s.setDrawingType)
  const selectDrawing = useAppStore((s) => s.selectDrawing)
  const selectedDrawingId = useAppStore((s) => s.selectedDrawingId)
  const buildModel = useAppStore((s) => s.buildModel)
  const processDrawing = useAppStore((s) => s.processDrawing)
  const setView = useAppStore((s) => s.setView)
  const setOverlayDrawing = useAppStore((s) => s.setFloorplanOverlayDrawing)
  const updateFloorplanOverlay = useAppStore((s) => s.updateFloorplanOverlay)

  const [symbolRefOpen, setSymbolRefOpen] = useState(false)
  const selected = drawings.find((d) => d.id === selectedDrawingId) ?? null

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
            <button
              className={styles.processBtn}
              onClick={() => {
                // Same defensive setup as the per-drawing button so the user
                // doesn't land on a blank grid when nothing is wired up yet.
                const target = selected ?? drawings.find((d) => d.status === 'ready') ?? drawings[0]
                if (target) {
                  setOverlayDrawing(target.id)
                  updateFloorplanOverlay({ visible: true }, false)
                  if (target.status === 'pending') processDrawing(target.id)
                }
                setView('model')
              }}
            >
              ↗ Open 3D Workspace
            </button>
            <button className={styles.processBtn} onClick={exportPilotMetrics} title="Export pilot metrics CSV">
              ⬇ Export Pilot CSV
            </button>
            <button
              className={styles.processBtn}
              onClick={() => setSymbolRefOpen(true)}
              title="View floor plan symbol reference"
            >
              📐 Symbols
            </button>
          </div>
        </div>

        {readyCount > 0 && (
          <div className={styles.readySummary}>
            {readyCount} drawing{readyCount !== 1 ? 's' : ''} analysed — calibration and tracing now happen in the 3D workspace overlay.
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
            onOpenWorkspace={() => {
              // Make sure the 3D workspace actually has something to render:
              //   1. point the floorplan overlay at this drawing
              //   2. ensure the overlay is visible (could've been toggled off)
              //   3. if the drawing was never analysed, kick that off so the
              //      rasterized preview becomes available for the texture map
              setOverlayDrawing(selected.id)
              updateFloorplanOverlay({ visible: true }, false)
              if (selected.status === 'pending') {
                processDrawing(selected.id)
              }
              setView('model')
            }}
          />
        ) : (
          <div className={styles.noSelection}>
            <span>👆</span>
            <p>Select a drawing to inspect it</p>
          </div>
        )}
      </div>

      {symbolRefOpen && (
        <SymbolReferencePanel onClose={() => setSymbolRefOpen(false)} />
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
          <p className={styles.wallCount}>{drawing.parsedWalls.length} walls · {drawing.scaleNotation ?? '3D calibration pending'}</p>
        )}
        {drawing.status === 'ready' && drawing.scaleConfidence === 'fallback' && (
          <p className={styles.cardFallbackWarn}>⚠ Finish scale setup in the 3D workspace</p>
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

function DrawingPreview({ drawing, onProcess, onOpenWorkspace }: { drawing: Drawing; onProcess: () => void; onOpenWorkspace: () => void }) {
  const previewSrc = drawing.rasterUrl ?? drawing.previewUrl
  const lowConfidenceCount = drawing.parsedWalls.filter((w) => (w.detectionConfidence ?? 1) < 0.75).length
  const doorCount = drawing.parsedOpenings.filter((o) => o.type === 'door').length
  const windowCount = drawing.parsedOpenings.filter((o) => o.type === 'window').length
  const unknownOpeningCount = drawing.parsedOpenings.filter((o) => o.type === 'unknown').length

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
          <button className={styles.actionBtn} onClick={onOpenWorkspace}>
            ↗ Calibrate / Trace in 3D
          </button>
        </div>
      </div>

      <div className={styles.previewCanvas}>
        {previewSrc ? (
          <div className={styles.previewImgWrap}>
            <img
              src={previewSrc}
              alt={drawing.name}
              className={styles.previewImg}
              draggable={false}
            />
          </div>
        ) : (
          <div className={styles.noPreview}>
            <p>Preview loading…</p>
          </div>
        )}
      </div>

      <div className={styles.scaleInfo}>
        <span>📏</span>
        {drawing.scaleNotation ? (
          <>
            <span>Scale: <strong>{drawing.scaleNotation}</strong></span>
            {drawing.scaleMmPerPx && (
              <span className={styles.hint}> · {drawing.scaleMmPerPx.toFixed(3)} mm/px</span>
            )}
            {drawing.scaleConfidence && (
              <ScaleConfBadge confidence={drawing.scaleConfidence} />
            )}
          </>
        ) : (
          <span className={styles.hint}>
            Scale not detected — use the 3D workspace calibration tool.
          </span>
        )}
        {drawing.parsedWalls.length > 0 && (
          <span className={styles.wallBadge}>{drawing.parsedWalls.length} walls detected</span>
        )}
        {lowConfidenceCount > 0 && (
          <span className={styles.confidenceBadge}>
            ⚠ {lowConfidenceCount} low-confidence wall{lowConfidenceCount !== 1 ? 's' : ''}
          </span>
        )}
        {drawing.status === 'ready' && (
          <>
            <span className={styles.wallBadge}>
              🧠 Semantic: {drawing.parsedRooms.length} room{drawing.parsedRooms.length !== 1 ? 's' : ''}, {drawing.parsedOpenings.length} opening{drawing.parsedOpenings.length !== 1 ? 's' : ''}
            </span>
            {(doorCount + windowCount + unknownOpeningCount) > 0 && (
              <span className={styles.wallBadge}>
                🚪 {doorCount} door{doorCount !== 1 ? 's' : ''} · 🪟 {windowCount} window{windowCount !== 1 ? 's' : ''}
                {unknownOpeningCount > 0 ? ` · ❓ ${unknownOpeningCount} unknown` : ''}
              </span>
            )}
          </>
        )}
      </div>
    </div>
  )
}
