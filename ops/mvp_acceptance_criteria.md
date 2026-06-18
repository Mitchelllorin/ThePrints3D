# ThePrints3D MVP Acceptance Criteria

This MVP acceptance definition is aligned to pilot artifacts in `pilot/pilot_runbook.txt` and `pilot/pilot_metrics_template.csv`.

## Scope

- Batch size: 20 pilot projects
- Input mix:
  - 8 clean PDF sets
  - 6 scanned/noisy sets
  - 6 phone-photo sets

## Functional completion gates

For each pilot project, the following flow must complete:
1. Upload full drawing set
2. Analyze drawings
3. Calibrate at least one known dimension
4. Build 3D model
5. Toggle layers (walls/floors/structure + one MEP layer)
6. Run at least 3 measurements
7. Record pilot metrics row

## Quantitative readiness thresholds (GO)

MVP is accepted when all are true:
1. `crash_or_blocker = no` for at least 18/20 projects
2. Average `wall_correctness_pct >= 85`
3. Median `measurement_error_pct <= 5`
4. Average `symbol_text_false_positive_count <= 10` per project
5. Average `time_to_usable_3d_min <= 10`

## Automatic No-Go conditions

MVP is not accepted if any are true:
1. More than 2 projects have `crash_or_blocker = yes`
2. Average `wall_correctness_pct < 80`
3. Median `measurement_error_pct > 8`
4. Same blocker repeats in the same flow step across 5+ projects

## Exit deliverables

1. Completed pilot CSV for all 20 projects
2. Ranked top-3 recurring issues
3. GO / NO-GO decision using thresholds above
4. If NO-GO: one-week remediation plan with clear owners
