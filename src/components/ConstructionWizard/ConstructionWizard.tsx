import { useMemo, useState } from 'react'
import { useAppStore } from '../../store/useAppStore'
import { orderDecisions, shouldSmartSkip, LAYER_ORDER } from '../../services/decisions'
import type { Decision, ConstructionLayer } from '../../services/decisions'
import styles from './ConstructionWizard.module.css'

const LAYER_LABELS: Record<ConstructionLayer, string> = {
  excavation: 'Excavation',
  foundation: 'Foundation',
  framing: 'Framing',
  electrical: 'Electrical',
  plumbing: 'Plumbing',
  hvac: 'HVAC',
  insulation: 'Insulation',
  drywall: 'Drywall',
  finishes: 'Finishes',
}

export default function ConstructionWizard() {
  const decisions = useAppStore((s) => s.constructionDecisions)
  const updateDecision = useAppStore((s) => s.updateDecision)
  const buildResult = useAppStore((s) => s.buildResult)
  const [showSkipped, setShowSkipped] = useState(false)
  const [currentIndex, setCurrentIndex] = useState(0)

  const ordered = useMemo(() => orderDecisions(decisions), [decisions])

  const visible = useMemo(() => {
    if (showSkipped) return ordered
    return ordered.filter((d) => !shouldSmartSkip(d))
  }, [ordered, showSkipped])

  // Group decisions by layer for the sidebar summary
  const byLayer = useMemo(() => {
    const map = new Map<ConstructionLayer, Decision[]>()
    for (const d of ordered) {
      const list = map.get(d.layer) ?? []
      list.push(d)
      map.set(d.layer, list)
    }
    return map
  }, [ordered])

  if (!buildResult || decisions.length === 0) return null

  const current = visible[currentIndex] ?? null
  const totalVisible = visible.length
  const skippedCount = ordered.length - ordered.filter((d) => !shouldSmartSkip(d)).length

  function handleSelect(decision: Decision, value: unknown) {
    updateDecision(decision.id, value)
    if (currentIndex < totalVisible - 1) {
      setCurrentIndex(currentIndex + 1)
    }
  }

  function handleBack() {
    if (currentIndex > 0) setCurrentIndex(currentIndex - 1)
  }

  return (
    <div className={styles.wizard}>
      <div className={styles.header}>
        <h3 className={styles.title}>Construction Wizard</h3>
        <div className={styles.progress}>
          {currentIndex + 1} / {totalVisible} decisions
          {skippedCount > 0 && (
            <button
              className={styles.skipToggle}
              onClick={() => setShowSkipped(!showSkipped)}
            >
              {showSkipped ? 'Hide' : 'Show'} {skippedCount} auto-resolved
            </button>
          )}
        </div>
      </div>

      {/* Layer progress bar */}
      <div className={styles.layerBar}>
        {LAYER_ORDER.map((layer) => {
          const layerDecisions = byLayer.get(layer)
          if (!layerDecisions || layerDecisions.length === 0) return null
          const allResolved = layerDecisions.every((d) => d.chosen !== undefined)
          return (
            <div
              key={layer}
              className={`${styles.layerPill} ${allResolved ? styles.layerDone : ''}`}
              title={`${LAYER_LABELS[layer]}: ${layerDecisions.length} decision${layerDecisions.length > 1 ? 's' : ''}`}
            >
              {LAYER_LABELS[layer]}
            </div>
          )
        })}
      </div>

      {/* Current decision card */}
      {current && (
        <div className={styles.card}>
          <div className={styles.cardLayer}>{LAYER_LABELS[current.layer]}</div>
          <div className={styles.cardQuestion}>{current.question}</div>
          <div className={styles.cardConfidence}>
            Confidence: {Math.round(current.confidence * 100)}%
            {shouldSmartSkip(current) && (
              <span className={styles.autoTag}>Auto-resolved</span>
            )}
          </div>

          <div className={styles.options}>
            {current.options.map((opt, i) => {
              const isChosen = JSON.stringify(current.chosen) === JSON.stringify(opt.value)
              const isDefault = JSON.stringify(current.default) === JSON.stringify(opt.value)
              return (
                <button
                  key={i}
                  className={`${styles.optionBtn} ${isChosen ? styles.optionChosen : ''}`}
                  onClick={() => handleSelect(current, opt.value)}
                >
                  <span className={styles.optionLabel}>{opt.label}</span>
                  {isDefault && <span className={styles.defaultTag}>default</span>}
                </button>
              )
            })}
          </div>

          <div className={styles.nav}>
            <button
              className={styles.navBtn}
              onClick={handleBack}
              disabled={currentIndex === 0}
            >
              Previous
            </button>
            <button
              className={styles.navBtn}
              onClick={() => setCurrentIndex(Math.min(currentIndex + 1, totalVisible - 1))}
              disabled={currentIndex >= totalVisible - 1}
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* Suggestions */}
      {buildResult.suggestions.length > 0 && (
        <div className={styles.suggestions}>
          <div className={styles.suggestionsTitle}>Suggestions</div>
          {buildResult.suggestions.map((s, i) => (
            <div key={i} className={styles.suggestion}>{s}</div>
          ))}
        </div>
      )}
    </div>
  )
}
