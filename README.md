# BluePrint3D

BluePrint3D is a React + TypeScript application that converts floor-plan drawings (PDF/images) into an interactive 3D building view with measurable geometry, layer controls, symbol awareness, and local project persistence.

## What the app does

1. Upload one or more drawing sheets (PDF or image files).
2. Rasterize and analyze each sheet (discipline, wall extraction, scale, floor, openings, rooms, symbols/text).
3. Build a multi-floor 3D representation from parsed drawing data.
4. Explore the model with layer toggles, measurement tools, annotations, and lightweight construction utilities.

## Current scope

- Prototype / pilot-oriented product.
- Processing is primarily client-side.
- Includes optional AI-assisted wall detection when an ONNX model exists locally.

## Tech stack

- **Frontend:** React 19, TypeScript, Vite
- **State:** Zustand + Immer
- **3D:** Three.js via @react-three/fiber + drei
- **File handling:** PDF.js + canvas image processing
- **Persistence:** IndexedDB (via `idb`) + localStorage
- **Testing:** Vitest
- **Linting:** ESLint

## Quick start

```bash
npm ci
npm run dev
```

Then open the Vite URL shown in terminal.

> Recommended runtime aligns with CI (`Node.js 22`).

## NPM scripts

- `npm run dev` - start local dev server
- `npm run lint` - run ESLint
- `npm run test` - run Vitest test suite
- `npm run build` - type-check + production build
- `npm run preview` - preview production build
- `npm run build:android` - build web assets and sync Capacitor Android
- `npm run open:android` - open Android project in Android Studio
- `npm run cap:sync` - sync Capacitor assets/plugins
- `npm run cap:assets` - regenerate app icons/splash assets

## Supported inputs

- `.pdf`
- `.png`, `.jpg`, `.jpeg`, `.tif`, `.tiff`, `.webp`

## Repository structure (key areas)

- `src/components/Upload` - drawing upload and camera capture UX
- `src/components/Drawings` - sheet management, analysis controls, preview, calibration, symbol reference
- `src/components/Viewer3D` - 3D scene, navigation, measurement, annotation, product placement
- `src/components/Projects` - project save/load library (IndexedDB-backed)
- `src/components/Tools` - unit converter and construction calculators
- `src/store/useAppStore.ts` - primary app state and orchestration actions
- `src/services` - rasterization, parsing, detection, inference, metrics, logging, persistence services
- `src/symbols` - symbol glossary and asset mapping used for semantic tagging
- `ops/` - operational docs and model training utilities
- `pilot/` - pilot runbooks, templates, and execution artifacts
- `.github/workflows` - CI, PR preview build, and model-training workflow

## Processing pipeline summary

`drawingProcessor` orchestrates:

1. Rasterize source file (`pdfRasterizer`)
2. Infer discipline and optionally gate wall detection (`sheetDiscipline`)
3. Detect walls (AI ONNX model if available, otherwise heuristic detector)
4. Resolve drawing scale (parsed notation, inferred structure, or fallback)
5. Classify wall types
6. Extract enclosed rooms
7. Detect openings from wall gaps
8. Derive semantic entities (parsed text/symbol/annotation candidates)
9. Infer floor number from naming patterns

## Data handling and privacy model

- Uploaded files are processed locally in-browser.
- Saved projects are stored in IndexedDB on-device.
- App logs/metadata are stored in localStorage.
- No mandatory backend account flow is required for core usage.

See `src/components/Legal/PrivacyPolicy.tsx` for current in-app policy text.

## AI wall model (optional)

If `public/models/floorplan-wall-segmentation.onnx` exists, the app attempts ONNX Runtime Web inference (`webgpu` with `wasm` fallback). If missing/unavailable, the app falls back to heuristic wall detection automatically.

Training utilities and workflow:

- `ops/train/` scripts
- `.github/workflows/train-model.yml` (manual workflow dispatch)

## CI and preview workflows

- **CI** (`.github/workflows/ci.yml`)
  - Runs lint, test, and build on pushes/PRs.
- **PR Preview** (`.github/workflows/preview.yml`)
  - Builds PR branch and uploads `dist` bundle to external preview endpoint.

## Known limitations

- Parsing quality varies with drawing quality, scan noise, and annotation density.
- Scale inference can still require manual calibration.
- 3D geometry blends parsed results with procedural fallback logic in lower-confidence cases.
- Project persistence is local-device only (no shared cloud workspace).

## Additional docs

- `ops/mvp_acceptance_criteria.md`
- `ops/day1_setup_checklist.txt`
- `ops/data_governance_controls.txt`
- `pilot/pilot_runbook.txt`
- `ops/train/README.md`
