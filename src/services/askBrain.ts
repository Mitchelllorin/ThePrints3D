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

// YOUR deployed proxy URL (Cloudflare Worker / Vercel / …). When set, the app
// calls the proxy — your Gemini key stays server-side and USERS NEED NO KEY.
// Set it at build time: VITE_ASK_PROXY_URL=https://…workers.dev in .env.
// Empty → fall back to own-key-on-device (dev) → offline specs.
const PROXY_URL = (import.meta.env.VITE_ASK_PROXY_URL as string | undefined)?.trim() || ''

/** True when the app talks to YOUR proxy — users need no key of their own. */
export const AI_PROXIED = PROXY_URL !== ''

/** Stable-ish per-device id for the proxy's free-tier cap (not identifying). */
function deviceId(): string {
  try {
    let id = localStorage.getItem('bp3d-device-id')
    if (!id) {
      id = 'd_' + Math.random().toString(36).slice(2) + Date.now().toString(36)
      localStorage.setItem('bp3d-device-id', id)
    }
    return id
  } catch {
    return 'anon'
  }
}

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

// ── the brain (Google Gemini, free tier) ──────────────────────────────────────
// Gemini's free tier needs no credit card and allows direct browser calls (no
// CORS header dance). The user pastes a Google AI Studio key (aiKey.ts). If
// Google renames/retires this model the call just errors → offline fallback.

const MODEL = 'gemini-2.0-flash'

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

/** True when a server proxy is configured — then users need no key of their own. */
export function aiAvailable(): boolean {
  return PROXY_URL !== '' || hasAiKey()
}

/** Thrown when the proxy's free daily cap is reached — surfaced as an upsell. */
export class FreeLimitError extends Error {}

async function askProxy(query: string, history: Turn[], cards: KnowledgeAnswer[]): Promise<string> {
  const messages = [
    ...history.map((t) => ({
      role: t.role,
      content: t.role === 'user' ? t.text : t.reply.text,
    })),
    { role: 'user' as const, content: query },
  ]
  const specs = cards.map((c) => `- ${c.title}: ${c.answer} [${c.source}]`).join('\n')

  const res = await fetch(PROXY_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ messages, specs, deviceId: deviceId() }),
  })
  if (res.status === 429) throw new FreeLimitError('free_limit')
  if (!res.ok) throw new Error(`Proxy ${res.status}`)
  const data = (await res.json()) as { text?: string }
  const text = (data.text ?? '').trim()
  if (!text) throw new Error('empty response')
  return text
}

async function askGemini(query: string, history: Turn[], cards: KnowledgeAnswer[]): Promise<string> {
  // Gemini uses role "model" (not "assistant") and a separate system_instruction.
  const contents = [
    ...history.map((t) => ({
      role: t.role === 'user' ? 'user' : 'model',
      parts: [{ text: t.role === 'user' ? t.text : t.reply.text }],
    })),
    { role: 'user', parts: [{ text: query }] },
  ]

  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent` +
    `?key=${encodeURIComponent(getAiKey())}`

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemPrompt(cards) }] },
      contents,
      generationConfig: { maxOutputTokens: 1024, temperature: 0.3 },
    }),
  })

  if (!res.ok) throw new Error(`Gemini ${res.status}`)
  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[]
  }
  const text = (data.candidates?.[0]?.content?.parts ?? [])
    .map((p) => p.text ?? '')
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

  // ── brain path: proxy (no user key) first, then own-key, then offline ──
  if (PROXY_URL || hasAiKey()) {
    try {
      const text = PROXY_URL
        ? await askProxy(trimmed, history, hits)
        : await askGemini(trimmed, history, hits)
      const primary = hits[0]
      return {
        text,
        trade: primary?.trade,
        related: hits.slice(0, 2),
        grounded: hits.length > 0,
        viaAI: true,
      }
    } catch (e) {
      if (e instanceof FreeLimitError) {
        return {
          text: "You've used today's free AI questions. They reset tomorrow — meanwhile I can still answer from the built-in specs below.",
          related: hits.slice(0, 2),
          grounded: hits.length > 0,
        }
      }
      // Any other failure (offline, error) → fall through to the specs.
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

// ── proactive review: catch mistakes in what the user built ────────────────────

interface WallLite {
  x1: number; y1: number; x2: number; y2: number
  framingType?: string; wallRole?: string; level?: number
}
interface ObjLite { type: string; label?: string }

/** Compact, human-readable summary of the current build for the reviewer. */
export function summarizeBuild(input: {
  scaleMmPerPx: number | null
  walls: WallLite[]
  floorsCount: number
  roofsCount: number
  objects: ObjLite[]
}): string {
  const { scaleMmPerPx, walls, floorsCount, roofsCount, objects } = input
  const ft = (px: number) => {
    if (scaleMmPerPx == null) return '?'
    return `${((px * scaleMmPerPx) / 304.8).toFixed(1)} ft`
  }
  const lines: string[] = []
  lines.push(scaleMmPerPx ? 'Scale: calibrated.' : 'Scale: NOT calibrated (lengths unknown).')
  lines.push(`${walls.length} walls, ${floorsCount} floor area(s), ${roofsCount} roof area(s).`)
  walls.slice(0, 40).forEach((w, i) => {
    const len = Math.hypot(w.x2 - w.x1, w.y2 - w.y1)
    lines.push(
      `Wall ${i + 1}: ${ft(len)} long` +
        (w.framingType ? `, ${w.framingType}` : '') +
        (w.wallRole ? `, ${w.wallRole}` : '') +
        (w.level ? `, level ${w.level + 1}` : ''),
    )
  })
  if (walls.length > 40) lines.push(`…and ${walls.length - 40} more walls.`)
  const byType = new Map<string, number>()
  for (const o of objects) byType.set(o.type, (byType.get(o.type) ?? 0) + 1)
  lines.push(
    byType.size
      ? 'Placed: ' + [...byType].map(([t, n]) => `${n}× ${t}`).join(', ') + '.'
      : 'No fixtures/openings placed yet.',
  )
  return lines.join('\n')
}

function reviewSystemPrompt(): string {
  return [
    "You are a master builder doing a plan check on a tradesperson's in-progress",
    '3D building model. Review the build summary below for mistakes and code issues',
    'across framing, electrical (NEC), plumbing (IPC/UPC), HVAC, insulation, and',
    'foundations — U.S. residential.',
    '',
    'Output ONLY a short list of concrete findings, most important first. Each line:',
    '  • [severity] finding — the fix, with a code reference if there is one.',
    'severity is one of: STOP (unsafe / will not pass), CHECK (likely wrong, verify),',
    'or FYI (minor). If the build looks fine as far as you can tell, say so in one',
    "line. Be specific to the numbers given; don't invent details not in the summary.",
    'No preamble, no markdown headings.',
  ].join('\n')
}

/** Review the current build and return findings. Requires the AI key. */
export async function reviewBuild(summary: string): Promise<AskReply> {
  if (!hasAiKey()) {
    return {
      text: 'Turn on the AI (free Gemini key) to have me review your build for mistakes.',
      related: [],
      grounded: false,
    }
  }
  try {
    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent` +
      `?key=${encodeURIComponent(getAiKey())}`
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: reviewSystemPrompt() }] },
        contents: [{ role: 'user', parts: [{ text: `Build summary:\n${summary}` }] }],
        generationConfig: { maxOutputTokens: 1024, temperature: 0.2 },
      }),
    })
    if (!res.ok) throw new Error(`Gemini ${res.status}`)
    const data = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[]
    }
    const text = (data.candidates?.[0]?.content?.parts ?? [])
      .map((p) => p.text ?? '')
      .join('')
      .trim()
    if (!text) throw new Error('empty')
    return { text, related: [], grounded: true, viaAI: true }
  } catch {
    return {
      text: "Couldn't reach the AI to review just now — check your connection and try again.",
      related: [],
      grounded: false,
    }
  }
}
