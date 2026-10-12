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
 * the text the share button hands on carries the date, the levels cleared, the
 * points and one mark per level for the senders spared there, and nothing that
 * would spoil the board for whoever reads it — and that the button gets it out
 * by every route it has: the share sheet, the clipboard, or by hand.
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

import {
  advance, createRun, dailySeed, ENDLESS_RUN, freeSeed, levelsCleared, place, utcDay,
} from '../src/run.js';
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
 * `level` is the level the run ended in, as the HUD shows it; `cleared` is the
 * number of levels behind it, as the end card and the shared line count it.
 * @returns {{script: Array<object>, level: number, cleared: number, score: number,
 *            opening: number[]}}
 */
function planRun(from) {
  const moves = [];
  let run = createRun({ seed: from, config: ENDLESS_RUN });
  const dealt = [run.current, ...run.preview];
  while (run.status === 'playing' || run.status === 'levelCleared') {
    if (run.status === 'levelCleared') {
      moves.push({ go: true });
      run = advance(run);
      continue;
    }
    const id = lookaheadChoice(run);
    moves.push({ id: String(id) });
    run = place(run, id);
  }
  return {
    script: moves,
    level: run.level,
    cleared: levelsCleared(run),
    score: run.score,
    opening: dealt,
    // Senders left over on each cleared level, in order — what the shared
    // result has to draw.
    spared: run.cleared.map(({ left }) => left),
  };
}

// What the run should do, computed before the browser ever opens.
const { script, opening, ...expected } = planRun(seed);
console.log(`Seed ${seed}: erwartet Ende in Level ${expected.level}, ${expected.cleared} geschafft,`
  + ` ${expected.score} Punkte, ${script.length} Eingaben`);
check(expected.cleared === expected.level - 1,
  `wer in Level ${expected.level} scheitert, hat ${expected.cleared} geschafft`);

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
  // The level is a standing, not a best: it has no record of its own any more,
  // and the element that used to carry one is gone rather than merely emptied.
  check(await page.locator('#hud-level-best, #hud-stage-best').count() === 0,
    'das Level hat keinen eigenen Bestwert mehr');
  check((await page.evaluate(() => document.getElementById('hud-level')
    .closest('span').textContent.replace(/\s+/g, ' ').trim())) === 'Level 1',
    'die Kopfzeile sagt nur „Level 1"');
  // The rename is complete on the page, not only where this test looks.
  check(!/Etappe|Depot/.test(await page.evaluate(() => document.body.textContent)),
    'die Seite sagt nirgends mehr Etappe oder Depot');
  check(await page.locator('#hud-score-best').count() === 1,
    'der Bestwert hängt an den Punkten');

  const opaque = await page.locator('.node.is-blocked').count();
  const nodes = await page.locator('.node').count();
  console.log(`Brett 1: ${nodes} Knoten, ${opaque} davon undurchlässig`);
  // Level 1 is the onboarding board: small, and with senders to spare.
  check(nodes === 9, `Level 1 hat ${nodes} Knoten, das kleine Einstiegsbrett`);
  check(await page.textContent('#hud-left') === '6', `und ${await page.textContent('#hud-left')} Sender`);
  check(await page.textContent('#hud-open-label') === 'Funklöcher', 'die Statuszeile zählt Funklöcher');
  // The word the player reads for the stock of transmitters, and a rename that
  // misses one of its places leaves the page speaking two languages about the
  // same thing. Number first, label after — the order the race row settled on.
  check((await page.evaluate(() => document.getElementById('hud-left')
    .closest('.race-value').textContent.replace(/\s+/g, ' ').trim())).endsWith('Sender'),
    'die Rennzeile nennt die Sender, Zahl zuerst');

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
  check(head.numberPx >= 40, `die Rennzahlen messen ${head.numberPx}px`);
  check(head.order.join(',') === 'b,b', 'beide Werte nennen die Zahl vor dem Label');
  check(head.edges[0].left === 0 && head.edges[1].right === 0,
    'die beiden Werte sitzen an den Rändern');
  check(head.ruleW > 100, `die Trennlinie füllt die ${head.ruleW}px dazwischen`);
  check(await page.locator('.depot-label').count() === 0,
    'die Wörter in der Hand und danach sind weg');

  // The big numbers may not buy their size with height. Same method as the
  // mark below: the header as it stands against the same header with the
  // numbers put back to the 30px they had, measured in one layout.
  const sized = await page.evaluate(() => {
    const head = document.querySelector('.head');
    const numbers = [...document.querySelectorAll('.race-value b')];
    const big = head.getBoundingClientRect().height;
    for (const b of numbers) Object.assign(b.style, { fontSize: '30px', lineHeight: '1' });
    const small = head.getBoundingClientRect().height;
    for (const b of numbers) Object.assign(b.style, { fontSize: '', lineHeight: '' });
    return { big, small };
  });
  check(sized.big <= sized.small,
    `die Kopfzeile misst ${sized.big}px mit großen Zahlen, ${sized.small}px mit den alten`);

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

  // The mark in front of the level count is only allowed to sit *in* the row,
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
  // The onboarding board teaches one rule and carries nothing else: 5 % of 9
  // nodes rounds to no octagon. The octagons are checked on the board the
  // scripted run ends on, further down.
  check(opaque === 0, 'das erste Brett hat keine Achtecke');
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

  // --- edges you can see -----------------------------------------------------
  // Relative luminance as WCAG defines it, read off the computed colours. An
  // edge has to stand clearly off the background, lit or not, and still stay
  // under the node it leads to: the nodes are what is touched.
  const lum = (rgb) => {
    const [r, g, b] = rgb.match(/\d+/g).slice(0, 3).map((v) => {
      const c = Number(v) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
  const look = () => page.evaluate(() => {
    const style = (el) => (el ? getComputedStyle(el) : null);
    const edge = style(document.querySelector('.edge:not(.is-lit)'));
    const lit = style(document.querySelector('.edge.is-lit'));
    const node = style(document.querySelector('.node:not(.is-covered):not(.is-blocked) .dot'));
    const litNode = style(document.querySelector('.node.is-covered:not(.is-transmitter):not(.is-blocked) .dot'));
    return {
      bg: getComputedStyle(document.body).backgroundColor,
      edge: edge?.stroke, edgeW: parseFloat(edge?.strokeWidth),
      lit: lit?.stroke ?? null, litW: lit ? parseFloat(lit.strokeWidth) : null,
      node: node?.stroke, litNode: litNode?.fill ?? null,
    };
  });
  const bare = await look();
  check(contrast(bare.edge, bare.bg) >= 2.5,
    `eine Kante hebt sich ab: ${contrast(bare.edge, bare.bg).toFixed(2)}:1 gegen den Grund`);
  check(lum(bare.edge) < lum(bare.node),
    `und bleibt dunkler als der Knoten (${contrast(bare.node, bare.bg).toFixed(2)}:1)`);
  check(bare.edgeW >= 3, `Strichstärke ${bare.edgeW}`);

  const [standing, slow, viaKey] = boardIds;
  await page.click(`.node[data-id="${standing}"] .hit`);
  check(await isSender(standing) === 1, 'ein Tipp setzt den Sender');
  // Past the ripple and the 140ms transition, so the colours are the settled ones.
  await page.waitForTimeout(600);
  const lit = await look();
  check(lit.lit !== null && lit.litNode !== null, 'nach dem Setzen leuchten Kanten und Knoten');
  if (lit.lit !== null && lit.litNode !== null) {
    // Against the dark edge measured before the tap: on the small first board
    // one sender can light every edge there is.
    check(contrast(lit.lit, lit.bg) > contrast(bare.edge, lit.bg),
      `eine versorgte Kante (${contrast(lit.lit, lit.bg).toFixed(2)}:1) hebt sich von einer dunklen ab`);
    check(lum(lit.lit) < lum(lit.litNode),
      `und bleibt dunkler als der versorgte Knoten (${contrast(lit.litNode, lit.bg).toFixed(2)}:1)`);
    check(lit.litW > bare.edgeW, `und ist breiter (${lit.litW} gegen ${bare.edgeW})`);
  }

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

  // Back to a clean board: the scripted run below expects an untouched level 1.
  await page.reload();
  await page.waitForSelector('.board .node');
  check(await page.locator('.node.is-transmitter').count() === 0,
    'der Neustart räumt das Brett für den gespielten Lauf');

  let firstGo = true;
  for (const step of script) {
    if (step.go && firstGo) {
      // Level 1 just cleared, with senders to spare. They score nothing, and
      // the status line says how points work instead of counting them.
      firstGo = false;
      const after = await page.evaluate(() => ({
        status: document.getElementById('status').textContent,
        score: document.getElementById('hud-score').textContent,
      }));
      check(after.score === '0', `nach dem Einstiegsbrett stehen ${after.score} Punkte`);
      check(after.status === 'Level 1 geschafft. Ab jetzt bringt jeder übrige Sender Punkte.',
        `die Statuszeile erklärt die Punkte: ${after.status}`);
    }
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
    level: document.getElementById('hud-level').textContent,
    score: document.getElementById('hud-score').textContent,
    scoreBest: document.getElementById('hud-score-best').textContent,
    overTitle: document.querySelector('#over h2').textContent,
    overLabel: document.querySelector('#over-level').previousElementSibling.textContent,
    overLevel: document.getElementById('over-level').textContent,
    overScore: document.getElementById('over-score').textContent,
    overBest: document.getElementById('over-best').textContent,
    record: !document.getElementById('over-record').hidden,
    seedShown: !document.getElementById('over-seed').hidden,
    seedText: document.getElementById('over-seed-link').textContent,
    seedHref: document.getElementById('over-seed-link').getAttribute('href'),
    status: document.getElementById('status').textContent,
    stored: localStorage.getItem('funkloch.endlos.best'),
  }));
  await page.screenshot({ path: `${shots}/ui-over.png` });

  // --- octagons, on the board the run ended on ------------------------------
  // The first board has none any more, so they are checked here, behind the
  // card. An impermeable node is a different body, not an ordinary one with a
  // frame around it: the octagon carries hatching and the circle is gone from
  // under it. Both halves checked, because either one alone would still pass if
  // the node had quietly gone back to being a dot with decoration on top.
  const lastBoard = await page.evaluate(() => ({
    nodes: document.querySelectorAll('.node').length,
    opaque: document.querySelectorAll('.node.is-blocked').length,
  }));
  console.log(`Letztes Brett: ${lastBoard.nodes} Knoten, ${lastBoard.opaque} davon undurchlässig`);
  check(lastBoard.opaque === Math.round(lastBoard.nodes * ENDLESS_RUN.blockedRatio) && lastBoard.opaque > 0,
    'Blockaden nach Dichte gesetzt');
  check(await page.locator('.node.is-blocked .shell-plate').count() === lastBoard.opaque,
    'jede Blockade ist ein Achteck');
  check(await page.locator('.node.is-blocked .shell-hatch line').count() >= lastBoard.opaque * 5,
    'und schraffiert');
  check(await page.locator('.node:not(.is-blocked) .shell-plate').count() === 0,
    'gewöhnliche Knoten tragen keins');
  check(await page.evaluate(() => {
    const node = document.querySelector('.node.is-blocked');
    return node ? getComputedStyle(node.querySelector('.dot')).display : null;
  }) === 'none', 'der runde Punkt tritt dafür zurück');

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
  check(wordmark?.aboveList === true, 'er steht über Level, Punkten und Bestwert');

  check(seen.overTitle === 'Keine Sender mehr.', `Karte betitelt sich „${seen.overTitle}"`);
  // The card counts what was cleared, the HUD what was being played: whoever
  // fails in level 10 has cleared 9, and both numbers say so side by side.
  check(seen.overLabel === 'Level geschafft', `die Karte beschriftet „${seen.overLabel}"`);
  check(seen.overLevel === String(expected.cleared),
    `Karte zeigt ${seen.overLevel} Level geschafft`);
  check(seen.overScore === String(expected.score), `Karte zeigt ${seen.overScore} Punkte`);
  check(seen.level === String(expected.level), `HUD steht auf Level ${seen.level}, dem gescheiterten`);
  check(seen.score === String(expected.score), `HUD-Punkte ${seen.score}`);
  check(seen.scoreBest === `best ${expected.score}`, `HUD-Rekord ${seen.scoreBest}`);
  check(seen.overBest === `${expected.score} Punkte`, `Karte zeigt Bestwert ${seen.overBest}`);
  check(seen.record === true, 'der erste Lauf ist ein Bestwert');
  check(seen.status === '', 'die Statuszeile schweigt beim Verlieren');
  check(seen.seedShown && seen.seedText === String(seed) && seen.seedHref === `?seed=${seed}`,
    `die Karte nennt die Partie: ${seen.seedText} → ${seen.seedHref}`);
  // Only the score is kept; the level record is not written back in any shape.
  // The scale travels with it, so a later change to the scoring can tell what
  // it is looking at instead of guessing.
  check(seen.stored === JSON.stringify({ score: expected.score, scale: 1 }),
    `gespeichert: ${seen.stored}`);

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
    level: document.getElementById('hud-level').textContent,
    scoreBest: document.getElementById('hud-score-best').textContent,
    over: document.getElementById('over').hidden,
  }));
  check(after.scoreBest === `best ${expected.score}`, `Punkterekord überlebt: ${after.scoreBest}`);
  check(after.level === '1', 'die neue Partie steht auf Level 1');
  check(after.over === true, 'die Karte ist wieder weg');

  // --- ein Bestwert von einer anderen Skala ---------------------------------
  // Unmarked is from before the leftovers were weighted by level; `scale: 2` is
  // from the build that showed them halved. Neither is the number this page
  // draws, so neither may be shown, however large it is — and the same goes for
  // a marker from any other build.
  for (const [stored, what] of [
    [{ score: 9999 }, 'ohne Skalenkennzeichen'],
    [{ score: 9999, scale: 2 }, 'von der halbiert angezeigten Skala'],
    [{ score: 9999, scale: 3 }, 'von einer fremden Skala'],
  ]) {
    await page.evaluate(
      (value) => localStorage.setItem('funkloch.endlos.best', JSON.stringify(value)),
      stored,
    );
    await page.reload();
    await page.waitForSelector('.board .node');
    check(await page.textContent('#hud-score-best') === '',
      `ein Bestwert ${what} wird verworfen statt angezeigt`);
  }

  check(noise.length === 0, `keine Konsolenfehler${noise.length ? `: ${noise.join(' | ')}` : ''}`);

  // --- der Seed einer freien Partie ----------------------------------------
  // No `?seed=` and a stopped clock: the free run takes its seed from the time,
  // the card names it, and following the card's link deals the same boards.
  {
    const startedAt = Date.UTC(2026, 9, 12, 17, 4, 31, 250);
    const free = await browser.newContext({ viewport: { width: 560, height: 960 } });
    const tab = await free.newPage();
    // Fixed, not merely installed: an installed clock keeps ticking while the
    // page loads, and the seed would be taken some milliseconds later.
    await tab.clock.setFixedTime(new Date(startedAt));
    await tab.goto(`http://127.0.0.1:${port}/index.html`);
    await tab.waitForSelector('.board .node');
    const shape = () => tab.$$eval('.board .node',
      (nodes) => nodes.map((n) => `${n.dataset.id}${n.classList.contains('is-blocked') ? '!' : ''}`).join(' '));
    const first = {
      seed: await tab.textContent('#over-seed-link'),
      href: await tab.getAttribute('#over-seed-link', 'href'),
      board: await shape(),
    };
    check(first.seed === String(freeSeed(startedAt)),
      `die freie Partie hat ihren Seed aus der Uhr: ${first.seed}`);

    // The card is hidden while the run is on; the link is the same one it
    // will show, so it is followed from script rather than by a click.
    await Promise.all([
      tab.waitForURL(/\?seed=\d+$/),
      tab.evaluate(() => document.getElementById('over-seed-link').click()),
    ]);
    await tab.waitForSelector('.board .node');
    check(new URL(tab.url()).search === first.href, `der Link führt auf ${new URL(tab.url()).search}`);
    check(await shape() === first.board, 'und teilt dasselbe Brett noch einmal aus');

    // A new run a few seconds later is a different run with a different seed.
    await tab.goto(`http://127.0.0.1:${port}/index.html`);
    await tab.waitForSelector('.board .node');
    await tab.clock.setFixedTime(new Date(startedAt + 5000));
    await tab.evaluate(() => document.getElementById('restart').click());
    await tab.waitForSelector('.board .node');
    const later = await tab.textContent('#over-seed-link');
    check(later === String(freeSeed(startedAt + 5000)) && later !== first.seed,
      `Neue Partie fünf Sekunden später: Seed ${later}`);
    await free.close();
  }

  // --- das Tagesbrett ------------------------------------------------------
  // A fixed clock, so "today" is a day we know, and its board and its whole
  // planned run are known before the page opens. Noon UTC: far enough from
  // both midnights that nothing here depends on how long the run takes.
  const day = Date.UTC(2026, 8, 24, 12, 0, 0);
  const plan = planRun(dailySeed(day));
  console.log(`Tagesbrett ${utcDay(day)}: erwartet ${plan.cleared} Level geschafft,`
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

  // An attempt at today's board stored by the build before the onboarding
  // level: no rules marker, and moves made on yesterday's 18-node level 1.
  // Replayed, they would name nodes that may not exist on today's first
  // board, so the page has to set the attempt aside rather than rebuild a run
  // from them.
  await daily.evaluate((today) => localStorage.setItem('funkloch.taeglich', JSON.stringify({
    day: today, moves: ['r9c9', 'r8c8', null, 'r7c7'], stage: 3, score: 12, done: true,
  })), utcDay(day));

  await daily.click('#mode-taeglich');
  await daily.waitForSelector('.board .node');
  check(await daily.getAttribute('#mode-taeglich', 'aria-pressed') === 'true',
    'der Umschalter steht auf Täglich');
  const fresh = await daily.evaluate(() => ({
    over: document.getElementById('over').hidden,
    level: document.getElementById('hud-level').textContent,
    left: document.getElementById('hud-left').textContent,
    stored: JSON.parse(localStorage.getItem('funkloch.taeglich')),
  }));
  check(fresh.over === true && fresh.level === '1' && fresh.left === '6',
    'ein Versuch aus der Zeit vor dem Einstiegsbrett wird nicht nachgespielt');
  check(fresh.stored?.rules === 2 && fresh.stored?.moves.length === 0,
    `der neue Versuch trägt sein Regelkennzeichen (${fresh.stored?.rules})`);
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
    level: document.getElementById('over-level').textContent,
    score: document.getElementById('over-score').textContent,
    bestShown: !document.getElementById('over-best').hidden,
    restartShown: !document.getElementById('restart').hidden,
    seedShown: !document.getElementById('over-seed').hidden,
    dailyShown: !document.getElementById('over-daily').hidden,
    countdown: document.getElementById('countdown').textContent,
    stored: JSON.parse(localStorage.getItem('funkloch.taeglich')),
  }));
  check(ended.level === String(plan.cleared), `Tageskarte zeigt ${ended.level} Level geschafft`);
  check(ended.score === String(plan.score), `Tageskarte zeigt ${ended.score} Punkte`);
  check(ended.restartShown === false, 'die Tageskarte bietet keine neue Partie an');
  check(ended.dailyShown === true, 'sie zeigt stattdessen Ergebnis und Wartezeit');
  check(ended.bestShown === false, 'und keinen Bestwert aus dem freien Spiel');
  check(ended.seedShown === false, 'und keinen Seed, über den sich das Brett nachspielen ließe');
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
  check(ended.stored?.levelsCleared === plan.cleared && !('stage' in (ended.stored ?? {})),
    `und mit ${ended.stored?.levelsCleared} geschafften Level, ohne altes stage-Feld`);
  // Same reason as the card above: shooting through the fade photographs a
  // half-transparent card and looks like a stacking bug.
  await daily.locator('#over').evaluate((card) =>
    Promise.all(card.getAnimations().map((animation) => animation.finished)));
  await daily.screenshot({ path: `${shots}/ui-daily.png` });

  // --- das geteilte Ergebnis -----------------------------------------------
  // The expectation is built here from the planned run, not by importing
  // share.js: a test that borrows the page's own formatter would agree with
  // it however wrong it was. One mark per level for the senders spared there —
  // · none, ○ one, ● two or more — a cross where the run ended, and nothing for
  // the onboarding level, which scores nothing and every run clears. It still
  // counts in the header.
  const pointsWord = plan.score === 1 ? 'Punkt' : 'Punkte';
  // The name as the wordmark draws it, with the ring for the o.
  const expectedHeader = `funkl○ch 24.09. — ${plan.cleared} Level geschafft, ${plan.score} ${pointsWord}`;
  const expectedMarks = [...plan.spared.slice(1).map((left) => (left === 0 ? '·' : left === 1 ? '○' : '●')), '×'];
  console.log(`erwartet: ${expectedMarks.join('')}`);

  const button = await daily.evaluate(() => {
    const share = document.getElementById('share');
    return { tag: share?.tagName ?? null, label: share?.textContent, visible: share?.offsetParent !== null };
  });
  check(button.tag === 'BUTTON' && button.visible, 'der Teilen-Knopf ist da und sichtbar');
  check(button.label === 'Ergebnis teilen', `er heißt „${button.label}"`);

  /** Clicks share and waits for the button to answer, which it does once the
   *  asynchronous share or copy has settled. */
  const pressShare = async () => {
    await daily.evaluate(() => { document.getElementById('share').dataset.before = document.getElementById('share').textContent; });
    await daily.click('#share');
    await until(daily, () => {
      const share = document.getElementById('share');
      return share.textContent !== share.dataset.before || window.__shareSettled === true;
    }, 2000);
    return daily.evaluate(() => ({
      text: document.getElementById('share-line').textContent,
      shown: !document.getElementById('share-line').hidden,
      label: document.getElementById('share').textContent,
      sent: window.__shared ?? null,
    }));
  };

  // 1. The native sheet. Stubbed, because a headless browser has none; the
  //    stub records what it was handed, which is the point of the check.
  await daily.evaluate(() => {
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async (data) => { window.__shared = data.text; },
    });
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true });
  });
  const viaSheet = await pressShare();
  check(viaSheet.sent !== null, 'der Knopf öffnet die Teilen-Auswahl');
  check(viaSheet.label === 'Geteilt.', `und meldet: ${viaSheet.label}`);
  check(viaSheet.shown === false, 'der Text bleibt dabei verborgen');

  const lines = (viaSheet.sent ?? '').split('\n');
  // Header, the block lines, and the game's address last. Spelled out here
  // rather than imported from share.js, for the same reason as the marks.
  const body = lines.slice(1, -1);
  check(lines[0] === expectedHeader, `Kopfzeile: ${lines[0]}`);
  check(lines.at(-1) === 'funkloch.vercel.app', `letzte Zeile: ${lines.at(-1)}`);
  check((viaSheet.sent ?? '').includes('funkloch.vercel.app'), 'der geteilte Text enthält die URL');
  check(lines[0].includes('24.09.'), 'sie nennt das Datum');
  check(lines[0].includes(`${plan.cleared} Level geschafft`), 'sie nennt die geschafften Level');
  check(lines[0].includes(`${plan.score} ${pointsWord}`), `sie nennt die Punkte (${pointsWord}; „1 Punkt" prüft test/share.test.js)`);
  // The spaces only group the marks in fives; taken out, one character is one
  // level.
  const marks = [...body.join('').replace(/\s/g, '')];
  check(marks.join('') === expectedMarks.join(''),
    `die Zeichen entsprechen den gesparten Sendern ab Level 2: ${body.join(' / ')}`);
  check(body.every((line) => line.split(' ').every((group) => group.length <= 5)),
    'in Fünfergruppen');
  check(marks.every((mark) => /^[·○●×]$/.test(mark)), 'ein Zeichen je Level, nur · ○ ● und ×');
  // Nothing that would hand the reader the board, let alone the moves.
  check(!/r\d+c\d+/.test(viaSheet.sent ?? ''), 'es verrät keinen Knoten');

  // 2. The sheet closed without sharing: that is the player's answer, so the
  //    button goes back to rest and nothing is copied behind their back.
  await daily.evaluate(async () => {
    await navigator.clipboard.writeText('unberührt');
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async () => { window.__shareSettled = true; throw new DOMException('closed', 'AbortError'); },
    });
  });
  const closed = await pressShare();
  check(closed.label === 'Ergebnis teilen', `eine geschlossene Auswahl setzt den Knopf zurück (${closed.label})`);
  check(await daily.evaluate(() => navigator.clipboard.readText().catch(() => null)) === 'unberührt',
    'und kopiert nicht heimlich');

  // 3. No share sheet at all: straight to the clipboard, and say so.
  await daily.evaluate(() => {
    window.__shareSettled = false;
    Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
  });
  const viaClip = await pressShare();
  const clip = await daily.evaluate(() => navigator.clipboard.readText().catch(() => null));
  check(viaClip.label === 'Kopiert.', `ohne Teilen-Auswahl wird kopiert: ${viaClip.label}`);
  check(clip === viaSheet.sent, 'derselbe Text liegt in der Zwischenablage');

  // 4. Neither works: the text is laid out to be selected by hand.
  await daily.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: () => Promise.reject(new DOMException('no', 'NotAllowedError')) },
    });
    document.execCommand = () => false;
  });
  const byHand = await pressShare();
  check(byHand.shown === true && byHand.text === viaSheet.sent,
    'geht beides nicht, steht der Text zum Markieren da');
  check(byHand.label.startsWith('Kopieren ging nicht'), `und der Knopf sagt es: ${byHand.label}`);
  await daily.screenshot({ path: `${shots}/ui-share.png` });

  // --- ein zweiter Versuch ------------------------------------------------
  await daily.reload();
  await daily.waitForSelector('#over:not([hidden])', { timeout: 5000 });
  const again = await daily.evaluate(() => ({
    level: document.getElementById('over-level').textContent,
    score: document.getElementById('over-score').textContent,
    moves: JSON.parse(localStorage.getItem('funkloch.taeglich')).moves.length,
  }));
  check(again.level === String(plan.cleared) && again.score === String(plan.score),
    'ein Neuladen zeigt dasselbe Ergebnis wieder');

  // Not merely hidden behind the card: the board itself refuses. Clicked with
  // force, so the overlay is not what is being tested here.
  const ids = await daily.$$eval('.board .node', (nodes) => nodes.map((n) => n.dataset.id));
  for (const id of ids.slice(0, 3)) {
    await daily.click(`.node[data-id="${id}"] .hit`, { force: true }).catch(() => {});
  }
  const denied = await daily.evaluate(() => ({
    level: document.getElementById('over-level').textContent,
    score: document.getElementById('over-score').textContent,
    moves: JSON.parse(localStorage.getItem('funkloch.taeglich')).moves.length,
    over: document.getElementById('over').hidden,
  }));
  check(denied.moves === again.moves, `kein Zug kommt hinzu (${denied.moves})`);
  check(denied.level === String(plan.cleared) && denied.score === String(plan.score),
    'und das Ergebnis bleibt stehen');
  check(denied.over === false, 'die Karte bleibt liegen');

  // --- zurück ins freie Spiel ----------------------------------------------
  await daily.click('#mode-frei');
  await daily.waitForSelector('.board .node');
  const back = await daily.evaluate(() => ({
    level: document.getElementById('hud-level').textContent,
    over: document.getElementById('over').hidden,
    pressed: document.getElementById('mode-frei').getAttribute('aria-pressed'),
    mode: localStorage.getItem('funkloch.modus'),
  }));
  check(back.pressed === 'true' && back.mode === 'frei', 'der Umschalter geht zurück auf Frei');
  check(back.level === '1' && back.over === true, 'und das freie Spiel fängt wieder an');

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
