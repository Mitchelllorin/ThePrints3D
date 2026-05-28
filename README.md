# BluePrint3D

[![CI](https://github.com/Mitchelllorin/BluePrint3D/actions/workflows/ci.yml/badge.svg)](https://github.com/Mitchelllorin/BluePrint3D/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-6-blue?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-61dafb?logo=react&logoColor=white)](https://react.dev/)
[![Three.js](https://img.shields.io/badge/Three.js-0.184-black?logo=threedotjs)](https://threejs.org/)
[![Vite](https://img.shields.io/badge/Vite-8-646cff?logo=vite&logoColor=white)](https://vite.dev/)
[![PWA Ready](https://img.shields.io/badge/PWA-ready-5A0FC8?logo=pwa)](https://web.dev/progressive-web-apps/)

**Turn flat floor-plan PDFs and images into an interactive 3D building model — entirely in the browser.**

BluePrint3D is a React + TypeScript web application that ingests architectural drawing sets (PDF or image files), automatically detects walls and openings using an AI segmentation model (with a heuristic fallback), and renders the result as a navigable Three.js 3D model. All processing happens client-side — no drawings ever leave your device.

🌐 **[Landing page](https://mitchelllorin.github.io/BluePrint3D/landing.html)** &nbsp;|&nbsp; 🚀 **[Launch the app](https://mitchelllorin.github.io/BluePrint3D/)**

---

## ✨ Features

| Feature | Description |
|---|---|
| **Drag-and-drop upload** | PDF, PNG, JPG, TIFF, WebP — all accepted |
| **AI wall detection** | U-Net ONNX model (WebGPU → WASM fallback) trained on CubiCasa5k |
| **Heuristic fallback** | Edge-based wall detector when no model is present |
| **Interactive 3D viewer** | Orbit, pan, zoom; camera presets; perspective/orthographic |
| **Layer toggles** | Show/hide walls, doors, windows, rooms independently |
| **Distance measurement** | Click two surface points to get real-world distances |
| **Annotation pins** | Place labelled, colour-coded notes anywhere on the model |
| **Product placement** | Drop doors, windows, plumbing, HVAC, lighting into the scene |
| **Material estimator** | Auto-estimates studs, plates, drywall, insulation from parsed walls |
| **Scale calibration** | Auto-detected from title block; manual override available |
| **Unit converter** | Imperial ↔ metric conversions for common construction units |
| **Construction calculators** | On-the-fly estimating helpers |
| **Project library** | Save and reopen projects from browser IndexedDB |
| **Share PNG** | Export a snapshot of the current 3D view |
| **PWA / offline** | Installable; works offline after first load |
| **Privacy-first** | 100 % client-side — no server, no uploads |

---

## 🚀 Quick start

```bash
git clone https://github.com/Mitchelllorin/BluePrint3D.git
cd BluePrint3D
npm ci
npm run dev
```

Open the URL printed by Vite (usually `http://localhost:5173`).

### Supported input formats

- **PDF** (`.pdf`) — rasterised via PDF.js; scale text is extracted from the title block
- **Images** (`.png`, `.jpg`, `.jpeg`, `.tif`, `.tiff`, `.webp`)

---

## 🛠 Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Local development server (HMR) |
| `npm run build` | TypeScript check + Vite production bundle → `dist/` |
| `npm run preview` | Serve the built `dist/` locally |
| `npm run lint` | ESLint quality checks |
| `npm run test` | Unit tests (Vitest) |
| `npm run build:android` | Build + sync to Capacitor Android project |

---

## 🏗 Architecture

```
src/
├── components/
│   ├── Upload/          # Drag-and-drop file intake
│   ├── Drawings/        # Sheet list, preview, scale calibration UI
│   ├── Viewer3D/        # Three.js canvas, camera HUD, measure & annotate tools
│   ├── Layers/          # Layer visibility panel
│   ├── Tools/           # Unit converter + construction calculators
│   ├── Projects/        # Project library (IndexedDB)
│   ├── Annotations/     # Annotation pin components
│   └── Layout/          # App shell, navigation
├── services/
│   ├── pdfRasterizer.ts        # PDF/image → canvas rasterisation
│   ├── aiWallDetector.ts       # ONNX U-Net wall segmentation
│   ├── wallDetector.ts         # Heuristic edge-based wall detector
│   ├── enhancedWallDetector.ts # Post-processing & refinement
│   ├── lineClassifier.ts       # Line-segment wall/non-wall classifier
│   ├── noisyPrintFilter.ts     # Context-aware filtering for noisy architectural prints
│   ├── openSourceDrawingContext.ts # Open drawing priors used by the noise filter
│   ├── wallTraceReducer.ts     # Wall-trace simplification
│   ├── wallTypeClassifier.ts   # Interior / exterior / partition labelling
│   ├── openingDetector.ts      # Door & window gap detection
│   ├── roomExtractor.ts        # BFS flood-fill room segmentation
│   ├── scaleInference.ts       # Scale auto-detection from title block
│   ├── scaleParser.ts          # Scale string parser
│   ├── sheetParser.ts          # Floor level inference & sheet grouping
│   ├── sheetDiscipline.ts      # Sheet discipline classification
│   ├── drawingProcessor.ts     # End-to-end processing pipeline
│   ├── materialEstimator.ts    # Bill-of-materials estimator
│   ├── projectStorage.ts       # IndexedDB project persistence
│   ├── datasetCollector.ts     # Anonymous feature collection for model training
│   ├── pilotMetrics.ts         # Pilot CSV snapshot/export utilities
│   └── logger.ts               # Structured event logging
├── store/
│   └── useAppStore.ts          # Centralised state + actions (Zustand + Immer)
└── types/                      # Shared TypeScript types
```

---

## 🤖 AI wall-segmentation model

`src/services/aiWallDetector.ts` looks for a trained ONNX model at
`public/models/floorplan-wall-segmentation.onnx`. When present it is loaded
via ONNX Runtime Web (WebGPU → WASM fallback). When absent, processing falls
back to the heuristic detector.

The model is a lightweight U-Net (~1.5 M parameters, ~6 MB) trained on the
[CubiCasa5k][cubicasa5k] open floor-plan dataset (CC BY 4.0).

### Train your own model

```bash
# 1. Install Python dependencies
pip install -r ops/train/requirements.txt

# 2. Download the CubiCasa5k dataset (~1.8 GB)
git clone --depth 1 https://github.com/CubiCasa/CubiCasa5k data/cubicasa5k

# 3. Train (~30 epochs — ≈1 h on GPU, ≈6 h on CPU)
python ops/train/train.py --data data/cubicasa5k --out checkpoints/

# 4. Export to ONNX
python ops/train/export.py --checkpoint checkpoints/best.pth
```

See [`ops/train/README.md`](ops/train/README.md) for full documentation.  
A `workflow_dispatch` CI job (`.github/workflows/train-model.yml`) can run a smoke-test and upload the ONNX as a build artifact.

- **CI** (`.github/workflows/ci.yml`)
  - Runs lint, test, and build on pushes/PRs.
- **PR Preview** (`.github/workflows/preview.yml`)
  - Builds PR branch and uploads `dist` bundle to external preview endpoint.

---

## 🧱 Tech stack

| Layer | Technology |
|---|---|
| UI framework | React 19 + TypeScript 6 |
| 3D rendering | Three.js 0.184 + React Three Fiber + Drei |
| State management | Zustand 5 + Immer |
| Build tooling | Vite 8 + Rolldown |
| PDF rendering | PDF.js 5 |
| AI inference | ONNX Runtime Web 1.26 (WebGPU / WASM) |
| Persistence | IndexedDB via idb |
| Mobile | Capacitor 8 (Android) |
| PWA | vite-plugin-pwa + Workbox |
| Testing | Vitest |
| Linting | ESLint 10 + typescript-eslint |

---

## ⚠️ Known limitations

- Wall detection includes adaptive noisy-print filtering, but extreme low-contrast scans can still require manual tracing.
- 3D geometry falls back to procedural generation when parsed wall fidelity is low.
- Scale inference is best-effort; manual calibration may be needed for non-standard title blocks.
- No server-side persistence — all state lives in browser memory / IndexedDB.

---

## 🗺 Near-term roadmap

1. Improve noisy-input robustness (reduce false positives / false negatives)
2. Strengthen scale inference and multi-floor stacking confidence
3. Expand unit-test coverage across parser and service modules
4. Add richer telemetry and result dashboards for pilot tracking
5. Introduce secure backend data handling and retention enforcement

---

## 🔧 Ops & pilot artifacts

| File | Purpose |
|---|---|
| `pilot/pilot_runbook.txt` | 2-week pilot operational runbook |
| `pilot/pilot_metrics_template.csv` | Required pilot metrics schema |
| `pilot/two_week_execution_loop.txt` | Daily execution and fix cadence |
| `ops/day1_setup_checklist.txt` | Day-1 setup checklist |
| `ops/data_permission_template.txt` | Permissions capture template |
| `ops/mvp_acceptance_criteria.md` | MVP readiness / exit criteria |
| `ops/data_governance_controls.txt` | Governance controls baseline |
| `ops/data_access_register_template.csv` | Permission / access register |

---

## 🤝 Contributing

1. Fork the repo and create a feature branch (`git checkout -b feature/my-thing`)
2. Make your changes and add tests where applicable
3. Ensure all quality gates pass: `npm run lint && npm run test && npm run build`
4. Open a pull request — the CI workflow and a preview deployment will run automatically
5. If you need a preview before opening a PR, run the **PR Preview** workflow manually and optionally provide the branch/SHA in the `ref` input; the workflow summary will include the preview URL

---

## 📄 CI / deployment

The CI workflow (`.github/workflows/ci.yml`) runs **lint → test → build** on every push and pull request.

The preview workflow (`.github/workflows/preview.yml`) builds and deploys a preview environment for every pull request. You can also run it manually for any branch/SHA, and the workflow summary will include the preview URL when the deploy API returns one.
