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

/**
 * A factor the maker's own report applies to bending strength at depth, over and
 * above the depth factor.
 *
 * Nordic's PR-L294(C) note (6) is the case this exists for: "When the member
 * depth is greater than 381 mm (15 inches), the tabulated Fbx values shall be
 * multiplied by a factor of 0.88." Carried as data rather than as a remark in a
 * comment, because the bench applies it — a factor that lives only in prose is
 * one the next person to add an Fb will not apply.
 */
export interface StrengthFactor {
  factor: number
  /** Applies above this depth, in millimetres. */
  overDepthMm: number
  /** The note the report prints beside it. */
  note: string
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
  /** A depth-dependent factor on Fb, applied wherever Fb is used. */
  fbFactor?: StrengthFactor
}

export const MANUFACTURER_PARTS: readonly ManufacturerPart[] = [
  {
    id: 'nordic-lam-24f-e-es1m1-7x18',
    manufacturer: 'Nordic Structures',
    product: 'Nordic Lam',
    designation: '24F-E/ES1M1',
    memberId: 'glulam-7x18',
    layer: { id: 'framing', material: 'wood' },
    rated: [
      // Dimensions and limits, straight off Table 1 of the product report.
      { label: 'Layup', value: '24F-E/ES1M1' },
      { label: 'Width', value: '7', unit: 'in', note: 'Moved off 6-3/4 on Mitchell\'s call, 8 Nov 2026 — 6-3/4 is permitted by Table 1 (38–191 mm) but is not one of Nordic\'s published beam widths: 1-3/4, 3-1/2, 5-1/2, 7' },
      { label: 'Depth', value: '18', unit: 'in' },
      { label: 'Depth : width', value: '2.571428571428571', unit: ':1', note: '18 ÷ 7, derived — the layup is capped at 12:1' },
      { label: 'Length, maximum', value: '80', unit: 'ft', note: 'A maximum, not a stock list — 24.4 m, per §2 of the report' },
      { label: 'Width range, layup', value: '1-1/2 – 7-1/2', unit: 'in' },
      { label: 'Depth, maximum', value: '36', unit: 'in' },
      { label: 'Bending factor over 381 mm', value: '0.88', unit: '×', note: 'PR-L294(C) note (6): tabulated Fbx × 0.88 when the member is deeper than 381 mm (15"). This member is 457 mm, so it applies to any Fbx used' },
      { label: 'Stock lengths', value: 'Generic list', note: 'Nordic publishes a maximum length (80 ft), not a stock list in this report, so the app\'s generic engineered lengths are what the buy list uses' },
      { label: 'Fabrication', value: 'ANSI A190.1' },
      { label: 'Product report', value: 'APA PR-L294(C)', note: 'Also covered by ESR-4874' },
      { label: 'Species', value: 'SPF, mechanically graded', note: 'Black spruce, per the report' },
    ],
    // Note (6) of the report, applied by the bench wherever Fb is used.
    fbFactor: {
      factor: 0.88,
      overDepthMm: 381,
      note: 'APA PR-L294(C) note (6) — Fbx × 0.88 for members deeper than 381 mm',
    },
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
      'CCMC 13216-R is the Canadian evaluation behind it. 7 in (178 mm) sits inside that range. ' +
      'Note (6) of the same report is carried on the plate and applied in code: over 381 mm deep, Fbx × 0.88 — this member is 457 mm.',
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
    id: 'weyerhaeuser-parallam-2_2e-3_1_2x19',
    manufacturer: 'Weyerhaeuser',
    product: 'Parallam PSL',
    designation: '2.2E',
    memberId: 'psl-3-1_2x19',
    layer: { id: 'framing', material: 'wood' },
    rated: [
      // The CANADIAN specified-strength block — TJ-9505 page 4, "Specified
      // Strengths and Moduli of Elasticity (Standard Term)". These replaced the
      // U.S. (ASD) figures this plate used to carry: a plate can only stand on
      // one basis, and the bench can only rate one of them.
      { label: 'Grade', value: '2.2E' },
      { label: 'Width', value: '3-1/2', unit: 'in', note: 'TJ-9505 (West Canada) lists 2.2E beams in 3-1/2, 5-1/4 and 7 in widths' },
      { label: 'Depth', value: '19', unit: 'in', note: 'The deepest 2.2E depth in TJ-9505 — its depths stop at 19". There is no 18" in that guide' },
      { label: 'Flexural stress', value: '5,360', unit: 'psi', note: 'Specified Fb at a 12" depth — TJ-9505, page 4' },
      { label: 'Bending depth factor', value: '(12/d)^0.111', note: 'TJ-9505 note (3): PSL flexural stress is adjusted for depth, and this is the maker\'s exponent' },
      { label: 'Horizontal shear', value: '540', unit: 'psi', note: 'Specified Fv — a flat figure, not depth-adjusted' },
      { label: 'Modulus of elasticity', value: '2.2 × 10⁶', unit: 'psi' },
      { label: 'Shear modulus', value: '137,500', unit: 'psi' },
      { label: 'Tension stress', value: '3,750', unit: 'psi', note: 'Specified ft, already adjusted for volume effects — note (4)' },
      { label: 'Compression perpendicular', value: '4,630', unit: 'psi' },
      { label: 'Compression parallel', value: '1,135', unit: 'psi', note: 'For a column, use 800 psi — note (9)' },
      { label: 'Stock lengths', value: 'Generic list', note: 'TJ-9505 prints a maximum offering, not a stock-length list, so the app\'s generic engineered lengths stand' },
      { label: 'Code evaluation', value: 'CCMC 11161-R' },
    ],
    basis:
      'Weyerhaeuser publishes no service life for Parallam, so F.U.S.E. scores it with the app\'s own timber figure. ' +
      'The strengths are Canadian specified strengths from TJ-9505, quoted at a 12" depth, and the guide gives the exponent for adjusting one to any other depth: ' +
      'this row is 19" deep, so the value it is rated at is (12/19)^0.111 of the tabulated figure. ' +
      'The guide forbids cutting, notching and drilling except as the engineer of record approves — a wall in this app can be remodelled freely, and that beam could not.',
    source: {
      label: "Trus Joist Beam, Header, and Column Specifier's Guide (W. Canada), TJ-9505 (April 2023)",
      url: 'https://www.weyerhaeuser.com/application/files/8416/8488/0366/TJ-9505.pdf',
    },
    verification: 'verified',
    verificationNote:
      'Canadian basis, NBC 2020 / CSA O86-19: TJ-9505 page 4 lists "Specified Strengths and Moduli of Elasticity (Standard Term)" — 2.2E Beam at Fb 5,360 psi, ft 3,750 psi, fc 1,135 psi, fcll 4,630 psi, Fv 540 psi, E 2.2 × 10⁶ psi, G 137,500 psi — and note (3) gives the PSL depth adjustment (12/d)^0.111. ' +
      'The cross-check is the same page\'s factored-resistance table: for 3-1/2 × 19 it prints Mr 80,445 ft-lb and Vr 21,545 lb, and φ 0.9 applied to those strengths and the depth factor reproduces them. ' +
      'The U.S. (ASD) figures from TJ-7001 that this row used to carry are gone, because a plate cannot stand on two bases. ' +
      'CCMC 11161-R is the Canadian evaluation behind the product.',
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

