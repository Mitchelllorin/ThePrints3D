/**
 * Rasterise the canonical brand SVGs to every PNG the stores and the app need.
 *
 * One source of truth: public/brand/*.svg. Re-run this after any change to the
 * mark rather than hand-editing a PNG — the whole point of keeping the mark in
 * vector is that these are disposable derivatives.
 *
 *   node scripts/brand-assets.mjs
 */
import { chromium } from 'playwright'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const brand = (f) => resolve(root, 'public/brand', f)

/** [source svg, output path, pixel size] */
const TARGETS = [
  // Play Store listing
  ['icon.svg', 'public/brand/PlayStore_icon_512.png', 512],
  ['adaptive-foreground.svg', 'public/brand/adaptive_foreground_512.png', 512],
  ['adaptive-background.svg', 'public/brand/adaptive_background_512.png', 512],
  // PWA / web icons (replacing the placeholder bolt)
  ['icon.svg', 'public/icons/icon-source-1024.png', 1024],
  ['icon.svg', 'public/icons/icon-512.png', 512],
  ['icon.svg', 'public/icons/icon-192.png', 192],
  ['icon.svg', 'public/icons/icon-144.png', 144],
  ['icon.svg', 'public/icons/icon-96.png', 96],
  ['icon.svg', 'public/icons/icon-72.png', 72],
  ['icon.svg', 'public/icons/icon-48.png', 48],
  // Maskable PWA icons — their own source, pulled in so a circular or squircle
  // mask cannot cut the roof or the print off. See maskable.svg.
  ['maskable.svg', 'public/icons/maskable-512.png', 512],
  ['maskable.svg', 'public/icons/maskable-192.png', 192],
  // Capacitor source icon — `npx cap:assets` regenerates the Android densities
  ['icon.svg', 'assets/icon/icon.png', 1024],
  // Launch splash. `drawable/splash.png` is the resource capacitor.config.ts
  // names in androidSplashResourceName, so it is the one that actually shows.
  ['splash.svg', 'assets/splash/splash.png', 2732],
  ['splash.svg', 'android/app/src/main/res/drawable/splash.png', 2048],
]

const browser = await chromium.launch()

for (const [src, out, size] of TARGETS) {
  const svg = readFileSync(brand(src), 'utf8')
  const page = await browser.newPage({ viewport: { width: size, height: size } })
  // Transparent ground so a mark with no tile keeps its alpha.
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
  )
  await page.waitForTimeout(120)
  const buf = await page.screenshot({ omitBackground: true })
  const target = resolve(root, out)
  mkdirSync(resolve(target, '..'), { recursive: true })
  writeFileSync(target, buf)
  await page.close()
  console.log(`${String(size).padStart(4)}px  ${out}`)
}

await browser.close()
console.log('\nDone. Android densities: npm run cap:assets')
