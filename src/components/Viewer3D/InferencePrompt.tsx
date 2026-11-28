/**
 * InferencePrompt — the ambient AI's gentle nudge. When the app infers what you
 * probably meant (e.g. a new floor sitting just off an existing one → snap the
 * shared edge flush), it surfaces a SMALL one-line text prompt with a one-tap
 * confirm — never a big modal, never a silent change. Least-intrusive by design.
 * See the ambient-inference-prompts memory / product vision.
 */
import { useAppStore } from '../../store/useAppStore'
import { useFloorplanLocalStore } from '../../store/useFloorplanLocalStore'
import { cinema } from '../../cinema/cinemaRuntime'

export default function InferencePrompt() {
  const suggestion = useAppStore((s) => s.inferenceSuggestion)
  const apply = useAppStore((s) => s.applyInferenceSuggestion)
  const dismiss = useAppStore((s) => s.dismissInferenceSuggestion)
  // A run still being drawn: its corners aren't finished, so a trim offer now
  // is about a wall you're in the middle of. It waits until the run ends.
  const midRun = useFloorplanLocalStore((s) => s.traceMode && s.traceStart != null)

  // Not during a take. A suggestion raised while the plan was being set up is
  // still up when the shot arms, and a chrome shot then carries an offer to fix
  // something nobody is looking at. Same gate as the G.C. bubble.
  if (cinema.active) return null
  if (!suggestion) return null
  if (midRun && suggestion.kind !== 'floor-flush') return null
  // Verb on the confirm button matches the suggestion kind.
  const verb = suggestion.kind === 'wall-corner' ? 'Trim'
    : suggestion.kind === 'wall-corner-all' ? (suggestion.trims.length > 1 ? 'Trim all' : 'Trim')
    : suggestion.kind === 'wall-line-snap' ? 'Align'
    : 'Snap'

  // Plain text over the model, in its own band under the top icons and clear
  // of the rail — the bottom band belongs to the trace controls, and the old
  // pill sat on top of them.
  return (
    <div
      role="status"
      style={{
        position: 'absolute',
        left: 'calc(var(--rail-w, 44px) + 8px)',
        top: 'calc(var(--top-icons-top, 52px) + var(--top-icons-h, 40px) + 8px)',
        maxWidth: 'calc(100vw - var(--rail-w, 44px) - 16px)',
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        columnGap: 6,
        color: '#f1f5f9',
        textShadow: 'var(--ink-on-model)',
        fontSize: 14,
        fontWeight: 600,
        zIndex: 'var(--z-hud)',
        pointerEvents: 'auto',
      }}
    >
      <span>{suggestion.message}</span>
      <button
        onClick={apply}
        style={{
          minWidth: 48, minHeight: 48, padding: '0 6px', background: 'none', border: 'none',
          color: '#67e8f9', textShadow: 'var(--ink-on-model)', fontWeight: 700, fontSize: 14, cursor: 'pointer',
        }}
      >
        <span style={{ border: '1.5px solid #67e8f9', borderRadius: 6, padding: '4px 10px' }}>{verb}</span>
      </button>
      <button
        onClick={dismiss}
        aria-label="Dismiss suggestion"
        style={{
          minWidth: 48, minHeight: 48, border: 'none', background: 'none', color: '#e2e8f0',
          textShadow: 'var(--ink-on-model)', fontSize: 20, lineHeight: 1, cursor: 'pointer',
        }}
      >
        ×
      </button>
    </div>
  )
}
