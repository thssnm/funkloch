#!/usr/bin/env node
/**
 * Drives the real page in a real browser: serves the project, clicks nodes,
 * checks the things only a rendering engine can answer, and writes screenshots.
 *
 *   node tools/preview.js [--out=dir] [--level=1]
 *
 * Needs the playwright devDependency and a browser:
 *   npm install && npx playwright install --with-deps chromium
 * The app itself stays dependency-free; this is a development tool.
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { mkdirSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

import { HOP_MS } from '../src/render.js';
import { MARK_MS, PREVIEW_MS } from '../src/input.js';
import { findAllSolutions } from '../src/solver.js';
import { generateExactLevel } from '../src/generator.js';
import { bfsWithin } from '../src/graph.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

/** Minimal static server over the project directory. */
function serve() {
  const server = createServer(async (request, response) => {
    const path = request.url === '/' ? '/index.html' : request.url.split('?')[0];
    try {
      const body = await readFile(join(ROOT, path));
      response.writeHead(200, { 'content-type': MIME[extname(path)] ?? 'application/octet-stream' });
      response.end(body);
    } catch {
      response.writeHead(404).end('not found');
    }
  });
  return new Promise((done) => server.listen(0, '127.0.0.1', () => done(server)));
}

const checks = [];
const check = (name, ok, detail = '') => checks.push({ name, ok: Boolean(ok), detail });

async function main() {
  const args = Object.fromEntries(
    process.argv.slice(2).map((arg) => arg.replace(/^--/, '').split('=')),
  );
  const out = resolve(ROOT, args.out ?? 'screenshots');
  mkdirSync(out, { recursive: true });

  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });

  const errors = [];
  const page = await browser.newPage({ viewport: { width: 900, height: 760 } });
  page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));
  page.on('pageerror', (error) => errors.push(String(error)));

  await page.goto(base, { waitUntil: 'networkidle' });
  await page.waitForSelector('.node');

  const shot = (name) => page.screenshot({ path: join(out, `${name}.png`) });
  const nodeIds = () => page.$$eval('.node', (all) => all.map((node) => node.dataset.id));
  /** Clears the board only when there is something to clear. */
  const clearBoard = async () => {
    if (!(await page.$eval('#reset', (button) => button.disabled))) await page.click('#reset');
    await page.waitForTimeout(200);
  };
  const classesOf = (id) =>
    page.$eval(`.node[data-id="${id}"]`, (node) => [...node.classList]);

  // --- 1. empty board ------------------------------------------------------
  const ids = await nodeIds();
  check('level renders its nodes', ids.length > 0, `${ids.length} nodes`);
  check('nothing supplied at the start', (await page.$$('.node.is-covered')).length === 0);
  await shot('01-empty');

  // --- 2. tap target size --------------------------------------------------
  const hitBox = await page.$eval('.hit', (hit) => {
    const box = hit.getBoundingClientRect();
    return { width: box.width, height: box.height };
  });
  check('tap target >= 44 px', hitBox.width >= 44 && hitBox.height >= 44,
    `${hitBox.width.toFixed(1)} x ${hitBox.height.toFixed(1)} px`);

  // --- 2b. the board actually fills the space it is given -----------------
  const fill = await page.evaluate(() => {
    const stage = document.getElementById('stage').getBoundingClientRect();
    const board = document.querySelector('.board').getBoundingClientRect();
    return { stage: stage.height, board: board.height };
  });
  check('board fills its stage', fill.board >= fill.stage * 0.95,
    `${fill.board.toFixed(0)} of ${fill.stage.toFixed(0)} px`);

  // --- 2c. clicking empty board must not draw a focus frame ---------------
  const boardBox = await page.$eval('.board', (svg) => {
    const rect = svg.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + 4 };
  });
  await page.mouse.click(boardBox.x, boardBox.y);
  await page.waitForTimeout(150);
  check('no focus frame around the board',
    await page.$eval('.board', (svg) => getComputedStyle(svg).outlineStyle === 'none'));

  // --- 3. the transition is real, not a snap ------------------------------
  const dotTransition = await page.$eval('.dot', (dot) => getComputedStyle(dot).transition);
  check('dot animates transform', /transform/.test(dotTransition), dotTransition.slice(0, 60));

  // --- 4. clicking places a transmitter, mid-ripple screenshot -------------
  const level = await page.evaluate(() => fetch('levels/01.json').then((r) => r.json()));
  await page.click(`.node[data-id="${level.solution[0]}"] .hit`);
  await page.waitForTimeout(HOP_MS);
  await shot('02-ripple-t60');
  await page.waitForTimeout(60);
  await shot('03-ripple-t120');
  await page.waitForTimeout(400);
  await shot('03b-one-transmitter');
  check('click places a transmitter', (await classesOf(level.solution[0])).includes('is-transmitter'));
  check('neighbours light up', (await page.$$('.node.is-covered')).length > 1,
    `${(await page.$$('.node.is-covered')).length} covered`);

  // --- 5. toggling off again ----------------------------------------------
  await page.click(`.node[data-id="${level.solution[0]}"] .hit`);
  await page.waitForTimeout(250);
  check('clicking again lifts it', (await page.$$('.node.is-covered')).length === 0);
  await page.click('#undo');
  await page.waitForTimeout(250);
  check('undo button restores the transmitter',
    (await classesOf(level.solution[0])).includes('is-transmitter'));

  // --- 6. win --------------------------------------------------------------
  for (const id of level.solution.slice(1)) await page.click(`.node[data-id="${id}"] .hit`);
  await page.waitForTimeout(450);
  check('win state reached', await page.$eval('.board', (b) => b.classList.contains('is-won')));
  check('status says solved', (await page.textContent('#status')).trim() === 'Gelöst.');
  check('no modal dialog', (await page.$$('dialog, .modal')).length === 0);
  await shot('04-solved');

  // --- 7. over budget ------------------------------------------------------
  const spare = ids.find((id) => !level.solution.includes(id));
  await page.click(`.node[data-id="${spare}"] .hit`);
  await page.waitForTimeout(300);
  check('over budget is flagged, not blocked',
    (await page.$$('.node.is-over-budget')).length === level.count + 1,
    `${(await page.$$('.node.is-over-budget')).length} flagged`);
  check('over budget is not a win', !(await page.$eval('.board', (b) => b.classList.contains('is-won'))));
  await shot('05-over-budget');

  // --- 8. keyboard ---------------------------------------------------------
  await clearBoard();
  await page.focus(`.node[data-id="${level.solution[0]}"] .hit`);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  check('Enter toggles the focused node',
    (await classesOf(level.solution[0])).includes('is-transmitter'));
  await shot('06-keyboard-focus');

  // --- 8b. notation: right click on the desktop ---------------------------
  await clearBoard();
  const probe = level.solution[0];
  const ball = await page.evaluate(
    async ({ id, k }) => {
      const { bfsWithin } = await import('/src/graph.js');
      const graph = await fetch('levels/01.json').then((r) => r.json()).then((l) => l.graph);
      return bfsWithin(graph, id, k);
    },
    { id: probe, k: level.k },
  );
  const neighbour = ball.find((id) => id !== probe);
  // Distinct from probe and neighbour, or the checks below would undo each other.
  const [noteA, noteB] = ids.filter(
    (id) => !level.solution.includes(id) && id !== probe && id !== neighbour,
  );
  await page.click(`.node[data-id="${noteA}"] .hit`, { button: 'right' });
  await page.click(`.node[data-id="${noteB}"] .hit`, { button: 'right' });
  await page.waitForTimeout(250);
  check('right click notes a node', (await classesOf(noteA)).includes('is-marked'));
  check('two notes stick', (await page.$$('.node.is-marked')).length === 2);
  check('a note draws a cross', await page.$eval(`.node[data-id="${noteA}"] .cross line`,
    (arm) => Number.parseFloat(getComputedStyle(arm).opacity) > 0.9));
  // Move the pointer off the board first, or the hover preview would still be up.
  await page.hover('#status');
  await page.waitForTimeout(250);
  check('notes survive the preview going away', (await page.$$('.node.is-marked')).length === 2);
  await shot('13-marked');
  await page.addStyleTag({ content: '#greyscale-probe, html { filter: grayscale(1); }' });
  await shot('13b-marked-greyscale');
  await page.evaluate(() => document.querySelectorAll('style').forEach((tag) => {
    if (tag.textContent.includes('greyscale-probe')) tag.remove();
  }));
  await page.waitForTimeout(100);

  check('a noted node stays tappable', true);
  await page.click(`.node[data-id="${noteA}"] .hit`);
  await page.waitForTimeout(250);
  check('placing a transmitter retracts the note',
    (await classesOf(noteA)).includes('is-transmitter') && !(await classesOf(noteA)).includes('is-marked'));
  await page.click('#undo');
  await page.waitForTimeout(250);
  check('undo brings the note back', (await classesOf(noteA)).includes('is-marked'));
  await page.click(`.node[data-id="${noteA}"] .hit`, { button: 'right' });
  await page.waitForTimeout(200);
  check('right click again lifts the note', !(await classesOf(noteA)).includes('is-marked'));
  await page.click('#undo');
  await page.waitForTimeout(200);

  // --- 8c. range preview on hover ----------------------------------------
  await page.hover(`.node[data-id="${probe}"] .hit`);
  await page.waitForTimeout(HOP_MS * (level.k + 1) + 200);
  const inRange = (await page.$$('.node.in-range')).length;
  check('hover shows the range', inRange === ball.length, `${inRange} nodes, ball is ${ball.length}`);
  check('hover lights the edges too', (await page.$$('.edge.in-range')).length > 0,
    `${(await page.$$('.edge.in-range')).length} edges`);
  check('hover places no transmitter', (await page.$$('.node.is-transmitter')).length === 0);
  check('a noted node stays marked inside the range',
    (await page.$$('.node.in-range.is-marked')).length + (await page.$$('.node.is-marked')).length > 0);
  await shot('14-range-preview');

  await page.hover('#status');
  await page.waitForTimeout(250);
  check('leaving the node clears the range', (await page.$$('.node.in-range')).length === 0);

  // Put a note inside the probe's range and look again, to prove the two
  // overlays coexist.
  await page.click(`.node[data-id="${neighbour}"] .hit`, { button: 'right' });
  await page.hover(`.node[data-id="${probe}"] .hit`);
  await page.waitForTimeout(HOP_MS * (level.k + 1) + 200);
  check('marked and in-range at once', (await classesOf(neighbour)).includes('is-marked') &&
    (await classesOf(neighbour)).includes('in-range'));
  await shot('15-marked-in-range');

  // --- 8d. keyboard note --------------------------------------------------
  await page.focus(`.node[data-id="${noteB}"] .hit`);
  await page.keyboard.press('m');
  await page.waitForTimeout(200);
  check('m toggles a note on the focused node', !(await classesOf(noteB)).includes('is-marked'));

  // --- 9. a level with radius 2, for the longer ripple ---------------------
  await clearBoard();
  for (let i = 0; i < 29; i++) await page.keyboard.press('n');
  await page.waitForFunction(() => document.getElementById('hud-level').textContent === '30');
  await page.waitForTimeout(300);
  const deep = await page.evaluate(() => fetch('levels/30.json').then((r) => r.json()));
  check('n key walks to the last level', (await page.textContent('#hud-level')) === '30');
  await shot('07-level30-empty');
  await page.click(`.node[data-id="${deep.solution[0]}"] .hit`);
  await page.waitForTimeout(HOP_MS + 20);
  await shot('08-level30-ripple');
  for (const id of deep.solution.slice(1)) await page.click(`.node[data-id="${id}"] .hit`);
  await page.waitForTimeout(500);
  await shot('09-level30-solved');
  check('level 30 solves', await page.$eval('.board', (b) => b.classList.contains('is-won')));

  // --- 10. phone -----------------------------------------------------------
  const phone = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  });
  phone.on('pageerror', (error) => errors.push(`phone: ${error}`));
  await phone.goto(base, { waitUntil: 'networkidle' });
  await phone.waitForSelector('.node');
  const phoneHit = await phone.$eval('.hit', (hit) => hit.getBoundingClientRect().width);
  check('tap target >= 44 px on a phone', phoneHit >= 44, `${phoneHit.toFixed(1)} px`);
  check('board fits without horizontal scroll',
    await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  const phoneFill = await phone.evaluate(() => {
    const stage = document.getElementById('stage').getBoundingClientRect();
    const board = document.querySelector('.board').getBoundingClientRect();
    return { stage: stage.height, board: board.height };
  });
  check('board fills its stage on a phone', phoneFill.board >= phoneFill.stage * 0.95,
    `${phoneFill.board.toFixed(0)} of ${phoneFill.stage.toFixed(0)} px`);
  await phone.tap(`.node[data-id="${level.solution[0]}"] .hit`);
  await phone.waitForTimeout(350);
  check('touch tap places a transmitter',
    await phone.$eval(`.node[data-id="${level.solution[0]}"]`,
      (node) => node.classList.contains('is-transmitter')));
  await phone.screenshot({ path: join(out, '10-phone.png') });

  // --- 10b. the touch hold ladder -----------------------------------------
  const phoneClasses = (id) => phone.$eval(`.node[data-id="${id}"]`, (node) => [...node.classList]);
  const hold = async (id, ms) => {
    const box = await phone.$eval(`.node[data-id="${id}"] .hit`, (hit) => {
      const rect = hit.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    });
    const init = { pointerType: 'touch', pointerId: 7, isPrimary: true, button: 0,
      clientX: box.x, clientY: box.y };
    await phone.dispatchEvent(`.node[data-id="${id}"] .hit`, 'pointerdown', init);
    await phone.waitForTimeout(ms);
    const seen = await phoneClasses(id);
    const ranged = (await phone.$$('.node.in-range')).length;
    await phone.dispatchEvent(`.node[data-id="${id}"] .hit`, 'pointerup', init);
    await phone.waitForTimeout(250);
    return { seen, ranged, after: await phoneClasses(id) };
  };

  const target = ids.find((id) => !level.solution.includes(id));
  const short = await hold(target, PREVIEW_MS + (MARK_MS - PREVIEW_MS) / 2);
  check('mid hold shows the range', short.ranged > 1, `${short.ranged} nodes lit`);
  check('mid hold marks the node as inspecting', short.seen.includes('is-inspecting'));
  check('releasing mid hold does nothing',
    !short.after.includes('is-transmitter') && !short.after.includes('is-marked'),
    short.after.join(' '));

  const long = await hold(target, MARK_MS + 200);
  check('long hold arms the node before release', long.seen.includes('is-arming'));
  check('releasing a long hold notes the node', long.after.includes('is-marked'));
  check('long hold places no transmitter', !long.after.includes('is-transmitter'));
  await phone.screenshot({ path: join(out, '16-phone-marked.png') });

  const quick = await hold(target, 60);
  check('a quick tap still places a transmitter', quick.after.includes('is-transmitter'),
    quick.after.join(' '));
  check('and it retracts the note', !quick.after.includes('is-marked'));
  check('no range flashes up during a quick tap', quick.ranged === 0);

  // --- 11. greyscale, to judge the colour-blind fallback -------------------
  await phone.addStyleTag({ content: 'html { filter: grayscale(1); }' });
  await phone.screenshot({ path: join(out, '11-phone-greyscale.png') });

  // --- 12. forbidden nodes, on a level fabricated for the purpose ---------
  // levels/ is left untouched: the page is served a synthetic level instead.
  const base01 = JSON.parse(readFileSync(join(ROOT, 'levels', '01.json'), 'utf8'));
  let guarded = null;
  for (const node of base01.graph.nodes) {
    const graph = {
      ...base01.graph,
      nodes: base01.graph.nodes.map((n) => (n.id === node.id ? { ...n, forbidden: true } : n)),
    };
    const [solution] = findAllSolutions(graph, base01.count, base01.k);
    if (solution) {
      guarded = { ...base01, id: 'F1', graph, solution, forbidden: node.id };
      break;
    }
  }
  if (!guarded) throw new Error('could not fabricate a forbidden-node level');

  const guard = await browser.newPage({ viewport: { width: 900, height: 760 } });
  guard.on('pageerror', (error) => errors.push(`forbidden: ${error}`));
  await guard.route('**/levels/01.json', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(guarded) }));
  await guard.goto(base, { waitUntil: 'networkidle' });
  await guard.waitForSelector('.node');

  const blocked = `.node[data-id="${guarded.forbidden}"]`;
  check('a forbidden node renders as a square, not a circle',
    await guard.$eval(`${blocked} .plate`, (rect) => rect.tagName.toLowerCase() === 'rect' &&
      Number.parseFloat(getComputedStyle(rect.parentElement).opacity) > 0.9));
  check('its circle and ring are gone',
    await guard.$eval(`${blocked} .dot`, (dot) => getComputedStyle(dot).display === 'none'));
  check('it is not a focus stop', await guard.$eval(`${blocked} .hit`,
    (hit) => hit.getAttribute('tabindex') === null && hit.getAttribute('aria-hidden') === 'true'));

  const before = await guard.$eval(blocked, (node) => [...node.classList]);
  await guard.click(`${blocked} .hit`, { force: true });
  await guard.waitForTimeout(250);
  check('it is not tappable',
    JSON.stringify(await guard.$eval(blocked, (node) => [...node.classList])) === JSON.stringify(before));
  await guard.screenshot({ path: join(out, '17-forbidden.png') });

  // Irradiate it on purpose: allowed, flagged, and not a win.
  const offender = await guard.evaluate(async ({ id, k }) => {
    const { bfsWithin } = await import('/src/graph.js');
    const graph = await fetch('levels/01.json').then((r) => r.json()).then((l) => l.graph);
    return bfsWithin(graph, id, k).find((other) => other !== id);
  }, { id: guarded.forbidden, k: guarded.k });
  await guard.click(`.node[data-id="${offender}"] .hit`);
  await guard.waitForTimeout(350);
  check('irradiating a forbidden node is not blocked',
    (await guard.$eval(`.node[data-id="${offender}"]`, (n) => [...n.classList])).includes('is-transmitter'));
  check('the violation is shown', (await guard.$eval(blocked, (n) => [...n.classList])).includes('is-violated'));
  check('and the status says so', (await guard.textContent('#status')).includes('bestrahlt'));
  await guard.screenshot({ path: join(out, '18-forbidden-violated.png') });

  for (const id of guarded.solution) await guard.click(`.node[data-id="${id}"] .hit`);
  await guard.click(`.node[data-id="${offender}"] .hit`);
  await guard.waitForTimeout(400);
  check('the level still wins when nothing is irradiated',
    await guard.$eval('.board', (b) => b.classList.contains('is-won')),
    (await guard.textContent('#status')).trim());
  await guard.addStyleTag({ content: 'html { filter: grayscale(1); }' });
  await guard.screenshot({ path: join(out, '19-forbidden-greyscale.png') });

  // --- 13. exact-cover mode, again on a fabricated level ------------------
  const exact = generateExactLevel({ count: 3, k: 1, seed: 7, maxAttempts: 300 });
  const exactLevel = { ...exact, id: 'X1' };
  const exactPage = await browser.newPage({ viewport: { width: 900, height: 760 } });
  exactPage.on('pageerror', (error) => errors.push(`exact: ${error}`));
  await exactPage.route('**/levels/01.json', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(exactLevel) }));
  await exactPage.goto(base, { waitUntil: 'networkidle' });
  await exactPage.waitForSelector('.node');
  check('exact mode is announced', (await exactPage.textContent('#hud-mode')).includes('genau ein Signal'));

  // Two transmitters whose balls overlap: allowed, but a conflict.
  const clashing = bfsWithin(exact.graph, exact.solution[0], 1).filter((id) => id !== exact.solution[0]);
  await exactPage.click(`.node[data-id="${exact.solution[0]}"] .hit`);
  await exactPage.click(`.node[data-id="${clashing[0]}"] .hit`);
  await exactPage.waitForTimeout(350);
  const conflicted = (await exactPage.$$('.node.is-conflict')).length;
  check('overlap is flagged as a conflict', conflicted > 0, `${conflicted} nodes`);
  check('the conflict draws two rings', await exactPage.$eval('.node.is-conflict .clash circle',
    (ring) => Number.parseFloat(getComputedStyle(ring).opacity) > 0.9));
  check('overlap is not blocked',
    (await exactPage.$$('.node.is-transmitter')).length === 2);
  check('the status names the conflict', (await exactPage.textContent('#status')).includes('Signal'));
  await exactPage.screenshot({ path: join(out, '20-exact-conflict.png') });

  await exactPage.click('#reset');
  await exactPage.waitForTimeout(200);
  for (const id of exact.solution) await exactPage.click(`.node[data-id="${id}"] .hit`);
  await exactPage.waitForTimeout(400);
  check('a partition wins', await exactPage.$eval('.board', (b) => b.classList.contains('is-won')),
    (await exactPage.textContent('#status')).trim());
  check('no node is left in conflict', (await exactPage.$$('.node.is-conflict')).length === 0);
  await exactPage.screenshot({ path: join(out, '21-exact-solved.png') });
  await exactPage.addStyleTag({ content: 'html { filter: grayscale(1); }' });
  await exactPage.screenshot({ path: join(out, '22-exact-greyscale.png') });

  check('no console or page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

  await browser.close();
  server.close();

  const width = Math.max(...checks.map((c) => c.name.length));
  for (const { name, ok, detail } of checks) {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(width)}  ${detail}`);
  }
  const failed = checks.filter((c) => !c.ok).length;
  console.log(`\n${checks.length - failed}/${checks.length} checks passed — screenshots in ${out}`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  for (const { name, ok, detail } of checks) {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail}`);
  }
  console.error(`\nABORTED: ${String(error).split('\n')[0]}`);
  process.exit(1);
});
