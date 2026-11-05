/**
 * CutListSection — the cut list and the buy list, counted off the framing.
 *
 * Rendered inside the Settings drawer under the takeoff. Two lists, because a
 * framer and a yard ask different questions:
 *
 *   CUT LIST — per wall, in the order you build it: what the piece is, what
 *              stock it comes from, how long, how many.
 *   BUY LIST — every piece nested into stock lengths, plus the waste allowance,
 *              rounded up to whole sticks.
 *
 * The numbers come from cutList, which counts the members the wall builder
 * actually frames — see the header there for why this is not an estimate.
 */
import { useIsPro } from '../Pro/usePro'
import { useState } from 'react'
import { useConfigStore } from '../../store/useConfigStore'
import { useFloorplanLocalStore } from '../../store/useFloorplanLocalStore'
import { useCutList, formatCutLength } from './useCutList'
import { roleLabel, WASTE_LABEL, nominalSize, boardFeet, orderBoardFeet, type WasteCategory, type WallCuts } from '../../services/cutList'

const INK = '#e5e7eb'
const INK_2 = '#cbd5e1'
const MUTED = '#94a3b8'
const ACCENT = '#38bdf8'

const row: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 13, lineHeight: 1.55 }
const num: React.CSSProperties = { fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }
/** Board feet as the yard writes them: the real figure, trimmed, never rounded to look neat. */
const bf = (v: number) => v.toLocaleString(undefined, { maximumFractionDigits: 2 })

const heading: React.CSSProperties = {
  color: '#f97316', fontWeight: 700, fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4,
}

/** One wall, its pieces hidden until asked for — a storey of walls is a long list. */
function WallBlock({ wall, open, onToggle }: { wall: WallCuts; open: boolean; onToggle: () => void }) {
  const pieces = wall.lines.reduce((n, l) => n + l.qty, 0)
  return (
    <div style={{ marginBottom: 6 }}>
      <button
        onClick={onToggle}
        aria-expanded={open}
        style={{
          width: '100%', minHeight: 48, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 10, padding: '0 10px', background: open ? 'rgba(56,189,248,0.10)' : 'none',
          border: open ? `1px solid ${ACCENT}` : '1px solid rgba(148,163,184,0.22)',
          borderRadius: 8, color: INK, fontSize: 13.5, fontWeight: 700, cursor: 'pointer', textAlign: 'left',
        }}
      >
        <span>{open ? '▾' : '▸'} {wall.name}</span>
        <span style={{ ...num, color: MUTED, fontWeight: 600 }}>
          {wall.masonry ? 'masonry' : `${pieces} ${pieces === 1 ? 'piece' : 'pieces'}`}
        </span>
      </button>
      {open && (
        <div style={{ padding: '6px 10px 2px' }}>
          {wall.masonry ? (
            <p style={{ color: MUTED, fontSize: 13, margin: 0 }}>
              Masonry — courses are in the takeoff above.
            </p>
          ) : wall.lines.length === 0 ? (
            <p style={{ color: MUTED, fontSize: 13, margin: 0 }}>Nothing framed in this wall yet.</p>
          ) : wall.lines.map((l) => (
            <div key={`${l.member}|${l.role}|${l.lengthIn}`} style={row}>
              <span style={{ color: INK_2 }}>
                {roleLabel(l.role)}
                <span style={{ color: MUTED }}> · {l.member}</span>
                {l.inPacks > 0 && <span style={{ color: MUTED }}> · {l.inPacks} packed</span>}
              </span>
              <span style={{ ...num, color: '#fff' }}>{formatCutLength(l.lengthIn)} × {l.qty}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** Waste allowance, per kind of member. Steps of 5%, floor of 0. */
function WasteRow({ cat, pct, onSet }: { cat: WasteCategory; pct: number; onSet: (v: number) => void }) {
  const step = (d: number) => onSet(Math.max(0, Math.min(50, pct + d)))
  const btn: React.CSSProperties = {
    minWidth: 48, minHeight: 48, background: 'none', border: '1px solid rgba(148,163,184,0.35)',
    borderRadius: 8, color: ACCENT, fontSize: 18, fontWeight: 700, cursor: 'pointer',
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
      <span style={{ flex: 1, color: INK_2, fontSize: 13 }}>{WASTE_LABEL[cat]}</span>
      <button style={btn} onClick={() => step(-5)} aria-label={`Less waste on ${WASTE_LABEL[cat]}`}>−</button>
      <span style={{ ...num, color: '#fff', fontSize: 13.5, fontWeight: 700, minWidth: 44, textAlign: 'center' }}>{pct}%</span>
      <button style={btn} onClick={() => step(5)} aria-label={`More waste on ${WASTE_LABEL[cat]}`}>+</button>
    </div>
  )
}

export default function CutListSection() {
  const isPro = useIsPro()   // the one Pro rule — see Pro/usePro
  const openUpgrade = useFloorplanLocalStore((s) => s.openUpgrade)
  const setConfig = useConfigStore((s) => s.set)
  const { walls, buy, waste } = useCutList()
  // The first wall opens; the rest wait to be asked for.
  const [openWall, setOpenWall] = useState<number | null>(0)
  const [showWaste, setShowWaste] = useState(false)
  const [showBoardFeet, setShowBoardFeet] = useState(false)

  const framed = walls.filter((w) => !w.masonry && w.lines.length > 0)
  if (walls.length === 0) return null

  // FREE SEES THE FIRST WALL, IN FULL. Same bargain as the takeoff above: one
  // wall's real cut list proves the numbers, the rest is the paid part.
  const shown = isPro ? walls : walls.slice(0, 1)
  const lockedWalls = isPro ? 0 : walls.length - shown.length
  const totalPieces = framed.reduce((n, w) => n + w.lines.reduce((m, l) => m + l.qty, 0), 0)

  return (
    <div style={{ marginTop: 12, borderTop: '1px solid rgba(148,163,184,0.18)', paddingTop: 10 }}>
      <div style={{ ...heading, display: 'flex', justifyContent: 'space-between' }}>
        <span>Cut list</span>
        <span style={{ ...num, color: MUTED }}>{totalPieces} pieces</span>
      </div>
      {shown.map((w) => (
        <WallBlock key={w.index} wall={w} open={openWall === w.index} onToggle={() => setOpenWall(openWall === w.index ? null : w.index)} />
      ))}
      {lockedWalls > 0 && (
        <button
          onClick={() => openUpgrade('The cut list for every wall')}
          style={{
            width: '100%', minHeight: 48, marginTop: 2, background: 'rgba(56,189,248,0.08)',
            border: `1px solid ${ACCENT}`, borderRadius: 8, color: ACCENT, fontSize: 13, fontWeight: 700, cursor: 'pointer',
          }}
        >{lockedWalls} more {lockedWalls === 1 ? 'wall' : 'walls'} — unlock the full cut list</button>
      )}

      {isPro && buy.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={heading}>Buy list</div>
          {buy.map((b) => (
            <div key={`${b.member}|${b.category}|${b.stockFt}`} style={row}>
              <span style={{ color: INK_2 }}>
                {b.member} <span style={{ color: MUTED }}>· {b.stockFt}&apos; · {WASTE_LABEL[b.category].toLowerCase()}</span>
              </span>
              <span style={{ ...num, color: '#fff' }}>
                {b.order}
                {b.order !== b.needed && <span style={{ color: MUTED }}> (cuts need {b.needed})</span>}
                <span style={{ color: MUTED }}> · {b.boardFt === null ? 'by the ft' : `${bf(b.boardFt)} BF`}</span>
              </span>
            </div>
          ))}
          {/* THE LUMBER LINE ON THE QUOTE. The order in board feet — whole
              sticks with waste, the way a yard prices it — and a plain word on
              anything not in it, rather than a total that quietly leaves out the
              LVL and lets you think it did not. */}
          {(() => {
            const total = orderBoardFeet(buy)
            const example = buy.find((b) => b.boardFt !== null)
            const size = example ? nominalSize(example.member) : null
            return (
              <>
                <div style={{ ...row, marginTop: 6, paddingTop: 6, borderTop: '1px solid rgba(148,163,184,0.18)' }}>
                  <span style={{ color: INK, fontWeight: 700 }}>Board feet</span>
                  <span style={{ ...num, color: '#fff', fontWeight: 700 }}>{bf(total.total)} BF</span>
                </div>
                {total.notCounted.length > 0 && (
                  <p style={{ color: MUTED, fontSize: 13, margin: '2px 0 0', lineHeight: 1.5 }}>
                    Not in it: {total.notCounted.join(', ')} — sold by the foot, not the board foot.
                  </p>
                )}
                <button
                  onClick={() => setShowBoardFeet(!showBoardFeet)}
                  aria-expanded={showBoardFeet}
                  style={{
                    width: '100%', minHeight: 48, marginTop: 6, background: 'none',
                    border: '1px solid rgba(148,163,184,0.22)', borderRadius: 8, color: INK_2,
                    fontSize: 13, fontWeight: 600, cursor: 'pointer',
                  }}
                >{showBoardFeet ? '▾' : '▸'} What&apos;s a board foot?</button>
                {showBoardFeet && (
                  <div style={{ color: INK_2, fontSize: 13, lineHeight: 1.55, padding: '6px 2px 2px' }}>
                    <p style={{ margin: '0 0 6px' }}>
                      A board foot is 144 cubic inches of lumber — a board 1&quot; thick, 12&quot; wide and 1&apos; long.
                      It&apos;s how a yard measures and prices framing lumber, usually per thousand (MBF).
                    </p>
                    <p style={{ margin: '0 0 6px', ...num, whiteSpace: 'normal' }}>
                      <b style={{ color: INK }}>Thickness × width × length in feet ÷ 12</b>, on the nominal size —
                      a 2×4 counts as 2&quot; × 4&quot; even though it mills to 1½&quot; × 3½&quot;.
                    </p>
                    {example && size && (
                      <p style={{ margin: '0 0 6px', ...num, whiteSpace: 'normal' }}>
                        From your list: {example.member} × {example.stockFt}&apos; is {size.t} × {size.w} × {example.stockFt} ÷ 12
                        {' '}= {bf(boardFeet(size.t, size.w, example.stockFt))} BF a stick, × {example.order} sticks
                        {' '}= {bf(example.boardFt ?? 0)} BF.
                      </p>
                    )}
                    <p style={{ margin: 0 }}>
                      These are the board feet of what you <b style={{ color: INK }}>buy</b> — whole sticks, waste included —
                      so the total times the yard&apos;s MBF price is the lumber on the quote. LVL and other
                      engineered members are sold by the foot and steel by the piece, so they aren&apos;t in it.
                    </p>
                  </div>
                )}
              </>
            )
          })()}
          <button
            onClick={() => setShowWaste(!showWaste)}
            aria-expanded={showWaste}
            style={{
              width: '100%', minHeight: 48, marginTop: 6, background: 'none',
              border: '1px solid rgba(148,163,184,0.22)', borderRadius: 8, color: INK_2,
              fontSize: 13, fontWeight: 600, cursor: 'pointer',
            }}
          >{showWaste ? '▾' : '▸'} Waste allowance</button>
          {showWaste && (
            <div style={{ padding: '2px 2px 4px' }}>
              {(['studs', 'plates', 'headers', 'blocking'] as WasteCategory[]).map((cat) => (
                <WasteRow key={cat} cat={cat} pct={waste[cat]} onSet={(v) => setConfig({ cutWastePct: { ...waste, [cat]: v } })} />
              ))}
              <button
                onClick={() => setConfig({ cutWastePct: null })}
                style={{
                  minHeight: 48, width: '100%', marginTop: 6, background: 'none', border: 'none',
                  color: MUTED, fontSize: 13, cursor: 'pointer',
                }}
              >Back to the defaults</button>
            </div>
          )}
        </div>
      )}
      <p style={{ color: '#6b7280', fontSize: 13, margin: '8px 0 0', lineHeight: 1.5 }}>
        Counted off the framing, to 1/16&quot;. Headers are the model&apos;s default size.
      </p>
    </div>
  )
}
