import { describe, it, expect } from 'vitest'
import { askConstruction } from './constructionKnowledge'

/**
 * The in-app AI answers from these cards before it ever reaches a model — they
 * are its grounded, offline, free layer (see askBrain). So these tests are not
 * really about the data structure: they are asking the questions a tradesperson
 * would ask on site and checking the app can answer them without a network.
 */
const asked = (q: string) => askConstruction(q).map((a) => a.id)

describe('the in-app AI knows the MEP rough-in rules', () => {
  it('answers how big a hole may be bored in a stud', () => {
    expect(asked('how big a hole can I drill in a stud')).toContain('framing-bore-stud')
  })

  it('answers what slope a drain needs', () => {
    expect(asked('what slope for a drain pipe')).toContain('plumb-dwv-slope')
  })

  it('knows a joist may not be notched in the middle of the span', () => {
    expect(asked('can I notch a joist in the middle')).toContain('framing-notch-joist')
  })

  it('knows when a wire needs a nail plate', () => {
    expect(asked('nail plate for romex through a stud')).toContain('elec-bore-clearance')
  })

  it('knows the rough-in order of trades', () => {
    expect(asked('what order do the trades rough in')).toContain('mep-sequence')
  })

  it('knows how big the stack is', () => {
    expect(asked('what size is the main stack')).toContain('plumb-dwv-sizes')
  })
})
