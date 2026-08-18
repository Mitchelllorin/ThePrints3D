# ThePrints3D

ThePrints3D turns 2D construction prints and drawing sets into an interactive 3D workspace. It is a React and TypeScript web app that can also be packaged for Android with Capacitor.

- Website: <https://theprints3d.com>
- Companion marketing site: <https://github.com/Mitchelllorin/ThePrints3D---Site>

## What the app does

- Imports PDF, PNG, JPEG, TIFF, and WebP drawing files, or captures a print with a device camera.
- Organizes uploaded sheets by drawing discipline, rasterizes them for review, and derives scale when possible. Users can calibrate and trace when a drawing needs correction.
- Detects walls and openings with an ONNX model when available, with a heuristic fallback and adjustable detection settings.
- Renders drawings as an interactive Three.js building model with camera controls, layer visibility, explode controls, element editing, annotations, distance measurement, and PNG snapshots.
- Supports trade and construction layers, including framing, floors, roofs, drywall, envelope, plumbing, electrical, and HVAC content.
- Provides material takeoffs, a CSV export for unlocked Pro users, construction calculators, and unit conversion.
- Stores saved projects and their drawing data locally in IndexedDB. The free tier keeps one saved project; additional project and export features are gated by the in-app Pro entitlement.

The core drawing-to-model workflow runs in the client. An optional Ask AI proxy can be configured at build time, and product-catalog links deliberately open third-party sites when a user chooses them.

## Development

Requirements: Node.js and npm.

```bash
git clone https://github.com/Mitchelllorin/ThePrints3D.git
cd ThePrints3D
npm ci
npm run dev
```

Vite serves the development app on port 5173 by default. It binds to all local interfaces; set `PORT` to select a different port. Set `VITE_BASE_PATH` when the app is deployed below the domain root.

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the Vite development server. |
| `npm run build` | Type-check and create the production web bundle in `dist/`. |
| `npm run preview` | Serve the production bundle locally. |
| `npm run lint` | Run ESLint. |
| `npm run test` | Run the Vitest suite. |
| `npm run build:android` | Build the web bundle and synchronize it into the Android project. |
| `npm run open:android` | Open the Android project through Capacitor. |
| `npm run cap:assets` | Generate Android icon and splash assets. |

Copy `.env.example` to `.env` only when configuring the optional Ask AI proxy or a development-only Gemini key. Do not put secrets in `VITE_` variables: Vite embeds them in the client bundle.

## Architecture

| Area | Implementation |
| --- | --- |
| Application | React, TypeScript, Vite, and Zustand |
| 3D workspace | Three.js with React Three Fiber and Drei |
| Drawing processing | PDF.js, Tesseract.js, ONNX Runtime Web, and in-repository detection services |
| Persistence | Browser IndexedDB through `idb` |
| Offline web support | Vite PWA and Workbox |
| Android | Capacitor 8 project in `android/` |
| Tests | Vitest service and store tests |

Key directories:

```text
src/components/  UI, workspace controls, upload, drawing, and 3D features
src/services/    drawing processing, detection, construction, billing, and storage
src/store/       application, configuration, and workspace state
src/data/        construction defaults and object catalog data
public/          PWA assets, model, product catalog, and static site pages
android/         Capacitor Android project
docs/            Play Store listing and release guidance
proxy/           optional Cloudflare Worker for Ask AI
```

## Android release configuration

The Android application ID and Capacitor app ID are `com.theprints3d.app`. The app declares network access and Android 13+ image-read access for importing drawing images. It does not declare video-read access.

`npm run build:android` builds the web application and runs `cap sync android`. For a signed release bundle, follow [`docs/play-store-release.md`](docs/play-store-release.md). The `Build Android AAB` workflow runs manually or for tags matching `v*`; it builds a signed AAB when the required Android keystore secrets are available and publishes the bundle as a workflow artifact. This repository does not confirm publication to a public app store.

## Web pages and deployment

The production web build is generated in `dist/`. This repository also contains legacy static landing, privacy, and data-safety pages in `public/`. On pushes to `main` that change those files, `.github/workflows/deploy-site.yml` publishes them to this repository's default GitHub Pages project URL. The companion marketing repository owns production `theprints3d.com`.

The app manifest is in `public/manifest.json`. The bundled PWA precaches application assets while treating PDF files as network-only runtime resources.

## Data handling

Drawing processing and saved projects are local to the device or browser for the core workflow. The in-app privacy policy, static privacy page, and data-safety page document the current handling and Android permissions:

- <https://theprints3d.com/privacy>
- <https://theprints3d.com/datasafety.html>
- <mailto:privacy@theprints3d.com>

## Contributing

Before opening a pull request, run the checks relevant to the change:

```bash
npm run lint
npm run test
npm run build
```
