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
  - On pull requests: builds and deploys a GitHub Pages preview environment **and** a Cloudflare Pages preview URL
  - On `main`: builds and deploys both GitHub Pages production and Cloudflare Pages production

## Cloudflare Pages deployment

The app is deployed to [Cloudflare Pages](https://pages.cloudflare.com/) in addition to GitHub Pages.

### Required repository secrets

| Secret | Description |
|--------|-------------|
| `CLOUDFLARE_API_TOKEN` | Cloudflare API token with **Cloudflare Pages: Edit** permission |
| `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare account ID (found in the Cloudflare dashboard sidebar) |

### Project name

The Cloudflare Pages project is named **`blueprint3d`** (configured in `wrangler.toml`).
Production URL: `https://blueprint3d.pages.dev`

### Local deploy

```bash
npx wrangler pages deploy dist --project-name=blueprint3d
```

### PR previews

Each pull request is deployed to a unique Cloudflare preview URL:
`https://<hash>.blueprint3d.pages.dev`

A bot comment with a one-click badge link is posted to the PR automatically.

## Near-term roadmap

1. Improve noisy-input robustness (false positives/false negatives)
2. Strengthen scale inference and floor stacking confidence
3. Expand parser/service unit coverage
4. Add richer pilot telemetry and result dashboards
5. Introduce secure backend data handling and retention enforcement
