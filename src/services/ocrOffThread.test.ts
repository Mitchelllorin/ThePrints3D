import { describe, it, expect } from 'vitest'
import { OcrTimeout } from './ocrOffThread'

/**
 * The distinction the module turns on. A slow worker and a broken worker want
 * opposite answers, and conflating them cost over four minutes on a 732x727
 * screenshot: the budget was spent in the worker, then the whole OCR ran again
 * on the thread that has to paint.
 */
describe('OcrTimeout', () => {
  it('is identifiable by instance, not by message text', () => {
    // The catch has to branch on this. Matching on a string would break the
    // moment anyone reworded the error.
    expect(new OcrTimeout()).toBeInstanceOf(OcrTimeout)
    expect(new OcrTimeout()).toBeInstanceOf(Error)
  })

  it('is not confused with an ordinary worker failure', () => {
    expect(new Error('worker exploded')).not.toBeInstanceOf(OcrTimeout)
  })

  it('names itself, so a log line says which path was taken', () => {
    expect(new OcrTimeout().name).toBe('OcrTimeout')
  })
})
