#!/usr/bin/env node
/**
 * Plays one endless run in a real browser, from the first click to the card
 * that ends it.
 *
 *   node tools/ui-smoke.js [--seed=7] [--shots=/tmp]
 *
 * The unit tests can say that `run.js` scores a run correctly and that the
 * renderer draws what it is told. Only this says that the page wires the two
 * together: that a click lands on the right node, that the HUD counts what the
 * state counts, that the record survives a reload, and that the end card shows
 * up at all.
 *
 * The moves are not improvised — the same run is played here first with the
 * planning bot, and the browser is then asked to reproduce it click for click,
 * so the expected numbers are known before the page is opened.
 *
 * Chromium needs a handful of system libraries. Where they are not installed
 * system-wide, point the loader at a local copy:
 *
 *   LD_LIBRARY_PATH=~/.local/browser-libs/root/usr/lib64 node tools/ui-smoke.js
 */

import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

import { advance, createRun, ENDLESS_RUN, place } from '../src/run.js';
import { lookaheadChoice } from './bot64.js';

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const seed = Number.parseInt(args.seed ?? '7', 10);
const shots = args.shots ?? '/tmp';
const port = Number.parseInt(args.port ?? '8731', 10);

/** Collected failures, so one bad assertion does not hide the rest. */
const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? '  ok  ' : '  FEHL'} ${what}`);
  if (!ok) failures.push(what);
};

// What the run should do, computed before the browser ever opens.
const script = [];
let state = createRun({ seed, config: ENDLESS_RUN });
while (state.status === 'playing' || state.status === 'stageCleared') {
  if (state.status === 'stageCleared') {
    script.push({ go: true });
    state = advance(state);
    continue;
  }
  const id = lookaheadChoice(state);
  script.push({ id: String(id) });
  state = place(state, id);
}
const expected = { stage: state.stage, score: state.score };
console.log(`Seed ${seed}: erwartet Etappe ${expected.stage}, ${expected.score} Punkte,`
  + ` ${script.length} Eingaben`);

const server = spawn(process.execPath, ['tools/serve.js', `--port=${port}`], { stdio: 'ignore' });
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 560, height: 960 } });
  const noise = [];
  page.on('pageerror', (error) => noise.push(String(error)));
  page.on('console', (message) => message.type() === 'error' && noise.push(message.text()));

  await page.goto(`http://127.0.0.1:${port}/index.html?seed=${seed}`);
  await page.waitForSelector('.board .node');
  await page.evaluate(() => {
    localStorage.removeItem('funkloch.endlos.best');
    // A record left behind by the old name, to see it swept away on load.
    localStorage.setItem('sendernetz.endlos.best', JSON.stringify({ stage: 99, score: 99 }));
  });
  await page.reload();
  await page.waitForSelector('.board .node');
  check(await page.evaluate(() => localStorage.getItem('sendernetz.endlos.best')) === null,
    'der alte Sendernetz-Rekord wird beim Laden entfernt');
  // Not merely gone from storage: the HUD counts from this run's own stage 1,
  // so the old 99 was never read either.
  check(await page.textContent('#hud-stage-best') === 'Best 1', 'und nicht übernommen');

  const opaque = await page.locator('.node.is-blocked').count();
  const nodes = await page.locator('.node').count();
  console.log(`Brett 1: ${nodes} Knoten, ${opaque} davon undurchlässig`);
  check(nodes === 18, 'erste Etappe hat 18 Knoten');
  check(await page.textContent('#hud-open-label') === 'Funklöcher', 'die Statuszeile zählt Funklöcher');
  // The word the player reads for the stock of transmitters. It lives in three
  // places — the HUD, the row of chips, the end card — and a rename that misses
  // one of them leaves the page speaking two languages about the same thing.
  check((await page.evaluate(() =>
    document.getElementById('hud-left').closest('span').textContent.trim())).startsWith('Depot'),
    'die Statuszeile nennt das Depot');
  check(await page.locator('.depot .chip').count() === 3,
    'die Depot-Zeile trägt die Hand und die zwei Vorschauen');

  // The mark in front of the stage count is only allowed to sit *in* the row,
  // never to set its height. Measured against the same row with the mark taken
  // out, which is the only comparison that means anything.
  const row = await page.evaluate(() => {
    const hud = document.querySelector('.hud');
    const mark = hud.querySelector('.hud-mark');
    const withMark = hud.getBoundingClientRect().height;
    mark.style.display = 'none';
    const without = hud.getBoundingClientRect().height;
    mark.style.display = '';
    return { withMark, without, mark: mark.getBoundingClientRect().height };
  });
  check(row.withMark === row.without,
    `die HUD-Zeile bleibt ${row.withMark}px hoch, mit Zeichen wie ohne`);
  check(row.mark > 0 && row.mark < row.withMark,
    `das Zeichen misst ${row.mark}px und bleibt damit unter der Zeile`);
  check(opaque === Math.round(18 * ENDLESS_RUN.blockedRatio), 'Blockaden nach Dichte gesetzt');
  check(await page.locator('.node.is-blocked .shell').count() === opaque, 'jede Blockade trägt ihr Achteck');
  check((await page.locator('#over').isVisible()) === false, 'die Endkarte liegt nicht über dem Start');
  await page.screenshot({ path: `${shots}/ui-board.png` });

  // --- the gesture that is gone --------------------------------------------
  // Placing is final in this mode, so the board has one action and the hold
  // ladder is switched off: no arming cue, no long press, no right click that
  // lifts anything. Checked on an actual transmitter — on an empty node every
  // one of these would "pass" by doing nothing at all.
  const boardIds = await page.$$eval('.board .node', (nodes) => nodes.map((n) => n.dataset.id));
  const isSender = (id) => page.locator(`.node[data-id="${id}"].is-transmitter`).count();
  /** Presses with a finger, holds, and reports the node before and after release. */
  const hold = async (id, ms) => {
    const at = await page.$eval(`.node[data-id="${id}"] .hit`, (hit) => {
      const box = hit.getBoundingClientRect();
      return { clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 };
    });
    const init = { pointerType: 'touch', pointerId: 7, isPrimary: true, button: 0, ...at };
    const hit = `.node[data-id="${id}"] .hit`;
    await page.dispatchEvent(hit, 'pointerdown', init);
    await page.waitForTimeout(ms);
    const during = await page.$eval(`.node[data-id="${id}"]`, (n) => [...n.classList]);
    await page.dispatchEvent(hit, 'pointerup', init);
    await page.waitForTimeout(150);
    return { during, after: await page.$eval(`.node[data-id="${id}"]`, (n) => [...n.classList]) };
  };

  const [standing, slow, viaKey] = boardIds;
  await page.click(`.node[data-id="${standing}"] .hit`);
  check(await isSender(standing) === 1, 'ein Tipp setzt den Sender');

  const onSender = await hold(standing, 900);
  check(!onSender.during.includes('is-arming') && !onSender.during.includes('is-inspecting'),
    `langes Halten kündigt nichts an (${onSender.during.join(' ')})`);
  check(await isSender(standing) === 1, 'und nimmt den gesetzten Sender nicht weg');

  await page.click(`.node[data-id="${standing}"] .hit`, { button: 'right' });
  check(await isSender(standing) === 1, 'die rechte Maustaste nimmt ihn auch nicht weg');

  // Without the ladder a slow tap is still a tap; there is no band left in
  // which a press means "I am only looking".
  const onFree = await hold(slow, 900);
  check(onFree.after.includes('is-transmitter'),
    `ein langsamer Tipp setzt trotzdem (${onFree.after.join(' ')})`);

  // Three things the gesture used to carry that have to survive without it.
  check(await page.$eval('.board', (svg) => svg.style.touchAction) === 'manipulation',
    'touch-action bleibt auf manipulation');
  check(await page.evaluate((id) => {
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    document.querySelector(`.node[data-id="${id}"] .hit`).dispatchEvent(event);
    return event.defaultPrevented;
  }, standing) === true, 'das Kontextmenü bleibt über dem Brett unterdrückt');

  await page.focus(`.node[data-id="${viaKey}"] .hit`);
  await page.keyboard.press('Enter');
  check(await isSender(viaKey) === 1, 'die Tastatur setzt weiterhin mit Enter');
  await page.keyboard.press('m');
  check(await isSender(viaKey) === 1, 'und m tut nichts mehr');

  // Back to a clean board: the scripted run below expects an untouched stage 1.
  await page.reload();
  await page.waitForSelector('.board .node');
  check(await page.locator('.node.is-transmitter').count() === 0,
    'der Neustart räumt das Brett für den gespielten Lauf');

  for (const step of script) {
    if (step.go) await page.click('#go');
    else await page.click(`.node[data-id="${step.id}"] .hit`);
  }
  await page.waitForSelector('#over:not([hidden])', { timeout: 5000 });
  // The card fades in. Shooting before that has finished says nothing about
  // what it looks like, and the first version of this check photographed a
  // half-transparent card and looked like a stacking bug.
  await page.locator('#over').evaluate((card) =>
    Promise.all(card.getAnimations().map((animation) => animation.finished)));

  const seen = await page.evaluate(() => ({
    stage: document.getElementById('hud-stage').textContent,
    stageBest: document.getElementById('hud-stage-best').textContent,
    score: document.getElementById('hud-score').textContent,
    scoreBest: document.getElementById('hud-score-best').textContent,
    overTitle: document.querySelector('#over h2').textContent,
    overStage: document.getElementById('over-stage').textContent,
    overScore: document.getElementById('over-score').textContent,
    overBest: document.getElementById('over-best').textContent,
    record: !document.getElementById('over-record').hidden,
    status: document.getElementById('status').textContent,
    stored: localStorage.getItem('funkloch.endlos.best'),
  }));
  await page.screenshot({ path: `${shots}/ui-over.png` });

  const wordmark = await page.evaluate(() => {
    const mark = document.getElementById('wordmark');
    if (mark === null) return null;
    const box = mark.getBoundingClientRect();
    const list = document.querySelector('#over dl').getBoundingClientRect();
    return {
      label: mark.getAttribute('aria-label'),
      letters: [...mark.querySelectorAll('text')].map((node) => node.textContent).join(''),
      ring: mark.querySelector('circle.mark-hole') !== null,
      width: Math.round(box.width),
      height: Math.round(box.height),
      aboveList: box.bottom <= list.top,
    };
  });
  check(wordmark !== null, 'die Endkarte trägt den Schriftzug');
  check(wordmark?.width > 0 && wordmark?.height > 0,
    `der Schriftzug wird gezeichnet (${wordmark?.width}×${wordmark?.height}px)`);
  check(wordmark?.letters === 'funklch' && wordmark?.ring === true,
    'das o ist der Ring, nicht der Buchstabe');
  check(wordmark?.label === 'funkloch', 'vorgelesen heißt er trotzdem funkloch');
  check(wordmark?.aboveList === true, 'er steht über Etappe, Punkten und Bestwert');

  check(seen.overTitle === 'Depot leer.', `Karte betitelt sich „${seen.overTitle}"`);
  check(seen.overStage === String(expected.stage), `Karte zeigt Etappe ${seen.overStage}`);
  check(seen.overScore === String(expected.score), `Karte zeigt ${seen.overScore} Punkte`);
  check(seen.stage === String(expected.stage), `HUD-Etappe ${seen.stage}`);
  check(seen.score === String(expected.score), `HUD-Punkte ${seen.score}`);
  check(seen.stageBest === `Best ${expected.stage}`, `HUD-Rekord ${seen.stageBest}`);
  check(seen.overBest === `Etappe ${expected.stage}, ${expected.score} Punkte`,
    `Karte zeigt Bestwert ${seen.overBest}`);
  check(seen.record === true, 'der erste Lauf ist ein Bestwert');
  check(seen.status === '', 'die Statuszeile schweigt beim Verlieren');
  check(seen.stored === JSON.stringify({ stage: expected.stage, score: expected.score }),
    `gespeichert: ${seen.stored}`);

  // A fresh visit remembers the record and starts clean.
  await page.reload();
  await page.waitForSelector('.board .node');
  const after = await page.evaluate(() => ({
    stage: document.getElementById('hud-stage').textContent,
    stageBest: document.getElementById('hud-stage-best').textContent,
    scoreBest: document.getElementById('hud-score-best').textContent,
    over: document.getElementById('over').hidden,
  }));
  check(after.stageBest === `Best ${expected.stage}`, `Rekord überlebt den Neustart: ${after.stageBest}`);
  check(after.scoreBest === `Best ${expected.score}`, `Punkterekord überlebt: ${after.scoreBest}`);
  check(after.stage === '1', 'die neue Partie steht auf Etappe 1');
  check(after.over === true, 'die Karte ist wieder weg');

  // And the board survives a new board being mounted under it.
  await page.click('#restart');
  await page.waitForSelector('.board .node');
  check(await page.locator('#over').count() === 1, 'die Karte bleibt im DOM, wenn ein Brett wechselt');

  check(noise.length === 0, `keine Konsolenfehler${noise.length ? `: ${noise.join(' | ')}` : ''}`);
} finally {
  await browser.close();
  server.kill();
}

console.log(failures.length === 0
  ? `\nAlles gut. Bilder in ${shots}/ui-board.png und ${shots}/ui-over.png`
  : `\n${failures.length} Prüfungen fehlgeschlagen.`);
process.exit(failures.length === 0 ? 0 : 1);
