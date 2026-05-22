import { useState } from 'react'
import { useAppStore } from '../../store/useAppStore'
import { SAMPLE_DRAWINGS, renderSvgToPng } from '../../data/sampleDrawings'
import type { SampleDrawingDef } from '../../data/sampleDrawings'
import styles from './SampleDrawingGallery.module.css'

function difficultyLabel(d: SampleDrawingDef['difficulty']): { label: string; className: string } {
  switch (d) {
    case 'simple':       return { label: 'SIMPLE', className: styles.badgeSimple }
    case 'intermediate': return { label: 'MEDIUM', className: styles.badgeMedium }
    case 'difficult':    return { label: 'HARD',   className: styles.badgeHard }
  }
}

function difficultyIcon(d: SampleDrawingDef['difficulty']): string {
  switch (d) {
    case 'simple':       return '🟢'
    case 'intermediate': return '🟡'
    case 'difficult':    return '🔴'
  }
}

export default function SampleDrawingGallery() {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState<string | null>(null)
  const addDrawings = useAppStore((s) => s.addDrawings)

  const handleSelect = async (sample: SampleDrawingDef) => {
    setLoading(sample.id)
    try {
      const svg = sample.generateSvg(sample.width, sample.height)
      const blob = await renderSvgToPng(svg, sample.width, sample.height)
      const imageUrl = URL.createObjectURL(blob)
      const file = new File([blob], `${sample.id}.png`, { type: 'image/png' })
      addDrawings([file])

      // Pre-set wizard answers so the model builds with full detail
      const store = useAppStore.getState()
      for (const [key, val] of Object.entries(sample.wizardDefaults)) {
        store.setWizardAnswer(key, String(val))
      }

      // Show the floorplan image on the 3D ground plane, sized to real-world meters
      const worldWidthM = (sample.width * sample.scaleMmPerPx) / 1000
      store.setFloorplanImage(imageUrl)
      store.setFloorplanScale(worldWidthM / 10)
      store.setFloorplanVisible(true)

      // Pre-set drawing scale from known preset dimensions
      const pending = store.drawings.filter((d) => d.status === 'pending')
      for (const d of pending) {
        store.setDrawingScale(d.id, sample.scaleMmPerPx, sample.scaleNotation, 'inferred')
        store.setCalibrationPendingDrawingId(d.id)
        store.processDrawing(d.id)
      }
      setOpen(false)
    } catch (err) {
      console.error('Failed to load sample drawing:', err)
      alert('Could not load sample drawing. Try again.')
    } finally {
      setLoading(null)
    }
  }

  return (
    <>
      <button className={styles.trigger} onClick={() => setOpen(true)} title="Load a sample drawing to test with">
        📋 Sample Drawings
      </button>

      {open && (
        <div className={styles.overlay} onClick={() => setOpen(false)}>
          <div className={styles.panel} onClick={(e) => e.stopPropagation()}>
            <div className={styles.header}>
              <span className={styles.title}>Sample Drawings</span>
              <button className={styles.closeBtn} onClick={() => setOpen(false)}>✕</button>
            </div>
            <p className={styles.subtitle}>
              Pick a pre-built floor plan to test the pipeline instantly. No upload needed.
            </p>
            <div className={styles.grid}>
              {SAMPLE_DRAWINGS.map((s) => {
                const { label, className } = difficultyLabel(s.difficulty)
                const busy = loading === s.id
                return (
                  <button
                    key={s.id}
                    className={styles.card}
                    onClick={() => handleSelect(s)}
                    disabled={!!busy}
                  >
                    <div className={styles.cardHeader}>
                      <span className={`${styles.badge} ${className}`}>{difficultyIcon(s.difficulty)} {label}</span>
                    </div>
                    <div className={styles.cardBody}>
                      <h3 className={styles.cardTitle}>{s.name}</h3>
                      <p className={styles.cardDesc}>{s.description}</p>
                      <div className={styles.tags}>
                        {s.tags.map((t) => <span key={t} className={styles.tag}>{t}</span>)}
                      </div>
                    </div>
                    <div className={styles.cardFooter}>
                      {busy ? (
                        <span className={styles.loading}>Loading…</span>
                      ) : (
                        <span className={styles.loadBtn}>Load Drawing →</span>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
