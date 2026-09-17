/**
 * THE SHOT LIBRARY.
 *
 * These are the takes that go out — a site hero, a store listing, a reply to
 * someone who asked what the app actually does. Each one is written to answer
 * a single question, because footage that tries to say everything says nothing
 * and gets closed four seconds in.
 *
 * WHAT MAKES A SHOT HERE WORK:
 *
 *   • It shows the model DOING something, not sitting still being rotated. A
 *     turntable proves the thing is 3D and nothing else, and everyone has seen
 *     a turntable. The explode, the trades coming apart, a plan standing up
 *     into a building — those are the product.
 *   • The camera keeps moving through the whole take, slowly. A move that
 *     stops dead in the middle reads as a stall, and the viewer decides the
 *     thing has frozen before they decide it has finished.
 *   • It opens on something legible. The first frame is what survives being
 *     scrubbed past, autoplayed muted in a feed, or pulled as a thumbnail.
 *   • Captions label, they do not narrate. A few words, trade register, and
 *     never a claim the footage is not itself proving on screen.
 *
 * Distance is a multiple of the FIT distance for that pose — the point at
 * which the model's own corners touch the frame edges — so it is written as
 * AIR.tight / AIR.normal / AIR.wide rather than as a tuned number, and every
 * shot carries the same breathing room as every other shot in the family.
 * Targets are offsets from the model centre in model radii. So every shot
 * below plays correctly on any of the three preset plans, in any frame shape,
 * and on a real permit set the day one gets dropped in. See moves.ts.
 */
import type { Shot } from './director'
import { AIR } from './moves'

/**
 * HERO — the establishing shot. Answers "what am I looking at".
 *
 * A long arc that rises as it swings and pushes in as it arrives, which is the
 * move that reads as deliberate rather than as a screen recording of someone
 * dragging. Assembled the whole way: this is the one that has to look like a
 * building, so nothing comes apart in it.
 *
 * Opens slightly wide and low so the first frame carries the roof line against
 * the grid — a shape that survives being scaled down to a thumbnail.
 */
const HERO: Shot = {
  id: 'hero',
  title: 'Hero sweep',
  duration: 12,
  plan: 'medium',
  chrome: false,
  cam: [
    { at: 0, az: 18, elev: 14, dist: AIR.wide, look: [0, 0.05, 0] },
    { at: 5, az: 68, elev: 22, dist: AIR.normal, ease: 'easeInOut' },
    { at: 12, az: 124, elev: 29, dist: AIR.tight, look: [0, 0.12, 0], ease: 'easeOutSoft' },
  ],
  cues: [
    { at: 0.6, caption: 'Three-bed ranch — built from the print' },
    { at: 6.5, caption: '' },
  ],
}

/**
 * EXPLODE — the signature, and the one shot that has to exist.
 *
 * The whole pitch of this app family is in the middle of this take: parts
 * leaving along the axis they would actually come off in, not scattering. So
 * the ramp is slow and the camera is slow, and it holds at full separation long
 * enough to read the arrangement before it comes back together.
 *
 * It does NOT return to zero. Settling at a third open leaves the last frame
 * showing both things at once — that it comes apart, and that it goes back —
 * which is the frame worth freezing on.
 */
const EXPLODE: Shot = {
  id: 'explode',
  title: 'Explode',
  duration: 16,
  plan: 'medium',
  chrome: false,
  cam: [
    { at: 0, az: 35, elev: 12, dist: AIR.tight },
    { at: 4, az: 62, elev: 20, dist: AIR.normal, ease: 'easeInOut' },
    { at: 10, az: 108, elev: 30, dist: AIR.normal, ease: 'easeInOut' },
    { at: 16, az: 146, elev: 24, dist: AIR.tight, ease: 'easeOutSoft' },
  ],
  cues: [
    { at: 0.5, caption: 'Assembled' },
    { at: 2, explode: 1, over: 5.5, ease: 'easeInOut', caption: 'Every part leaves on its assembly axis' },
    { at: 9, caption: 'Structure, floors, roof — each to its own zone' },
    { at: 12.5, explode: 0.34, over: 3, ease: 'easeInOut', caption: 'Back together, non-destructive' },
  ],
}

/**
 * STOREYS — what the explode does that a parts diagram cannot.
 *
 * On the two-storey plan the floors peel apart floor-by-floor as well as
 * radially, so the upper storey lifts clear of the lower one and you can see
 * the stair opening through both. Shot from low and craning up, so the
 * separation happens across the frame rather than towards the lens.
 */
const STOREYS: Shot = {
  id: 'storeys',
  title: 'Storeys apart',
  duration: 13,
  plan: 'hard',
  chrome: false,
  cam: [
    { at: 0, az: 210, elev: 6, dist: AIR.tight, look: [0, -0.1, 0] },
    { at: 6, az: 250, elev: 20, dist: AIR.normal, look: [0, 0.05, 0], ease: 'easeInOut' },
    { at: 13, az: 292, elev: 34, dist: AIR.normal, look: [0, 0.15, 0], ease: 'easeOutSoft' },
  ],
  cues: [
    { at: 0.5, caption: 'Two storeys, one print' },
    { at: 1.8, explode: 0.85, over: 6.5, ease: 'easeInOut' },
    { at: 4.5, caption: 'Floors separate storey by storey' },
    { at: 10, caption: '' },
  ],
}

/**
 * TRADES — the layers, one at a time.
 *
 * Each trade arrives on its own beat with its own label, over a camera that
 * never stops moving, so the reveal is the edit and not a slideshow. Starts
 * with nothing but the floor deck for the same reason a build starts there:
 * the order is the real construction order, which is the thing a tradesperson
 * watching this will notice and a stock-render will always get wrong.
 */
const TRADES: Shot = {
  id: 'trades',
  title: 'Trade layers',
  duration: 18,
  plan: 'medium',
  chrome: false,
  layers: ['floors'],
  cam: [
    { at: 0, az: 300, elev: 34, dist: AIR.normal },
    { at: 9, az: 348, elev: 22, dist: AIR.tight, ease: 'easeInOut' },
    { at: 18, az: 404, elev: 30, dist: AIR.normal, ease: 'easeOutSoft' },
  ],
  cues: [
    { at: 0.5, caption: 'Floors' },
    { at: 3, layers: { on: ['framing'] }, caption: 'Framing' },
    { at: 6, layers: { on: ['roof'] }, caption: 'Roof' },
    { at: 9, layers: { on: ['plumbing'] }, caption: 'Plumbing' },
    { at: 11.5, layers: { on: ['electrical'] }, caption: 'Electrical' },
    { at: 14, layers: { on: ['hvac'] }, caption: 'HVAC' },
    { at: 16, explode: 0.45, over: 2, ease: 'easeInOut', caption: 'Every trade, one model' },
  ],
}

/**
 * PLAN TO MODEL — the pitch, in ten seconds and no words.
 *
 * Opens dead top-down, where the screen is the drawing and nothing about the
 * frame says 3D. Then the camera descends into an iso and the flat plan is
 * standing walls. That descent IS the product claim, and nothing has to assert
 * it because the move demonstrates it.
 *
 * The first two seconds hold the plan view deliberately. Cutting straight into
 * the move loses the setup, and without the setup the descent is just a camera
 * move rather than a before and after.
 */
const PLAN_TO_MODEL: Shot = {
  id: 'plan-to-model',
  title: 'Plan to model',
  duration: 11,
  plan: 'easy',
  chrome: false,
  cam: [
    { at: 0, az: 0, elev: 88, dist: AIR.normal },
    { at: 2.2, az: 0, elev: 88, dist: AIR.normal, ease: 'linear' },
    { at: 7, az: 34, elev: 42, dist: AIR.normal, ease: 'easeInOut' },
    { at: 11, az: 58, elev: 20, dist: AIR.tight, ease: 'easeOutSoft' },
  ],
  cues: [
    { at: 0.4, caption: 'The print' },
    { at: 4.5, caption: 'The building' },
    { at: 9, caption: '' },
  ],
}

/**
 * TURNTABLE — the loop, for a site hero that plays behind text.
 *
 * Linear azimuth all the way round and identical first and last frame, so it
 * loops with no seam and no easing stutter at the join. Deliberately the least
 * interesting shot in the library: it is wallpaper, it sits under a headline,
 * and anything more energetic fights the copy on top of it.
 */
const TURNTABLE: Shot = {
  id: 'turntable',
  title: 'Turntable loop',
  duration: 14,
  plan: 'medium',
  chrome: false,
  cam: [
    { at: 0, az: 0, elev: 24, dist: AIR.normal },
    { at: 14, az: 360, elev: 24, dist: AIR.normal, ease: 'linear' },
  ],
  cues: [{ at: 0, explode: 0.18, over: 0.01 }],
}

/**
 * VERTICAL — the same building, framed for a phone.
 *
 * Not a crop of the wide shot. A 9:16 frame is tall and narrow, so the camera
 * has to stand further back and higher or the model runs out of both sides,
 * and the move has to be mostly vertical — a crane rather than a swing —
 * because horizontal travel is exactly what a vertical frame has no room for.
 *
 * This is the one that goes on a store listing and into a reply. It keeps the
 * app's own chrome ON, because in that context the question is not "is this
 * pretty", it is "is this a real app".
 *
 * It therefore frames WIDER than a clean plate would. The rails and the top
 * bar take the edges of the frame, and the fit is computed against the whole
 * frame — so a shot composed tight here has the building running under the
 * chrome rather than sitting in the space the chrome leaves.
 */
const VERTICAL: Shot = {
  id: 'vertical',
  title: 'Vertical — explode',
  duration: 12,
  plan: 'medium',
  aspect: 'vertical',
  chrome: true,
  cam: [
    { at: 0, az: 28, elev: 40, dist: AIR.wide },
    { at: 5, az: 52, elev: 26, dist: AIR.normal, ease: 'easeInOut' },
    { at: 12, az: 84, elev: 32, dist: AIR.wide, ease: 'easeOutSoft' },
  ],
  cues: [
    { at: 1.2, explode: 0.95, over: 5, ease: 'easeInOut' },
    { at: 8.5, explode: 0.3, over: 3, ease: 'easeInOut' },
  ],
}

/**
 * NAMEPLATE — the detail shot, and the only one that shows the interface.
 *
 * Pushes in close enough that the data plate is readable, because the claim
 * being made here is specific: the labels carry real rated values, not a
 * caption. Chrome stays on for the same reason — the plate IS the app, and
 * cutting it out to get a cleaner render would cut out the point.
 */
const NAMEPLATE: Shot = {
  id: 'nameplate',
  title: 'Nameplate detail',
  duration: 10,
  plan: 'medium',
  chrome: true,
  cam: [
    { at: 0, az: 44, elev: 26, dist: AIR.normal },
    { at: 10, az: 72, elev: 16, dist: 0.55, look: [0, 0.02, 0], ease: 'easeInOut' },
  ],
  cues: [
    /**
     * SELECT A WALL, OR THE SHOT IS A CAPTION OVER AN EMPTY CORNER.
     *
     * The plate shows nothing at all when nothing is selected — correct for
     * the app, where silence is the resting state, and fatal for the one shot
     * whose entire subject is the plate. The first cut of this storyboard had
     * the caption and no selection, so it asserted five field names over a
     * screen that was not showing them. Selecting here puts the real rated
     * values on screen and the caption goes back to labelling what is already
     * visible, which is the only thing a caption is allowed to do.
     *
     * Ahead of the push-in on purpose: the plate is up and readable before the
     * camera arrives, rather than appearing under it at the moment the frame
     * settles.
     */
    { at: 0.8, selectWall: 0 },
    { at: 1, explode: 0.55, over: 4, ease: 'easeInOut' },
    { at: 5.5, caption: 'Member, depth, spacing, span, grade' },
  ],
}

/** Everything the recorder can render, in the order a batch renders them. */
export const SHOTS: Shot[] = [
  HERO,
  EXPLODE,
  STOREYS,
  TRADES,
  PLAN_TO_MODEL,
  TURNTABLE,
  VERTICAL,
  NAMEPLATE,
]

export { HERO, EXPLODE, STOREYS, TRADES, PLAN_TO_MODEL, TURNTABLE, VERTICAL, NAMEPLATE }
