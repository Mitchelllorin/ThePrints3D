import { defineConfig } from 'vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  base: process.env.VITE_BASE_PATH ?? '/',
  server: {
    // Bind all interfaces so the dev server is reachable on the local network.
    host: '0.0.0.0',
    // Honor a harness-assigned port (e.g. Claude preview); default to Vite's 5173
    port: process.env.PORT ? Number(process.env.PORT) : 5173,
    strictPort: Boolean(process.env.PORT),
  },
  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: false, // use our own public/manifest.json
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webp,woff,woff2}'],
        // PDF.js worker and large files are loaded on-demand; don't pre-cache them
        globIgnores: ['**/pdf.worker*'],
        runtimeCaching: [
          {
            urlPattern: /\.pdf$/i,
            handler: 'NetworkOnly',
          },
        ],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024, // 5 MB
      },
    }),
  ],
})
