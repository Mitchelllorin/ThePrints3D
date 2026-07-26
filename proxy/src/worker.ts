/**
 * ThePrints3D — Ask AI proxy (Cloudflare Worker).
 *
 * The app calls THIS instead of Google directly, so YOUR Gemini key lives
 * server-side (a Worker secret) and never ships in the app — users need no key.
 * The Worker owns the construction system prompt, so a caller can only ask
 * construction questions — they can't use your key for arbitrary prompts. A
 * simple per-device daily cap (KV) is the free tier; beyond it, the Worker
 * returns 429 and the app falls back to the offline grounded specs.
 *
 * Portable: the only Cloudflare-specific bits are the KV rate-cap and the
 * `export default { fetch }` shape. On Vercel/Netlify/Deno, swap KV for that
 * host's store (or drop the cap for v1); the Gemini call is identical.
 *
 * Request  (POST, JSON): { messages: {role,content}[], specs?: string, deviceId?: string }
 * Response (JSON):        { text, remaining }   |   429 { error:"free_limit", remaining:0 }
 *
 * NOTE: this is the interim gate (device cap + fixed prompt). Real per-user
 * entitlement/billing (Play Billing → verified receipt) is a later step; see README.
 */

export interface Env {
  /** YOUR Google AI Studio (Gemini) key — stored as a Worker secret, never shipped. */
  GEMINI_API_KEY: string
  ASK_KV: KVNamespace
  /** Free AI questions per device per day (default 10). */
  FREE_PER_DAY?: string
}

interface Msg {
  role: 'user' | 'assistant'
  content: string
}

const MODEL = 'gemini-2.0-flash'
const MAX_TOKENS = 1024

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...CORS },
  })
}

function systemPrompt(specs: string): string {
  const block = specs?.trim() ? specs.trim() : '(no directly matching spec found)'
  return [
    'You are a master builder embedded in ThePrints3D, a 3D floor-plan and framing',
    'app for tradespeople. Answer construction questions across framing, electrical',
    '(NEC), plumbing (IPC/UPC), HVAC, insulation, drywall, finishes, foundations,',
    'and drawing symbols. Refuse anything unrelated to construction.',
    '',
    'Ground your answer in these baked-in reference specs when they apply, and cite',
    'the code/standard:',
    '<specs>',
    block,
    '</specs>',
    '',
    'Rules:',
    '- Lead with the number/answer, then a short why. A tradesperson on a job site is asking.',
    '- Prefer the specs above; when you go beyond them, use your expertise but say so.',
    '- These are U.S. residential defaults — note "verify against local code / the AHJ" when it matters.',
    '- Plain text, no markdown headings, no preamble. Keep it tight.',
  ].join('\n')
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
    if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

    let body: { messages?: Msg[]; specs?: string; deviceId?: string }
    try {
      body = await req.json()
    } catch {
      return json({ error: 'bad_json' }, 400)
    }

    const messages = Array.isArray(body.messages) ? body.messages : []
    const last = messages[messages.length - 1]
    if (!last || last.role !== 'user' || typeof last.content !== 'string' || !last.content.trim()) {
      return json({ error: 'no_query' }, 400)
    }

    // ── free-tier gate (per device, per day) ──
    const cap = Math.max(0, Number(env.FREE_PER_DAY ?? '10'))
    const day = new Date().toISOString().slice(0, 10)
    const id = String(body.deviceId || req.headers.get('cf-connecting-ip') || 'anon').slice(0, 64)
    const kvKey = `q:${id}:${day}`
    const used = Number((await env.ASK_KV.get(kvKey)) ?? '0')
    if (used >= cap) return json({ error: 'free_limit', remaining: 0 }, 429)

    // ── call Gemini with YOUR key (never leaves the Worker) ──
    // Gemini uses role "model" (not "assistant") + a separate system_instruction.
    const contents = messages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: String(m.content) }],
    }))
    let upstream: Response
    try {
      upstream = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent` +
          `?key=${encodeURIComponent(env.GEMINI_API_KEY)}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: systemPrompt(body.specs ?? '') }] },
            contents,
            generationConfig: { maxOutputTokens: MAX_TOKENS, temperature: 0.3 },
          }),
        },
      )
    } catch {
      return json({ error: 'upstream_unreachable' }, 502)
    }

    if (!upstream.ok) return json({ error: 'upstream', status: upstream.status }, 502)

    const data = (await upstream.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[]
    }
    const text = (data.candidates?.[0]?.content?.parts ?? [])
      .map((p) => p.text ?? '')
      .join('')
      .trim()
    if (!text) return json({ error: 'empty' }, 502)

    // Count the successful question; entry self-expires after 48h.
    await env.ASK_KV.put(kvKey, String(used + 1), { expirationTtl: 60 * 60 * 48 })

    return json({ text, remaining: Math.max(0, cap - (used + 1)) })
  },
}
