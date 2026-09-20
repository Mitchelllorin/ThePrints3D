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
    /**
     * ONE APP, ONE PORT, ALWAYS — so a phone bookmark stays true.
     *
     * This used to default to 5173 and let Vite walk upward if that was taken,
     * with the launcher scanning 5173–5190 afterwards to find where it landed.
     * Fine from the laptop, where something else does the finding. Useless from
     * a phone, where you have typed a URL by hand and it silently points at
     * whatever was serving last time — which is the real reason testing on the
     * real device kept not happening. A moving address cannot be bookmarked.
     *
     * So the port is fixed and `strictPort` makes it fail LOUDLY when something
     * already holds it. That is the honest answer on this machine anyway: only
     * one dev server runs at a time here, so "5173 is busy" means "the other
     * project is still up", and being told that beats being quietly moved to
     * 5174 and wondering why the phone shows the wrong app.
     *
     * The number is per app so each one can have its own home-screen icon:
     *   5173  ThePrints3D      5174  CircuiTry3D      5175  AutoMotive3D
     *
     * PORT still wins when the harness assigns one.
     */
    port: process.env.PORT ? Number(process.env.PORT) : 5173,
    strictPort: true,
    /**
     * Let a tunnel reach the dev server.
     *
     * Vite checks the Host header and rejects anything it does not recognise,
     * which is right — it is what stops a hostile page on another origin from
     * driving your dev server. A tunnel (ngrok, Cloudflare, localtunnel) sends
     * its own hostname, so without this the phone gets a bare "Blocked request.
     * This host is not allowed" and nothing else, which reads like the tunnel
     * is broken when it is working perfectly.
     *
     * Named tunnel domains only — NOT `true`, which would turn the check off
     * altogether. The LAN address and localhost are allowed by Vite already.
     */
    allowedHosts: [
      '.ngrok-free.dev', '.ngrok-free.app', '.ngrok.app', '.ngrok.io',
      '.loca.lt', '.trycloudflare.com',
      /**
       * The laptop, by name.
       *
       * Vite waves through IP addresses and localhost, but a BARE HOSTNAME is
       * not an IP, so `http://rainmaker:5173` from the phone gets "Blocked
       * request. This host is not allowed" — which reads like the network is
       * broken when it is working perfectly. Tailscale's MagicDNS serves the
       * machine under its own name and again under the tailnet's `.ts.net`
       * domain, so both are named here.
       */
      'rainmaker',
      '.ts.net',
    ],
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
