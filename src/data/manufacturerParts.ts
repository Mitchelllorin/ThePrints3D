/**
 * MANUFACTURER PARTS — a real product, modelled from its own published data.
 *
 * This is the door the outreach pitches knock on. A framer does not ask for
 * "a glulam beam"; they ask for a Nordic Lam beam at a depth they can get, and
 * the difference between one maker's line and another's is in the product
 * report, not in the trade. So a manufacturer's part is a data row here, and
 * three things follow from it automatically:
 *
 *   • it is in the member catalogue, so it can be framed with and cut-listed;
 *   • it carries a nameplate of the maker's own rated values, each tied to the
 *     document it came from;
 *   • F.U.S.E. scores the assembly it belongs to, and the sheet says where the
 *     part sits in the failure order.
 *
 * THE RULE THIS FILE EXISTS TO KEEP. Every number in `rated` is published by
 * the manufacturer and cited in `source`. Nothing here is a durability claim
 * dressed up as a spec: a maker's service life is almost never published, so
 * F.U.S.E. uses the app's own figure and `basis` says so in words. Two columns,
 * two owners — theirs is the spec, ours is the model — and a pitch that keeps
 * them apart is one an engineer will not throw back at you.
 *
 * Nothing in `rated` is rounded to look tidy. It says 6-3/4 because that is the
 * width, and it keeps the layup symbol exactly as the report prints it.
 *
 * CANADIAN BASIS, NOT AMERICAN. The app frames to the National Building Code of
 * Canada and CSA O86, so a maker's U.S. allowable stress design value is not
 * the number this file may carry: the same 3000Fb 1.9E LVL is Fb 3000 psi in
 * West Fraser's U.S. edition and Fb 5544 psi in their Canadian one, because one
 * is an allowable stress and the other a specified strength under limit states
 * design. Where the Canadian document could not be reached, the part is marked
 * `unverified` and its figures are left exactly as they were.
 *
 * MODELLING STATUS. `reference-only` is not a demotion, it is a fact: F.U.S.E.
 * scores how a building ages, so it never loads a beam to its bending stress
 * and cannot fail one at these numbers. The plate is a datasheet the sim cannot
 * contradict. `fully-modelled` is reserved for a part F.U.S.E. can actually
 * drive to failure.
 */

import type { LayerId } from '../services/fuse'

/** One rated field, as it appears on the product report. */
export interface RatedField {
  label: string
  /** Printed exactly as the maker prints it — '6-3/4', '24F-E/ES1M1'. */
  value: string
  /** Always shown when there is one. No bare numbers on a nameplate. */
  unit?: string
  /** Where this one figure came from, when it is not the headline document. */
  note?: string
}

/** Where a part sits in the assembly F.U.S.E. scores. */
export interface PartLayer {
  id: LayerId
  /**
   * The model's material key for this layer. A maker whose published data
   * justifies its own row in the F.U.S.E. material table gets its own key; one
   * who does not inherits the base material and says so in `basis`.
   */
  material: string
}

export interface ManufacturerPart {
  /** Stable key. Never rename one — it is referenced by sheets and tests. */
  id: string
  manufacturer: string
  /** The product line, as the maker names it: 'Nordic Lam'. */
  product: string
  /** The designation a specifier would write: a layup symbol, a model number. */
  designation: string
  /** The member catalogue row this part becomes. See data/members.ts. */
  memberId: string
  layer: PartLayer
  /** Published values only. Every figure here is citable. */
  rated: RatedField[]
  /** What F.U.S.E. credits, in plain words — and what it deliberately does not. */
  basis: string
  source: { label: string; url: string }
  /**
   * 'verified' — every figure traced to the maker's own current document on the
   * Canadian basis (NBC / CSA O86). 'unverified' — at least one figure could not
   * be traced to such a document; nothing was changed and nothing guessed.
   */
  verification: 'verified' | 'unverified'
  /** What was checked, or what could not be reached. Never a substitute for `source`. */
  verificationNote: string
  /**
   * 'reference-only' — F.U.S.E. cannot fail the part at these numbers, so the
   * plate is a datasheet rather than a model. 'fully-modelled' — it can.
   */
  modelling: 'reference-only' | 'fully-modelled'
  /** One line for the sheet and the pitch, in the trade's register. */
  pitchLine: string
}

export const MANUFACTURER_PARTS: readonly ManufacturerPart[] = [
  {
    id: 'nordic-lam-24f-e-es1m1-6-3_4x18',
    manufacturer: 'Nordic Structures',
    product: 'Nordic Lam',
    designation: '24F-E/ES1M1',
    memberId: 'glulam-6-3_4x18',
    layer: { id: 'framing', material: 'wood' },
    rated: [
      // Dimensions and limits, straight off Table 1 of the product report.
      { label: 'Layup', value: '24F-E/ES1M1' },
      { label: 'Width', value: '6-3/4', unit: 'in', note: 'Permitted by Table 1 (max 7-1/2) but not one of Nordic\'s four published beam widths — 1-3/4, 3-1/2, 5-1/2, 7' },
      { label: 'Depth', value: '18', unit: 'in' },
      { label: 'Depth : width', value: '2.667', unit: ':1', note: '18 ÷ 6-3/4, derived — the layup is capped at 12:1' },
      { label: 'Length, maximum', value: '80', unit: 'ft' },
      { label: 'Width range, layup', value: '1-1/2 – 7-1/2', unit: 'in' },
      { label: 'Depth, maximum', value: '36', unit: 'in' },
      { label: 'Fabrication', value: 'ANSI A190.1' },
      { label: 'Product report', value: 'APA PR-L294(C)', note: 'Also covered by ESR-4874' },
      { label: 'Species', value: 'SPF, mechanically graded', note: 'Black spruce, per the report' },
    ],
    basis:
      "Nordic does not publish a service life for Nordic Lam, and F.U.S.E. does not invent one. " +
      "The member is scored with the app's own figure for structural timber — 90 years in a dry wall — " +
      "so the year column is the model's, not Nordic's.",
    source: {
      label: 'APA Product Report PR-L294(C) — Nordic Lam, Nordic Structures (rev. 2025-12-21)',
      url: 'https://www.nordic.ca/sites/default/files/datasheet/file/APA_PR-L294C_2025-12-21.pdf',
    },
    verification: 'verified',
    verificationNote:
      'Table 1 of PR-L294(C) confirms the 38–191 mm width range, the 914 mm depth cap under the 12:1 limit, and lengths to 24.4 m (80 ft); ' +
      'CCMC 13216-R is the Canadian evaluation behind it. The plate flags 6-3/4: Table 1 permits it, Nordic does not publish it as a stock width.',
    modelling: 'reference-only',
    pitchLine:
      'Their layup, their widths, their depth limit — a beam a framer can pick, and see where it sits when the wall ages.',
  },
  {
    id: 'west-fraser-lvl-3000fb-1_9e',
    manufacturer: 'West Fraser',
    product: 'LVL',
    designation: '3000Fb 1.9E',
    memberId: 'lvl-1-3_4x11-1_2',
    layer: { id: 'framing', material: 'wood' },
    rated: [
      // Straight off the design-properties table for 1-3/4" 3000Fb 1.9E.
      { label: 'Grade', value: '3000Fb 1.9E' },
      { label: 'Thickness', value: '1-3/4', unit: 'in' },
      { label: 'Depth', value: '11-1/2', unit: 'in' },
      { label: 'Modulus of elasticity', value: '1.9 × 10⁶', unit: 'psi' },
      { label: 'Bending stress', value: '5544', unit: 'psi', note: 'Specified strength, standard term, at a 12" depth' },
      { label: 'Bending depth factor', value: '(12/d)^(1/7.35)', note: 'Per the guide, for depths other than 12"' },
      { label: 'Shear stress', value: '554', unit: 'psi' },
      { label: 'Compression perpendicular', value: '1300', unit: 'psi' },
      { label: 'Compression parallel', value: '4000', unit: 'psi' },
      { label: 'Depth range, 1-3/4" 1.9E', value: '5-1/2 – 24', unit: 'in' },
    ],
    basis:
      'West Fraser publishes no service life for its LVL, and F.U.S.E. does not invent one. ' +
      "The member is scored with the app's own figure for structural timber, so the year column is the model's, not West Fraser's. " +
      'The 5544 psi bending stress is their tabulated value at a 12" depth and the guide\'s own depth factor is carried beside it: ' +
      'this row is 11-1/2" deep, so the beam F.U.S.E. scores is not the 12" beam the table describes until that factor is applied.',
    source: {
      label: "West Fraser LVL User's Guide, Canadian edition (2026-07-14 v1.1)",
      url: 'https://www.westfraser.com/sites/default/files/2026-09/LVL-UsersGuide-CANADA-2026-v1.1-WEB.pdf',
    },
    verification: 'verified',
    verificationNote:
      'Canadian edition, cross-checked against CCMC 12904-R: fb 38.2 MPa = 5544 psi, fc 27.5 MPa ≈ 4000 psi, fc⊥ 9.0 MPa = 1300 psi. ' +
      'The previous figures (3000 / 300 / 750 / 3000 psi) were the U.S. edition\'s allowable stresses, not Canadian specified strengths.',
    modelling: 'reference-only',
    pitchLine:
      'Their 1.9E line and their own depth factor, so a 1.9E beam stops being a number in a guide and becomes a beam in a wall.',
  },
  {
    id: 'weyerhaeuser-parallam-2_2e-3_1_2x20',
    manufacturer: 'Weyerhaeuser',
    product: 'Parallam PSL',
    designation: '2.2E',
    memberId: 'psl-3-1_2x20',
    layer: { id: 'framing', material: 'wood' },
    rated: [
      // The 2.2E design-stress block of the deep-beam guide, plus the two
      // stiffness figures carried beside it.
      { label: 'Grade', value: '2.2E' },
      { label: 'Width', value: '3-1/2', unit: 'in' },
      { label: 'Depth', value: '20', unit: 'in' },
      { label: 'Modulus of elasticity', value: '2.2 × 10⁶', unit: 'psi' },
      { label: 'Adjusted modulus', value: '1,118,190', unit: 'psi', note: 'Emin, per the guide' },
      { label: 'Flexural stress', value: '2900', unit: 'psi', note: 'At a 12" depth' },
      { label: 'Tension stress', value: '2300', unit: 'psi', note: 'At a 4 ft length' },
      { label: 'Compression perpendicular', value: '625', unit: 'psi' },
      { label: 'Compression parallel', value: '2900', unit: 'psi' },
      { label: 'Horizontal shear', value: '290', unit: 'psi' },
      { label: 'Shear modulus', value: '137,500', unit: 'psi' },
      { label: 'Lengths available', value: '48 and 60', unit: 'ft' },
      { label: 'Code evaluation', value: 'ICC-ES ESR-1387' },
    ],
    basis:
      'Weyerhaeuser publishes no service life for Parallam, so F.U.S.E. scores it with the app\'s own timber figure. ' +
      'The bending and tension values are reference values at a 12" depth and a 4 ft length, and the guide gives a depth and a length factor for anything else: ' +
      'this row is 20" deep, so the stress the beam carries is the tabulated figure reduced by those factors, not the figure on its own. ' +
      'The guide forbids cutting, notching and drilling except as the engineer of record approves — a wall in this app can be remodelled freely, and that beam could not.',
    source: {
      label: "Trus Joist 2.2E Parallam PSL Deep Beam Specifier's Guide, TJ-7001 (April 2026)",
      url: 'https://www.weyerhaeuser.com/application/files/6017/7757/7574/TJ-7001_2.2E_Parallam_PSL_Deep_Beam.pdf',
    },
    verification: 'unverified',
    verificationNote:
      'TJ-7001 is the U.S. guide, on ICC-ES ESR-1387 and NDS allowable stresses, so these are not Canadian specified strengths. ' +
      "Weyerhaeuser's Canadian guides are public and were checked: TJ-9505 (West, April 2023) offers 2.2E Parallam in 3-1/2, 5-1/4 and 7 in widths at 9-1/4 to 19 in deep, " +
      'and TJ-9500 (East, February 2026) carries 2.0E Parallam at 3-1/2, 5-1/4 and 7 in by 9-1/4 to 18 in. ' +
      'This beam is 20 in deep, which neither Canadian edition offers; CCMC 11161-R is the Canadian evaluation behind both. ' +
      'Their tables give CSA O86 specified strengths rather than the ASD values on this plate, and the Parallam rows could not be read off the PDF without ambiguity, ' +
      'so every figure here is left exactly as it was.',
    modelling: 'reference-only',
    pitchLine:
      'A beam whose whole selling point is that it has no plies to nail wrong — and an app that can show the wall it carries outliving it.',
  },
  {
    id: 'lp-lsl-1_35e-1_3_4x9-1_2',
    manufacturer: 'LP Building Solutions',
    product: 'SolidStart LSL',
    designation: '1.35E',
    memberId: 'lsl-1-3_4x9-1_2',
    layer: { id: 'framing', material: 'wood' },
    rated: [
      { label: 'Grade', value: '1.35E' },
      { label: 'Thickness', value: '1-3/4', unit: 'in', note: 'LSL rim board is 1-1/4" and thicker' },
      { label: 'Depth', value: '9-1/2', unit: 'in' },
      { label: 'Bending stress', value: '1730', unit: 'psi', note: 'Tabulated at a 12" depth' },
      { label: 'Bending depth factor', value: '(12/d)^0.120', note: 'Per the guide, for depths other than 12"' },
      { label: 'Modulus of elasticity', value: '1.35 × 10⁶', unit: 'psi' },
      { label: 'Shear stress', value: '410', unit: 'psi' },
      { label: 'Compression perpendicular', value: '750', unit: 'psi' },
      { label: 'Use condition', value: 'dry use only' },
    ],
    basis:
      'LP publishes dry-use design values and no service life, so the year column is F.U.S.E.\'s own timber figure and not LP\'s. ' +
      'The 1730 psi bending stress is their value at a 12" depth: at 9-1/2" the guide\'s factor applies and the member is stronger than the table says, ' +
      'which is why the factor is carried on the plate rather than folded into a number nobody can check. ' +
      'Dry-use only is LP\'s limitation and the app does not rain on a wall it cannot get wet.',
    source: {
      label: 'LP SolidStart OSB & LSL Rim Board, U.S. (ASD) Technical Guide (2019)',
      url: 'https://assets.ctfassets.net/89s5b832f23c/5D4Zy2SYqbErz2olYtzOlA/9357c1a3b5938dfbcd40333b04a10918/Rim_Board_-_Technical_Guide',
    },
    verification: 'unverified',
    verificationNote:
      'The cited guide is LP\'s U.S. (ASD) rim-board guide, so these are allowable stresses for rim board, not Canadian specified strengths for a beam. ' +
      'LP\'s Canadian (LSD) values exist but the only copies reachable are distributor-hosted, which are not an official source. No figure was changed.',
    modelling: 'reference-only',
    pitchLine:        "A rim board spec'd at the maker's own values, on an app that shows what the floor does when the rim gives first.",
  },
]

const BY_ID = new Map(MANUFACTURER_PARTS.map((p) => [p.id, p]))

export function getManufacturerPart(id: string): ManufacturerPart | undefined {
  return BY_ID.get(id)
}

