# Arena — bench report

Run 7 Nov 2026. Every figure below is the bench's own output for the case it is
set to; nothing here is rounded to look tidy.

## The case

- Span 12 ft, tributary width 4 ft, 40 psf live over 15 psf dead — the default
  residential floor case, and every figure is a control.
- Deflection limit L/360 on a 12 ft span = 0.400 in.
- Load ramp in 0.05× steps to 4×. Each part is graded nominal → stressed →
  critical → failed, and the envelope reports the multiple at which each grade is
  first reached.

## The roster

Four branded parts. Two are on the bench; the other two are waiting on a figure
their plate does not carry, which is the answer to "why is this maker not on the
bench yet".

### West Fraser LVL 3000Fb 1.9E — canadian-verified

- Section 1-3/4 × 11-1/2, from catalogue row `lvl-1-3_4x11-1_2`.
- Plate: Fb 5544 psi · Fv 554 psi · E 1 900 000 psi · bending depth factor
  (12/d)^(1/7.35), stored as the exponent 0.1360544217687075.
- Source: West Fraser LVL User's Guide, Canadian edition, 2026-07-14 v1.1 — the
  plate is on the NBC / CSA O86 specified-strength basis, so this is a real
  rating.
- **At 1×**: bending 22.1%, shear 17.8%, deflection 60.9% — nominal.
  Deflection governs. Demand 1232.0 psi bending, 98.39 psi shear, 0.244 in of
  sag; capacity 5576.2 psi, 554.00 psi, 0.400 in (the 5576.2 is 5544 carrying
  its own depth factor for 11-1/2").
- **Envelope**: first watch at 1.15×, critical from 1.65×, lets go at 2.25× —
  and it is deflection at both ends of that, 137% of L/360. A sag, not a break.

### LP SolidStart LSL 1.35E — us-reference

- Section 1-3/4 × 9-1/2, from catalogue row `lsl-1-3_4x9-1_2`.
- Plate: Fb 1730 psi · Fv 410 psi · E 1 350 000 psi · depth factor
  (12/d)^0.120, stored as 0.12.
- Source: LP SolidStart OSB & LSL Rim Board, U.S. (ASD) Technical Guide, 2019.
  Allowable stresses on the U.S. basis — it runs, and every number it prints says
  so. It is a reference, not a Canadian rating. It is also a rim board guide: the
  bench is asking a rim board to carry a floor.
- **At 1×**: bending 101.5%, shear 29.0%, deflection 152.0% — over on two checks
  before the ramp has moved. Demand 1805.3 psi, 119.10 psi, 0.608 in; capacity
  1779.2 psi, 410.00 psi, 0.400 in.
- **Envelope**: watch at 0.50×, critical 0.70×, lets go 0.90× — deflection, at
  137% of L/360.

## Versus

The two parts share one ramp. LVL 3000Fb endures to 2.25×, SolidStart LSL to
0.90×: **LVL wins**, 2-1/2 times the endurance on the same case. Both let go in
deflection at the same 137% of L/360 — neither breaks, both sag out.

## Not on the bench, and what each is waiting for

- **Nordic Lam 24F-E/ES1M1** (glulam 6-3/4 × 18, `glulam-6-3_4x18`). The plate as
  read carries none of the four figures the bench needs: Fb, Fv, E and the
  bending depth factor. Source APA Product Report PR-L294(C), Nordic Structures,
  rev. 2025-12-21. Until those are on the plate it does not run — and the width
  is a separate question: 6-3/4" sits inside the layup's 7-1/2" limit in Table 1
  of that report, but Nordic publish 1-3/4, 3-1/2, 5-1/2 and 7, so this size is
  at best built to order.
- **Parallam PSL 2.2E** (3-1/2 × 20, `psl-3-1_2x20`). Fb 2900 psi, Fv 290 psi and
  E 2 200 000 psi are read; the bending depth factor is not. At 20" deep the
  12"-tabulated value cannot be used without it, and the bench will not invent
  1.0. Source Trus Joist TJ-7001, April 2026.

## What this does not decide

One member, one case, three checks: bending, shear, and L/360 deflection. It is
not a design. Bearing, connections, load duration, repetitive-member credit and
everything else a stamped design applies live outside this bench, and a part that
passes here has passed a comparison, not a review.
