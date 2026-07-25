// askBrain — the ONE seam the Ask chat talks to.
//
// Two layers, best-available wins:
//  1. GROUNDED CARDS (constructionKnowledge.ts) — deterministic, offline, free,
//     no hallucination. Always computed; it's the source of truth and the
//     offline fallback.
//  2. THE BRAIN (Claude Opus 4.8) — a master-builder that answers conversation-
//     ally, reasons about the question, and knows construction far past the
//     cards. It is GROUNDED on the same cards (passed as reference) and told to
//     cite + flag when it goes beyond them, so it stays anchored. Only used when
//     the user has set their own API key (aiKey.ts) and the call succeeds; any
//     failure (no key, offline, error) silently falls back to layer 1.

import { askConstruction, type KnowledgeAnswer, type Trade } from './constructionKnowledge'
import { getAiKey, hasAiKey } from './aiKey'

/** One assistant reply. `related` are supporting cards shown beneath the answer. */
export interface AskReply {
  text: string
  trade?: Trade
  source?: string
  related: KnowledgeAnswer[]
  /** True when a baked-in spec backs the answer; false = we don't know it yet. */
  grounded: boolean
  /** True when the Claude brain produced this (vs the offline lookup). */
  viaAI?: boolean
}

/** A single line of the conversation. Assistant turns carry the full reply. */
export type Turn =
  | { role: 'user'; text: string }
  | { role: 'assistant'; reply: AskReply }

const NO_MATCH =
  "I don't have a grounded spec for that yet — try naming a trade or element " +
  '(outlet, toilet, stud, R-value, header, duct, footing) or a symbol.'

// ── the Claude brain ──────────────────────────────────────────────────────────

const MODEL = 'claude-opus-4-8'

function systemPrompt(cards: KnowledgeAnswer[]): string {
  const specs = cards.length
    ? cards.map((c) => `- ${c.title}: ${c.answer} [${c.source}]`).join('\n')
    : '(no directly matching spec found)'
  return [
    'You are a master builder embedded in ThePrints3D, a 3D floor-plan and framing',
    'app for tradespeople. Answer construction questions across framing, electrical',
    '(NEC), plumbing (IPC/UPC), HVAC, insulation, drywall, finishes, foundations,',
    'and drawing symbols.',
    '',
    'Ground your answer in these baked-in reference specs when they apply, and cite',
    'the code/standard:',
    '<specs>',
    specs,
    '</specs>',
    '',
    'Rules:',
    '- Lead with the number/answer, then a short why. A tradesperson on a job site is asking.',
    '- Prefer the specs above; when you go beyond them, use your expertise but say so.',
    '- These are U.S. residential defaults — note "verify against local code / the AHJ" when it matters.',
    '- Plain text, no markdown headings, no preamble. Keep it tight.',
  ].join('\n')
}

async function askClaude(query: string, history: Turn[], cards: KnowledgeAnswer[]): Promise<string> {
  const messages = [
    ...history.map((t) =>
      t.role === 'user'
        ? { role: 'user' as const, content: t.text }
        : { role: 'assistant' as const, content: t.reply.text },
    ),
    { role: 'user' as const, content: query },
  ]

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': getAiKey(),
      'anthropic-version': '2023-06-01',
      // Required for direct browser/WebView calls with the user's own key.
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      system: systemPrompt(cards),
      messages,
    }),
  })

  if (!res.ok) throw new Error(`Claude ${res.status}`)
  const data = (await res.json()) as { content?: { type: string; text?: string }[] }
  const text = (data.content ?? [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('')
    .trim()
  if (!text) throw new Error('empty response')
  return text
}

// ── the ask ───────────────────────────────────────────────────────────────────

/**
 * Answer a construction question. Uses the Claude brain when a key is set and
 * reachable; otherwise the offline grounded lookup. `history` threads the
 * conversation (and lets short offline follow-ups keep their subject).
 */
export async function answer(query: string, history: Turn[] = []): Promise<AskReply> {
  const trimmed = query.trim()
  if (!trimmed) return { text: NO_MATCH, related: [], grounded: false }

  // Last thing the user asked — the subject a terse follow-up leans on (offline path).
  let prevUserText = ''
  for (const t of history) if (t.role === 'user') prevUserText = t.text
  const isFollowUp = trimmed.split(/\s+/).length <= 3 && prevUserText !== ''
  const effective = isFollowUp ? `${prevUserText} ${trimmed}` : trimmed

  // Grounding cards — feed the brain, and back the offline answer.
  const hits = askConstruction(effective, 6)

  // ── brain path ──
  if (hasAiKey()) {
    try {
      const text = await askClaude(trimmed, history, hits)
      const primary = hits[0]
      return {
        text,
        trade: primary?.trade,
        related: hits.slice(0, 2),
        grounded: hits.length > 0,
        viaAI: true,
      }
    } catch {
      // Any failure (offline, bad key, rate limit) → fall through to the specs.
    }
  }

  // ── offline grounded path ──
  if (hits.length === 0) return { text: NO_MATCH, related: [], grounded: false }
  const [primary, ...rest] = hits
  return {
    text: primary.answer,
    trade: primary.trade,
    source: primary.source,
    related: rest.slice(0, 2),
    grounded: true,
  }
}
