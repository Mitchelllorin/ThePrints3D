// Construction knowledge — the on-device "genius" answer engine.
//
// This is the grounded FACTS layer: it turns the construction-standards data the
// app already ships (tradeRules + data/defaults/*.json + the symbol glossary)
// into a searchable body of answers. Ask a plain-language question — "what height
// for a kitchen outlet?", "header span for a 2x10?", "what's a Type X board?" —
// and it returns the relevant spec and its citation, offline, no hallucination. A
// conversational brain (Claude API) can plug in ON TOP of this later, grounding
// its replies on these same cards. The facts never depend on it.

import {
  ELECTRICAL_MOUNTS,
  PLUMBING_FIXTURES,
  wireGaugeForAmps,
  STACK_SIZE_IN,
  BRANCH_SIZE_IN,
  WATER_MAIN_IN,
  OUTLET_MAX_SPACING_M,
} from './tradeRules'
import electrical from '../data/defaults/electrical.json'
import plumbing from '../data/defaults/plumbing.json'
import framing from '../data/defaults/framing.json'
import hvac from '../data/defaults/hvac.json'
import insulation from '../data/defaults/insulation.json'
import drywall from '../data/defaults/drywall.json'
import finishes from '../data/defaults/finishes.json'
import excavation from '../data/defaults/excavation.json'
import glossary from '../symbols/glossary.json'

export type Trade =
  | 'electrical' | 'plumbing' | 'framing' | 'hvac'
  | 'insulation' | 'drywall' | 'finishes' | 'excavation'
  | 'symbols' | 'general'

export interface KnowledgeCard {
  id: string
  trade: Trade
  title: string
  answer: string
  source: string
  keywords: string[]
}

export interface KnowledgeAnswer extends KnowledgeCard {
  score: number
}

// ── unit helpers ──────────────────────────────────────────────────────────────
const M_TO_IN = 39.3701
const inches = (m: number): string => `${Math.round(m * M_TO_IN)}"`
const mmToIn = (mm: number): string => {
  const v = Math.round((mm / 25.4) * 8) / 8
  return `${v}"`
}

const tokenize = (s: string): string[] =>
  (s || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s.-]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1)

// ── build the card index once ───────────────────────────────────────────────────

function buildCards(): KnowledgeCard[] {
  const cards: KnowledgeCard[] = []
  const add = (c: KnowledgeCard) => cards.push(c)

  // ELECTRICAL — mount heights (tradeRules) ------------------------------------
  for (const [type, rule] of Object.entries(ELECTRICAL_MOUNTS)) {
    add({
      id: `elec-mount-${type}`,
      trade: 'electrical',
      title: `${type.replace(/-/g, ' ')} — mount height`,
      answer: `Mount a ${type.replace(/-/g, ' ')} at ~${inches(rule.heightM)} AFF (to device centre). ${rule.note}`,
      source: 'NEC 210.52 / common practice',
      keywords: [...tokenize(type), 'height', 'mount', 'aff', 'electrical', 'wire', ...tokenize(rule.note)],
    })
  }

  // ELECTRICAL — outlet spacing (electrical.json) ------------------------------
  for (const [room, s] of Object.entries(electrical.outletSpacing)) {
    add({
      id: `elec-spacing-${room}`,
      trade: 'electrical',
      title: `Outlet spacing — ${room}`,
      answer: `${room[0].toUpperCase()}${room.slice(1)}: ${s.label}. Height ~${Math.round(s.heightFromFloorM * M_TO_IN)}" AFF.`,
      source: 'NEC 210.52',
      keywords: [...tokenize(room), 'outlet', 'receptacle', 'spacing', 'apart', 'distance', 'plug'],
    })
  }
  add({
    id: 'elec-outlet-maxspan',
    trade: 'electrical',
    title: 'Max distance between outlets',
    answer: `No point along a wall may be more than 6 ft from a receptacle — so outlets sit no more than ${inches(OUTLET_MAX_SPACING_M)} (12 ft) apart.`,
    source: 'NEC 210.52(A)',
    keywords: ['outlet', 'receptacle', 'spacing', 'distance', 'apart', '6', 'foot', 'feet', 'far', 'max'],
  })

  // ELECTRICAL — switch / panel ------------------------------------------------
  for (const [k, v] of Object.entries(electrical.switchHeight)) {
    add({
      id: `elec-switch-${k}`,
      trade: 'electrical',
      title: `Switch height — ${k}`,
      answer: `Wall switch (${k}): ${v.label}.`,
      source: k === 'ada' ? 'ADA' : 'Common practice',
      keywords: ['switch', 'height', 'aff', k, 'light'],
    })
  }
  for (const [k, v] of Object.entries(electrical.panelDefaults)) {
    add({
      id: `elec-panel-${k}`,
      trade: 'electrical',
      title: `Service panel — ${k}`,
      answer: `${k[0].toUpperCase()}${k.slice(1)} default panel: ${v.label}.`,
      source: 'NEC',
      keywords: ['panel', 'load', 'centre', 'center', 'service', 'amps', 'breaker', k],
    })
  }

  // ELECTRICAL — wire gauge table ----------------------------------------------
  add({
    id: 'elec-wire-table',
    trade: 'electrical',
    title: 'Wire gauge by amperage (copper NM-B)',
    answer: '15A→14 AWG, 20A→12 AWG, 30A→10 AWG, 40A→8 AWG, 50A→6 AWG, 60A→4 AWG, 100A→2 AWG (copper Romex, residential).',
    source: 'NEC 310.16',
    keywords: ['wire', 'gauge', 'awg', 'amp', 'amps', 'amperage', 'romex', 'nm-b', 'copper', 'breaker', 'conductor', 'size'],
  })

  // PLUMBING — fixture rough-ins (tradeRules) ----------------------------------
  for (const [type, rule] of Object.entries(PLUMBING_FIXTURES)) {
    add({
      id: `plumb-fixture-${type}`,
      trade: 'plumbing',
      title: `${type.replace(/-/g, ' ')} — rough-in`,
      answer: `${type.replace(/-/g, ' ')}: ${rule.drainIn}" drain${rule.drainM > 0 ? ` at ~${inches(rule.drainM)} AFF` : ' at floor'}, ${rule.supplyIn}" supply${rule.supplyM > 0 ? ` at ~${inches(rule.supplyM)} AFF` : ''}. ${rule.note}`,
      source: 'IPC / UPC',
      keywords: [...tokenize(type), 'rough', 'roughin', 'drain', 'supply', 'plumbing', 'pipe', 'fixture', ...tokenize(rule.note)],
    })
  }
  add({
    id: 'plumb-stacks',
    trade: 'plumbing',
    title: 'Drain / stack / water-main sizes',
    answer: `Main building drain & soil stack: ${STACK_SIZE_IN}". Branch serving a toilet: ${BRANCH_SIZE_IN}". Water service into the building: ${WATER_MAIN_IN}".`,
    source: 'IPC / UPC',
    keywords: ['stack', 'soil', 'drain', 'main', 'branch', 'water', 'service', 'sewer', 'size', 'pipe', 'diameter'],
  })
  for (const [k, v] of Object.entries(plumbing.pipeSizes)) {
    add({
      id: `plumb-pipe-${k}`,
      trade: 'plumbing',
      title: `Pipe size — ${v.label}`,
      answer: `${v.label}: ${mmToIn(v.diameterMm)} nominal (${v.diameterMm} mm).`,
      source: 'IPC / UPC',
      keywords: ['pipe', 'size', 'diameter', 'supply', 'drain', ...tokenize(v.label)],
    })
  }

  // FRAMING — stud sizes, spacing ----------------------------------------------
  for (const [k, v] of Object.entries(framing.studSizes)) {
    add({
      id: `framing-stud-${k}`,
      trade: 'framing',
      title: `Stud size — ${v.label}`,
      answer: `${v.label}. Actual ${v.actualWidthMm}×${v.actualDepthMm} mm.`,
      source: 'Nominal lumber',
      keywords: ['stud', 'lumber', 'size', 'nominal', 'actual', 'dimensional', k, v.nominalIn, ...tokenize(v.label)],
    })
  }
  for (const [k, v] of Object.entries(framing.spacings)) {
    add({
      id: `framing-oc-${k}`,
      trade: 'framing',
      title: `On-centre spacing — ${v.inches}"`,
      answer: `${v.label} = ${v.inches}" OC (${v.mm} mm).`,
      source: 'IRC framing',
      keywords: ['oc', 'on', 'centre', 'center', 'spacing', 'stud', 'joist', 'rafter', String(v.inches), ...tokenize(v.label)],
    })
  }

  // HVAC — ducts ----------------------------------------------------------------
  for (const [k, v] of Object.entries(hvac.ductSizes)) {
    add({
      id: `hvac-duct-${k}`,
      trade: 'hvac',
      title: `Duct size — ${v.label}`,
      answer: `${v.label}: ${v.widthMm}×${v.heightMm} mm.`,
      source: 'ACCA Manual D',
      keywords: ['duct', 'trunk', 'branch', 'hvac', 'air', 'size', k, ...tokenize(v.label)],
    })
  }

  // INSULATION — R-values ------------------------------------------------------
  for (const [k, v] of Object.entries(insulation.types)) {
    add({
      id: `insul-${k}`,
      trade: 'insulation',
      title: `Insulation — ${v.label}`,
      answer: `${v.label}: R-${v.rValuePerInch} per inch. ${v.note}`,
      source: 'IECC',
      keywords: ['insulation', 'r-value', 'rvalue', 'r', 'value', 'foam', 'batt', 'fiberglass', k, ...tokenize(v.label), ...tokenize(v.note)],
    })
  }

  // DRYWALL — board types & fire ratings ---------------------------------------
  for (const [k, v] of Object.entries(drywall.boardTypes)) {
    add({
      id: `drywall-${k}`,
      trade: 'drywall',
      title: `Drywall — ${v.label}`,
      answer: `${v.label}: ${v.thicknessMm} mm thick${v.fireRating && v.fireRating !== 'none' ? `, ${v.fireRating} fire rating` : ', no fire rating'}.`,
      source: 'ASTM C1396',
      keywords: ['drywall', 'gypsum', 'board', 'sheetrock', 'fire', 'rated', 'type', k, ...tokenize(v.label)],
    })
  }

  // FINISHES -------------------------------------------------------------------
  for (const [group, key] of [['wallFinishes', 'wall'], ['floorFinishes', 'floor']] as const) {
    const set = (finishes as unknown as Record<string, Record<string, { thicknessMm: number; label: string }>>)[group]
    if (!set) continue
    for (const [k, v] of Object.entries(set)) {
      add({
        id: `finish-${key}-${k}`,
        trade: 'finishes',
        title: `${key} finish — ${v.label}`,
        answer: `${v.label} (${key}): ${v.thicknessMm} mm thick.`,
        source: 'Manufacturer typical',
        keywords: ['finish', key, 'tile', 'paint', 'wood', 'flooring', 'thickness', k, ...tokenize(v.label)],
      })
    }
  }

  // EXCAVATION — foundations & frost -------------------------------------------
  for (const [k, v] of Object.entries(excavation.foundationTypes)) {
    add({
      id: `excav-${k}`,
      trade: 'excavation',
      title: `Foundation — ${v.label}`,
      answer: `${v.label}: ~${v.depthM} m excavation. ${v.note}`,
      source: 'IRC foundations',
      keywords: ['foundation', 'footing', 'excavation', 'slab', 'basement', 'crawl', 'depth', k, ...tokenize(v.label), ...tokenize(v.note)],
    })
  }
  /**
   * MEP ROUGH-IN — the rules that decide where a pipe or a wire is ALLOWED to
   * go, not just where it looks nice.
   *
   * Researched and written down here rather than left in a chat, because these
   * are the numbers the auto-router has to obey and the ones a tradesperson
   * will check us against. Every one of them is a hard limit: break it and the
   * model is showing work that would fail an inspection.
   */
  const MEP_ROUGH_IN: Omit<KnowledgeCard, 'keywords'>[] = [
    {
      id: 'mep-sequence',
      trade: 'general',
      title: 'Rough-in sequence — and why it is that order',
      answer:
        'After framing, before insulation and drywall, with the walls open: plumbing, then electrical, then HVAC, then low voltage — scheduled apart so trades are not fighting for the same bay. The rule underneath the order is LEAST FLEXIBLE FIRST. DWV is gravity-driven so its slope is not negotiable; ducts are big and barely bend; supply water bends more; wire bends anywhere. Route in that order and the flexible systems work around the constrained ones.',
      source: 'Trade practice — MEP rough-in sequencing',
    },
    {
      id: 'plumb-dwv-slope',
      trade: 'plumbing',
      title: 'DWV drain slope',
      answer:
        'Drains 3" and smaller: 1/4" per foot (1:48). Sewer mains 4" and larger: 1/8" per foot is usually permitted. Too steep is a DEFECT, not a bonus — the liquid outruns the solids, which strand and block. Horizontal vents also slope 1/4" per foot back toward the drain so water cannot stand in them.',
      source: 'IPC / UPC drainage',
    },
    {
      id: 'plumb-dwv-sizes',
      trade: 'plumbing',
      title: 'DWV stack and branch sizes',
      answer:
        'Main stack 3–4" running straight up and out through the roof. Secondary stacks 2–3" serving a branch. Fixture branch drains 1 1/2–2". Turns use sweeping fittings, never abrupt ones, so waste is carried rather than caught.',
      source: 'IPC drainage sizing',
    },
    {
      id: 'plumb-vent-height',
      trade: 'plumbing',
      title: 'Vent must rise above the flood rim',
      answer:
        'A vent has to rise above the flood rim level of the highest fixture it serves BEFORE it runs horizontally. Run it horizontal too low and a blocked drain pushes waste into the vent.',
      source: 'IPC venting',
    },
    {
      id: 'framing-bore-stud',
      trade: 'framing',
      title: 'Boring a stud — how big, how close',
      answer:
        'Bore up to 60% of the stud width. Over 40% in an exterior wall or bearing partition and the stud must be DOUBLED, with no more than two successive doubled studs bored. Keep the hole edge at least 5/8" from the edge of the stud, and never in the same section as a notch.',
      source: 'IRC R602.6',
    },
    {
      id: 'framing-notch-stud',
      trade: 'framing',
      title: 'Notching a stud',
      answer:
        'Exterior wall or bearing partition: notch no deeper than 25% of the stud width. Non-bearing partition: up to 40%. Notching is always the worse option — bore if you can.',
      source: 'IRC R602.6',
    },
    {
      id: 'framing-bore-joist',
      trade: 'framing',
      title: 'Boring a joist',
      answer:
        'Holes up to 1/3 of the joist depth — a 2x10 takes about a 3 1/16" hole — kept at least 2" clear of both the top and bottom edges. Bored holes are allowed ANYWHERE in the span, including the middle third where notches are not.',
      source: 'IRC R502.8',
    },
    {
      id: 'framing-notch-joist',
      trade: 'framing',
      title: 'Notching a joist',
      answer:
        'Notches no deeper than 1/6 of the depth, no longer than 1/3 of the depth, and never in the middle third of the span — that is where the bending stress lives.',
      source: 'IRC R502.8',
    },
    {
      id: 'elec-bore-clearance',
      trade: 'electrical',
      title: 'Cable through a bored hole — 1 1/4" or a nail plate',
      answer:
        'The edge of the hole must be at least 1 1/4" from the face of the stud, or the cable gets a steel nail plate at least 1/16" thick. A 2x4 is 3 1/2" actual, so a CENTRED hole leaves exactly 1 1/4" each side — dead on the limit. Anywhere off centre, or any 2x3 or furring, and the plate is not optional.',
      source: 'NEC 300.4(A)(1) / 300.4(D)',
    },
  ]
  for (const card of MEP_ROUGH_IN) {
    add({
      ...card,
      keywords: [
        ...tokenize(card.title), ...tokenize(card.answer), ...tokenize(card.source),
        'rough', 'rough-in', 'mep', 'code', card.trade,
      ],
    })
  }

  const frost = (excavation as Record<string, unknown>).frostLineDepths as
    | Record<string, { depthM: number; label: string }>
    | undefined
  if (frost) {
    for (const [k, v] of Object.entries(frost)) {
      add({
        id: `excav-frost-${k}`,
        trade: 'excavation',
        title: `Frost line — ${v.label}`,
        answer: `${v.label}: footings below ~${v.depthM} m to beat frost heave.`,
        source: 'Local climate / IRC',
        keywords: ['frost', 'line', 'depth', 'footing', 'freeze', 'heave', k, ...tokenize(v.label)],
      })
    }
  }

  // SYMBOLS — the glossary -----------------------------------------------------
  interface GlossaryEntry {
    id: string
    category: string
    common_names?: string[]
    represents: string
    standards?: string[]
  }
  const glossaryEntries = (glossary as unknown as { entries: GlossaryEntry[] }).entries
  for (const entry of glossaryEntries) {
    const names = (entry.common_names ?? []).join(', ')
    add({
      id: `symbol-${entry.id}`,
      trade: 'symbols',
      title: `Symbol — ${entry.common_names?.[0] ?? entry.id}`,
      answer: `${entry.represents}${names ? ` (also called: ${names})` : ''}.`,
      source: (entry.standards ?? []).join(', ') || 'AIA / NCS',
      keywords: ['symbol', 'means', 'plan', 'drawing', entry.category, ...tokenize(names), ...tokenize(entry.represents)],
    })
  }

  return cards
}

let CARDS: KnowledgeCard[] | null = null
function cards(): KnowledgeCard[] {
  if (!CARDS) CARDS = buildCards()
  return CARDS
}

// ── the ask ─────────────────────────────────────────────────────────────────

const TRADE_TERMS: Record<string, Trade> = {
  electrical: 'electrical', electric: 'electrical', wiring: 'electrical', wire: 'electrical',
  plumbing: 'plumbing', plumb: 'plumbing', pipe: 'plumbing',
  framing: 'framing', frame: 'framing', stud: 'framing', lumber: 'framing',
  hvac: 'hvac', duct: 'hvac', air: 'hvac',
  insulation: 'insulation',
  drywall: 'drywall', gypsum: 'drywall',
  finish: 'finishes', finishes: 'finishes',
  foundation: 'excavation', excavation: 'excavation',
  symbol: 'symbols', symbols: 'symbols',
}

/**
 * Answer a plain-language construction question from the grounded knowledge base.
 * Returns the best-matching cards, most-relevant first (empty if nothing matches).
 * Deterministic + offline — a card only appears if its data backs it.
 */
export function askConstruction(query: string, limit = 5): KnowledgeAnswer[] {
  const terms = tokenize(query)
  if (terms.length === 0) return []

  const tradeHint: Trade | null =
    terms.map((t) => TRADE_TERMS[t]).find(Boolean) ?? null

  // Computed intent: "wire/gauge for 40 amp" → run the sizing function directly.
  const ampMatch = query.match(/(\d+)\s*(a\b|amp)/i)
  const wantsWire = /wire|gauge|awg|conductor/i.test(query)
  const dynamic: KnowledgeAnswer[] = []
  if (ampMatch && wantsWire) {
    const amps = Number(ampMatch[1])
    dynamic.push({
      id: 'elec-wire-computed',
      trade: 'electrical',
      title: `Wire for a ${amps}A circuit`,
      answer: `A ${amps}A circuit needs ${wireGaugeForAmps(amps)} copper (NM-B, residential). Always confirm against derating and the AHJ.`,
      source: 'NEC 310.16',
      keywords: [],
      score: 1000,
    })
  }

  const scored: KnowledgeAnswer[] = cards().map((c) => {
    const kw = new Set(c.keywords)
    const titleTokens = new Set(tokenize(c.title))
    let score = 0
    for (const t of terms) {
      if (kw.has(t)) score += 3
      if (titleTokens.has(t)) score += 4
      else if ([...kw].some((k) => k.includes(t) || t.includes(k))) score += 1
    }
    if (tradeHint && c.trade === tradeHint) score += 2
    return { ...c, score }
  })

  const hits = scored.filter((c) => c.score > 0).sort((a, b) => b.score - a.score)
  return [...dynamic, ...hits].slice(0, limit)
}

/** Total facts currently indexed — surfaced in the UI ("grounded on N specs"). */
export function knowledgeCardCount(): number {
  return cards().length
}

/** A few example questions to seed an empty Ask box. */
export const EXAMPLE_QUESTIONS: string[] = [
  'What height for a kitchen counter outlet?',
  'Toilet drain size and rough-in?',
  'Wire gauge for a 40 amp circuit?',
  'How far apart do outlets go?',
  'What is a Type X drywall board?',
  'R-value of closed-cell spray foam?',
  '16 vs 24 inch on center?',
  'What does a double solid line mean on a plan?',
]
