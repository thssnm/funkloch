#!/usr/bin/env node
/**
 * Which strip should the shared daily result draw? Compares candidate formats
 * on real daily runs of the planning bot.
 *
 *   node tools/share-forms.js [--days=365] [--render=out.png]
 *
 * Two criteria, from the brief:
 *
 * - **Readable without level numbers, even when the spacing collapses.** A
 *   proportional font in a chat box can eat the space between groups, so a
 *   format that needs it to tell levels apart is ambiguous. That is a matter
 *   of glyphs and is checked by eye: `--render` sets every format in three
 *   fonts at letter-spacing -1px and writes a screenshot (needs playwright).
 * - **Varied enough that two runs look different.** Measured: how many
 *   different strips the sample produces, and the chance that two random days
 *   show the same one — for the whole run and for its first six shown levels,
 *   since short runs are the common ones.
 *
 * Also printed: how many senders are left per cleared level, which is what a
 * threshold between "tight" and "comfortable" has to be set against.
 *
 * The daily boards from 2026-01-01 are the sample because they are what gets
 * shared. Each format is given the cleared levels it shows; "ab L2" leaves out
 * the onboarding level, which every run clears with senders to spare.
 */

import { advance, createRun, dailySeed, ENDLESS_RUN, place } from '../src/run.js';
import { lookaheadChoice } from './bot64.js';
import { DAILY_FROM, printTable } from './endless.js';

const FORMS = {
  'Blöcke (0.2.0)': { glyph: (left) => (left ? '■'.repeat(left) : '·'), sep: ' ', fromL2: false },
  'drei Stufen ●○×, ≥1': { glyph: (left) => (left >= 1 ? '●' : '○'), sep: '', fromL2: false },
  'drei Stufen ●○×, ≥1, ab L2': { glyph: (left) => (left >= 1 ? '●' : '○'), sep: '', fromL2: true },
  'drei Stufen ●○×, ≥2, ab L2': { glyph: (left) => (left >= 2 ? '●' : '○'), sep: '', fromL2: true },
  'Ziffern': { glyph: (left) => String(left), sep: '', fromL2: false },
  'Ziffern, ab L2 (ausgeliefert)': { glyph: (left) => String(left), sep: '', fromL2: true },
  // C: a ramp from light to full. The four-step one needs a third circle that
  // failed the render test; it is measured to show what capping costs.
  'Rampe ·○◉●, ab L2': { glyph: (left) => ['·', '○', '◉', '●'][Math.min(left, 3)], sep: '', fromL2: true },
  'Rampe ·○●, ab L2': { glyph: (left) => ['·', '○', '●'][Math.min(left, 2)], sep: '', fromL2: true },
};

/** The strip of a run in a format, `limit` shown levels at most, no cross. */
function strip(run, { glyph, sep, fromL2 }, limit = Infinity) {
  return run.cleared
    .filter(({ level }) => !fromL2 || level > 1)
    .slice(0, limit)
    .map(({ left }) => glyph(left))
    .join(sep);
}

function variety(texts) {
  const counts = new Map();
  for (const text of texts) counts.set(text, (counts.get(text) ?? 0) + 1);
  const same = [...counts.values()].reduce((sum, count) => sum + (count / texts.length) ** 2, 0);
  return [counts.size, `${(100 * same).toFixed(2)}%`];
}

async function render(path) {
  const { chromium } = await import('playwright');
  // 2026-10-06 as the planning bot plays it: what it left over per level.
  const rests = [5, 2, 2, 1, 0, 0, 1, 1, 0, 1, 1, 0, 1, 1, 0];
  const lines = (glyphs) => `${glyphs.slice(0, 10).join('')}\n${glyphs.slice(10).join('')}`;
  const samples = [
    ['■ drei Stufen', lines([...rests.map((r) => (r >= 1 ? '■' : '□')), '×'])],
    ['Balken', lines([...rests.map((r) => '▁▃▅▇'[Math.min(r, 3)]), '×'])],
    ['● drei Stufen', lines([...rests.map((r) => (r >= 1 ? '●' : '○')), '×'])],
    ['Füllstand', lines([...rests.map((r) => '○◔◑●'[Math.min(r, 3)]), '×'])],
    ['Ziffern', lines([...rests.map(String), '×']).replace(/(\d{5})(?=\d)/g, '$1 ')],
    ['umkreist', lines([...rests.map((r) => '○①②③④⑤'[Math.min(r, 5)]), '×'])],
    ['Emoji', lines([...rests.map((r) => (r >= 1 ? '🟢' : '🟡')), '🔴'])],
    // C: a ramp from light to full, the count carried rather than binned.
    // The third step is the doubtful one; its stand-ins are set beside it.
    ...['◉', '◎', '⊙', '⦿'].map((two) => [`Rampe ·○${two}●`,
      lines([...rests.map((r) => ['·', '○', two, '●'][Math.min(r, 3)]), '×'])]),
    ['Rampe ·○●', lines([...rests.map((r) => ['·', '○', '●'][Math.min(r, 2)]), '×'])],
    ['Kopfzeile', 'funkl○ch 06.10. — 15 Level\nfunkloch 06.10. — 15 Level'],
  ];
  const fonts = ['system-ui', 'Georgia, serif', 'monospace'];
  const html = `<body style="background:#fff;margin:16px;font:16px system-ui">${fonts.map((font) => `
    <div style="font-family:${font};margin-bottom:14px">
      <div style="color:#888;font-size:12px">${font}, letter-spacing -1px</div>
      ${samples.map(([name, text]) => `<div style="display:flex;gap:18px;margin:6px 0">
        <span style="width:110px;color:#888;font-size:12px">${name}</span>
        <pre style="margin:0;font:inherit;letter-spacing:-1px">${text}</pre></div>`).join('')}
    </div>`).join('')}</body>`;
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 560, height: 600 }, deviceScaleFactor: 2 });
  await page.setContent(html);
  await page.screenshot({ path, fullPage: true });
  await browser.close();
  console.log(`Rendertest geschrieben: ${path}`);
}

async function main() {
  const args = Object.fromEntries(process.argv.slice(2).map((a) => {
    const flag = a.replace(/^--/, '');
    const at = flag.indexOf('=');
    return at < 0 ? [flag, ''] : [flag.slice(0, at), flag.slice(at + 1)];
  }));
  if (args.render) await render(args.render);
  const days = Number.parseInt(args.days ?? '365', 10);

  const runs = [];
  for (let d = 0; d < days; d++) {
    let run = createRun({ seed: dailySeed(DAILY_FROM + d * 86400000), config: ENDLESS_RUN });
    while (run.status === 'playing' || run.status === 'levelCleared') {
      run = run.status === 'levelCleared' ? advance(run) : place(run, lookaheadChoice(run));
    }
    runs.push(run);
  }

  const share = (pred) => {
    const counts = [0, 0, 0, 0, 0];
    let n = 0;
    for (const run of runs) {
      for (const { level, left } of run.cleared) {
        if (!pred(level)) continue;
        counts[Math.min(left, 4)]++;
        n++;
      }
    }
    return [...counts.map((c) => `${((100 * c) / n).toFixed(1)}%`), n, Math.max(...runs.flatMap((r) => r.cleared.filter(({ level }) => pred(level)).map(({ left }) => left)))];
  };
  console.log(`Rest je geschafftem Level, ${days} Tagesbretter ab 2026-01-01, Planer`);
  printTable(['Level', '0', '1', '2', '3', '4+', 'n', 'max'], [
    ['1', ...share((l) => l === 1)],
    ['2+', ...share((l) => l >= 2)],
    ['2-5', ...share((l) => l >= 2 && l <= 5)],
    ['6-10', ...share((l) => l >= 6 && l <= 10)],
    ['11+', ...share((l) => l >= 11)],
  ]);

  console.log(`\nAbwechslung, ${days} Tagesbretter`);
  printTable(
    ['Format', 'ganz: verschieden', 'zwei Tage gleich', 'erste 6: verschieden', 'zwei Tage gleich'],
    Object.entries(FORMS).map(([name, form]) => [
      name,
      ...variety(runs.map((run) => strip(run, form))),
      ...variety(runs.map((run) => strip(run, form, 6))),
    ]),
  );
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
