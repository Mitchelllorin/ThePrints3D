/**
 * THE SHEET AS A PDF — what actually gets attached.
 *
 * The pitch sheet is HTML because it is generated from the engine. A maker
 * cannot open a generator, so it gets printed: same page, same stylesheet, and
 * the print rules already in `pitch-sheet.ts` do the colour swap — the dark
 * ground is for reading on screen, and white ground with dark ink is what goes
 * out, because a page of dark panels eats a laser printer's toner and looks
 * like a screenshot in a deck.
 *
 *   npx vite-node scripts/pitch-sheet.ts      # regenerate the HTML
 *   node scripts/pitch-pdf.mjs                # print every pitch/*.html
 */
import { chromium } from 'playwright'
import { mkdirSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PITCH = join(ROOT, 'pitch')
const OUT = join(PITCH, 'pdf')
mkdirSync(OUT, { recursive: true })

const sheets = readdirSync(PITCH).filter((f) => f.endsWith('.html'))
if (!sheets.length) {
  console.error('no sheets in pitch/ — run `npx vite-node scripts/pitch-sheet.ts` first')
  process.exit(1)
}

const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  for (const file of sheets) {
    await page.goto(pathToFileURL(join(PITCH, file)).href, { waitUntil: 'load' })
    // The sheet is one page by design; if it grows past A4 it must break where
    // the sections do rather than through the middle of the rated table.
    const pdf = join(OUT, file.replace(/\.html$/, '.pdf'))
    await page.pdf({
      path: pdf,
      format: 'A4',
      printBackground: true,
      margin: { top: '14mm', right: '14mm', bottom: '14mm', left: '14mm' },
    })
    console.log(`  ${resolve(pdf)}`)
  }
} finally {
  await browser.close()
}
