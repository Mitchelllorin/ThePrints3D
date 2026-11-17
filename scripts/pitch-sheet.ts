/**
 * THE ONE-PAGER — what goes in front of a manufacturer.
 *
 * Generates `pitch/<part>.html` from the same code the app runs: the part's
 * rated values out of data/manufacturerParts.ts, and the year-by-year reading
 * out of F.U.S.E. Nothing on this page is typed by hand, which is the point —
 * the sheet cannot drift from the panel, and when the engine changes the sheet
 * changes with it.
 *
 *   npx vite-node scripts/pitch-sheet.ts
 *
 * Print it to PDF from Chrome for sending; it carries a print stylesheet so the
 * page comes out light on white without a second layout.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MANUFACTURER_PARTS } from '../src/data/manufacturerParts'
import { getMember } from '../src/data/members'
import { DEMO_ASSEMBLY, partMaterialSpec, scorePart } from '../src/services/manufacturer/reading'
import { HORIZON_YEARS, RISK_COLOR, RISK_LABEL } from '../src/services/fuse'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ORIGIN = 'theprints3d.com'
const TODAY = new Date().toISOString().slice(0, 10)

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function ratedRows(fields: { label: string; value: string; unit?: string; note?: string }[]): string {
  return fields
    .map(
      (f) => `<tr>
        <th scope="row">${esc(f.label)}</th>
        <td class="num">${esc(f.value)}${f.unit ? ` <span class="u">${esc(f.unit)}</span>` : ''}</td>
        <td class="note">${f.note ? esc(f.note) : ''}</td>
      </tr>`,
    )
    .join('\n')
}

function sheet(part: (typeof MANUFACTURER_PARTS)[number]): string {
  const reading = scorePart(part)
  const member = getMember(part.memberId)
  const spec = partMaterialSpec(part)

  const siteRows = reading.sites
    .map((s) => {
      const p = s.part
      const partYear = p == null
        ? 'not scored'
        : p.failsYear == null
          ? `holds past ${reading.horizon}`
          : `year ${p.failsYear}`
      const level = p ? p.level : 'ok'
      const first = s.first ? `${s.first.label} — year ${s.first.year}` : `nothing inside ${reading.horizon}`
      return `<tr>
        <th scope="row">${esc(s.siteName)}</th>
        <td class="num" style="color:${RISK_COLOR[level]}">${esc(partYear)}</td>
        <td>${esc(first)}</td>
        <td class="num">${s.failedCount}</td>
      </tr>`
    })
    .join('\n')

  const worst = reading.sites.reduce(
    (acc, s) => Math.max(acc, s.failedCount),
    0,
  )
  const partName = member ? member.name : `${part.product} ${part.designation}`

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(part.manufacturer)} ${esc(part.product)} — ${esc(ORIGIN)}</title>
<style>
  :root{
    --canvas:#0b0f14; --panel:21 28 37; --panel-a:.78; --panel-solid:#151c25;
    --panel-2:#1e2833; --line:#2c3a4a;
    --ink:#e8eef5; --ink-2:#aebccd; --muted:#7b8ca1;
    --accent:#3d9ae8; --ok:#3fbf6e; --warn:#e0a03a; --bad:#e5643f;
  }
  *{box-sizing:border-box}
  body{margin:0; background:var(--canvas); color:var(--ink);
    font:15px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif}
  .page{max-width:860px; margin:0 auto; padding:40px 28px 64px; display:grid; gap:22px}
  header{display:grid; gap:6px; border-bottom:1px solid var(--line); padding-bottom:18px}
  .kick{font-size:11px; letter-spacing:.14em; text-transform:uppercase; color:var(--muted)}
  h1{margin:0; font-size:30px; line-height:1.15; letter-spacing:-.01em}
  h1 .m{color:var(--accent)}
  .sub{margin:0; color:var(--ink-2); max-width:62ch}
  section{display:grid; gap:10px}
  h2{margin:0; font-size:12px; letter-spacing:.12em; text-transform:uppercase; color:var(--muted); font-weight:600}
  table{width:100%; border-collapse:collapse; font-size:14px}
  th,td{text-align:left; padding:7px 10px; border-bottom:1px solid var(--line); vertical-align:top}
  th[scope=row]{font-weight:500; color:var(--ink-2); width:34%}
  thead th{font-size:11px; letter-spacing:.08em; text-transform:uppercase; color:var(--muted); font-weight:600}
  td.num,th.num{font-variant-numeric:tabular-nums; white-space:nowrap}
  td.note{color:var(--muted); font-size:12.5px}
  .u{color:var(--muted); font-size:12.5px}
  .plate{background:rgba(var(--panel) / var(--panel-a));
    border:1px solid var(--line); border-radius:10px; padding:16px 18px; display:grid; gap:8px}
  .plate .name{font-size:17px; font-weight:600}
  .plate .meta{color:var(--ink-2); font-size:13.5px}
  .plate .line{color:var(--ink-2)}
  .basis{background:var(--panel-solid); border-radius:8px; padding:14px 16px;
    color:var(--ink-2); font-size:13.5px; display:grid; gap:8px}
  .basis b{color:var(--ink); font-weight:600}
  .legend{display:flex; gap:16px; flex-wrap:wrap; font-size:12.5px; color:var(--muted)}
  .legend span i{display:inline-block; width:8px; height:8px; border-radius:50%; margin-right:6px}
  footer{border-top:1px solid var(--line); padding-top:16px; color:var(--muted); font-size:12.5px;
    display:grid; gap:6px}
  a{color:var(--accent)}
  @media print{
    :root{--canvas:#fff; --ink:#0c1a2b; --ink-2:#3d5068; --muted:#63758c; --line:#c9d5e1;
      --panel-solid:#f3f6f9; --panel:255 255 255; --panel-a:1; --accent:#12658f}
    body{font-size:12px}
    .page{padding:0; gap:14px}
    h1{font-size:24px}
    @page{margin:14mm}
  }
</style>
</head>
<body>
<div class="page">

  <header>
    <p class="kick">Manufacturer preview · ${esc(TODAY)}</p>
    <h1>${esc(part.product)} in ThePrints3D<span class="m">.</span></h1>
    <p class="sub">${esc(part.pitchLine)}</p>
  </header>

  <section>
    <h2>The part, as it is in the model</h2>
    <div class="plate">
      <span class="name">${esc(partName)}</span>
      <span class="meta">${esc(part.manufacturer)} · designation ${esc(part.designation)}</span>
      <span class="line">${member ? `${member.uses.join(' · ')} · stocked to ${member.stockLengthsFt.slice(-1)[0]} ft` : ''}</span>
      <span class="line">Scored as ${esc(spec?.label ?? part.layer.material)} in the ${esc(part.layer.id)} layer.</span>
    </div>
  </section>

  <section>
    <h2>Rated — your published figures</h2>
    <table>
      <tbody>
${ratedRows(part.rated)}
      </tbody>
    </table>
    <p class="sub" style="font-size:12.5px">Source: <a href="${esc(part.source.url)}">${esc(part.source.label)}</a></p>
  </section>

  <section>
    <h2>F.U.S.E. — the assembly it sits in, aged ${reading.horizon} years</h2>
    <table>
      <thead>
        <tr><th>Site</th><th>Your member</th><th>First thing to go</th><th class="num">Gone</th></tr>
      </thead>
      <tbody>
${siteRows}
      </tbody>
    </table>
    <div class="legend">
      ${['ok', 'watch', 'critical', 'failed']
        .map((l) => `<span><i style="background:${RISK_COLOR[l as keyof typeof RISK_COLOR]}"></i>${RISK_LABEL[l as keyof typeof RISK_LABEL]}</span>`)
        .join('\n      ')}
    </div>
    <div class="basis">
      <span><b>What this is.</b> ${esc(part.basis)}</span>
      <span><b>The assembly.</b> ${esc(
        `Fiber-cement lap over housewrap on OSB, ${DEMO_ASSEMBLY.storeys} storeys, metal roof over it, ` +
          `closed roof space, nothing repainted. Six sites, ${reading.horizon} years.`,
      )}</span>
      <span><b>What this is not.</b> A warranty, a code ruling, or a substitute for the local trade.
        F.U.S.E. reports the order failures arrive in; it does not promise the year.</span>
    </div>
  </section>

  <section>
    <h2>What happens next</h2>
    <div class="basis">
      <span>Send one product line and its span data. It goes into the catalogue as a real member —
        width, depth, layup or gauge, stock lengths — and comes back as this sheet, with the
        spec figures checked against your own table and your name on the member a contractor picks.</span>
      <span>Nothing ships with your name on it until you have read the sheet and said yes.</span>
    </div>
  </section>

  <footer>
    <span>ThePrints3D — ${esc(ORIGIN)} · Mitchell Lorin McKnight</span>
    <span>Generated from data/manufacturerParts.ts and services/fuse on ${esc(TODAY)}.
      ${reading.sites.length} sites, horizon ${reading.horizon} years, worst site loses ${worst} ${worst === 1 ? 'layer' : 'layers'}.</span>
  </footer>

</div>
</body>
</html>
`
}

const outDir = join(ROOT, 'pitch')
mkdirSync(outDir, { recursive: true })

for (const part of MANUFACTURER_PARTS) {
  const file = join(outDir, `${part.id}.html`)
  writeFileSync(file, sheet(part), 'utf8')
  const reading = scorePart(part)
  console.log(
    `${part.manufacturer} ${part.product}: ${file}\n` +
      reading.sites.map((s) => `  ${s.siteName.padEnd(14)} ${s.part?.failsYear == null ? `holds ${HORIZON_YEARS}` : `year ${s.part.failsYear}`}  first: ${s.first ? `${s.first.label} @ ${s.first.year}` : 'none'}`).join('\n'),
  )
}
