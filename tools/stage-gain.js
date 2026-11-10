#!/usr/bin/env node
/**
 * What the board would gain from more stage height — say, from hiding the
 * hint below it: stage height and on-screen node radius with and without the
 * hint, at phone sizes, for the board sizes the curves deal. And which side
 * limits the scaling, because that decides whether height matters at all.
 *
 *   node tools/stage-gain.js [--port=8743]           height: with and without the hint
 *   node tools/stage-gain.js --width [--port=8743]   width: gutter, rotation, both, all
 *
 * `--width` measures the other side ("Die Breite ausnutzen" in MESSUNGEN.md):
 * the stage without its 16px side gutter, the board rotated by 90° when it
 * is wider than tall and the stage taller than wide, both, and both with the
 * hint hidden as well. The gutter is what shipped; the rotation is measured
 * with a `<g transform>` and a swapped viewBox, which is enough to measure
 * the radius and exactly the implementation that would break hit resolution
 * (input.js maps the pointer through the root SVG's CTM onto the graph's
 * own coordinates).
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

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [key, value] = a.replace(/^--/, '').split('=');
  return [key, value ?? true];
}));
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
const WIDTH_VARIANTS = ['heute', 'ohne Rand', 'gedreht', 'beides', 'alles'];

let browser = null;
try {
  const deadline = Date.now() + 5000;
  for (;;) {
    try { await fetch(`http://127.0.0.1:${port}/index.html`); break; } catch { /* not up yet */ }
    if (Date.now() > deadline) throw new Error('der Server antwortet nicht');
    await new Promise((resume) => setTimeout(resume, 50));
  }
  browser = await chromium.launch();
  if (args.width) {
    await measureWidth(browser);
  } else {
    await measureHeight(browser);
  }
} finally {
  await browser?.close();
  server.kill();
}

/** Stage height and node radius with and without the hint below the board. */
async function measureHeight(browser) {
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
}

/**
 * Node radius and air around the board for the stage as it is, without its
 * side gutter, with the board rotated, both, and both with the hint hidden.
 * "heute" is measured against the page as served — once the gutter has
 * shipped, "heute" and "ohne Rand" are the same and the table says so.
 */
async function measureWidth(browser) {
  console.log(`Knotenradius und Luft je Einpassung, ${SEEDS.length} Bretter je Größe`);
  for (const [width, height] of SCREENS) {
    const page = await browser.newPage({ viewport: { width, height } });
    await page.route('https://api.thssn.dev/**', (route) => route.abort());
    await page.goto(`http://127.0.0.1:${port}/index.html?seed=1`);
    await page.waitForSelector('.board .node');
    const rows = await page.evaluate(async ({ sizes, seeds, variants }) => {
      const { createRun, ENDLESS_RUN } = await import('./src/run.js');
      const { createScene } = await import('./src/render.js');
      const SVG_NS = 'http://www.w3.org/2000/svg';
      const stage = document.getElementById('stage');
      const hint = document.querySelector('.hint');
      const gutterToday = getComputedStyle(stage).marginLeft;
      const out = [];
      for (const n of sizes) {
        for (const seed of seeds) {
          const config = { ...ENDLESS_RUN, endless: false, levelSizes: [n], senderRatio: [0.15] };
          const state = createRun({ seed: seed * 7919, config });
          for (const variant of variants) {
            const scene = createScene({ graph: state.graph, k: 1 }, { padding: 26 });
            const svg = scene.svg;
            let [minX, minY, vbW, vbH] = svg.getAttribute('viewBox').split(' ').map(Number);
            const gutterless = variant !== 'heute' && variant !== 'gedreht';
            stage.style.marginLeft = gutterless ? '-16px' : gutterToday;
            stage.style.marginRight = gutterless ? '-16px' : gutterToday;
            hint.hidden = variant === 'alles';
            stage.replaceChildren(svg);
            const stageRect = stage.getBoundingClientRect();
            let rotated = false;
            if (variant !== 'heute' && variant !== 'ohne Rand' && vbW > vbH && stageRect.width < stageRect.height) {
              const g = document.createElementNS(SVG_NS, 'g');
              g.setAttribute('transform', `translate(${minX + vbH} ${minY}) rotate(90) translate(${-minX} ${-minY})`);
              while (svg.firstChild) g.append(svg.firstChild);
              svg.append(g);
              svg.setAttribute('viewBox', `${minX} ${minY} ${vbH} ${vbW}`);
              [vbW, vbH] = [vbH, vbW];
              rotated = true;
            }
            const dot = svg.querySelector('.node:not(.is-blocked) .dot');
            const scale = (dot.getBoundingClientRect().width / 2) / Number(dot.getAttribute('r'));
            out.push({
              n, variant, rotated,
              r: dot.getBoundingClientRect().width / 2,
              airY: (stageRect.height - vbH * scale) / 2,
              airX: (stageRect.width - vbW * scale) / 2,
              limit: stageRect.height / vbH < stageRect.width / vbW ? 'H' : 'B',
              stageW: Math.round(stageRect.width), stageH: Math.round(stageRect.height),
            });
          }
        }
      }
      stage.style.marginLeft = '';
      stage.style.marginRight = '';
      hint.hidden = false;
      return out;
    }, { sizes: SIZES, seeds: SEEDS, variants: WIDTH_VARIANTS });
    const first = (variant) => rows.find((row) => row.variant === variant);
    console.log(`\n${width}×${height}  (Bühne heute ${first('heute').stageW}×${first('heute').stageH},`
      + ` ohne Rand ${first('ohne Rand').stageW}×${first('ohne Rand').stageH},`
      + ` ohne Rand und Hilfetext ${first('alles').stageW}×${first('alles').stageH})`);
    console.log('Knoten  Variante    Radius   gegen heute   Luft oben/unten  links/rechts  begrenzt  gedreht');
    for (const n of SIZES) {
      const today = rows.filter((row) => row.n === n && row.variant === 'heute');
      const r0 = today.reduce((sum, row) => sum + row.r, 0) / today.length;
      for (const variant of WIDTH_VARIANTS) {
        const group = rows.filter((row) => row.n === n && row.variant === variant);
        const mean = (f) => group.reduce((sum, row) => sum + f(row), 0) / group.length;
        console.log(`${String(n).padStart(6)}  ${variant.padEnd(10)}  ${mean((row) => row.r).toFixed(2)} px`
          + `  ${((mean((row) => row.r) / r0 - 1) * 100).toFixed(1).padStart(6)} %`
          + `   ${String(Math.round(mean((row) => row.airY))).padStart(4)} px`
          + `         ${String(Math.round(mean((row) => row.airX))).padStart(4)} px`
          + `      ${group.map((row) => row.limit).join('').padEnd(7)} ${group.filter((row) => row.rotated).length}/${group.length}`);
      }
    }
    await page.close();
  }
  console.log('\nLuft ist der freie Streifen je Seite zwischen viewBox und Bühnenrand; H/B: die Höhe/Breite begrenzt.');
}
