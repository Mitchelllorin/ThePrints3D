/**
 * THE MEP STEPS — the same three for every trade (services/mepWorkflow):
 *
 *   ① what it serves → ② where it comes from → ③ run it
 *
 * Three chips across the top say where you are, with a ✓ on each step that is
 * done; the step underneath offers "do it for me" (one tap, one undo, all of
 * it editable afterwards) and the by-hand way — the parts to place yourself,
 * or a run to draw. It replaced a different panel per trade, a wall of
 * finishes under it, and an auto-wire button hidden in another drawer.
 */
import { useState } from 'react'
import { useAppStore } from '../../store/useAppStore'
import { mepTrayItems } from '../../data/objectCatalog'
import { TRADE_SPECS, TRADE_LINES, stepStatus, type Trade } from '../../services/mepWorkflow'
import { getCatalogItem } from '../../data/objectCatalog'
import styles from './AmbientGuide.module.css'

type Step = 0 | 1 | 2

interface Props {
  trade: Trade
  level: number
  /** Arm one part for placing on the plan (the tray's own behaviour). */
  onPlace: (type: string) => void
  armedType: string | null
  /** Start the by-hand tracer for this trade. */
  onDrawRun: () => void
  /** Electrical only: the panel board (circuits). */
  onPanelBoard?: () => void
}

export default function MepSteps({ trade, level, onPlace, armedType, onDrawRun, onPanelBoard }: Props) {
  const spec = TRADE_SPECS[trade]
  const objects = useAppStore((s) => s.placedObjects)
  const lines = useAppStore((s) => s[TRADE_LINES[trade]])
  const mepPlaceServes = useAppStore((s) => s.mepPlaceServes)
  const mepPlaceSource = useAppStore((s) => s.mepPlaceSource)
  const mepRun = useAppStore((s) => s.mepRun)
  const status = stepStatus(trade, objects, lines, level)
  const done = [status.serves > 0, status.sourceMissing.length === 0, status.runs > 0]
  // Open on the first step not yet done; the chips move freely after that.
  const [picked, setPicked] = useState<Step | null>(null)
  const firstOpen = (done.findIndex((d) => !d) === -1 ? 2 : done.findIndex((d) => !d)) as Step
  const step = picked ?? firstOpen
  const [note, setNote] = useState<string | null>(null)

  const tray = mepTrayItems(trade)
  const servesTray = tray.filter((i) => spec.serves.types.includes(i.type))
  const sourceTray = tray.filter((i) => spec.source.types.includes(i.type))
  const extraTray = tray.filter((i) => !spec.serves.types.includes(i.type) && !spec.source.types.includes(i.type))

  const go = (n: number, what: string, none: string) => {
    setNote(n > 0 ? `${what.replace('{n}', String(n))} — drag, retype or delete any of it. Undo takes it all back.` : none)
    setPicked(null)
  }

  const chip = (i: Step, label: string, count?: string) => (
    <button
      key={i}
      className={step === i ? styles.action : styles.secondary}
      onClick={() => { setPicked(i); setNote(null) }}
      aria-pressed={step === i}
      style={{ flex: 1, minWidth: 0, padding: '6px 4px', fontSize: 12 }}
    >
      {done[i] ? '✓ ' : `${i + 1} `}{label}{count ? ` · ${count}` : ''}
    </button>
  )

  const parts = (items: typeof tray) => (
    <div className={styles.btnRow} style={{ flexWrap: 'wrap' }}>
      {items.map((item) => (
        <button key={item.type} className={armedType === item.type ? styles.action : styles.secondary}
          onClick={() => onPlace(item.type)} title={item.label}>
          {item.short}
        </button>
      ))}
    </div>
  )

  const missingNames = status.sourceMissing.map((t) => getCatalogItem(t)?.short ?? t).join(' + ')

  return (
    <div className={styles.step}>
      <span className={styles.stepLabel}>{spec.label}</span>
      <div className={styles.btnRow} style={{ flexWrap: 'nowrap' }}>
        {chip(0, spec.serves.label, String(status.serves))}
        {chip(1, spec.source.label)}
        {chip(2, spec.run.label, String(status.runs))}
      </div>

      {step === 0 && (
        <>
          <span className={styles.stepHint}>{spec.serves.hint}</span>
          {trade === 'plumbing' ? (
            <span className={styles.stepHint}>Fixtures come from the plan — tap one, then tap where it goes:</span>
          ) : (
            <button className={styles.action} onClick={() => go(
              mepPlaceServes(trade, level),
              trade === 'electrical' ? 'Placed {n} receptacles' : 'Placed {n} registers',
              'Nothing placed — this storey needs walls and a known scale',
            )}>
              Place them for me
            </button>
          )}
          {trade !== 'plumbing' && <span className={styles.stepHint}>Or place them yourself — tap one, then tap the plan:</span>}
          {parts(servesTray)}
        </>
      )}

      {step === 1 && (
        <>
          <span className={styles.stepHint}>{spec.source.hint}</span>
          {status.sourceMissing.length > 0 ? (
            <button className={styles.action} onClick={() => go(
              mepPlaceSource(trade, level),
              'Placed {n}',
              'Nothing placed — this storey needs walls first',
            )}>
              Put the {missingNames.toLowerCase()} in for me
            </button>
          ) : (
            <span className={styles.stepText}>✓ In place. Drag it to move it.</span>
          )}
          <span className={styles.stepHint}>Or place it yourself:</span>
          {parts(sourceTray)}
          {trade === 'electrical' && onPanelBoard && (
            <button className={styles.secondary} onClick={onPanelBoard}>Panel board — circuits</button>
          )}
        </>
      )}

      {step === 2 && (
        <>
          <span className={styles.stepHint}>{spec.run.hint}</span>
          {status.serves === 0 || status.sourceMissing.length > 0 ? (
            <span className={styles.stepHint}>
              {status.serves === 0 ? `Needs ${spec.serves.label.toLowerCase()} first (step 1).` : `Needs the ${missingNames.toLowerCase()} first (step 2).`}
            </span>
          ) : (
            <button className={styles.action} onClick={() => go(
              mepRun(trade, level),
              'Ran {n} lengths',
              'Nothing to run on this storey',
            )}>
              {status.runs > 0 ? 'Run it again for me' : 'Run it for me'}
            </button>
          )}
          <span className={styles.stepHint}>Or draw a run yourself — tap along the route, double-tap to finish.</span>
          <button className={styles.secondary} onClick={onDrawRun}>Draw a run →</button>
          {extraTray.length > 0 && (
            <>
              <span className={styles.stepHint}>Rough-in boxes:</span>
              {parts(extraTray)}
            </>
          )}
        </>
      )}

      {note && <p className={styles.stepHint} style={{ color: '#a7f3d0' }}>{note}</p>}
    </div>
  )
}
