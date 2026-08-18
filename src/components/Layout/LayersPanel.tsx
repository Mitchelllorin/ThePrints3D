/**
 * LayersPanel — an On/Off for EVERY layer in the model, big and small.
 *
 * It used to list four: Framing, Plumbing, Electrical, HVAC. Everything else you
 * can see — the floor deck, the roof, the sheathing, the wrap, the cladding, the
 * board, the print you are tracing over — was either buried in another panel or
 * had no switch at all. So "let me look at what is under this" meant hunting
 * through drawers, and in the cladding's case it meant setting the product to
 * 'none' and losing the choice you had made.
 *
 * One list, in build order: what is under the building, then the shell, then the
 * skin on it, then the trades inside it, then the reference layers that are not
 * part of the building at all. A row is a row whichever store owns it — the
 * split between "trade layers" (app store) and "construction layers" (UI
 * settings) is an implementation detail and has no business being visible here.
 *
 * Trade rows keep their second job: tapping the NAME makes that layer the active
 * one to trace on. The rest are toggles only, because there is nothing to trace
 * on a sheet of housewrap.
 */
import { useAppStore } from '../../store/useAppStore'
import { useUISettingsStore } from '../../store/useUISettingsStore'
import { useFloorplanLocalStore } from '../../store/useFloorplanLocalStore'
import { requirePro } from '../Pro/usePro'
import { LAYER_COLORS, PRO_TRACE_LAYERS } from '../../data/traceLayers'
import type { TraceLayer } from '../../data/traceLayers'
import styles from './WorkspaceLayout.module.css'

/** A row backed by the trade-layer set — tap the name to trace on it. */
interface TradeRow {
  kind: 'trade'
  key: TraceLayer
  label: string
  color: string
}
/** A row backed by a boolean in UI settings. */
interface FlagRow {
  kind: 'flag'
  key: 'sheathingVisible' | 'wrapVisible' | 'claddingVisible' | 'drywallVisible'
    | 'gridVisible' | 'dimensionsVisible'
  label: string
  color: string
}
/** The print overlay lives on the drawing, not in either layer store. */
interface PrintRow {
  kind: 'print'
  label: string
  color: string
}

type Row = TradeRow | FlagRow | PrintRow
type Group = { title: string; rows: Row[] }

// Colours are the material's own where there is one — OSB tan, housewrap white,
// gypsum off-white — so the dot reads as the thing rather than as decoration.
const GROUPS: Group[] = [
  {
    title: 'Structure',
    rows: [
      { kind: 'trade', key: 'floors', label: 'Floors & joists', color: LAYER_COLORS.floors },
      { kind: 'trade', key: 'framing', label: 'Framing', color: LAYER_COLORS.framing },
      { kind: 'trade', key: 'roof', label: 'Roof', color: LAYER_COLORS.roof },
    ],
  },
  {
    title: 'Envelope',
    rows: [
      { kind: 'flag', key: 'sheathingVisible', label: 'Sheathing', color: '#c9a273' },
      { kind: 'flag', key: 'wrapVisible', label: 'Tyvek® / barrier', color: '#eef2f6' },
      { kind: 'flag', key: 'claddingVisible', label: 'Cladding', color: '#8fa3b8' },
      { kind: 'flag', key: 'drywallVisible', label: 'Board (drywall)', color: '#e8e6e1' },
    ],
  },
  {
    title: 'Trades',
    rows: [
      { kind: 'trade', key: 'plumbing', label: 'Plumbing', color: LAYER_COLORS.plumbing },
      { kind: 'trade', key: 'electrical', label: 'Electrical', color: LAYER_COLORS.electrical },
      { kind: 'trade', key: 'hvac', label: 'HVAC', color: LAYER_COLORS.hvac },
    ],
  },
  {
    title: 'Reference',
    rows: [
      { kind: 'print', label: 'Print overlay', color: '#93c5fd' },
      { kind: 'flag', key: 'dimensionsVisible', label: 'Dimensions', color: '#cbd5e1' },
      { kind: 'flag', key: 'gridVisible', label: 'Grid', color: '#2b3b5c' },
    ],
  },
]

export default function LayersPanel() {
  const isPro = useAppStore((s) => s.isPro)
  const visibleLayers = useAppStore((s) => s.visibleLayers)
  const toggleTradeLayerVisible = useAppStore((s) => s.toggleTradeLayerVisible)
  const overlayVisible = useAppStore((s) => s.floorplanOverlay.visible)
  const updateFloorplanOverlay = useAppStore((s) => s.updateFloorplanOverlay)
  const ui = useUISettingsStore()
  const setUI = useUISettingsStore((s) => s.set)
  const activeTraceLayer = useFloorplanLocalStore((s) => s.activeTraceLayer)
  const setActiveTraceLayer = useFloorplanLocalStore((s) => s.setActiveTraceLayer)

  const isOn = (row: Row): boolean => {
    if (row.kind === 'trade') return visibleLayers.has(row.key)
    if (row.kind === 'print') return overlayVisible
    return ui[row.key]
  }

  const toggle = (row: Row) => {
    if (row.kind === 'trade') toggleTradeLayerVisible(row.key)
    else if (row.kind === 'print') updateFloorplanOverlay({ visible: !overlayVisible })
    else setUI({ [row.key]: !ui[row.key] } as Partial<typeof ui>)
  }

  /** Everything at once — the fastest way back from a model you have stripped
   *  down to one layer, and the fastest way to strip it. */
  const setAll = (on: boolean) => {
    for (const g of GROUPS) {
      for (const row of g.rows) {
        if (isOn(row) !== on) toggle(row)
      }
    }
  }

  /** The envelope, as one thing. Order matters only for readability. */
  const SKIN_KEYS = ['sheathingVisible', 'wrapVisible', 'claddingVisible', 'drywallVisible'] as const
  /** On when ANY of it is showing, so the button always offers the move that
   *  changes something rather than sitting there saying "Off" over a visible
   *  wall because one of the four is still on. */
  const skinOn = SKIN_KEYS.some((k) => ui[k])
  const setSkin = (on: boolean) => setUI(
    Object.fromEntries(SKIN_KEYS.map((k) => [k, on])) as Partial<typeof ui>,
  )

  const allRows = GROUPS.flatMap((g) => g.rows)
  /** Is this the only thing currently showing? */
  const isSolo = (row: Row) => isOn(row) && allRows.every((r) => r === row || !isOn(r))

  /**
   * SOLO — show this and nothing else.
   *
   * "Just the electrical" or "just the board" was thirteen taps away: turn
   * everything off, then turn one thing back on. It is the single most useful
   * thing a layer list does and it had no control at all.
   *
   * It lives on the COLOUR DOT, which until now was decoration. That costs the
   * row no width and adds no third button to an already three-part row — and a
   * dot that means "this layer" is a fair thing to press when you want only
   * this layer. Pressing it again puts everything back, so it is a place you
   * can always get out of.
   */
  const toggleSolo = (row: Row) => {
    if (isSolo(row)) {
      setAll(true)
      return
    }
    for (const r of allRows) {
      const want = r === row
      if (isOn(r) !== want) toggle(r)
    }
  }

  return (
    <div className={styles.layerList}>
      <div className={styles.layerRow}>
        <span className={styles.layerDot} style={{ background: 'transparent', borderStyle: 'dashed' }} />
        <span className={styles.layerName} style={{ opacity: 0.7 }}>All layers</span>
        <button className={styles.layerToggle} onClick={() => setAll(true)}>On</button>
        <button className={styles.layerToggle} onClick={() => setAll(false)}>Off</button>
      </div>

      {/* SKIN — the four envelope layers as ONE switch, at the top where it can
          be found. Closing the building up and opening it back up is the most
          repeated move there is: you put the skin on to see the house, and take
          it off to see the framing you actually drew. Doing that four rows at a
          time, two groups down the list, made a constant action feel like a
          settings change. The rows below still work individually for anyone who
          wants just the board or just the wrap. */}
      <div className={styles.layerRow}>
        <span className={styles.layerDot} style={{ background: '#c9a273' }} />
        <span className={styles.layerName}>Skin (sheathing, wrap, cladding, board)</span>
        <button
          className={`${styles.layerToggle} ${skinOn ? styles.layerToggleOn : ''}`}
          onClick={() => setSkin(!skinOn)}
          aria-pressed={skinOn}
        >{skinOn ? 'On' : 'Off'}</button>
      </div>

      {GROUPS.map((g) => (
        // NOT nested .layerList — that applied the list's row gap twice and
        // spread thirteen rows down the whole workspace.
        <div key={g.title} className={styles.layerGroupBlock}>
          <p className={styles.layerGroup}>{g.title}</p>
          {g.rows.map((row) => {
            const on = isOn(row)
            const solo = isSolo(row)
            const active = row.kind === 'trade' && activeTraceLayer === row.key
            const rowKey = row.kind === 'print' ? 'print' : row.key
            return (
              <div key={rowKey} className={`${styles.layerRow} ${active ? styles.layerRowActive : ''}`}>
                <button
                  className={`${styles.layerDot} ${solo ? styles.layerDotSolo : ''}`}
                  style={{ background: row.color }}
                  onClick={() => toggleSolo(row)}
                  title={solo ? 'Show everything again' : `Show only ${row.label}`}
                  aria-label={solo ? 'Show everything again' : `Show only ${row.label}`}
                  aria-pressed={solo}
                />
                {row.kind === 'trade' ? (
                  <button
                    className={styles.layerName}
                    // Picking a layer here is what arms tracing on it. The MEP
                    // three are Pro; structure stays free, because floors,
                    // framing and roof ARE the free model — gating them would
                    // gate the thing that sells the app.
                    onClick={() => (
                      PRO_TRACE_LAYERS.has(row.key)
                        ? requirePro(`${row.label} layers`, () => setActiveTraceLayer(row.key))
                        : setActiveTraceLayer(row.key)
                    )}
                  >
                    {row.label}
                    {PRO_TRACE_LAYERS.has(row.key) && !isPro && <span className={styles.layerProTag}>PRO</span>}
                  </button>
                ) : (
                  <span className={styles.layerName}>{row.label}</span>
                )}
                <button
                  className={`${styles.layerToggle} ${on ? styles.layerToggleOn : ''}`}
                  onClick={() => toggle(row)}
                  aria-pressed={on}
                >
                  {on ? 'On' : 'Off'}
                </button>
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}
