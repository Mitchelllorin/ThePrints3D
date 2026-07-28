/**
 * AskAI — the in-app construction reference + AI, as a CONVERSATION.
 *
 * You ask, it answers. Offline it uses the app's baked-in construction standards
 * (grounded, no hallucination). With the proxy deployed (VITE_ASK_PROXY_URL) —
 * or, failing that, your own free Google AI Studio key — the Gemini brain answers
 * conversationally, grounded on those same specs. It is NOT an Anthropic key;
 * the comment here used to say Claude, but the call has always gone to Gemini.
 * Everything routes through askBrain.answer(); this file just renders the thread
 * + the key toggle. See src/services/askBrain.ts and src/services/aiKey.ts.
 */
import { useState, useRef, useEffect, type FormEvent } from 'react'
import { answer, reviewBuild, summarizeBuild, AI_PROXIED, type Turn } from '../../services/askBrain'
import { knowledgeCardCount, EXAMPLE_QUESTIONS } from '../../services/constructionKnowledge'
import { hasAiKey, setAiKey } from '../../services/aiKey'
import { useAppStore } from '../../store/useAppStore'
import styles from './AskAI.module.css'

export default function AskAI() {
  const [turns, setTurns] = useState<Turn[]>([])
  const [input, setInput] = useState('')
  const [pending, setPending] = useState(false)
  // Proxy configured → AI is on for everyone, no key to manage.
  const [keyed, setKeyed] = useState(AI_PROXIED || hasAiKey())
  const [keyOpen, setKeyOpen] = useState(false)
  const [keyInput, setKeyInput] = useState('')
  const endRef = useRef<HTMLDivElement>(null)

  // Build state for the "Check my build" review.
  const drawings = useAppStore((s) => s.drawings)
  const floorsAreas = useAppStore((s) => s.floorsAreas)
  const roofAreas = useAppStore((s) => s.roofAreas)
  const placedObjects = useAppStore((s) => s.placedObjects)
  const hasBuild = drawings.some((d) => d.parsedWalls.length > 0) || placedObjects.length > 0

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' })
  }, [turns, pending])

  const ask = async (q: string) => {
    const query = q.trim()
    if (!query || pending) return
    const history = turns
    setInput('')
    setTurns((t) => [...t, { role: 'user', text: query }])
    setPending(true)
    try {
      const reply = await answer(query, history)
      setTurns((t) => [...t, { role: 'assistant', reply }])
    } finally {
      setPending(false)
    }
  }

  const check = async () => {
    if (pending) return
    setTurns((t) => [...t, { role: 'user', text: '⚠ Check my build' }])
    setPending(true)
    try {
      const summary = summarizeBuild({
        scaleMmPerPx: drawings.find((d) => d.parsedWalls.length > 0)?.scaleMmPerPx ?? null,
        walls: drawings.flatMap((d) => d.parsedWalls),
        floorsCount: floorsAreas.length,
        roofsCount: roofAreas.length,
        objects: placedObjects.map((o) => ({ type: o.type, label: o.label })),
      })
      const reply = await reviewBuild(summary)
      setTurns((t) => [...t, { role: 'assistant', reply }])
    } finally {
      setPending(false)
    }
  }

  const saveKey = (e: FormEvent) => {
    e.preventDefault()
    setAiKey(keyInput)
    setKeyed(hasAiKey())
    setKeyOpen(false)
    setKeyInput('')
  }
  const clearKey = () => {
    setAiKey('')
    setKeyed(false)
  }

  return (
    <div className={styles.root}>
      {turns.length === 0 ? (
        <div className={styles.intro}>
          <p className={styles.tagline}>
            {keyed
              ? `✦ AI on — ask anything about the build, grounded in ${knowledgeCardCount()} baked-in specs.`
              : `Ask about heights, spans, sizes, symbols or code — grounded in ${knowledgeCardCount()} baked-in specs, offline.`}
          </p>
          {keyed ? (
            <p className={styles.aiStatus}>
              ✦ AI on
              {!AI_PROXIED && (
                <>
                  {' · '}
                  <button className={styles.aiLink} onClick={clearKey}>
                    remove key
                  </button>
                </>
              )}
            </p>
          ) : keyOpen ? (
            <form className={styles.keyRow} onSubmit={saveKey}>
              <input
                className={styles.keyInput}
                type="password"
                autoComplete="off"
                placeholder="Google AI Studio key (AIza…)"
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                aria-label="Google AI Studio API key"
              />
              <button className={styles.askBtn} type="submit" disabled={!keyInput.trim()}>
                Save
              </button>
            </form>
          ) : (
            <button className={styles.enableAi} onClick={() => setKeyOpen(true)}>
              ✦ Turn on the AI — free Google Gemini key
            </button>
          )}

          <div className={styles.examples}>
            {EXAMPLE_QUESTIONS.slice(0, 5).map((ex) => (
              <button key={ex} className={styles.exampleChip} onClick={() => ask(ex)}>
                {ex}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className={styles.thread}>
          {turns.map((t, i) =>
            t.role === 'user' ? (
              <div key={i} className={styles.userMsg}>
                {t.text}
              </div>
            ) : (
              <div key={i} className={styles.aiMsg}>
                <p className={styles.aiText}>{t.reply.text}</p>
                {(t.reply.viaAI || (t.reply.grounded && (t.reply.trade || t.reply.source))) && (
                  <p className={styles.sourceLine}>
                    {t.reply.viaAI && <span className={styles.aiTag}>✦ AI</span>}
                    {t.reply.trade && (
                      <span
                        className={`${styles.tradeTag} ${styles[`trade_${t.reply.trade}`] ?? ''}`}
                      >
                        {t.reply.trade}
                      </span>
                    )}
                    {t.reply.source}
                  </p>
                )}
                {t.reply.related.length > 0 && (
                  <div className={styles.related}>
                    {t.reply.related.map((r) => (
                      <div key={r.id} className={styles.relatedCard}>
                        <span className={styles.relatedTitle}>{r.title}</span>
                        <span className={styles.relatedAnswer}>{r.answer}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ),
          )}
          {pending && (
            <div className={styles.aiMsg}>
              <span className={styles.typing}>…thinking</span>
            </div>
          )}
          <div ref={endRef} />
        </div>
      )}

      <form
        className={styles.askRow}
        onSubmit={(e) => {
          e.preventDefault()
          ask(input)
        }}
      >
        <input
          className={styles.input}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask anything about the build…"
          aria-label="Ask a construction question"
        />
        <button className={styles.askBtn} type="submit" disabled={pending || !input.trim()}>
          Ask
        </button>
      </form>

      {hasBuild && (
        <button className={styles.checkBuild} onClick={check} disabled={pending}>
          ⚠ Check my build for mistakes
        </button>
      )}
    </div>
  )
}
