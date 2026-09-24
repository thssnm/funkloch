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
 * The daily board gets its own pass at the end, on a stopped clock: that the
 * same UTC day gives the same board in two separate browsers, that a second
 * attempt at it is refused however the page is reloaded or clicked, and that
 * the line the share button copies carries the date, the stage and the points
 * and nothing that would spoil the board for whoever reads it.
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

import { advance, createRun, dailySeed, ENDLESS_RUN, place, utcDay } from '../src/run.js';
import { lookaheadChoice } from './bot64.js';

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const seed = Number.parseInt(args.seed ?? '7', 10);
const shots = args.shots ?? '/tmp';
const port = Number.parseInt(args.port ?? '8731', 10);

/** Collected failures, so one bad assertion does not hide the rest. */
const failures = [];

/**
 * Waits for a predicate to hold in the page, polled from here.
 *
 * Node's clock and not the page's: the daily pass runs against a faked browser
 * clock, and anything that waited on a page-side timer would be waiting on the
 * very thing the test is controlling.
 * @param {import('playwright').Page} target
 * @param {() => boolean} predicate evaluated in the page
 * @param {number} [ms] how long to keep trying
 * @returns {Promise<boolean>}
 */
async function until(target, predicate, ms = 5000) {
  const deadline = Date.now() + ms;
  for (;;) {
    if (await target.evaluate(predicate)) return true;
    if (Date.now() > deadline) return false;
    await new Promise((resume) => setTimeout(resume, 50));
  }
}
const check = (ok, what) => {
  console.log(`${ok ? '  ok  ' : '  FEHL'} ${what}`);
  if (!ok) failures.push(what);
};

/**
 * Plays a whole run with the planning bot and writes down what it did, so the
 * browser can be asked to reproduce it click for click and the expected numbers
 * are known before the page is ever opened.
 * @param {number} from the seed the run starts from
 * @returns {{script: Array<object>, stage: number, score: number, opening: number[]}}
 */
function planRun(from) {
  const moves = [];
  let run = createRun({ seed: from, config: ENDLESS_RUN });
  const dealt = [run.current, ...run.preview];
  while (run.status === 'playing' || run.status === 'stageCleared') {
    if (run.status === 'stageCleared') {
      moves.push({ go: true });
      run = advance(run);
      continue;
    }
    const id = lookaheadChoice(run);
    moves.push({ id: String(id) });
    run = place(run, id);
  }
  return { script: moves, stage: run.stage, score: run.score, opening: dealt };
}

// What the run should do, computed before the browser ever opens.
const { script, opening, ...expected } = planRun(seed);
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
    localStorage.removeItem('funkloch.taeglich');
    localStorage.removeItem('funkloch.modus');
    // A record left behind by the old name, to see it swept away on load.
    localStorage.setItem('sendernetz.endlos.best', JSON.stringify({ stage: 99, score: 99 }));
  });
  await page.reload();
  await page.waitForSelector('.board .node');
  check(await page.evaluate(() => localStorage.getItem('sendernetz.endlos.best')) === null,
    'der alte Sendernetz-Rekord wird beim Laden entfernt');
  // Not merely gone from storage: a run that has scored nothing yet shows no
  // record at all, so the old 99 was never read either.
  check(await page.textContent('#hud-score-best') === '', 'und nicht übernommen');

  // --- one record, not two -------------------------------------------------
  // The stage is a standing, not a best: it has no record of its own any more,
  // and the element that used to carry one is gone rather than merely emptied.
  check(await page.locator('#hud-stage-best').count() === 0,
    'die Etappe hat keinen eigenen Bestwert mehr');
  check((await page.evaluate(() => document.getElementById('hud-stage')
    .closest('span').textContent.replace(/\s+/g, ' ').trim())) === 'Etappe 1',
    'die Kopfzeile sagt nur „Etappe 1"');
  check(await page.locator('#hud-score-best').count() === 1,
    'der Bestwert hängt an den Punkten');

  const opaque = await page.locator('.node.is-blocked').count();
  const nodes = await page.locator('.node').count();
  console.log(`Brett 1: ${nodes} Knoten, ${opaque} davon undurchlässig`);
  check(nodes === 18, 'erste Etappe hat 18 Knoten');
  check(await page.textContent('#hud-open-label') === 'Funklöcher', 'die Statuszeile zählt Funklöcher');
  // The word the player reads for the stock of transmitters, and a rename that
  // misses one of its places leaves the page speaking two languages about the
  // same thing. Number first, label after — the order the race row settled on.
  check((await page.evaluate(() => document.getElementById('hud-left')
    .closest('.race-value').textContent.replace(/\s+/g, ' ').trim())).endsWith('Depot'),
    'die Rennzeile nennt das Depot, Zahl zuerst');

  // --- the three rows of the header ----------------------------------------
  // Bookkeeping small and dimmed on top, the two numbers of the race below it
  // at opposite ends of a rule, the hand at the bottom. The order is the point:
  // it is what says which of these you play against.
  const head = await page.evaluate(() => {
    const race = document.querySelector('.race').getBoundingClientRect();
    return {
      rows: [...document.querySelectorAll('.head > *')].map((el) => el.className),
      ledgerPx: parseFloat(getComputedStyle(document.querySelector('.ledger')).fontSize),
      numberPx: parseFloat(getComputedStyle(document.querySelector('.race-value b')).fontSize),
      ruleW: Math.round(document.querySelector('.race-rule').getBoundingClientRect().width),
      // Number before label in both, so the eye learns one order, not two.
      order: [...document.querySelectorAll('.race-value')]
        .map((v) => v.firstElementChild.tagName.toLowerCase()),
      edges: [...document.querySelectorAll('.race-value')].map((v) => {
        const b = v.getBoundingClientRect();
        return { left: Math.round(b.left - race.left), right: Math.round(race.right - b.right) };
      }),
    };
  });
  check(head.rows.join(' ') === 'ledger race hand', `Kopf hat drei Zeilen: ${head.rows.join(' ')}`);
  check(head.ledgerPx === 13, `die Buchführung misst ${head.ledgerPx}px`);
  check(head.numberPx >= 24, `die Rennzahlen messen ${head.numberPx}px`);
  check(head.order.join(',') === 'b,b', 'beide Werte nennen die Zahl vor dem Label');
  check(head.edges[0].left === 0 && head.edges[1].right === 0,
    'die beiden Werte sitzen an den Rändern');
  check(head.ruleW > 100, `die Trennlinie füllt die ${head.ruleW}px dazwischen`);
  check(await page.locator('.depot-label').count() === 0,
    'die Wörter in der Hand und danach sind weg');

  // --- reach as rings ------------------------------------------------------
  const cards = await page.$$eval('.hand .chip', (chips) => chips.map((chip) => ({
    rings: chip.querySelectorAll('.chip-ring').length,
    digit: chip.querySelector('.chip-digit')?.textContent ?? null,
    label: chip.querySelector('svg')?.getAttribute('aria-label') ?? null,
    width: Math.round(chip.getBoundingClientRect().width),
  })));
  check(cards.length === 3, `die Hand zeigt ${cards.length} Karten`);
  opening.forEach((radius, index) => {
    check(cards[index]?.rings === radius,
      `Karte ${index + 1}: ${cards[index]?.rings} Ringe für Reichweite ${radius}`);
    check(cards[index]?.digit === String(radius),
      `und die Ziffer sagt ${cards[index]?.digit}`);
    check(cards[index]?.label === `Reichweite ${radius}`, `vorgelesen: ${cards[index]?.label}`);
  });
  check(cards[0].width > cards[1].width && cards[1].width === cards[2].width,
    `die erste Karte ist größer (${cards[0].width} gegen ${cards[1].width}px)`);

  // --- Neue Partie is not under a running board ----------------------------
  const restart = await page.evaluate(() => {
    const button = document.getElementById('restart');
    return {
      onCard: button.closest('#over') !== null,
      laidOut: button.offsetParent !== null,
      width: button.getBoundingClientRect().width,
    };
  });
  check(restart.onCard === true, 'Neue Partie sitzt auf der Endkarte');
  check(restart.laidOut === false && restart.width === 0,
    'und nimmt während der Partie keinen Platz im Layout');

  // The mark in front of the stage count is only allowed to sit *in* the row,
  // never to set its height. Measured against the same row with the mark taken
  // out, which is the only comparison that means anything.
  const row = await page.evaluate(() => {
    const hud = document.querySelector('.ledger');
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

  // The mode switch has to obey the same rule. It sits in the bookkeeping row,
  // and the whole point of putting it there was that the header does not grow
  // a fourth row or a taller first one to carry it.
  const modes = await page.evaluate(() => {
    const hud = document.querySelector('.ledger');
    const box = document.getElementById('modes');
    const withSwitch = hud.getBoundingClientRect().height;
    box.style.display = 'none';
    const without = hud.getBoundingClientRect().height;
    box.style.display = '';
    return {
      withSwitch,
      without,
      height: box.getBoundingClientRect().height,
      rows: [...document.querySelectorAll('.head > *')].map((el) => el.className),
      labels: [...box.querySelectorAll('button')].map((b) => b.textContent),
      pressed: [...box.querySelectorAll('button')].map((b) => b.getAttribute('aria-pressed')),
    };
  });
  check(modes.withSwitch === modes.without,
    `der Umschalter lässt die Zeile bei ${modes.withSwitch}px`);
  check(modes.height > 0 && modes.height <= modes.withSwitch,
    `er misst ${modes.height}px und bleibt in der Zeile`);
  check(modes.rows.join(' ') === 'ledger race hand', 'der Kopf hat weiterhin drei Zeilen');
  check(modes.labels.join(',') === 'Frei,Täglich', `der Umschalter nennt ${modes.labels.join(', ')}`);
  check(modes.pressed.join(',') === 'true,false', 'und steht auf Frei');
  check(opaque === Math.round(18 * ENDLESS_RUN.blockedRatio), 'Blockaden nach Dichte gesetzt');
  // An impermeable node is a different body, not an ordinary one with a frame
  // around it: the octagon carries hatching and the circle is gone from under
  // it. Both halves checked, because either one alone would still pass if the
  // node had quietly gone back to being a dot with decoration on top.
  check(await page.locator('.node.is-blocked .shell-plate').count() === opaque,
    'jede Blockade ist ein Achteck');
  check(await page.locator('.node.is-blocked .shell-hatch line').count() >= opaque * 5,
    'und schraffiert');
  check(await page.locator('.node:not(.is-blocked) .shell-plate').count() === 0,
    'gewöhnliche Knoten tragen keins');
  check(await page.evaluate(() => {
    const node = document.querySelector('.node.is-blocked');
    return getComputedStyle(node.querySelector('.dot')).display;
  }) === 'none', 'der runde Punkt tritt dafür zurück');
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
  check(seen.scoreBest === `best ${expected.score}`, `HUD-Rekord ${seen.scoreBest}`);
  check(seen.overBest === `${expected.score} Punkte`, `Karte zeigt Bestwert ${seen.overBest}`);
  check(seen.record === true, 'der erste Lauf ist ein Bestwert');
  check(seen.status === '', 'die Statuszeile schweigt beim Verlieren');
  // Only the score is kept; the stage record is not written back in any shape.
  check(seen.stored === JSON.stringify({ score: expected.score }), `gespeichert: ${seen.stored}`);

  // The one door into a new game, and the board has to survive being swapped
  // out from under the card that opened it.
  check(await page.locator('#over #restart').isVisible() === true,
    'auf der Endkarte ist Neue Partie erreichbar');
  await page.click('#restart');
  await page.waitForSelector('.board .node');
  check(await page.locator('#over').count() === 1, 'die Karte bleibt im DOM, wenn ein Brett wechselt');
  check(await page.locator('#over').isVisible() === false, 'und liegt nicht über der neuen Partie');

  // A fresh visit remembers the record and starts clean.
  await page.reload();
  await page.waitForSelector('.board .node');
  const after = await page.evaluate(() => ({
    stage: document.getElementById('hud-stage').textContent,
    scoreBest: document.getElementById('hud-score-best').textContent,
    over: document.getElementById('over').hidden,
  }));
  check(after.scoreBest === `best ${expected.score}`, `Punkterekord überlebt: ${after.scoreBest}`);
  check(after.stage === '1', 'die neue Partie steht auf Etappe 1');
  check(after.over === true, 'die Karte ist wieder weg');

  check(noise.length === 0, `keine Konsolenfehler${noise.length ? `: ${noise.join(' | ')}` : ''}`);

  // --- das Tagesbrett ------------------------------------------------------
  // A fixed clock, so "today" is a day we know, and its board and its whole
  // planned run are known before the page opens. Noon UTC: far enough from
  // both midnights that nothing here depends on how long the run takes.
  const day = Date.UTC(2026, 8, 24, 12, 0, 0);
  const plan = planRun(dailySeed(day));
  console.log(`Tagesbrett ${utcDay(day)}: erwartet Etappe ${plan.stage},`
    + ` ${plan.score} Punkte, ${plan.script.length} Eingaben`);

  const context = await browser.newContext({ viewport: { width: 560, height: 960 } });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'],
    { origin: `http://127.0.0.1:${port}` });
  const daily = await context.newPage();
  const dailyNoise = [];
  daily.on('pageerror', (error) => dailyNoise.push(String(error)));
  daily.on('console', (message) => message.type() === 'error' && dailyNoise.push(message.text()));
  // Installed before the first navigation, or the page would read the real
  // clock on the way up and derive a different board from it.
  await daily.clock.install({ time: new Date(day) });
  // No `?seed=`: that would pin a free run and is exactly what must *not* be
  // needed to reach the same board twice.
  await daily.goto(`http://127.0.0.1:${port}/index.html`);
  await daily.waitForSelector('.board .node');

  await daily.click('#mode-taeglich');
  await daily.waitForSelector('.board .node');
  check(await daily.getAttribute('#mode-taeglich', 'aria-pressed') === 'true',
    'der Umschalter steht auf Täglich');
  check(await daily.textContent('#hud-score-best') === '',
    'auf dem Tagesbrett gibt es keinen Bestwert zu jagen');

  /** The board as the page drew it, node for node. */
  const boardShape = (target) => target.$$eval('.board .node',
    (nodes) => nodes.map((n) => `${n.dataset.id}${n.classList.contains('is-blocked') ? '!' : ''}`).join(' '));

  const first = await boardShape(daily);
  check(await daily.evaluate(() => localStorage.getItem('funkloch.modus')) === 'taeglich',
    'die Spielart überlebt einen Neuladen');
  await daily.reload();
  await daily.waitForSelector('.board .node');
  check(await boardShape(daily) === first, 'dasselbe Datum gibt dasselbe Brett');

  // A second browser, same day, nothing shared but the clock: the same board.
  // This is the claim the whole mode rests on.
  const other = await browser.newContext({ viewport: { width: 560, height: 960 } });
  const stranger = await other.newPage();
  await stranger.clock.install({ time: new Date(Date.UTC(2026, 8, 24, 21, 30)) });
  await stranger.goto(`http://127.0.0.1:${port}/index.html`);
  await stranger.waitForSelector('.board .node');
  await stranger.click('#mode-taeglich');
  await stranger.waitForSelector('.board .node');
  check(await boardShape(stranger) === first,
    'ein anderer Spieler bekommt am selben UTC-Tag dasselbe Brett');
  // And the next day is a different one, or the mode would be one board.
  await stranger.clock.setFixedTime(new Date(Date.UTC(2026, 8, 25, 12)));
  await stranger.reload();
  await stranger.waitForSelector('.board .node');
  check(await boardShape(stranger) !== first, 'am nächsten Tag ist es ein anderes Brett');
  await other.close();

  // Play the day out.
  for (const step of plan.script) {
    if (step.go) await daily.click('#go');
    else await daily.click(`.node[data-id="${step.id}"] .hit`);
  }
  await daily.waitForSelector('#over:not([hidden])', { timeout: 5000 });

  const ended = await daily.evaluate(() => ({
    stage: document.getElementById('over-stage').textContent,
    score: document.getElementById('over-score').textContent,
    bestShown: !document.getElementById('over-best').hidden,
    restartShown: !document.getElementById('restart').hidden,
    dailyShown: !document.getElementById('over-daily').hidden,
    countdown: document.getElementById('countdown').textContent,
    stored: JSON.parse(localStorage.getItem('funkloch.taeglich')),
  }));
  check(ended.stage === String(plan.stage), `Tageskarte zeigt Etappe ${ended.stage}`);
  check(ended.score === String(plan.score), `Tageskarte zeigt ${ended.score} Punkte`);
  check(ended.restartShown === false, 'die Tageskarte bietet keine neue Partie an');
  check(ended.dailyShown === true, 'sie zeigt stattdessen Ergebnis und Wartezeit');
  check(ended.bestShown === false, 'und keinen Bestwert aus dem freien Spiel');
  // Noon UTC, so about twelve hours are left of the day. Checked against the
  // page's own clock rather than against a fixed string: the faked clock keeps
  // ticking while the run is played, so the seconds have moved on by the time
  // the card appears, and the property worth asserting is that the number
  // really tracks the time to UTC midnight.
  const counted = await daily.evaluate(() => {
    const shown = document.getElementById('countdown').textContent;
    const parts = shown.match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
    if (parts === null) return { shown, ok: false };
    const seconds = Number(parts[1]) * 3600 + Number(parts[2]) * 60 + Number(parts[3]);
    const left = (86400000 - (Date.now() % 86400000)) / 1000;
    return { shown, ok: Math.abs(seconds - left) < 90, left: Math.round(left) };
  });
  check(counted.ok, `Zeit bis zum nächsten Brett: ${counted.shown}`
    + ` (bis Mitternacht UTC: ${counted.left}s)`);
  check(ended.stored?.day === utcDay(day) && ended.stored?.done === true,
    `gespeichert: ${utcDay(day)}, abgeschlossen`);
  // Same reason as the card above: shooting through the fade photographs a
  // half-transparent card and looks like a stacking bug.
  await daily.locator('#over').evaluate((card) =>
    Promise.all(card.getAnimations().map((animation) => animation.finished)));
  await daily.screenshot({ path: `${shots}/ui-daily.png` });

  // --- die Ergebniszeile ---------------------------------------------------
  await daily.click('#share');
  // The handler copies before it reports, and copying is asynchronous, so the
  // button's own label is the signal that it has finished.
  check(await until(daily, () => document.getElementById('share').textContent !== 'Ergebnis kopieren'),
    'der Knopf meldet zurück');
  const shared = await daily.evaluate(() => ({
    line: document.getElementById('share-line').textContent,
    label: document.getElementById('share').textContent,
  }));
  check(shared.line === `funkloch 24.09. — Etappe ${plan.stage}, ${plan.score} Punkte`,
    `Ergebniszeile: ${shared.line}`);
  check(shared.line.includes('24.09.'), 'sie nennt das Datum');
  check(shared.line.includes(`Etappe ${plan.stage}`), 'sie nennt die Etappe');
  check(shared.line.includes(`${plan.score} Punkte`), 'sie nennt die Punkte');
  // Nothing that would hand the reader the board, let alone the moves.
  check(!/r\d+c\d+/.test(shared.line), 'sie verrät keinen Knoten');
  const clip = await daily.evaluate(() => navigator.clipboard.readText().catch(() => null));
  check(clip === null || clip === shared.line,
    clip === null ? 'die Zwischenablage war nicht lesbar' : 'sie liegt in der Zwischenablage');
  check(shared.label === 'Kopiert.' || shared.label === 'Kopieren ging nicht',
    `der Knopf meldet: ${shared.label}`);

  // --- ein zweiter Versuch ------------------------------------------------
  await daily.reload();
  await daily.waitForSelector('#over:not([hidden])', { timeout: 5000 });
  const again = await daily.evaluate(() => ({
    stage: document.getElementById('over-stage').textContent,
    score: document.getElementById('over-score').textContent,
    moves: JSON.parse(localStorage.getItem('funkloch.taeglich')).moves.length,
  }));
  check(again.stage === String(plan.stage) && again.score === String(plan.score),
    'ein Neuladen zeigt dasselbe Ergebnis wieder');

  // Not merely hidden behind the card: the board itself refuses. Clicked with
  // force, so the overlay is not what is being tested here.
  const ids = await daily.$$eval('.board .node', (nodes) => nodes.map((n) => n.dataset.id));
  for (const id of ids.slice(0, 3)) {
    await daily.click(`.node[data-id="${id}"] .hit`, { force: true }).catch(() => {});
  }
  const denied = await daily.evaluate(() => ({
    stage: document.getElementById('over-stage').textContent,
    score: document.getElementById('over-score').textContent,
    moves: JSON.parse(localStorage.getItem('funkloch.taeglich')).moves.length,
    over: document.getElementById('over').hidden,
  }));
  check(denied.moves === again.moves, `kein Zug kommt hinzu (${denied.moves})`);
  check(denied.stage === String(plan.stage) && denied.score === String(plan.score),
    'und das Ergebnis bleibt stehen');
  check(denied.over === false, 'die Karte bleibt liegen');

  // --- zurück ins freie Spiel ----------------------------------------------
  await daily.click('#mode-frei');
  await daily.waitForSelector('.board .node');
  const back = await daily.evaluate(() => ({
    stage: document.getElementById('hud-stage').textContent,
    over: document.getElementById('over').hidden,
    pressed: document.getElementById('mode-frei').getAttribute('aria-pressed'),
    mode: localStorage.getItem('funkloch.modus'),
  }));
  check(back.pressed === 'true' && back.mode === 'frei', 'der Umschalter geht zurück auf Frei');
  check(back.stage === '1' && back.over === true, 'und das freie Spiel fängt wieder an');

  check(dailyNoise.length === 0,
    `keine Konsolenfehler im Tagesmodus${dailyNoise.length ? `: ${dailyNoise.join(' | ')}` : ''}`);
  await context.close();
} finally {
  await browser.close();
  server.kill();
}

console.log(failures.length === 0
  ? `\nAlles gut. Bilder in ${shots}/ui-board.png, ${shots}/ui-over.png und ${shots}/ui-daily.png`
  : `\n${failures.length} Prüfungen fehlgeschlagen.`);
process.exit(failures.length === 0 ? 0 : 1);
