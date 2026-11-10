#!/usr/bin/env node
/**
 * What the board would gain from more stage height — say, from hiding the
 * hint below it: stage height and on-screen node radius with and without the
 * hint, at phone sizes, for the board sizes the curves deal. And which side
 * limits the scaling, because that decides whether height matters at all.
 *
 *   node tools/stage-gain.js [--port=8743]
 *
 * The board is scaled uniformly to fit the stage (`preserveAspectRatio`), so
 * the node radius on screen is its viewBox radius — 0.20 of the closest pair,
 * see DOT_RATIO in render.js — times min(stageWidth / boardWidth, stageHeight /
 * boardHeight). Whichever of the two is smaller is the limit; the other side
 * only adds air around the board. Measured 2026-11-10: on a portrait phone it
 * is the width, every time (MESSUNGEN.md, "Hilfetext ausblenden").
 *
 * Starts its own dev server, like ui-smoke.js, and needs Playwright's browser.
 */

import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { chromium } from 'playwright';

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const port = Number.parseInt(args.port ?? '8743', 10);

const blocked = await new Promise((resolve) => {
  const probe = createServer();
  probe.once('error', (error) => resolve(error.code ?? String(error)));
  probe.once('listening', () => probe.close(() => resolve(null)));
  probe.listen(port, '127.0.0.1');
});
if (blocked !== null) {
  console.error(`Port ${port} ist nicht frei (${blocked}); anderen wählen: --port=…`);
  process.exit(2);
}
const server = spawn(process.execPath, ['tools/serve.js', `--port=${port}`], { stdio: 'ignore' });
process.on('exit', () => server.kill());

const SIZES = [22, 34, 46, 60];
const SEEDS = [1, 2, 3, 4, 5, 6];
const SCREENS = [[360, 640], [320, 568], [390, 844]];

let browser = null;
try {
  const deadline = Date.now() + 5000;
  for (;;) {
    try { await fetch(`http://127.0.0.1:${port}/index.html`); break; } catch { /* not up yet */ }
    if (Date.now() > deadline) throw new Error('der Server antwortet nicht');
    await new Promise((resume) => setTimeout(resume, 50));
  }
  browser = await chromium.launch();
  console.log(`Knotenradius auf dem Schirm mit und ohne Hilfetext, ${SEEDS.length} Bretter je Größe`);
  for (const [width, height] of SCREENS) {
    const page = await browser.newPage({ viewport: { width, height } });
    // Nothing leaves the page: the leaderboard is never asked.
    await page.route('https://api.thssn.dev/**', (route) => route.abort());
    await page.goto(`http://127.0.0.1:${port}/index.html?seed=1`);
    await page.waitForSelector('.board .node');
    const rows = await page.evaluate(async ({ sizes, seeds }) => {
      const { createRun, ENDLESS_RUN } = await import('./src/run.js');
      const { createScene, fitHitAreas } = await import('./src/render.js');
      const stage = document.getElementById('stage');
      const hint = document.querySelector('.hint');
      const measure = () => {
        const svg = stage.querySelector('svg.board');
        const [, , vbW, vbH] = svg.getAttribute('viewBox').split(' ').map(Number);
        const rect = stage.getBoundingClientRect();
        const dot = svg.querySelector('.node:not(.is-blocked) .dot');
        return {
          stageH: Math.round(rect.height),
          r: dot.getBoundingClientRect().width / 2,
          limit: rect.height / vbH < rect.width / vbW ? 'H' : 'B',
          boardAspect: vbW / vbH,
          stageAspect: rect.width / rect.height,
        };
      };
      const out = [];
      for (const n of sizes) {
        for (const seed of seeds) {
          // One board of this size off the endless family, drawn as a fixed run.
          const config = { ...ENDLESS_RUN, endless: false, levelSizes: [n], senderRatio: [0.15] };
          const state = createRun({ seed: seed * 7919, config });
          const scene = createScene({ graph: state.graph, k: 1 }, { padding: 26 });
          stage.replaceChildren(scene.svg);
          fitHitAreas(scene);
          hint.hidden = false;
          const withHint = measure();
          hint.hidden = true;
          const without = measure();
          out.push({ n, withHint, without });
        }
      }
      hint.hidden = false;
      return out;
    }, { sizes: SIZES, seeds: SEEDS });
    console.log(`\n${width}×${height}`);
    console.log('Knoten  Bühne mit→ohne  Radius mit→ohne   Gewinn  begrenzt (mit→ohne)        Brett : Bühne (mit→ohne)');
    for (const n of SIZES) {
      const group = rows.filter((row) => row.n === n);
      const mean = (f) => group.reduce((sum, row) => sum + f(row), 0) / group.length;
      const rWith = mean((row) => row.withHint.r);
      const rWithout = mean((row) => row.without.r);
      console.log(`${String(n).padStart(6)}  ${`${group[0].withHint.stageH}→${group[0].without.stageH} px`.padEnd(16)}`
        + `${`${rWith.toFixed(2)}→${rWithout.toFixed(2)} px`.padEnd(18)}`
        + `${((rWithout / rWith - 1) * 100).toFixed(1).padStart(5)} %  `
        + `${group.map((row) => `${row.withHint.limit}→${row.without.limit}`).join(' ').padEnd(27)}`
        + `${mean((row) => row.withHint.boardAspect).toFixed(2)} : ${group[0].withHint.stageAspect.toFixed(2)}`
        + `→${group[0].without.stageAspect.toFixed(2)}`);
    }
    await page.close();
  }
  console.log('\nH = die Höhe begrenzt, B = die Breite. Brett : Bühne ist Breite/Höhe; ist das Brett breiter'
    + ' als die Bühne, begrenzt die Breite, und mehr Höhe ist nur Luft.');
} finally {
  await browser?.close();
  server.kill();
}
