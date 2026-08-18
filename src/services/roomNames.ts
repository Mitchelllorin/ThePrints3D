/**
 * WHAT A ROOM IS CALLED, AND WHY THE APP CARES.
 *
 * A plan tells you what every space is for, in words, right in the middle of
 * it. That single label decides real construction:
 *
 *   BATH    -> tile backer instead of gypsum on the wet walls (see wetWalls)
 *   KITCHEN -> two 20A small-appliance circuits, GFCI (see constructionCode)
 *   BEDROOM -> AFCI protection, smoke detector
 *   GARAGE  -> fire-rated board on the house separation
 *
 * All of that reasoning already exists. What was missing is the wire between
 * the words on the drawing and the rooms the detector found: `ParsedRoom.name`
 * is documented as "absent when a room was found purely by geometry", which is
 * every detected plan, so `wetWalls` read undefined every time and nothing was
 * ever tiled.
 *
 * A room label was also only recognised if it was ALL CAPS. That is a fair
 * description of a permit set and a poor one of the plans people actually hand
 * you — the ADU screenshot in data/test-prints/ says "Bathroom", "Living Area",
 * "Entry Hall", "Kitchen & Dining Area", none of which qualified. Capitalisation
 * is a typographic accident; the WORD is the signal, so match on vocabulary.
 */

/** What a space is, once the wording is stripped away. */
export type RoomKind =
  | 'bathroom' | 'kitchen' | 'bedroom' | 'living' | 'dining' | 'hall'
  | 'closet' | 'laundry' | 'garage' | 'office' | 'storage' | 'stairs' | 'other'

/**
 * How each kind is written in the field. Abbreviations are the point: a plan
 * says BR, MBR, W.I.C., PWDR, and a lexicon that only knows the long form is a
 * lexicon that works on brochures.
 */
const VOCAB: { kind: RoomKind; patterns: RegExp }[] = [
  { kind: 'bathroom', patterns: /\b(bath|bathroom|ensuite|en-?suite|shower|wc|powder|pwdr|washroom|toilet|lav|lavatory)\b/i },
  { kind: 'kitchen',  patterns: /\b(kitchen|kit|kitchenette|pantry|galley)\b/i },
  { kind: 'bedroom',  patterns: /\b(bed|bedroom|bdrm|br|mbr|master|primary|nursery|guest\s*room)\b/i },
  { kind: 'living',   patterns: /\b(living|lounge|family|great\s*room|den|sitting|rec\s*room|parlou?r)\b/i },
  { kind: 'dining',   patterns: /\b(dining|dinette|breakfast|nook)\b/i },
  { kind: 'hall',     patterns: /\b(hall|hallway|corridor|entry|entrance|foyer|vestibule|landing|mudroom|mud\s*room)\b/i },
  { kind: 'closet',   patterns: /\b(closet|clo|clst|w\.?i\.?c|wardrobe|walk-?in)\b/i },
  { kind: 'laundry',  patterns: /\b(laundry|utility|util|mech|mechanical|furnace|boiler)\b/i },
  { kind: 'garage',   patterns: /\b(garage|carport|gar)\b/i },
  { kind: 'office',   patterns: /\b(office|study|library)\b/i },
  { kind: 'storage',  patterns: /\b(storage|store|attic|basement|cellar|crawl)\b/i },
  { kind: 'stairs',   patterns: /\b(stair|stairs|stairwell|stairway)\b/i },
]

/**
 * Which kind of room this text names, or null if it names none.
 *
 * Order matters where words overlap: "walk-in closet" is a closet, not a
 * living space, and it is listed after bedroom so "master closet" still reads
 * as a closet rather than a bedroom. Whichever pattern matches EARLIEST in the
 * string wins, so "Kitchen & Dining Area" is a kitchen and "Bathroom 4,5 m²"
 * is a bathroom despite the trailing area.
 */
export function roomKindOf(text: string | undefined | null): RoomKind | null {
  if (!text) return null
  const value = text.trim()
  if (!value) return null
  let best: { kind: RoomKind; at: number } | null = null
  for (const entry of VOCAB) {
    const m = entry.patterns.exec(value)
    if (!m) continue
    if (!best || m.index < best.at) best = { kind: entry.kind, at: m.index }
  }
  return best ? best.kind : null
}

/** Does this text name a room at all? */
export function looksLikeRoomName(text: string | undefined | null): boolean {
  return roomKindOf(text) !== null
}

/**
 * A room label with its measurement stripped, for display.
 *
 * Plans commonly print the area with the name — "Bathroom 4,5 m²", "LIVING
 * 21.4 SF". The words are what identify the room; the number belongs to the
 * takeoff, not the label.
 */
export function cleanRoomLabel(text: string): string {
  return text
    // No trailing \b on the unit: it can never match after "²", which is not a
    // word character, so "4,5 m²" survived untouched. The boundary is applied
    // per-alternative instead, only where the unit ends in a letter.
    .replace(/\b\d+([.,]\d+)?\s*(m²|ft²|m2\b|sq\.?\s*m\b|sq\.?\s*ft\b|sf\b)/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/**
 * The floor area a label states, in square metres, or null.
 *
 * Worth reading because it is a scale oracle that needs no user input: a room
 * labelled with both a name and an area gives the true size of a space we can
 * also measure in pixels. Handles the comma decimal separator, which is what
 * the ADU screenshot uses.
 */
export function statedAreaSqM(text: string): number | null {
  const metric = /(\d+(?:[.,]\d+)?)\s*(?:m²|m2\b|sq\.?\s*m\b)/i.exec(text)
  if (metric) {
    const v = parseFloat(metric[1].replace(',', '.'))
    return Number.isFinite(v) && v > 0 ? v : null
  }
  const imperial = /(\d+(?:[.,]\d+)?)\s*(?:ft²|sf\b|sq\.?\s*ft\b)/i.exec(text)
  if (imperial) {
    const v = parseFloat(imperial[1].replace(',', '.'))
    return Number.isFinite(v) && v > 0 ? v * 0.092903 : null
  }

  /**
   * OCR MANGLES SUPERSCRIPTS, AND THE UNIT IS A SUPERSCRIPT.
   *
   * Read off the ADU capture, "TOTAL AREA = 71 m²" comes back as
   * "TOTAL AREA = 71 m?" — Tesseract turns the ² into a question mark. Every
   * strict pattern above then fails, and the one number on the drawing that
   * fixes the scale exactly is thrown away over one character.
   *
   * So a number followed by `m` and one piece of junk counts as square metres —
   * but ONLY when the surrounding words say the figure is an area. That guard
   * matters: "5,37 m" is also on that sheet, and it is a LENGTH along a
   * dimension line. Reading it as 5.37 m² would put the scale out by a factor
   * of four, which is worse than not reading it at all.
   */
  if (/\b(area|total)\b/i.test(text)) {
    const loose = /(\d+(?:[.,]\d+)?)\s*m\s*[²2?*'"`^]?\s*$/i.exec(text.trim())
    if (loose) {
      const v = parseFloat(loose[1].replace(',', '.'))
      return Number.isFinite(v) && v > 0 ? v : null
    }
  }
  return null
}

/**
 * IS THIS TEXT PLAUSIBLY A ROOM'S NAME AT ALL.
 *
 * The ALL-CAPS fallback that promotes a token to a room tag is useful — plenty
 * of real labels ("REC RM 2", "AREA B") are in no lexicon — and far too eager on
 * its own. On the ADU capture it promoted "TOTAL AREA = 71 m?" and a scatter of
 * single OCR characters, and those went on to NAME rooms. That is not cosmetic:
 * a room called BATH gets tile backer instead of gypsum, so a wrongly named room
 * changes what gets built and quoted.
 *
 * A name is mostly letters, has at least a short word in it, and is not a
 * measurement. Anything that states an area or reads as a bare dimension is a
 * number the drawing is telling us, not a room.
 */
export function isPlausibleRoomLabel(text: string | undefined | null): boolean {
  if (!text) return false
  const value = text.trim()
  if (value.length < 3) return false
  // A stated measurement is a figure, not a name.
  if (statedAreaSqM(value) != null) return false
  if (/^\s*[\d.,]+\s*(m|mm|cm|ft|in|")?\s*$/i.test(value)) return false
  const letters = (value.match(/[A-Za-z]/g) ?? []).length
  if (letters < 3) return false
  // Mostly letters, not a figure with a word attached.
  if (letters / value.replace(/\s/g, '').length < 0.5) return false
  // A room is never named with an equals or a colon. That is a schedule entry,
  // a scale note or a callout — "AREA = 71 m?" got through every other check
  // here and went on to name a room, because "AREA" is four honest letters.
  if (/[=:]/.test(value)) return false
  // "TOTAL AREA", "GROSS AREA", schedules and title blocks are about the
  // drawing, not a space inside it.
  if (/\b(total|gross|net|scale|sheet|drawn|date|rev|no\.?|project|client)\b/i.test(value)) return false
  return true
}
