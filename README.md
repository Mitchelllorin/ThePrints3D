# BluePrint3D

BluePrint3D is a React + TypeScript web app that converts drawing sets (PDF/image sheets) into an interactive 3D model with layer toggles and distance measurement.

## Current product stage

- Prototype with end-to-end flow:
  1) Upload drawing set
  2) Analyze/rasterize sheets
  3) Detect walls + infer floor level + infer/calibrate scale
  4) Build and inspect 3D model
- Optimized for pilot validation, not yet production hardened.

## Local setup

```bash
npm ci
npm run dev
```

Open the app URL printed by Vite.

## Commands

- `npm run dev` – local development
- `npm run lint` – ESLint checks
- `npm run test` – unit tests (Vitest)
- `npm run build` – TypeScript build + Vite production bundle
- `npm run preview` – preview built app

## Input support

- PDFs (`.pdf`)
- Images (`.png`, `.jpg`, `.jpeg`, `.tif`, `.tiff`, `.webp`)

## High-level architecture

- `src/components/Upload` – file intake
- `src/components/Drawings` – sheet management, preview, scale calibration
- `src/components/Viewer3D` – Three.js model visualization and measuring
- `src/store/useAppStore.ts` – centralized app state/actions (Zustand + Immer)
- `src/services/pdfRasterizer.ts` – PDF/image rasterization + scale text extraction
- `src/services/wallDetector.ts` – heuristic wall detection in raster space
- `src/services/sheetParser.ts` – floor inference/grouping helpers
- `src/services/drawingProcessor.ts` – drawing processing pipeline orchestration
- `src/services/logger.ts` – structured app event logging
- `src/services/pilotMetrics.ts` – pilot CSV snapshot/export utilities

## Pilot and operations artifacts

- `pilot/pilot_runbook.txt` – 2-week pilot operational runbook
- `pilot/pilot_metrics_template.csv` – required pilot metrics schema
- `pilot/two_week_execution_loop.txt` – daily execution/fix cadence
- `ops/day1_setup_checklist.txt` – setup checklist
- `ops/data_permission_template.txt` – permissions capture template
- `ops/mvp_acceptance_criteria.md` – MVP readiness/exit criteria
- `ops/data_governance_controls.txt` – governance controls baseline
- `ops/data_access_register_template.csv` – permission/access register template

## AI wall-segmentation model

`src/services/aiWallDetector.ts` looks for a trained ONNX model at
`public/models/floorplan-wall-segmentation.onnx`.  When the file is present
it is loaded by ONNX Runtime Web (WebGPU → WASM fallback) and used instead
of the heuristic edge detector.  When absent, processing falls back
transparently to the heuristic detector.

The model is a lightweight U-Net (~1.5 M parameters, ~6 MB) trained on the
[CubiCasa5k][cubicasa5k] open floor-plan dataset
(Creative Commons Attribution 4.0).

### Training the model

```bash
# 1. Install Python deps
pip install -r ops/train/requirements.txt

# 2. Download dataset (~1.8 GB)
git clone --depth 1 https://github.com/CubiCasa/CubiCasa5k data/cubicasa5k

# 3. Train (~30 epochs, ≈1 h GPU / 6 h CPU)
python ops/train/train.py --data data/cubicasa5k --out checkpoints/

# 4. Export to public/models/
python ops/train/export.py --checkpoint checkpoints/best.pth
```

See [`ops/train/README.md`](ops/train/README.md) for full documentation.

A `workflow_dispatch` CI job (`.github/workflows/train-model.yml`) can run a
quick smoke-test and upload the ONNX as a workflow artifact.

[cubicasa5k]: https://github.com/CubiCasa/CubiCasa5k

## Known limitations

- Wall detection is heuristic and may over/under-detect on noisy scans and text-heavy plans.
- Model geometry is partially procedural fallback when parsed wall fidelity is low.
- Scale inference is best-effort and may require manual calibration.
- No backend persistence yet (client-side processing/state only).

## Quality gates

CI workflow (`.github/workflows/ci.yml`) runs:
- lint
- tests
- build

## Build and preview pipeline

- `npm run build` creates production assets in `dist/`
- `npm run preview` serves the built `dist/` locally for verification
- GitHub Actions preview workflow (`.github/workflows/preview.yml`):
  - On pull requests: builds and deploys a GitHub Pages preview environment (relative base path `./`)
  - On `main`: builds and deploys production GitHub Pages (base path `/BluePrint3D/`)

## Near-term roadmap

1. Improve noisy-input robustness (false positives/false negatives)
2. Strengthen scale inference and floor stacking confidence
3. Expand parser/service unit coverage
4. Add richer pilot telemetry and result dashboards
5. Introduce secure backend data handling and retention enforcement
