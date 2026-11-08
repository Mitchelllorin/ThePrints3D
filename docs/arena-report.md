# Arena — bench report

Run 8 Nov 2026, rebuilt on CSA O86 limit states. Every figure below is the
bench's own output for the case it is set to; nothing is rounded to look tidy.

## What changed from the first run

Four things were wrong and are fixed in the code, not only in this page:

1. **The versus run is gone.** It ranked a Canadian specified strength against a
   U.S. allowable stress on one ramp and declared a winner. Parts on different
   bases are not comparable and the bench no longer offers the comparison.
   `duelFor` and its types are deleted; the panel takes one part.
2. **LP SolidStart LSL is off the bench.** The cited document is LP's rim-board
   guide, and a rim board is not a floor beam. Asking one to carry a 12 ft span
   is a test LP never sold it for, so a FAILED chip against it would be a false
   accusation. It keeps its catalogue row and its plate; it no longer runs.
3. **Strength is on factored resistance; L/360 is not a failure.** Bending and
   shear are 1.25D + 1.5L against φ and the CSA O86 modification factors.
   Deflection stays on specified (unfactored) load. Only bending or shear
   reaching factored resistance produces FAILED; sag past L/360 gets its own
   readout and never the word failed.
4. **Parallam is on the bench, on its Canadian figures.** TJ-9505 page 4
   publishes the 2.2E specified strengths — Fb 5,360 psi, Fv 540 psi, E
   2.2 × 10⁶ psi — and the same page's factored-resistance table prints
   Mr 80,445 ft-lb and Vr 21,545 lb for 3-1/2 × 19. The U.S. allowable stresses
   this plate used to carry are gone, so the plate stands on one basis. The
   bench derives 80,444.7 ft-lb and 21,546 lb from those strengths; the gap is
   the guide's own rounding, and reproducing the printed table is what proves
   the reading of it.

## The case

- Span 12 ft, tributary width 4 ft, 40 psf live over 15 psf dead — the default
  residential floor case, and every figure is a control.
- Strength load: 1.25 × 15 + 1.5 × 40 = 78.75 psf over 4 ft = **315 plf**
  (NBCC 2020 Table 4.1.3.2-A, principal combination).
- Deflection load: specified, (40 + 15) × 4 = **220 plf**, unfactored.
- Deflection limit L/360 on a 12 ft span = 0.400 in — the app's own limit, not a
  manufacturer's.
- Ramp in 0.05× steps to 4×. Bending and shear utilisation is factored demand
  over factored resistance; deflection utilisation is sag over L/360.

## Every factor used

Listed so Mitchell can check them before anything is filmed. The strengths are
the makers'; the factor chain is CSA O86's. Neither is invented here, and the
makers say exactly that themselves — West Fraser's product report for its LVL
(APA PR-L349(C), rev. 2 Apr 2026) states its table values are "based on
covered, dry conditions of use, as defined in CSA O86, for the standard-term
load duration", and Weyerhaeuser's Canadian specifier's guide (TJ-9500, Feb 2026)
says "to obtain factored resistances, apply the appropriate formulae from CSA
O86 to the specified strengths shown."

| Factor | Value | Why this value | Where it comes from |
|---|---|---|---|
| φ bending | 0.90 | resistance factor, bending limit state | CSA O86:19 Cl. 6.5.3.1 |
| φ shear | 0.90 | resistance factor, shear limit state | CSA O86:19 Cl. 6.5.4.3 |
| KD | 1.00 | standard-term load duration — a floor's live load | CSA O86:19 Cl. 5.3.2; TJ-9500 states KD = 1.0 "where the specified snow or live load is greater than the specified dead load", which is this case (40 over 15) |
| KH | 1.00 | one member standing alone — no repetitive-member, built-up or layup system | CSA O86:19 Cl. 6.4.4 |
| KS | 1.00 | covered, dry service — the condition the tabulated values are already given for | CSA O86:19 Cl. 6.4.2; PR-L349(C) note (a) |
| KT | 1.00 | untreated | CSA O86:19 Cl. 6.4.3 |
| KL | 1.00 | **assumed, not checked** — the bench has no bracing control | CSA O86:19 Cl. 6.5.3.7 / 7.5.6.4 |
| KZb (size) | 1.0058072206386928 | the maker's own depth factor at 11-1/2": (12 / 11.5) ^ (1 / 7.35) | West Fraser LVL User's Guide, Canadian edition — applied instead of, not on top of, a code depth factor |
| KZb (size, PSL) | 0.9502709841765127 | the maker's own depth factor at 19": (12 / 19) ^ 0.111 | TJ-9505 note (3) — the PSL exponent, applied the same way |
| Dead load factor | 1.25 | principal combination | NBCC 2020 Table 4.1.3.2-A |
| Live load factor | 1.50 | principal combination | NBCC 2020 Table 4.1.3.2-A |
| Deflection basis | specified | a floor sags under the load it carries, not a factored one | CSA O86:19 Cl. 5.4.2 (serviceability); limit L/360 is the app's |

**KL is the one soft factor.** Every guide cited here requires lateral support at
bearing and along the span (TJ-9505, PR-L294(C), PR-L349(C)). If the beam on the
bench is not braced that way, Mr is lower than the bench prints. The bench cannot
police a bracing condition it has no control for, so it says so here instead of
pretending KL was computed.

## West Fraser LVL 3000Fb 1.9E — canadian-verified

- Section 1-3/4 × 11-1/2 from catalogue row `lvl-1-3_4x11_2`'s plate row
  `lvl-1-3_4x11-1_2`; S = 38.5729 in³, I = 221.794 in⁴, A = 20.125 in².
- Plate: Fb 5544 psi · Fv 554 psi · E 1 900 000 psi · depth factor
  (12/d)^(1/7.35).
- Factored resistances: Mr/S = **5018.575708098821 psi**, Mr =
  193 581.10 lb·in; Vr = **6689.55 lb**, which on 1.5V/A is 498.60 psi.
- Source: West Fraser LVL User's Guide, Canadian edition, 2026-07-14 v1.1 —
  NBC / CSA O86 specified strengths, so this is a real rating rather than a
  reference.
- **At 1×**: factored load 315 plf, Mf 68 040 lb·in, Vf 1890 lb.
  - Bending: demand 1763.93 psi against 5018.58 psi — **35.15% of Mr**.
  - Shear: 1890 lb against 6689.55 lb — **28.25% of Vr**.
  - Sag: 0.2436 in against 0.400 in — **60.89% of L/360** (specified load).
- **Envelope**: first past its 0.7 band at 2.00×, CRITICAL from 2.60×, and
  **factored resistance reached at 2.85×** — bending, at 100.17% of Mr. Sag
  passed L/360 much earlier, **from 1.65×**, at 100.47% of the limit.
- Read plainly: the floor starts to feel springy at about 1.65 times the
  designed load and the member reaches its factored bending resistance at about
  2.85 times it. Two different numbers, two different events. On a 0.05 ramp the
  continuous crossings are 1.642× and 2.845×.

## Parallam PSL 2.2E — canadian-verified

- Section 3-1/2 × 19 from catalogue row `psl-3-1_2x19`; S = 210.5833 in³,
  I = 2000.5417 in⁴, A = 66.5 in².
- Plate: Fb 5,360 psi at a 12" depth · Fv 540 psi · E 2 200 000 psi · depth
  factor (12/d)^0.111, which at 19" is 0.9502709841765127.
- Factored resistances: Mr/S = **4584.107227667498 psi**, Mr =
  965 336.58 lb·in = 80 444.715 ft-lb; Vr = **21 546 lb**, which on 1.5V/A is
  486.00 psi.
- **The check that matters**: TJ-9505 page 4 prints Mr 80,445 ft-lb and
  Vr 21,545 lb for this width and depth, and the bench derives 80,444.7 and
  21,546. The chain is right — or the table was read wrong, and both would show.
- Source: Trus Joist Beam, Header, and Column Specifier's Guide (W. Canada),
  TJ-9505, April 2023 — NBC / CSA O86 specified strengths, so this is a real
  rating rather than a reference.
- **At 1×**: factored load 315 plf, Mf 68 040 lb·in, Vf 1890 lb.
  - Bending: demand 323.10 psi against 4584.11 psi — **7.05% of Mr**.
  - Shear: 42.63 psi against 486.00 psi — **8.77% of Vr**.
  - Sag: 0.0233 in against 0.400 in — **5.83% of L/360** (specified load).
- **At 12 ft it does not fail on the ramp**: at 4× bending is 28.19% of Mr, shear
  35.09% of Vr, sag 23.32% of L/360 — "holds to 4× — nothing on this plate takes
  it", which is the honest verdict on a 19" member over 12 ft.
- **Where it does fail, for the clip**: at a 24 ft span the same member is over
  L/360 from 2.2× and reaches factored resistance at 3.5×, bending — 28.19% at
  1× and 3.55× on the ramp. That is the run to film if Parallam is the specimen.

## Not on the bench, and what each is waiting for

- **Nordic Lam 24F-E/ES1M1** (glulam 7 × 18, `glulam-7x18`). The plate as read
  carries none of the four figures the bench needs: Fb, Fv, E and the bending
  depth factor. Source APA Product Report PR-L294(C), Nordic Structures, rev.
  2025-12-21. Until those are on the plate it does not run. The width moved from
  6-3/4" to 7" on Mitchell's call (8 Nov 2026) so the row is a published Nordic
  width; note (6) of that report — Fbx × 0.88 over 381 mm deep, and this member
  is 457 mm — is carried on the plate and applied in code the moment an Fb
exists.
- **LP SolidStart LSL 1.35E** — off the bench by decision, not by a missing
  figure: it is a rim board, and the cited document is LP's rim-board guide.

## What this does not decide

One member, one case, two strength limit states and one serviceability limit. It
is not a design. Bearing, connections, load duration in combinations other than
this one, repetitive-member credit, lateral bracing and everything else a stamped
design applies live outside this bench. A part that passes here has passed a
comparison, not a review.

## For Mitchell

1. **The factor list above.** He is the framer and checks it before anything from
   the bench is filmed or sent.
2. **KL.** Assumed 1.0. If a bracing condition should be a control, the bench
   needs a fourth input and this report needs re-running.
3. **Bearing.** Not modelled — it needs a bearing length the bench does not ask
   for. Compression perpendicular is on every plate, unused.
