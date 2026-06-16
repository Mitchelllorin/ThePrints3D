/**
 * PanelBoard — a visual breaker panel for the electrical layer. Shows every
 * circuit in two columns (odd slots left, even slots right) with amperage,
 * slot, and computed load; total load in amps/watts; an overload warning when
 * a circuit exceeds 80% of its rating; and required-circuit suggestions by
 * room type that the user can add (then trace to fulfil).
 */
import { useState } from 'react'
import { useAppStore } from '../../store/useAppStore'
import { FIXTURE_WATTS, REQUIRED_CIRCUITS, ROOM_TYPES, circuitVoltage, type RequiredCircuitSpec } from '../../services/constructionCode'
import type { Circuit } from '../../types'
import styles from './AmbientGuide.module.css'

let _cseq = 0
const newCircuitId = () => `circuit-${_cseq++}-${Math.round(performance.now())}`

export default function PanelBoard({ onClose }: { onClose: () => void }) {
  const circuits = useAppStore((s) => s.circuits)
  const placedObjects = useAppStore((s) => s.placedObjects)
  const addCircuit = useAppStore((s) => s.addCircuit)
  const [roomType, setRoomType] = useState<string>(ROOM_TYPES[0])

  const loadW = (c: Circuit) =>
    placedObjects.filter((o) => o.circuitId === c.id).reduce((sum, o) => sum + (FIXTURE_WATTS[o.type] ?? 0), 0)

  const totalW = circuits.reduce((sum, c) => sum + loadW(c), 0)
  const totalA = totalW / 120

  const ordered = [...circuits].sort((a, b) => a.breaker - b.breaker)
  const left = ordered.filter((_, i) => i % 2 === 0)
  const right = ordered.filter((_, i) => i % 2 === 1)

  const addSuggested = (spec: RequiredCircuitSpec) => {
    const n = spec.count ?? 1
    for (let i = 0; i < n; i++) {
      const slot = useAppStore.getState().circuits.reduce((m, c) => Math.max(m, c.breaker), 0) + 1
      addCircuit({
        id: newCircuitId(),
        label: `${roomType} — ${spec.label}${n > 1 ? ` #${i + 1}` : ''}`,
        amperage: spec.amps,
        breaker: slot,
        lineIds: [],
        type: spec.type,
        suggested: true,
      })
    }
  }

  const breakerChip = (c: Circuit) => {
    const w = loadW(c)
    const a = w / circuitVoltage(c.amperage)
    const pct = Math.min(100, (a / c.amperage) * 100)
    const over = a > 0.8 * c.amperage
    const cls = [styles.breaker, over ? styles.breakerOver : '', c.suggested ? styles.breakerSuggested : ''].filter(Boolean).join(' ')
    return (
      <div key={c.id} className={cls}>
        <span><span className={styles.breakerSlot}>#{c.breaker}</span> {c.amperage}A {c.type !== 'general' ? c.type.toUpperCase() : ''}</span>
        <span>{c.label}{c.suggested ? ' · suggested' : ''}</span>
        <span>{a.toFixed(1)}A / {w}W {over ? '⚠ >80%' : ''}</span>
        <div className={styles.loadBar}><div className={`${styles.loadFill} ${over ? styles.loadFillOver : ''}`} style={{ width: `${pct}%` }} /></div>
      </div>
    )
  }

  return (
    <div className={styles.panelBoard}>
      <div className={styles.propHeader}>
        <span className={styles.propTitle}>⚡ Panel board</span>
        <button className={styles.cardClose} onClick={onClose} aria-label="Close">✕</button>
      </div>

      {circuits.length === 0 ? (
        <span className={styles.stepHint}>No circuits yet — trace electrical runs to create them, or add required circuits below.</span>
      ) : (
        <div className={styles.breakerCols}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>{left.map(breakerChip)}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>{right.map(breakerChip)}</div>
        </div>
      )}

      <div className={styles.stepHint} style={{ marginTop: 4 }}>
        Total load: <strong style={{ color: '#e2e8f0' }}>{totalA.toFixed(1)} A</strong> · {totalW} W ({circuits.length} circuit{circuits.length !== 1 ? 's' : ''})
      </div>

      <span className={styles.stepLabel}>Required circuits</span>
      <div className={styles.row}>
        <select className={styles.select} value={roomType} onChange={(e) => setRoomType(e.target.value)}>
          {ROOM_TYPES.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {REQUIRED_CIRCUITS[roomType].map((spec, i) => (
          <button key={i} className={styles.secondary} style={{ fontSize: 11, textAlign: 'left' }} onClick={() => addSuggested(spec)}>
            + {spec.label} — {spec.amps}A {spec.type}{spec.count && spec.count > 1 ? ` ×${spec.count}` : ''}
          </button>
        ))}
      </div>
    </div>
  )
}
