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
import { useState, useRef, useEffect, useMemo, type FormEvent } from 'react'
import { answer, AI_PROXIED, type Turn } from '../../services/askBrain'
import { reviewBuildModel, type FindingTarget } from '../../services/buildReview'
import { cameraForFinding } from '../../services/reviewFocus'
import { focusSceneFor } from '../../services/buildFocus'
import { FLOOR_ASSEMBLY_H } from '../../services/framingGeometry'
import { knowledgeCardCount, EXAMPLE_QUESTIONS } from '../../services/constructionKnowledge'
import { hasAiKey, setAiKey } from '../../services/aiKey'
import { getCatalogItem, VERTICAL_CIRCULATION } from '../../data/objectCatalog'
import { useAppStore } from '../../store/useAppStore'
import { useConfigStore } from '../../store/useConfigStore'
import { useSceneConfig } from '../../store/useSceneConfig'
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
  const overlay = useAppStore((s) => s.floorplanOverlay)
  const wizardInputs = useAppStore((s) => s.wizardInputs)
  const setCameraPreset = useAppStore((s) => s.setCameraPreset)
  const hasBuild = drawings.some((d) => d.parsedWalls.length > 0) || placedObjects.length > 0
  const ceilingM = useConfigStore((s) => s.ceilingHeightM)
  const studSpacingIn = useConfigStore((s) => s.studSpacingIn)
  const framingMaterial = useConfigStore((s) => s.framingMaterial)
  // Ceiling + floor assembly = the storey-to-storey rise. Read from the scene
  // config rather than the raw setting, because that is the height the walls on
  // storey 2 are actually framed to; jumping to an upper-storey finding with the
  // setting instead would land the camera at the wrong elevation.
  const storeyHeightM = useSceneConfig(wizardInputs).wallHeightM + FLOOR_ASSEMBLY_H

  const [reviewOpen, setReviewOpen] = useState(false)
  /**
   * What the user has already looked at and waved away.
   *
   * Dismissal cannot simply hide the badge until the build changes, because
   * that nags in the wrong direction: FIXING something changes the build, so the
   * badge would pop back up to tell you the list got shorter — an alert every
   * time the user does the right thing. So what brings it back is one of two
   * things, and nothing else:
   *
   *   • something NEW is wrong that was not in the list when it was dismissed
   *   • the count to deal with went UP (including by reverting a fix)
   *
   * Both mean "there is work here you have not seen". A shorter list means the
   * opposite, and stays quiet.
   */
  const [dismissed, setDismissed] = useState<{ ids: string[]; count: number } | null>(null)
  /** The review is a WALK, not a page of prose: one problem, one action, next.
   *  `step` is where you are in that walk, `why` whether the reasoning is open.
   *  Both reset per finding so "why" never carries over onto the next thing. */
  const [step, setStep] = useState(0)
  const [whyOpen, setWhyOpen] = useState(false)

  /**
   * THE REVIEW IS LIVE, not a button you press.
   *
   * The rules are a pure function over state the app already holds, so they run
   * on every change instead of on demand (a few hundred microseconds on a real
   * plan). That is what makes the badge honest — it counts what is wrong NOW,
   * and it drops back to nothing the moment the last finding is fixed, with no
   * "check again" step standing between the user and the truth.
   */
  const review = useMemo(() => {
    if (!hasBuild) return null
    // Flat walls, in the order the review checks them — a finding's wallIndex
    // indexes THIS array, so the world points below must be built in step with
    // it, drawing by drawing and wall by wall.
    const walls = drawings.flatMap((d) => d.parsedWalls)
    const openingObjects = placedObjects.filter((o) => o.type === 'door' || o.type === 'window')
    const openings = openingObjects.map((o) => ({
      type: o.type,
      subtype: o.subtype,
      widthM: (getCatalogItem(o.type)?.defaultW ?? 0.9144) * (o.scaleX || 1),
      level: o.level ?? 0,
    }))
    const input = {
      scaleMmPerPx: drawings.find((d) => d.parsedWalls.length > 0)?.scaleMmPerPx ?? null,
      walls,
      openings,
      floors: floorsAreas.map((f) => ({ level: f.level, elementType: f.elementType })),
      roofs: roofAreas.map((r) => ({ level: r.level })),
      hasVerticalCirculation: placedObjects.some((o) => VERTICAL_CIRCULATION.has(o.type)),
      // null in the config store means "unset", which the rules read as absent.
      ceilingM: ceilingM ?? undefined,
      studSpacingIn,
      framingMaterial,
    }

    // Where each wall and opening IS, in world metres. Shared with F.U.S.E.,
    // which points a camera at the same building from the same numbers — see
    // services/buildFocus.ts.
    const { scene } = focusSceneFor({ drawings, placedObjects, overlay, storeyHeightM })

    const findings = reviewBuildModel(input)
    return {
      input,
      findings,
      focus: scene,
      signature: findings.map((f) => f.id).join('|'),
      toFix: findings.filter((f) => f.severity === 'STOP').length,
      toVerify: findings.filter((f) => f.severity === 'CHECK').length,
    }
  }, [
    hasBuild, drawings, placedObjects, floorsAreas, roofAreas,
    ceilingM, studSpacingIn, framingMaterial, overlay, storeyHeightM,
  ])

  // What the badge counts: the two grades that ask something of the builder.
  // FYIs (walls framed to the default, walls inferred from rooms) are worth
  // reading and are not worth a number on the button — a counter that includes
  // them is a counter that gets ignored.
  const toDealWith = review ? review.toFix + review.toVerify : 0
  const worstOffenders = review ? review.findings.filter((f) => f.severity !== 'FYI') : []
  /** Worst first: what stops the build, then what to verify, then the notes.
   *  In that order the first screen is always the thing that matters most, and
   *  the walk reads as a worklist instead of an archive. */
  const ordered = useMemo(() => {
    const rank = { STOP: 0, CHECK: 1, FYI: 2 } as const
    return review ? [...review.findings].sort((a, b) => rank[a.severity] - rank[b.severity]) : []
  }, [review])
  const stepIndex = ordered.length === 0 ? 0 : Math.min(step, ordered.length - 1)
  const shown = ordered[stepIndex]
  const showBadge = !reviewOpen && review != null && toDealWith > 0 && (
    dismissed == null ||
    toDealWith > dismissed.count ||
    worstOffenders.some((f) => !dismissed.ids.includes(f.id))
  )

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

  /**
   * Take me there. One tap on a finding and the camera flies to the wall, the
   * opening or the storey it is about — the finding stops being a sentence you
   * have to go hunting through the plan to make sense of.
   */
  const jumpTo = (target?: FindingTarget) => {
    if (!review) return
    setCameraPreset(cameraForFinding(target, review.focus))
    // The card STAYS. It is one line at the bottom-left now, not a list, so it
    // no longer covers what the camera flew to — and closing it would throw
    // away the place in the walk every time the user looked at something.
  }

  const goStep = (n: number) => {
    setStep(n)
    setWhyOpen(false)
  }

  /**
   * NO TEXT DUMPS.
   *
   * "Explain these" used to paste every finding into the conversation as one
   * `• [STOP] …` block — a wall of prose in a bubble that, like every message,
   * could never be closed. It buried the model it was describing and left the
   * user with homework instead of a next step. The reasoning now lives behind
   * "Why?" on the finding itself: same words, opened one problem at a time, and
   * gone the moment you move on.
   */
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
    <div className={`${styles.root} ${reviewOpen ? styles.rootReview : ''}`}>
      {turns.length === 0 && !reviewOpen ? (
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

      {/* Nothing in the conversation is permanent any more: a long answer used
          to sit there with no way to clear it, which is what made an answer
          feel like an obstruction rather than an answer. One tap clears. */}
      {turns.length > 0 && (
        <div className={styles.threadTools}>
          <button className={styles.clearThread} onClick={() => setTurns([])}>
            clear
          </button>
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

      {hasBuild && review && (
        <>
          {reviewOpen && (
            <div className={styles.reviewPanel} role="dialog" aria-label="Build review">
              <div className={styles.reviewHead}>
                <span className={styles.reviewCount}>
                  {ordered.length === 0 ? 'Nothing to fix' : `${stepIndex + 1} of ${ordered.length}`}
                </span>
                <button
                  className={styles.reviewClose}
                  onClick={() => {
                    setReviewOpen(false)
                    setDismissed({ ids: worstOffenders.map((f) => f.id), count: toDealWith })
                  }}
                  aria-label="Close the build review"
                >
                  ✕
                </button>
              </div>

              {ordered.length === 0 ? (
                <p className={styles.reviewClear}>
                  Nothing I can check is missing or outside a rule.
                </p>
              ) : (
                <>
                  <div className={styles.stepCard}>
                    <span className={`${styles.dot} ${styles[`dot_${shown.severity}`] ?? ''}`} />
                    <div className={styles.stepBody}>
                      <span className={styles.stepTitle}>{shown.title}</span>
                      <span className={styles.stepFix}>{shown.fix}</span>
                      {whyOpen && (
                        <p className={styles.stepWhy}>
                          {shown.detail}
                          {shown.citation ? ` · ${shown.citation}` : ''}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className={styles.stepNav}>
                    <button className={styles.stepGo} onClick={() => jumpTo(shown.target)}>
                      Show me
                    </button>
                    <button className={styles.stepWhyBtn} onClick={() => setWhyOpen((w) => !w)}>
                      {whyOpen ? 'Hide' : 'Why?'}
                    </button>
                    {/* The AI, one finding at a time. It used to review the whole
                        build at once and post the lot — that is the wall of text
                        again. Asked about the thing on screen it answers in a
                        sentence or two, which is a second opinion you can use. */}
                    {keyed && (
                      <button
                        className={styles.stepWhyBtn}
                        onClick={() =>
                          ask(`On a building: ${shown.title}. Why does it matter and what should I do?`)
                        }
                        disabled={pending}
                      >
                        ✦ Ask
                      </button>
                    )}
                    <span className={styles.stepArrows}>
                      <button
                        className={styles.stepArrow}
                        onClick={() => goStep(stepIndex - 1)}
                        disabled={stepIndex === 0}
                        aria-label="Previous finding"
                      >
                        ‹
                      </button>
                      <button
                        className={styles.stepArrow}
                        onClick={() => goStep(stepIndex + 1)}
                        disabled={stepIndex >= ordered.length - 1}
                        aria-label="Next finding"
                      >
                        ›
                      </button>
                    </span>
                  </div>
                </>
              )}
            </div>
          )}
          <button
            className={styles.checkBuild}
            onClick={() => setReviewOpen((o) => !o)}
            disabled={pending}
          >
            ⚠ Check my build
            {showBadge && (
              <span className={`${styles.badgeCount} ${review.toFix > 0 ? styles.badgeStop : ''}`}>
                {toDealWith}
              </span>
            )}
          </button>
        </>
      )}
    </div>
  )
}
