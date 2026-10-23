/**
 * F.U.S.E.™ for ThePrints3D — the building domain file.
 *
 * F.U.S.E. is not a countdown. A countdown is one number per product, and the
 * "20-year shingle" myth comes out of exactly that: the same shingle lasts 12
 * years on a hot roof in a wet climate and 25 on a shaded one over an attic
 * that breathes. So the engine scores the ASSEMBLY instead — what the thing is
 * made of, what is in front of it, what the site does to it, and whether the
 * detail was built right — and it reports the year it goes, what takes it, and
 * what is physically happening while it does.
 *
 * Three things make this a simulation rather than a table of lifespans:
 *
 *   1. THE CASCADE. Water is why buildings fail, and water only gets to the
 *      sheathing when the cladding has stopped stopping it. So each layer is
 *      scored in context: once the thing in front of it has failed, the layer
 *      behind it gets wetter, and the order the failures arrive in is the
 *      reading. A wall does not rot; a wall loses its paint, then its siding,
 *      then its wrap, and THEN it rots. The panel walks you down that line.
 *   2. THE THRESHOLD. Below the wet time it was built to shed, a wall is fine
 *      at any age. Past it, the same rain starts costing years — see
 *      engine.derate, the same curve CircuiTry3D grades components on.
 *   3. THE ACCELERATION. Nothing wears at a constant rate. As reserve runs
 *      out, the rate rises, which is why the last two years of a roof are
 *      worse than its first two. That is what makes "18 of 25" a warning and
 *      not a countdown.
 *
 * Every nominal life below is a real-world service life for that product in a
 * benign climate with the detail done right — not a warranty, and not a
 * promise. The app says so out loud in the panel: F.U.S.E. tells you WHAT goes
 * first and WHY, and the local trade tells you the year.
 */

import {
  clamp, clamp01, derate, reserveToLevel, severityRank, stressFactor,
  type RiskLevel,
} from './engine'

/** How far the scrubber goes. 25 years is one cladding plus one roof. */
export const HORIZON_YEARS = 25

/**
 * The positions a building has, and the only ones F.U.S.E. scores. Each is a
 * thing that fails on its own schedule; they are scored in the order they sit
 * in the wall, because that order IS the cascade.
 */
export type LayerId =
  | 'cladding' | 'wrb' | 'sheathing' | 'framing' | 'board'
  | 'roofing' | 'roofDeck'
  | 'plumbing' | 'electrical'

/** Which wet path a layer sits in. The roof deck rots from a roof leak, not
 *  from the siding, so the two chains are scored separately. */
type ChainId = 'wall' | 'wallInner' | 'roof'

export interface MaterialSpec {
  label: string
  /** Service life at a benign site, with the detail done right. */
  nominalYears: number
  /** How hard each driver bites. 0 = does not care, 1 = doubles the wear at
   *  double a benign exposure. See engine.stressFactor. */
  uv: number
  wet: number
  freeze: number
  salt: number
  /** Fraction of the year this thing can be wet and still dry out. Past it,
   *  decay stops being weather and starts being damage (engine.derate). */
  wetCapacity: number
  /** How much a failed neighbour in front of it hurts, relative to the wetness
   *  it already sees. 0 = unaffected; 1 = roughly doubles once exposed. */
  exposed: number
  /** The failure that arrives, what is happening inside the material while it
   *  does, and the one action that answers it. */
  mode: string
  why: string
  fix: string
  citation?: string
  /** Where the camera should look for this layer. */
  look: AssemblyLook
}

/** Where a layer is, so a verdict can be pointed at instead of described. */
export interface AssemblyLook {
  /** Height above the storey floor to aim at, in metres. */
  aimM: number
  /** How far back to stand, in metres — close work or the whole building. */
  standoffM: number
  /** 'wall' looks from outside at the building's side; 'above' from over the
   *  roof; 'inside' from in front of the wall it is buried in. */
  from: 'wall' | 'above' | 'inside'
  /** Which layer to switch VISIBLE when we fly there, so the shot shows the
   *  thing being talked about rather than the siding in front of it. Null when
   *  the layer is always drawn. */
  reveal: HiddenLayer | null
}

/** The model's own visibility switches — the ones that uncover a layer. */
export type HiddenLayer = 'cladding' | 'sheathing' | 'wrap' | 'drywall'

/**
 * WHAT EACH PRODUCT IS, IN F.U.S.E.'s TERMS.
 *
 * Keyed `layer:material`, because the material keys come from wherever the
 * model already names that product — CladdingKind, WrbKind, BoardKind — and two
 * different trades can use the same word for different things.
 *
 * The wet capacities are the load-bearing numbers. OSB at 0.22 and plywood at
 * 0.34 is the app's own field note (see constructionCode: plywood holds up far
 * better to getting rained on before the walls are dry-in) turned into a
 * threshold. Gypsum at 0.15 is why a dripping fitting ruins a ceiling in one
 * season while the same ceiling stays perfect for sixty years dry.
 */
const M = (
  label: string, nominalYears: number,
  drivers: [uv: number, wet: number, freeze: number, salt: number],
  wetCapacity: number, exposed: number,
  mode: string, why: string, fix: string,
  look: AssemblyLook, citation?: string,
): MaterialSpec => ({
  label, nominalYears,
  uv: drivers[0], wet: drivers[1], freeze: drivers[2], salt: drivers[3],
  wetCapacity, exposed, mode, why, fix, look, citation,
})

export const MATERIALS: Record<string, MaterialSpec> = {
  // ── Cladding — what the weather hits first ────────────────────────────────
  'cladding:vinyl-lap': M(
    'Vinyl lap siding', 22, [0.55, 0.15, 0.35, 0.05], 0.5, 0.55,
    'Embrittlement and impact cracking',
    'Vinyl has no plasticiser left to lose after a couple of decades of sun. It goes chalky, then brittle, and then a cold-weather knock takes a chunk out of a course instead of denting it. The lap joints open as the panel shortens.',
    'Plan a full re-side rather than patching courses — half-new vinyl against 20-year-old vinyl reads as a patch from the street.',
    { aimM: 1.6, standoffM: 7, from: 'wall', reveal: 'cladding' },
  ),
  'cladding:fiber-cement-lap': M(
    'Fiber-cement lap (Hardie-type)', 35, [0.1, 0.25, 0.2, 0.05], 0.55, 0.3,
    'Factory paint chalking, and joint failure before the board',
    'The board itself outlives the paint on it. What fails is the coating — chalking and losing adhesion at the laps — and once water gets behind an open lap the sheathing starts the clock.',
    'Recoat the factory finish on its own schedule; the board is not the part that expires.',
    { aimM: 1.6, standoffM: 7, from: 'wall', reveal: 'cladding' },
  ),
  'cladding:wood-lap': M(
    'Wood bevel siding', 12, [0.45, 0.85, 0.3, 0.05], 0.28, 0.8,
    'Paint failure at the end grain, then rot',
    'Wood siding dies from the bottom up. End grain and the back of the bevel drink water and cannot dry, so the paint fails there first, bare wood follows, and the board starts losing section — which is why a painted wall lasts twice as long as an unpainted one.',
    'Keep it painted, end grain primed first. That is the whole maintenance budget and it buys the years back.',
    { aimM: 1.6, standoffM: 7, from: 'wall', reveal: 'cladding' },
  ),
  'cladding:panel': M(
    'Rainscreen panel (fabricated)', 25, [0.35, 0.3, 0.2, 0.1], 0.55, 0.45,
    'Coating erosion and fastener corrosion at the panel edges',
    'A panel system fails at its edges and its fixings, not its field. Coating erodes on the exposed faces first, and where the fasteners are, water sits.',
    'Inspect and re-seal the vertical joints and the top termination; the panels themselves are the last thing to go.',
    { aimM: 1.6, standoffM: 7, from: 'wall', reveal: 'cladding' },
  ),
  'cladding:stucco': M(
    'Stucco (3-coat)', 40, [0.1, 0.55, 0.75, 0.05], 0.45, 0.35,
    'Hairline cracking, then water entry at the cracks',
    'Cement stucco is a hundred-year skin that fails at its cracks. Shrinkage cracking is normal within the first years; the damage is freeze–thaw in a saturated crack, which widens it, and the water that gets through to a wall with no drainage plane behind it.',
    'Keep the cracks closed and re-seal the penetrations — the stucco is not the problem, the water behind it is.',
    { aimM: 1.6, standoffM: 7, from: 'wall', reveal: 'cladding' },
  ),
  'cladding:brick-veneer': M(
    'Brick veneer', 80, [0.02, 0.7, 0.6, 0.08], 0.6, 0.25,
    'Nothing happens to the brick — the flashing and weeps are what fail',
    'Brick is the most durable thing on this list and the wall behind it is the most at risk, because a veneer is a drainage cavity: a brick wall with blocked weeps and failed flashing holds water against the sheathing as reliably as a leak.',
    'Keep the weeps clear and the flashing sound at the base and over openings. That is the entire maintenance history of a brick wall.',
    { aimM: 1.6, standoffM: 7, from: 'wall', reveal: 'cladding' },
    'IRC R703.8 — flashing and weep holes in veneer',
  ),
  'cladding:stone-veneer': M(
    'Adhered stone veneer', 80, [0.02, 0.6, 0.7, 0.08], 0.6, 0.25,
    'Efflorescence and freeze–thaw at the base, water behind the stone',
    'The stone outlives the building. What fails around it is the drainage: salt pushing out of the mortar as efflorescence is the visible sign that the wall behind the veneer is staying wet.',
    'Check the flashing at the base and the weeps; the stone is a symptom, never the cause.',
    { aimM: 1.6, standoffM: 7, from: 'wall', reveal: 'cladding' },
  ),

  // ── Water-resistive barrier — the layer actually keeping water out ────────
  'wrb:housewrap': M(
    'Housewrap (Tyvek-type)', 30, [0.5, 0.35, 0.15, 0.05], 0.35, 0.95,
    'UV degradation and failed lap seams',
    'Housewrap is a filter, not a sheet of armour: it holds liquid water out and lets vapour through. Sun destroys it in weeks if it is left exposed, and the failure that matters later is a lap seam that let go — the wrap does its job right up until the water is already inside the seam.',
    'Nothing to maintain — the way to buy a second life out of it is a drained, ventilated cavity in front of it, so the cladding carries the rain.',
    { aimM: 1.7, standoffM: 6.5, from: 'wall', reveal: 'wrap' },
    'IRC R703.4 — water-resistive barrier required behind the cladding',
  ),
  'wrb:felt': M(
    'Asphalt felt (tar paper) · No. 15', 22, [0.35, 0.4, 0.2, 0.05], 0.3, 0.95,
    'Drying out and tearing at the fasteners',
    'Felt is still the code answer and still the one tradespeople trust against a wet substrate, but it is brittle by nature: it tears at every staple and it dries out and cracks where it is left exposed to sun or wind.',
    'Overlap it properly and get the cladding on it in the same season — as a weather cut-off it is excellent, as a permanent skin it is not.',
    { aimM: 1.7, standoffM: 6.5, from: 'wall', reveal: 'wrap' },
  ),
  'wrb:fluid': M(
    'Fluid-applied barrier', 30, [0.3, 0.3, 0.25, 0.1], 0.4, 0.85,
    'Coating erosion and thin spots at transitions',
    'Sprayed and rolled membranes are seamless in the field and thin at the places somebody had to think: inside corners, penetrations, the wall-to-floor tie. The field outlasts the details it was supposed to fix.',
    'Re-inspect the transitions — the membrane fails at the detail, not the wall.',
    { aimM: 1.7, standoffM: 6.5, from: 'wall', reveal: 'wrap' },
  ),
  'wrb:avb': M(
    'Air / vapour barrier (steel)', 45, [0.2, 0.2, 0.2, 0.15], 0.5, 0.6,
    'Photo-degradation where it is exposed, and trapping water where it should not be',
    'Poly is not supposed to expire — it is supposed to be on the warm side of the wall, out of the sun, doing nothing much for forty years. Its real failure is a design one: a vapour barrier on the wrong side of a damp wall holds the water IN.',
    'Make sure it is on the interior face and the wall behind it can dry outward. Seal the penetrations rather than the field.',
    { aimM: 1.7, standoffM: 6.5, from: 'wall', reveal: 'wrap' },
  ),
  'wrb:integrated': M(
    'Integrated in sheathing (ZIP-type)', 35, [0.15, 0.3, 0.2, 0.05], 0.55, 0.35,
    'Seam tape failure and UV at the exposed edges',
    'The barrier is the facing on the panel, so the panel and the barrier age together and the seam tape is the whole system — a taped joint is the only place water can get past it, and the amount of sun the panel sees before the cladding goes on decides how much of the facing is left.',
    'Tape it and clad it promptly; the join is the assembly.',
    { aimM: 1.7, standoffM: 6.5, from: 'wall', reveal: 'wrap' },
  ),

  // ── Sheathing — the layer that pays for everything in front of it ─────────
  'sheathing:osb': M(
    'OSB 7/16″', 32, [0.2, 0.95, 0.45, 0.05], 0.22, 1.1,
    'Edge swelling and rot — strength falls off above 20% moisture content',
    'OSB is glue and flakes and it drinks at the edges. Soaked edges swell and stay swollen, the panel never comes back to flat, and it has lost a large share of its racking strength long before anything looks wrong from inside the wall.',
    'Do not try to dry it out and keep it — replace swollen sheathing when the wall is open. The wrap and the cladding are what keep the next one dry.',
    { aimM: 1.5, standoffM: 6.5, from: 'wall', reveal: 'sheathing' },
  ),
  'sheathing:plywood': M(
    'CDX plywood 15/32″', 40, [0.2, 0.6, 0.4, 0.05], 0.34, 0.9,
    'Edge rot at the panel joints, delamination at the plies',
    'Plywood is also glue and veneer, but the cross-plies hold their shape and their strength while wet far better than flakes do — which is why crews choose it for walls that will be rained on before they are closed.',
    'Same answer as OSB, with more patience: it tolerates a wet season, not a wet service life.',
    { aimM: 1.5, standoffM: 6.5, from: 'wall', reveal: 'sheathing' },
  ),
  'sheathing:glassmat': M(
    'Glass-mat sheathing (DensGlass-type)', 40, [0.1, 0.45, 0.25, 0.05], 0.5, 0.7,
    'Face-paper scuffing, then gypsum core softening where it stays wet',
    'The glass mat is the point of it: the panel survives being exposed to weather in a way gypsum board never could, and the trade uses it exactly for that — as the weather cut-off on a steel-framed wall.',
    'Keep the face intact at the joints and it does not need replacing when a wall is opened for a repair.',
    { aimM: 1.5, standoffM: 6.5, from: 'wall', reveal: 'sheathing' },
  ),

  // ── Framing ───────────────────────────────────────────────────────────────
  'framing:wood': M(
    'Wood framing', 90, [0.1, 0.85, 0.3, 0.2], 0.3, 1.2,
    'Decay above 20% moisture content, mould above 80% RH',
    'Framing is not meant to expire. Dimension lumber left dry in a dry wall is a 90-year structure; the same stud held above 20% moisture content rots in a handful of seasons, and the mould that shows up long before the rot is the wall telling you it is wet.',
    'Find the water and fix that, not the stud — and replace any member that has already started to decay, because decayed wood does not re-dry back into structure.',
    { aimM: 1.4, standoffM: 6, from: 'inside', reveal: 'sheathing' },
    'IRC R317 / R703.1.1 — drainage and damp-proofing to keep framing dry',
  ),
  'framing:steel': M(
    'Steel framing', 70, [0.05, 0.5, 0.3, 0.75], 0.55, 0.8,
    'Corrosion at cut ends and fasteners, worst within a mile of salt water',
    'Galvanised steel frame does not rot, and it does not have a moisture-content failure. What it has is corrosion at the cut ends and the screws, where the coating is gone — and salt air turns that from a curiosity into the failure mode.',
    'Keep the wall dry, touch up cut ends, and use the fastener specified for coastal exposure.',
    { aimM: 1.4, standoffM: 6, from: 'inside', reveal: 'sheathing' },
  ),

  // ── Interior board ────────────────────────────────────────────────────────
  'board:gypsum-half': M(
    'Gypsum 1/2″', 60, [0.05, 0.8, 0.15, 0.05], 0.15, 1.4,
    'Paper faces feed mould, the core turns to powder',
    'Drywall is paper and gypsum and both are food for the things that grow in a wet wall. It does not fail gradually: a wall that has been wet for a season behind tile is already gone, and the board that looks fine next to it is holding water too.',
    'Cut it back past what looks damaged and fix the leak first — a patched ceiling over a live leak is a second repair waiting.',
    { aimM: 1.3, standoffM: 5, from: 'inside', reveal: 'drywall' },
  ),
  'board:gypsum-type-x': M(
    'Gypsum 5/8″ Type X (fire)', 60, [0.05, 0.8, 0.15, 0.05], 0.18, 1.4,
    'Wet core loses the fire rating along with the strength',
    'Type X buys a fire rating with a denser core. Water takes both — the board that has been wet is not the rated assembly any more, whether or not it dried out straight.',
    'Replace it, and replace it with Type X. A wet-rated board is not a substitute in a rated assembly.',
    { aimM: 1.3, standoffM: 5, from: 'inside', reveal: 'drywall' },
  ),
  'board:mold-resistant': M(
    'Mould-resistant gypsum', 60, [0.05, 0.7, 0.15, 0.05], 0.24, 1.3,
    'The paper resists mould; the core still does not survive being wet',
    'Mould-resistant board is a treatment on the paper face. It buys real time in a bathroom and no time at all in a wall that is actually wet — the gypsum underneath behaves exactly like ordinary board.',
    'Still find and fix the water. The board was never the waterproofing.',
    { aimM: 1.3, standoffM: 5, from: 'inside', reveal: 'drywall' },
  ),
  'board:cement-board': M(
    'Cement board', 60, [0.1, 0.25, 0.3, 0.05], 0.75, 0.5,
    'Nothing much — it is the substrate that outlives the tile',
    'Cement backer is the answer to a wet wall: no paper, no food, no loss of strength when it is wet. What ages around it is the tile adhesive and the joint treatment, not the board.',
    'Nothing needed. This is the right board for the shower wall.',
    { aimM: 1.3, standoffM: 5, from: 'inside', reveal: 'drywall' },
  ),
  'board:glassmat-tile': M(
    'Glass-mat tile backer', 60, [0.05, 0.3, 0.2, 0.05], 0.7, 0.5,
    'Edge softening where the cut face is left unsealed',
    'Glass-mat board survives wet service; its cut edges are the weak point, which is why the trade treats them, and why a poorly detailed shower fails at the joints rather than the field.',
    'Seal the cut edges and the joints. The board is fine.',
    { aimM: 1.3, standoffM: 5, from: 'inside', reveal: 'drywall' },
  ),
  'board:foam-waterproof': M(
    'Foam waterproof board (bonded membrane)', 60, [0.05, 0.2, 0.15, 0.05], 0.85, 0.35,
    'Nothing happens to the board — the membrane seams are the assembly',
    'A bonded waterproof board is a waterproof panel with a built-in membrane; the waterproofing is the joint treatment between the panels and at every penetration. That is where these fail, and it is why the trades argue about methods rather than products.',
    'Get the seams and the penetrations right and it is the last wall you will think about.',
    { aimM: 1.3, standoffM: 5, from: 'inside', reveal: 'drywall' },
  ),

  // ── Roof — its own chain, because its water comes from the sky ────────────
  'roofing:asphalt-shingle': M(
    'Asphalt shingles · 3-tab / architectural', 22, [0.6, 0.25, 0.5, 0.05], 0.5, 0.6,
    'Loss of the granules, then the mat, then the seal strips let go',
    'A shingle dies from the top down and from the bottom up at once: the sun burns off the granules that protect the asphalt, and a hot, unventilated attic cooks the underside until the mat is brittle and the seal strips release in the first gale.',
    'Have it inspected after the first big wind of its second decade, and keep the attic venting working — the shingle is only half the reason a roof dies young.',
    { aimM: 0, standoffM: 14, from: 'above', reveal: null },
    'IRC R905 — roof covering installation',
  ),
  'roofing:metal-standing-seam': M(
    'Metal standing seam', 45, [0.15, 0.15, 0.35, 0.3], 0.6, 0.4,
    'Fastener and panel corrosion, then the sealant at the closures',
    'Metal roofing is a fastened system: the panels and the clamps are good for generations, and the neoprene washers under the fasteners — which are not — set the date. Coastal salt eats them first.',
    'Re-do the fastener seals and the closures before repainting anything — it is a maintenance item, not a replacement.',
    { aimM: 0, standoffM: 14, from: 'above', reveal: null },
  ),
  'roofing:membrane': M(
    'Low-slope membrane', 25, [0.45, 0.3, 0.45, 0.05], 0.55, 0.5,
    'Seam and flashing failure, ponding where the slope has fallen out',
    'A flat membrane is only as good as its seams and its drainage. Standing water on a seam is where it goes, and freeze–thaw in a ponded area is how a five-year-old roof behaves like a twenty-year-old one.',
    'Keep the drains and the scuppers clear — ponding is what shortens these roofs.',
    { aimM: 0, standoffM: 14, from: 'above', reveal: null },
  ),
  'roofDeck:osb': M(
    'OSB roof deck', 32, [0.15, 0.9, 0.45, 0.05], 0.25, 1.2,
    'Sagging and rot between the rafters, from a leak nobody saw',
    'A roof deck fails from the underside of a leak. It is the first thing to go when a flashing or a shingle fails, and because it is out of sight the visible sign is usually a ceiling stain, which is water that has already crossed the deck.',
    'When the roof covering is replaced, sound the deck and replace the soft panels. A new roof over a rotten deck is a warranty call.',
    { aimM: 0, standoffM: 14, from: 'above', reveal: null },
  ),
  'roofDeck:plywood': M(
    'Plywood roof deck', 40, [0.15, 0.55, 0.4, 0.05], 0.36, 1.0,
    'Delamination over the leak, sag between the framing',
    'Plywood holds a wet deck longer than OSB, which is why it survives a slow leak that would have taken the flakes apart — but a leak left for years takes either of them, and the sag is the last symptom before the ceiling.',
    'Same story: sound the deck when the covering comes off, and replace what is soft.',
    { aimM: 0, standoffM: 14, from: 'above', reveal: null },
  ),

  // ── Services in the envelope — only scored when the model has them ────────
  'plumbing:piping': M(
    'Supply piping in the envelope', 45, [0.05, 0.2, 0.9, 0.25], 0.6, 0.9,
    'A split pipe at the first hard freeze',
    'Piping does not wear out — it bursts. Water in a pipe on an exterior wall or in an unheated run freezes, expands, and the pipe is scrap; the damage is found at the ceiling below it, not at the pipe.',
    'Keep supply runs out of exterior walls, or insulate and heat-trace them. A freeze is the one failure here that shows up in one night.',
    { aimM: 1.2, standoffM: 12, from: 'inside', reveal: 'drywall' },
    'IRC P2603.5 / P2904 — piping in exterior walls and freeze protection',
  ),
  'electrical:wiring': M(
    'Wiring in the envelope', 50, [0.05, 0.3, 0.2, 0.85], 0.55, 0.7,
    'Corroded terminations at wet locations',
    'The cable in a dry wall outlives the building. The failures are at the terminations — outdoor receptacles, boxes in a wall that has been wet — and salt air turns a nuisance into the reason a device has to be replaced.',
    'Keep the covers on the wet-location devices and the boxes dry. Cheap, and it is the whole failure.',
    { aimM: 1.2, standoffM: 12, from: 'inside', reveal: 'drywall' },
    'NEC 406.9 — receptacles in wet and damp locations',
  ),
}

/** One thing in the envelope, as the model knows it. */
export interface Layer {
  id: LayerId
  /** A MATERIALS key suffix — the model's own material name for this layer. */
  material: string
}

/**
 * The site, in F.U.S.E.'s terms. All three drivers are normalised so 1.0 is a
 * benign temperate site — the condition every nominal life above is quoted at.
 */
export interface SiteEnvironment {
  /** Sun. 1.0 temperate, ~1.35 high desert or an unshaded southern exposure. */
  uv: number
  /** Driven rain and wetting. 1.0 temperate, ~1.4 a wet coast or a rainy season. */
  wet: number
  /** Freeze–thaw cycling. 1.0 mild winters, ~1.4 continental. */
  freezeThaw: number
  /** Airborne chloride. The coast, within about a mile. */
  coastal: boolean
  /** Winter indoor relative humidity, 0.3–0.7. High indoor RH is a wet wall. */
  indoorRh: number
}

/**
 * What the model does not know and the user does. These are not preferences —
 * each one is a real detail that changes which layer fails first, which is why
 * they are worth asking about rather than assuming.
 */
export interface DetailFacts {
  /** A drained, ventilated cavity behind the cladding (rainscreen furring). */
  rainscreen: boolean
  /** Roof space ventilated, or a cold ventilated roof. */
  atticVentilated: boolean
  /** The exterior is being kept painted / sealed on schedule. */
  maintained: boolean
}

export interface BuildingProfile {
  /** The envelope, outermost first. The order IS the cascade. */
  layers: Layer[]
  /** Frame material — also decides whether the model has a steel-only chain. */
  steelFramed: boolean
  /** Number of storeys the model was drawn with. */
  storeys: number
  /** True when the model has supply lines traced. */
  hasPlumbing: boolean
  /** True when the model has wiring traced. */
  hasElectrical: boolean
}

/** One layer, scored at one year. */
export interface AssemblyState {
  id: LayerId
  label: string
  material: string
  /** What is still in hand: 1 new, 0 gone. */
  reserve: number
  level: RiskLevel
  /** The year this layer goes, or null if it outlives the horizon. */
  failsYear: number | null
  /** Share of the year it spends wet at THIS year, and the threshold it was
   *  built to shed — the two numbers that explain a verdict. */
  wetTime: number
  wetCapacity: number
  /** True when the layer in front of it has already failed. */
  exposed: boolean
  mode: string
  why: string
  fix: string
  citation?: string
  look: AssemblyLook
  /** Reserve year by year, for the panel's own trace. Index 0 is year 0 (new). */
  trace: number[]
}

export interface FuseReading {
  /** The year being reported. */
  year: number
  horizon: number
  /** Every layer, worst first — the order the panel walks. */
  states: AssemblyState[]
  /** The first thing to go inside the horizon, or null if nothing does. */
  first: AssemblyState | null
  /** How many layers have gone by `year`. */
  failedCount: number
  /** Layers still holding at `year`. */
  holdingCount: number
}

/**
 * A layer's spec, or null when the model named a material F.U.S.E. does not
 * score (a cladding set to 'none' is the normal case — a dried-in wall is not a
 * material, it is an absent one, and it is not a failure either).
 */
export function specFor(layer: Layer): MaterialSpec | null {
  return MATERIALS[`${layer.id}:${layer.material}`] ?? null
}

/** The chain a layer sits in, and where in it — the order water arrives. */
function chainOf(id: LayerId): { chain: ChainId; index: number } {
  switch (id) {
    case 'roofing': return { chain: 'roof', index: 0 }
    case 'roofDeck': return { chain: 'roof', index: 1 }
    case 'cladding': return { chain: 'wall', index: 0 }
    case 'wrb': return { chain: 'wall', index: 1 }
    case 'sheathing': return { chain: 'wall', index: 2 }
    case 'framing': return { chain: 'wall', index: 3 }
    case 'board': return { chain: 'wallInner', index: 0 }
    case 'plumbing': return { chain: 'wallInner', index: 1 }
    case 'electrical': return { chain: 'wallInner', index: 2 }
  }
}

/**
 * HOW WET A LAYER GETS, as a fraction of the year.
 *
 * This is the heart of the model, so it is written out rather than tuned. The
 * rain that reaches a layer is what is left after everything in front of it has
 * done its job; the drying is what the cavity and the interior side can take
 * away. When the two cross, the layer is wet for longer than it can dry and the
 * threshold in engine.derate starts costing years.
 */
function wetTimeFor(
  chain: ChainId,
  index: number,
  countInFrontFailed: number,
  env: SiteEnvironment,
  details: DetailFacts,
  profile: BuildingProfile,
): number {
  // Rain that gets to this layer. Start from the site, then subtract what the
  // things in front of it are for.
  let rain = 0.17 * env.wet
  const layers = new Set(profile.layers.map((l) => l.id))
  if (chain === 'roof' && index > 0) {
    // The covering takes the weather; the deck only sees what gets past it, so
    // a sound roof means a dry deck whatever the climate is doing.
    rain *= 0.12
  }
  if (countInFrontFailed > 0) rain += 0.16 * countInFrontFailed
  if (chain === 'wall' || chain === 'wallInner') {
    if (!layers.has('cladding')) rain += 0.16   // dried-in: nothing is shedding the rain
    if (!layers.has('wrb')) rain += 0.1         // nothing holding it off the sheathing
  }
  // A closed (non-draining) cladding holds water against the layer behind it.
  // The model cannot see furring strips, so the fact comes from the panel's own
  // answer about the detail — see DetailFacts.rainscreen.
  if (!details.rainscreen && (chain === 'wall' || chain === 'wallInner') && index > 0) rain += 0.05

  // Drying. A drained cavity is the single most valuable detail on the list.
  let drying = 0.06
  if (details.rainscreen) drying += 0.06
  if (chain === 'roof' && details.atticVentilated) drying += 0.07
  if (chain === 'roof' && !details.atticVentilated) drying -= 0.03
  // A humid house dries its walls more slowly, and the interior side is half of
  // a wall's drying potential.
  drying += 0.05 * (1 - clamp(env.indoorRh, 0.3, 0.8))

  return clamp01(rain - drying)
}

/**
 * RUN IT.
 *
 * A straight year-by-year march from new to the horizon. It is deliberately a
 * simulation rather than a closed-form answer, because every interesting thing
 * here depends on the state of the layer in front of it: the order failures
 * arrive in is the whole reading, and it cannot be solved by division.
 *
 * `year` is where the scrubber is. Everything the panel shows is computed at
 * that year from the same run, so the timeline and the verdict can never
 * disagree about what has happened.
 */
export function runFuse(
  profile: BuildingProfile,
  env: SiteEnvironment,
  details: DetailFacts,
  opts: { year?: number; horizon?: number } = {},
): FuseReading {
  const horizon = Math.max(1, Math.round(opts.horizon ?? HORIZON_YEARS))
  const year = clamp(Math.round(opts.year ?? 0), 0, horizon)

  interface Scored {
    layer: Layer
    spec: MaterialSpec
    chain: ChainId
    index: number
    /** Failed in year n, or null. */
    failsYear: number | null
    trace: number[]
    wetTrace: number[]
  }

  const scored: Scored[] = []
  for (const layer of profile.layers) {
    const spec = specFor(layer)
    if (!spec) continue
    const { chain, index } = chainOf(layer.id)
    scored.push({ layer, spec, chain, index, failsYear: null, trace: [1], wetTrace: [0] })
  }

  /** Has anything in front of this layer, in its own chain, already failed? */
  const outerFailed = (s: Scored, atYear: number): number =>
    scored.filter((o) => o.chain === s.chain && o.index < s.index && o.failsYear !== null && o.failsYear <= atYear)
      .length

  for (let y = 1; y <= horizon; y++) {
    for (const s of scored) {
      if (s.failsYear !== null) { s.trace.push(0); s.wetTrace.push(s.wetTrace[y - 1]); continue }

      const spec = s.spec
      const failedInFront = outerFailed(s, y)
      const exposed = failedInFront > 0

      // 0 · WHAT IS COVERED IS NOT BEING WEATHERED.
      //
      // This is the sentence the whole model turns on. A wrap behind siding is
      // not doing anything except staying dry, and staying dry is not what ages
      // a material — weather is. So a layer with something sound in front of it
      // ages at a fraction of its exposed rate, and the day the thing in front
      // of it fails, that discount is gone and the exposed multiplier lands on
      // top. Which is why F.U.S.E. can say "the wrap has twenty years on it and
      // nineteen of them are in the bank until the siding goes".
      const COVERED_FACTOR = 0.45

      // 1 · the site, driver by driver
      let rate = 1 / spec.nominalYears
      rate *= stressFactor(env.uv, spec.uv)
      rate *= stressFactor(env.wet, spec.wet)
      rate *= stressFactor(env.freezeThaw, spec.freeze)
      if (env.coastal) rate *= 1 + 0.5 * spec.salt
      if (s.index > 0 && !exposed) rate *= COVERED_FACTOR

      // 2 · the detail. A cavity is worth real years to anything that gets wet;
      //     an unpainted wood wall loses them again.
      if (details.rainscreen && spec.wet > 0.2) rate *= 0.88
      if (!details.maintained && s.layer.id === 'cladding' && spec.wet > 0.5) rate *= 1.5
      if (!details.atticVentilated && s.chain === 'roof' && spec.uv > 0.3) rate *= 1.18

      // 3 · being exposed by the failure in front of it
      if (exposed) rate *= 1 + spec.exposed

      // 4 · the threshold: wet time past what the layer can shed
      const wetTime = wetTimeFor(s.chain, s.index, failedInFront, env, details, profile)
      const overWet = 1 - derate(wetTime, spec.wetCapacity)
      if (overWet > 0) rate *= 1 + 2 * overWet

      // 5 · nothing wears at a constant rate. As reserve runs out, the same
      //     weather takes more of what is left.
      const wear = 1 - s.trace[y - 1]
      rate *= 1 + 0.6 * wear

      const next = clamp01(s.trace[y - 1] - rate)
      s.trace.push(next)
      s.wetTrace.push(wetTime)
      if (next <= 0) s.failsYear = y
    }
  }

  const states: AssemblyState[] = scored.map((s) => {
    const reserve = s.trace[year]
    const failedInFront = outerFailed(s, year)
    return {
      id: s.layer.id,
      label: s.spec.label,
      material: s.layer.material,
      reserve,
      level: reserveToLevel(reserve),
      failsYear: s.failsYear,
      // Wet time is a property of the SITE, not of the age — a new roof is
      // asked to shed the same rain as an old one — so year 0 reads the same
      // exposure year 1 does rather than reporting a misleading zero.
      wetTime: s.wetTrace[Math.max(1, year)] ?? 0,
      wetCapacity: s.spec.wetCapacity,
      exposed: failedInFront > 0,
      mode: s.spec.mode,
      why: s.spec.why,
      fix: s.spec.fix,
      citation: s.spec.citation,
      look: s.spec.look,
      trace: s.trace,
    }
  })

  // Worst first — one ordering rule for the whole module, so a panel that
  // sorts a subset and a reading can never disagree about which layer is the
  // problem. See sortStates.
  const ordered = sortStates(states)

  const first = ordered.find((s) => s.failsYear !== null) ?? null
  const failedCount = ordered.filter((s) => s.failsYear !== null && s.failsYear <= year).length

  return {
    year,
    horizon,
    states: ordered,
    first,
    failedCount,
    holdingCount: ordered.length - failedCount,
  }
}

/**
 * Worst first, and the only ordering rule in the module.
 *
 * The year it goes is the primary key, because the year is what the timeline
 * is about: the first layer in this list is the first thing the owner has to
 * pay for. Ties — two layers that go in the same year — fall to whichever has
 * less left in hand, and then to the grade, which only matters once both are
 * already gone.
 */
export function sortStates(states: AssemblyState[]): AssemblyState[] {
  return [...states].sort((a, b) => {
    const af = a.failsYear ?? Number.POSITIVE_INFINITY
    const bf = b.failsYear ?? Number.POSITIVE_INFINITY
    if (af !== bf) return af - bf
    if (a.reserve !== b.reserve) return a.reserve - b.reserve
    return severityRank(b.level) - severityRank(a.level)
  })
}
