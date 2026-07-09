/**
 * InferencePrompt — the ambient AI's gentle nudge. When the app infers what you
 * probably meant (e.g. a new floor sitting just off an existing one → snap the
 * shared edge flush), it surfaces a SMALL one-line text prompt with a one-tap
 * confirm — never a big modal, never a silent change. Least-intrusive by design.
 * See the ambient-inference-prompts memory / product vision.
 */
import { useAppStore } from '../../store/useAppStore'

export default function InferencePrompt() {
  const suggestion = useAppStore((s) => s.inferenceSuggestion)
  const apply = useAppStore((s) => s.applyInferenceSuggestion)
  const dismiss = useAppStore((s) => s.dismissInferenceSuggestion)

  if (!suggestion) return null
  // Verb on the confirm button matches the suggestion kind.
  const verb = suggestion.kind === 'wall-corner' ? 'Trim'
    : suggestion.kind === 'wall-line-snap' ? 'Align'
    : 'Snap'

  return (
    <div
      role="status"
      style={{
        position: 'absolute',
        left: '50%',
        bottom: 96,
        transform: 'translateX(-50%)',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '7px 10px 7px 13px',
        borderRadius: 999,
        background: 'rgba(15,23,42,0.86)',
        border: '1px solid rgba(34,211,238,0.5)',
        boxShadow: '0 4px 14px rgba(0,0,0,0.35)',
        color: '#e5e7eb',
        fontSize: 13,
        whiteSpace: 'nowrap',
        zIndex: 60,
        backdropFilter: 'blur(4px)',
        pointerEvents: 'auto',
      }}
    >
      <span aria-hidden style={{ opacity: 0.9 }}>💡</span>
      <span>{suggestion.message}</span>
      <button
        onClick={apply}
        style={{
          border: 'none', borderRadius: 999, padding: '4px 12px',
          background: '#22d3ee', color: '#083344', fontWeight: 600, fontSize: 12.5, cursor: 'pointer',
        }}
      >
        {verb}
      </button>
      <button
        onClick={dismiss}
        aria-label="Dismiss suggestion"
        style={{
          border: 'none', background: 'transparent', color: '#94a3b8',
          fontSize: 16, lineHeight: 1, cursor: 'pointer', padding: '0 2px',
        }}
      >
        ×
      </button>
    </div>
  )
}
