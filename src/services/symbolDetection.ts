import glossary from '../symbols/glossary.json'
import type { ClassifiedLine, SymbolEntry } from '../symbols/types'
import type {
  ParsedAnnotationCandidate,
  ParsedOpening,
  ParsedRoom,
  ParsedSymbol,
  ParsedTextEntity,
  ParsedWall,
} from '../types'
import type { RasterTextToken } from './pdfRasterizer'

interface DetectSemanticEntitiesInput {
  classifiedLines: ClassifiedLine[]
  walls: ParsedWall[]
  openings: ParsedOpening[]
  rooms: ParsedRoom[]
  textTokens: RasterTextToken[]
}

interface DetectSemanticEntitiesResult {
  symbols: ParsedSymbol[]
  text: ParsedTextEntity[]
  annotations: ParsedAnnotationCandidate[]
}

const GLOSSARY_ENTRIES = glossary.entries as SymbolEntry[]

function pickGlossaryEntry(predicate: (entry: SymbolEntry) => boolean): SymbolEntry | null {
  return GLOSSARY_ENTRIES.find(predicate) ?? null
}

const SYMBOL_PICK = {
  wall: pickGlossaryEntry((e) => e.category === 'wall'),
  door: pickGlossaryEntry((e) => e.category === 'opening' && e.common_names.some((n) => /\bdoor\b/i.test(n))),
  window: pickGlossaryEntry((e) => e.category === 'opening' && e.common_names.some((n) => /\bwindow\b/i.test(n))),
  dimension: pickGlossaryEntry((e) => e.category === 'dimension' && e.common_names.some((n) => /dimension/i.test(n))),
  leader: pickGlossaryEntry((e) => e.category === 'dimension' && e.common_names.some((n) => /leader/i.test(n))),
  dashedOverhead: pickGlossaryEntry((e) => e.category === 'overhead' && e.appearance?.stroke_style === 'dashed'),
  dottedOverhead: pickGlossaryEntry((e) => e.category === 'overhead' && e.appearance?.stroke_style === 'dotted'),
  roomTag: pickGlossaryEntry((e) => e.category === 'annotation' && e.common_names.some((n) => /room/i.test(n))),
} as const

function maybePushSymbol(
  symbols: ParsedSymbol[],
  nextId: number,
  symbol: SymbolEntry | null,
  x: number,
  y: number,
  confidence: number,
  source: ParsedSymbol['source'],
): number {
  if (!symbol) return nextId
  symbols.push({
    id: `symbol-${nextId}`,
    symbolId: symbol.id,
    category: symbol.category,
    label: symbol.common_names[0] ?? symbol.id,
    x: Math.round(x),
    y: Math.round(y),
    confidence,
    source,
  })
  return nextId + 1
}

function classifyTextKind(text: string): ParsedTextEntity['kind'] {
  const value = text.trim()
  if (!value) return 'note'
  if (/^\d+(\.\d+)?\s*(mm|cm|m|ft|in|")$/i.test(value) || /^\d+(\.\d+)?\s*[x×]\s*\d+(\.\d+)?$/i.test(value)) {
    return 'dimension'
  }
  if (/[A-Z]/.test(value) && value === value.toUpperCase() && /[A-Z]/.test(value[0])) {
    return 'room_tag'
  }
  if (/^(section|detail|elevation)\b/i.test(value)) {
    return 'callout'
  }
  return 'note'
}

export function detectSemanticEntities({
  classifiedLines,
  walls,
  openings,
  rooms,
  textTokens,
}: DetectSemanticEntitiesInput): DetectSemanticEntitiesResult {
  const symbols: ParsedSymbol[] = []
  const text: ParsedTextEntity[] = []
  const annotations: ParsedAnnotationCandidate[] = []

  let nextSymbolId = 0
  let nextTextId = 0
  let nextAnnotationId = 0

  for (const wall of walls) {
    nextSymbolId = maybePushSymbol(
      symbols,
      nextSymbolId,
      SYMBOL_PICK.wall,
      (wall.x1 + wall.x2) / 2,
      (wall.y1 + wall.y2) / 2,
      wall.detectionConfidence ?? 0.7,
      'wall_detector',
    )
  }

  for (const opening of openings) {
    const symbol = opening.type === 'door'
      ? SYMBOL_PICK.door
      : opening.type === 'window'
        ? SYMBOL_PICK.window
        : null
    nextSymbolId = maybePushSymbol(
      symbols,
      nextSymbolId,
      symbol,
      opening.x,
      opening.y,
      opening.type === 'unknown' ? 0.55 : 0.83,
      'opening_detector',
    )
  }

  for (const line of classifiedLines) {
    if (line.classification === 'dimension') {
      nextSymbolId = maybePushSymbol(symbols, nextSymbolId, SYMBOL_PICK.dimension, (line.x1 + line.x2) / 2, (line.y1 + line.y2) / 2, line.confidence, 'line_classifier')
    } else if (line.classification === 'leader') {
      nextSymbolId = maybePushSymbol(symbols, nextSymbolId, SYMBOL_PICK.leader, line.x2, line.y2, line.confidence, 'line_classifier')
    } else if (line.classification === 'dashed') {
      nextSymbolId = maybePushSymbol(symbols, nextSymbolId, SYMBOL_PICK.dashedOverhead, (line.x1 + line.x2) / 2, (line.y1 + line.y2) / 2, line.confidence, 'line_classifier')
    } else if (line.classification === 'dotted') {
      nextSymbolId = maybePushSymbol(symbols, nextSymbolId, SYMBOL_PICK.dottedOverhead, (line.x1 + line.x2) / 2, (line.y1 + line.y2) / 2, line.confidence, 'line_classifier')
    }
  }

  for (const token of textTokens) {
    const value = token.text.trim()
    if (!value) continue
    const kind = classifyTextKind(value)
    text.push({
      id: `text-${nextTextId++}`,
      text: value,
      x: Math.round(token.x),
      y: Math.round(token.y),
      kind,
      confidence: token.confidence,
      source: 'pdf_text',
    })
    annotations.push({
      id: `ann-${nextAnnotationId++}`,
      x: Math.round(token.x),
      y: Math.round(token.y),
      text: value,
      kind,
      confidence: token.confidence,
      source: 'text',
    })
  }

  const roomTagTexts = text.filter((t) => t.kind === 'room_tag')
  for (const room of rooms) {
    const nearestText = roomTagTexts
      .map((t) => ({ t, d2: (t.x - room.cx) ** 2 + (t.y - room.cy) ** 2 }))
      .sort((a, b) => a.d2 - b.d2)[0]

    if (!nearestText || nearestText.d2 > 240 ** 2) continue
    nextSymbolId = maybePushSymbol(
      symbols,
      nextSymbolId,
      SYMBOL_PICK.roomTag,
      room.cx,
      room.cy,
      Math.max(0.65, nearestText.t.confidence),
      'room_extractor',
    )
    annotations.push({
      id: `ann-${nextAnnotationId++}`,
      x: room.cx,
      y: room.cy,
      text: nearestText.t.text,
      kind: 'room_tag',
      confidence: Math.max(0.65, nearestText.t.confidence),
      source: 'room',
    })
  }

  return { symbols, text, annotations }
}
