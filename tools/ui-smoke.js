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
 * page opens on it after every reload — attempt open or spent, free play left
 * active or not — with free play one tap away, that the
 * same Berlin day gives the same board in two separate browsers in different
 * time zones, that the board changes at Berlin midnight, that a second
 * attempt at it is refused however the page is reloaded or clicked, and that
 * the text the share button hands on carries the date, the levels cleared, the
 * points and the address, and nothing that would spoil the board for whoever
 * reads it — and that the button gets it out
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
import { createServer } from 'node:net';
import { chromium } from 'playwright';

import {
  advance, createRun, DAILY_RUN, dailySeed, ENDLESS_RUN, freeSeed, levelsCleared, place,
} from '../src/run.js';
import { lookaheadChoice } from './bot64.js';
import { rolloutChoice } from './plateau.js';
import { LEADERBOARD } from '../src/leaderboard.js';
import { GAME_URL } from '../src/share.js';

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
 * Plays a whole run with a bot — the planner unless told otherwise — and
 * writes down what it did, so the browser can be asked to reproduce it click
 * for click and the expected numbers are known before the page is ever opened.
 * @param {number} from the seed the run starts from
 * @param {object} [config] ENDLESS_RUN for free play, DAILY_RUN for the daily board
 * @param {(state: object) => *} [choose]
 * `level` is the level the run ended in, as the HUD shows it; `cleared` is the
 * number of levels behind it, as the end card and the shared line count it.
 * @returns {{script: Array<object>, level: number, cleared: number, score: number,
 *            opening: number[], status: string}}
 */
function planRun(from, config = ENDLESS_RUN, choose = lookaheadChoice) {
  const moves = [];
  let run = createRun({ seed: from, config });
  const dealt = [run.current, ...run.preview];
  while (run.status === 'playing' || run.status === 'levelCleared') {
    if (run.status === 'levelCleared') {
      moves.push({ go: true });
      run = advance(run);
      continue;
    }
    const id = choose(run);
    moves.push({ id: String(id) });
    run = place(run, id);
  }
  return {
    script: moves,
    level: run.level,
    cleared: levelsCleared(run),
    score: run.score,
    opening: dealt,
    status: run.status,
  };
}

/** Every request the page may make to the leaderboard's server. */
const API = `${LEADERBOARD.baseUrl}/**`;

/**
 * Keeps a page off the real leaderboard: anything it asks of the server is
 * written down and refused. A page that has not been asked to show the
 * leaderboard must leave this list empty.
 * @param {import('playwright').Page|import('playwright').BrowserContext} target
 * @param {string[]} log
 */
const guardApi = (target, log) => target.route(API, (route) => {
  log.push(`${route.request().method()} ${route.request().url()}`);
  return route.abort();
});

/**
 * A stand-in for the PocketBase collection, answering the requests
 * src/leaderboard.js makes: a day's list sorted -level,-points,created, the
 * count of those ahead of a result, and a create with the unique index on
 * (date, client_id). Written from the request shapes, not by importing the
 * module's own helpers, so the two cannot agree by accident. `fail(true)`
 * makes it answer 503 to everything.
 */
function fakeLeaderboard() {
  const records = [];
  const requests = [];
  let next = 1;
  let failing = false;
  const reply = (route, status, body) => route.fulfill({
    status,
    contentType: 'application/json',
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'content-type',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
    },
    body: body === undefined ? '' : JSON.stringify(body),
  });
  const handle = async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return reply(route, 204);
    requests.push({ method: request.method(), url: request.url(), body: request.postData() });
    if (failing) return reply(route, 503, { message: 'unavailable' });
    if (request.method() === 'POST') {
      const body = JSON.parse(request.postData() ?? '{}');
      if (records.some((r) => r.date === body.date && r.client_id === body.client_id)) {
        return reply(route, 400, { data: { client_id: { code: 'validation_not_unique' } } });
      }
      const record = { id: `rec${next++}`, ...body };
      records.push(record);
      return reply(route, 200, { id: record.id });
    }
    const url = new URL(request.url());
    const filter = url.searchParams.get('filter') ?? '';
    const day = filter.match(/date>="(\d{4}-\d{2}-\d{2})" && date<"(\d{4}-\d{2}-\d{2})"/);
    const ahead = filter.match(/level>(\d+) \|\| \(level=(\d+) && points>(\d+)\)/);
    let rows = records.filter((r) => day !== null && r.date >= day[1] && r.date < day[2]);
    if (ahead) {
      const [l, p] = [Number(ahead[2]), Number(ahead[3])];
      rows = rows.filter((r) => r.level > l || (r.level === l && r.points > p));
    }
    rows = [...rows].sort((a, b) => b.level - a.level || b.points - a.points);
    const fields = (url.searchParams.get('fields') ?? '').split(',');
    const items = rows.slice(0, Number(url.searchParams.get('perPage')))
      .map((r) => Object.fromEntries(fields.map((f) => [f, r[f]])));
    return reply(route, 200, { items, totalItems: rows.length });
  };
  const seed = (rows) => {
    for (const row of rows) records.push({ id: `rec${next++}`, client_id: `fremd-${next}`, ...row });
  };
  return { handle, records, requests, seed, fail: (on) => { failing = on; } };
}

// What the run should do, computed before the browser ever opens.
const { script, opening, ...expected } = planRun(seed);
console.log(`Seed ${seed}: erwartet Ende in Level ${expected.level}, ${expected.cleared} geschafft,`
  + ` ${expected.score} Punkte, ${script.length} Eingaben`);
check(expected.cleared === expected.level - 1,
  `wer in Level ${expected.level} scheitert, hat ${expected.cleared} geschafft`);

// A commit for the server to report as Vercel would, so the version line has
// something to show. Made up: the test is about the wiring, not about git.
const commit = '0123456789abcdef0123456789abcdef01234567';

/**
 * Why the port cannot be had, or null if it is free. Asked before the server
 * is started: a server left over from an earlier run — or anything else on
 * the port — would otherwise answer in place of ours, and the whole run would
 * test whatever code that server was started with.
 * @returns {Promise<string|null>}
 */
const portBlocked = () => new Promise((resolve) => {
  const probe = createServer();
  probe.once('error', (error) => resolve(error.code ?? String(error)));
  probe.once('listening', () => probe.close(() => resolve(null)));
  probe.listen(port, '127.0.0.1');
});
const blocked = await portBlocked();
if (blocked !== null) {
  console.error(`Port ${port} ist nicht frei (${blocked}). Läuft noch ein Server von einem`
    + ` früheren Lauf? Beenden, oder einen anderen Port wählen: --port=…`);
  process.exit(2);
}

const server = spawn(process.execPath, ['tools/serve.js', `--port=${port}`], {
  stdio: 'ignore',
  env: { ...process.env, VERCEL_GIT_COMMIT_SHA: commit },
});
// Whatever ends this process takes the server with it — a failed check's
// process.exit, a browser that will not start, any error thrown before the
// `finally` below is reached. Without this a crash in `chromium.launch()`
// left the server running, and the next run tested against it.
process.on('exit', () => server.kill());

/**
 * Waits until *our* server answers: the version it reports is the made-up
 * commit it was started with, which no other server on the port would know.
 */
async function serverReady(ms = 5000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) break;
    try {
      const answer = await fetch(`http://127.0.0.1:${port}/api/version`);
      if ((await answer.json()).commit === commit) return;
    } catch {
      /* not listening yet */
    }
    await new Promise((resume) => setTimeout(resume, 50));
  }
  throw new Error(`der Testserver auf Port ${port} antwortet nicht`
    + (server.exitCode !== null ? ` (beendet mit ${server.exitCode})` : ''));
}

let browser = null;
try {
  await serverReady();
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 560, height: 960 } });
  const noise = [];
  page.on('pageerror', (error) => noise.push(String(error)));
  page.on('console', (message) => message.type() === 'error' && noise.push(message.text()));
  /** What free play asked of the leaderboard's server: it must ask nothing. */
  const freeApi = [];
  await guardApi(page, freeApi);

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

  // --- der laufende Stand ---------------------------------------------------
  // Under the hint and last on the page, never in the header.
  await until(page, () => !document.getElementById('version').hidden, 3000);
  const version = await page.evaluate(() => {
    const line = document.getElementById('version');
    const hint = document.querySelector('.hint');
    return {
      shown: !line.hidden && line.offsetParent !== null,
      text: line.textContent,
      title: document.getElementById('version-commit').title,
      // Below the hint and the last thing on the page that is drawn: the
      // privacy link sits between the two, the closed leaderboard dialog after.
      afterHint: Boolean(hint.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING)
        && [...line.parentElement.children].filter((el) => el.offsetParent !== null).at(-1) === line,
      inHeader: line.closest('.head') !== null,
      size: Number.parseFloat(getComputedStyle(line).fontSize),
    };
  });
  check(version.shown && version.text === `Stand ${commit.slice(0, 7)}`,
    `die Seite nennt den laufenden Stand: ${version.text}`);
  check(version.title === commit, 'der ganze Hash steht im Tooltip');
  check(version.afterHint && !version.inHeader, 'unter dem Hilfetext, am Ende der Seite, nicht in der Kopfzeile');
  check(version.size < 14, `kleiner als der Hilfetext (${version.size}px)`);

  // --- one record, not two -------------------------------------------------
  // The level is a standing, not a best: it has no record of its own any more,
  // and the element that used to carry one is gone rather than merely emptied.
  check(await page.locator('#hud-level-best, #hud-stage-best').count() === 0,
    'das Level hat keinen eigenen Bestwert mehr');
  // innerText, what is read: the goal is there but hidden in free play.
  check((await page.evaluate(() => document.getElementById('hud-level')
    .closest('span').innerText.replace(/\s+/g, ' ').trim())) === 'Level 1',
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

  // --- the link preview ------------------------------------------------------
  // What a chat shows next to the shared address. The tags have to be there
  // and absolute — preview services resolve nothing relative — and every icon
  // the head or the manifest names has to come back from the server.
  const preview = await page.evaluate(() => {
    const get = (selector) => document.querySelector(selector)?.getAttribute('content') ?? null;
    return {
      title: get('meta[property="og:title"]'),
      description: get('meta[property="og:description"]'),
      url: get('meta[property="og:url"]'),
      image: get('meta[property="og:image"]'),
      type: get('meta[property="og:type"]'),
      card: get('meta[name="twitter:card"]'),
      twitterImage: get('meta[name="twitter:image"]'),
    };
  });
  check(preview.title === 'Funkloch' && preview.type === 'website' && preview.card === 'summary_large_image',
    `Vorschau-Tags: ${preview.title}, ${preview.type}, ${preview.card}`);
  check(Boolean(preview.description), `mit Beschreibung: ${preview.description}`);
  check([preview.url, preview.image, preview.twitterImage].every((u) => /^https:\/\//.test(u ?? '')),
    `og:url, og:image und twitter:image sind absolut (${preview.image})`);
  check(preview.url === `${GAME_URL}/`, `og:url ist die geteilte Adresse: ${preview.url}`);
  const assets = ['favicon.svg', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'manifest.webmanifest', 'og-image.png'];
  for (const asset of assets) {
    const response = await page.request.get(`http://127.0.0.1:${port}/${asset}`);
    const type = response.headers()['content-type'] ?? '';
    check(response.status() === 200 && /image|manifest/.test(type), `${asset} kommt an (${response.status()}, ${type})`);
  }
  const size = await page.evaluate(() => new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(`${image.naturalWidth}×${image.naturalHeight}`);
    image.onerror = () => resolve('Fehler');
    image.src = './og-image.png';
  }));
  check(size === '1200×630', `das Vorschaubild misst ${size}`);

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

  // The digit is the information on the card, so it sits in the centre at a
  // size that reads mid-game, and the rings go round it. The small card grew
  // from 44 to 48px for it; what it may not do is grow the header. Same
  // method as the mark below: the header as it stands against the same header
  // with the small cards put back to 44, measured in one layout.
  const digits = await page.evaluate(() => {
    const head = document.querySelector('.head');
    const small = [...document.querySelectorAll('.chip.next')];
    const now = head.getBoundingClientRect().height;
    for (const chip of small) Object.assign(chip.style, { width: '44px', height: '44px' });
    const old = head.getBoundingClientRect().height;
    for (const chip of small) Object.assign(chip.style, { width: '', height: '' });
    return {
      now,
      old,
      placed: [...document.querySelectorAll('.chip-digit')].map((digit) => {
        const chip = digit.closest('.chip').getBoundingClientRect();
        const box = digit.getBoundingClientRect();
        return {
          // The glyph's centre against the card's, in px; the glyph box is the
          // em box, so it hangs a little below the cap height it is set by.
          dx: Math.round(box.left + box.width / 2 - (chip.left + chip.width / 2)),
          units: parseFloat(getComputedStyle(digit).fontSize),
        };
      }),
    };
  });
  check(digits.now === digits.old,
    `die Kopfzeile misst ${digits.now}px mit 48er-Karten, ${digits.old}px mit 44er-Karten`);
  check(digits.placed.length === 3 && digits.placed.every((d) => Math.abs(d.dx) <= 1),
    `die Ziffern stehen in der Kartenmitte (Abweichung ${digits.placed.map((d) => d.dx).join(', ')}px)`);
  check(digits.placed.every((d) => d.units >= 16),
    `und messen ${digits.placed[0]?.units} Einheiten, nicht mehr 9`);

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

  // --- a tap goes to the nearest node ---------------------------------------
  // On this board the 44px targets overlap almost entirely, and hit-testing by
  // element used to hand the tap to whichever node was drawn last. Pressed
  // along the line between every pair of overlapping targets; the node that
  // shows the press has to be the nearest one whose target contains the point.
  // Behind the card, which is lifted for the moment: the run is over, so the
  // release places nothing.
  const targets = await page.evaluate(() => {
    document.getElementById('over').style.visibility = 'hidden';
    return [...document.querySelectorAll('.node:not(.is-forbidden) .hit')].map((hit) => {
      const box = hit.getBoundingClientRect();
      return { id: hit.closest('.node').dataset.id, x: box.left + box.width / 2, y: box.top + box.height / 2, reach: box.width / 2 };
    });
  });
  const nearestTarget = (x, y) => {
    let best = null;
    for (const t of targets) {
      const d = Math.hypot(t.x - x, t.y - y);
      if (d <= t.reach && (best === null || d < best.d)) best = { id: t.id, d };
    }
    return best?.id ?? null;
  };
  const probes = [];
  for (let i = 0; i < targets.length; i++) {
    for (let j = i + 1; j < targets.length; j++) {
      const a = targets[i]; const b = targets[j];
      if (Math.hypot(a.x - b.x, a.y - b.y) >= a.reach + b.reach) continue;
      for (const t of [0.3, 0.45, 0.55, 0.7]) probes.push([a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t]);
    }
  }
  let wrongHits = 0;
  for (const [x, y] of probes) {
    await page.mouse.move(x, y);
    await page.mouse.down();
    const pressed = await page.evaluate(() => document.querySelector('.node.is-pressed')?.dataset.id ?? null);
    await page.mouse.up();
    if (pressed !== nearestTarget(x, y)) wrongHits++;
  }
  await page.evaluate(() => { document.getElementById('over').style.visibility = ''; });
  check(probes.length >= 20, `${probes.length} Druckpunkte zwischen überlappenden Trefferflächen`);
  check(wrongHits === 0, `davon ${wrongHits} am falschen Knoten: der nächste gewinnt`);
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
  // The card names the level the run ended in, as the HUD did when it ended:
  // one number for one run (until 2026-11-10 the card counted the levels
  // cleared, one fewer). Free play has no goal, so no "von".
  check(seen.overLabel === 'Level', `die Karte beschriftet „${seen.overLabel}"`);
  check(seen.overLevel === String(expected.level),
    `Karte zeigt Level ${seen.overLevel}, das Level, in dem die Partie endete`);
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
  // A whole free run, its end card and several reloads, and not one request:
  // free play neither reads nor writes the leaderboard, and no start does.
  check(freeApi.length === 0, `das freie Spiel fragt die Rangliste nie an${freeApi.length ? `: ${freeApi[0]}` : ''}`);
  check(await page.isHidden('#enter'), 'die Endkarte des freien Spiels bietet kein Eintragen an');

  // --- der Seed einer freien Partie ----------------------------------------
  // No `?seed=` and a stopped clock: the free run takes its seed from the time,
  // the card names it, and following the card's link deals the same boards.
  {
    const startedAt = Date.UTC(2026, 9, 12, 17, 4, 31, 250);
    const free = await browser.newContext({ viewport: { width: 560, height: 960 } });
    const seedApi = [];
    await guardApi(free, seedApi);
    const tab = await free.newPage();
    // Fixed, not merely installed: an installed clock keeps ticking while the
    // page loads, and the seed would be taken some milliseconds later.
    await tab.clock.setFixedTime(new Date(startedAt));
    await tab.goto(`http://127.0.0.1:${port}/index.html`);
    await tab.waitForSelector('.board .node');
    // Without a seed the page opens on the daily board; free play is the
    // switch in the header.
    await tab.click('#mode-frei');
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
    await tab.click('#mode-frei');
    await tab.waitForSelector('.board .node');
    await tab.clock.setFixedTime(new Date(startedAt + 5000));
    await tab.evaluate(() => document.getElementById('restart').click());
    await tab.waitForSelector('.board .node');
    const later = await tab.textContent('#over-seed-link');
    check(later === String(freeSeed(startedAt + 5000)) && later !== first.seed,
      `Neue Partie fünf Sekunden später: Seed ${later}`);
    check(seedApi.length === 0, `Starts mit und ohne Seed fragen die Rangliste nicht an (${seedApi.length})`);
    await free.close();
  }

  // --- das Tagesbrett ------------------------------------------------------
  // A fixed clock, so "today" is a day we know, and its board and its whole
  // planned run are known before the page opens. Noon UTC is 14:00 in Berlin
  // (summer time, UTC+2): far enough from midnight that nothing here depends on
  // how long the run takes. Dates and midnights are written out as the known
  // facts they are, not asked of run.js, so the test does not grade itself.
  const day = Date.UTC(2026, 8, 24, 12, 0, 0);
  const dayName = '2026-09-24';
  const berlinMidnight = Date.UTC(2026, 8, 24, 22); // 2026-09-25 00:00 CEST
  const plan = planRun(dailySeed(day), DAILY_RUN);
  console.log(`Tagesbrett ${dayName}: erwartet ${plan.cleared} Level geschafft,`
    + ` ${plan.score} Punkte, ${plan.script.length} Eingaben`);
  // This pass is about the card for a run that ran out; the one played
  // through has its own pass below.
  check(plan.status === 'lost', `der Planer verliert das Tagesbrett vom ${dayName} (${plan.status})`);

  const context = await browser.newContext({ viewport: { width: 560, height: 960 } });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'],
    { origin: `http://127.0.0.1:${port}` });
  // The day's leaderboard, already well filled: twelve results ahead of the
  // planned run's, two of them tied on level and points, two on level only —
  // entered in the wrong order, so that only the points put them right — and
  // one name that would be an image if it were ever read as markup.
  const board = fakeLeaderboard();
  const injected = '<img src=x onerror="window.__injected=1">';
  board.seed([
    ['Spieler 1', 20, 60], ['Spieler 2', 19, 59], ['Gleich A', 18, 57], ['Gleich B', 18, 57],
    ['Spieler 5', 17, 70], [injected, 16, 55], ['Wenig Punkte', 15, 10], ['Viele Punkte', 15, 90],
    ['Spieler 9', 14, 50], ['Spieler 10', 13, 50], ['Spieler 11', 12, 50], ['Spieler 12', 11, 50],
  ].map(([username, level, points]) => ({ date: dayName, username, level, points })));
  board.seed([{ date: '2026-09-23', username: 'Gestern', level: 25, points: 999 }]);
  await context.route(API, board.handle);
  const daily = await context.newPage();
  const dailyNoise = [];
  daily.on('pageerror', (error) => dailyNoise.push(String(error)));
  // The browser logs every 4xx/5xx it receives as an error of its own. The
  // leaderboard's 400 (a second entry) and 503 (server down) are provoked on
  // purpose below and handled by the page, so those alone are not noise.
  const fromLeaderboard = (message) => message.location().url.startsWith(LEADERBOARD.baseUrl);
  daily.on('console', (message) => message.type() === 'error' && !fromLeaderboard(message)
    && dailyNoise.push(message.text()));
  // Installed before the first navigation, or the page would read the real
  // clock on the way up and derive a different board from it.
  await daily.clock.install({ time: new Date(day) });
  // No `?seed=`: that would pin a free run and is exactly what must *not* be
  // needed to reach the same board twice.
  await daily.goto(`http://127.0.0.1:${port}/index.html`);
  await daily.waitForSelector('.board .node');

  /** What the page opened on: the switch, the level, and whether the card is up. */
  const openedOn = (target) => target.evaluate(() => ({
    daily: document.getElementById('mode-taeglich').getAttribute('aria-pressed') === 'true',
    free: document.getElementById('mode-frei').getAttribute('aria-pressed') === 'true',
    level: document.getElementById('hud-level').textContent,
    over: !document.getElementById('over').hidden,
  }));

  // --- beim Laden steht das Tagesbrett -------------------------------------
  // A first visit, nothing stored: the daily board, unplayed.
  const firstVisit = await openedOn(daily);
  check(firstVisit.daily && !firstVisit.free && firstVisit.level === '1' && !firstVisit.over,
    'der erste Besuch öffnet auf dem Tagesbrett');
  check(board.requests.length === 0, 'beim Start keine Anfrage an die Rangliste');
  const rankButton = await daily.evaluate(() => {
    const button = document.getElementById('ranks-open');
    return {
      inCardRow: button.closest('#hud-hand') !== null,
      shown: button.offsetParent !== null,
      rowHeight: Math.round(document.getElementById('hud-hand').getBoundingClientRect().height),
      chipHeight: Math.round(document.getElementById('chip-now').getBoundingClientRect().height),
    };
  });
  check(rankButton.shown && rankButton.inCardRow && rankButton.rowHeight === rankButton.chipHeight,
    `„Rangliste" sitzt in der Kartenreihe, die so hoch bleibt wie eine Karte (${rankButton.rowHeight} px)`);

  /** The level reading in the header as a player reads it, goal and all. */
  const levelReading = (target) => target.evaluate(() => {
    const goal = document.getElementById('hud-goal');
    return {
      text: document.getElementById('hud-level').parentElement.innerText.replace(/\s+/g, ' ').trim(),
      goalShown: !goal.hidden && goal.offsetParent !== null,
    };
  });
  const dailyReading = await levelReading(daily);
  check(dailyReading.goalShown && dailyReading.text === 'Level 1 von 25',
    `die Kopfzeile zeigt das Ziel: „${dailyReading.text}"`);
  // Left in free play with today's attempt still open: back on the daily board.
  await daily.click('#mode-frei');
  await daily.waitForSelector('.board .node');
  check((await openedOn(daily)).free, 'der Umschalter geht auf Frei');
  await daily.reload();
  await daily.waitForSelector('.board .node');
  const afterFree = await openedOn(daily);
  check(afterFree.daily && afterFree.level === '1' && !afterFree.over,
    'nach einem Neuladen aus dem freien Spiel steht wieder das Tagesbrett (Versuch offen)');
  check(await daily.evaluate(() => localStorage.getItem('funkloch.modus')) === null,
    'die Spielart wird nicht mehr gespeichert');

  // An attempt at today's board stored by the build before the onboarding
  // level: no rules marker, and moves made on yesterday's 18-node level 1.
  // Replayed, they would name nodes that may not exist on today's first
  // board, so the page has to set the attempt aside rather than rebuild a run
  // from them.
  await daily.evaluate((today) => localStorage.setItem('funkloch.taeglich', JSON.stringify({
    day: today, moves: ['r9c9', 'r8c8', null, 'r7c7'], stage: 3, score: 12, done: true,
  })), dayName);

  await daily.reload();
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
  check(fresh.stored?.rules === 3 && fresh.stored?.moves.length === 0,
    `der neue Versuch trägt sein Regelkennzeichen (${fresh.stored?.rules})`);

  // One from the build before DAILY_RUN (rules 2): its level 7 had a sender
  // fewer and there was no level 25 to end on, so it is set aside as well.
  await daily.evaluate((today) => localStorage.setItem('funkloch.taeglich', JSON.stringify({
    day: today, rules: 2, moves: ['r0c0', null], levelsCleared: 1, score: 0, done: false,
  })), dayName);
  await daily.reload();
  await daily.waitForSelector('.board .node');
  const older = await daily.evaluate(() => JSON.parse(localStorage.getItem('funkloch.taeglich')));
  check(older?.rules === 3 && older?.moves.length === 0,
    'ein Versuch nach den Regeln vor dem 25-Level-Tagesbrett wird nicht nachgespielt');
  check(await daily.textContent('#hud-score-best') === '',
    'auf dem Tagesbrett gibt es keinen Bestwert zu jagen');

  /** The board as the page drew it, node for node. */
  const boardShape = (target) => target.$$eval('.board .node',
    (nodes) => nodes.map((n) => `${n.dataset.id}${n.classList.contains('is-blocked') ? '!' : ''}`).join(' '));

  const first = await boardShape(daily);
  await daily.reload();
  await daily.waitForSelector('.board .node');
  check(await boardShape(daily) === first, 'dasselbe Datum gibt dasselbe Brett');

  // A second browser, same Berlin day, nothing shared but the clock: the same
  // board. This is the claim the whole mode rests on. Its own time zone is set
  // to Auckland, where it is already the 25th: the device's zone must not
  // matter, only Berlin's.
  const other = await browser.newContext({
    viewport: { width: 560, height: 960 }, timezoneId: 'Pacific/Auckland',
  });
  const strangerApi = [];
  await guardApi(other, strangerApi);
  const stranger = await other.newPage();
  /** Opens the daily board in the stranger's browser at a fixed instant. */
  const strangerAt = async (instant) => {
    await stranger.clock.setFixedTime(new Date(instant));
    await stranger.goto(`http://127.0.0.1:${port}/index.html`);
    await stranger.waitForSelector('.board .node');
    // No click on the switch: a page opened without a seed is on the daily
    // board already, and has to be.
    if (await stranger.getAttribute('#mode-taeglich', 'aria-pressed') !== 'true') {
      check(false, `beim Laden um ${new Date(instant).toISOString()} steht nicht das Tagesbrett`);
    }
    return boardShape(stranger);
  };
  check(await strangerAt(Date.UTC(2026, 8, 24, 21, 30)) === first,
    'ein anderer Spieler in einer anderen Zeitzone bekommt am selben Berliner Tag dasselbe Brett');

  // The change lies on Berlin midnight: a second before it, still the 24th;
  // a second after, the 25th — the same board as at noon on the 25th.
  const nextDay = await strangerAt(Date.UTC(2026, 8, 25, 12));
  check(nextDay !== first, 'am nächsten Tag ist es ein anderes Brett');
  check(await strangerAt(berlinMidnight - 1000) === first, 'um 23:59:59 Berliner Zeit noch das Brett vom 24.');
  check(await strangerAt(berlinMidnight + 1000) === nextDay, 'um 00:00:01 Berliner Zeit schon das vom 25.');
  check(await strangerAt(Date.UTC(2026, 8, 24, 23, 30)) === nextDay,
    'um 23:30 UTC, als UTC noch den 24. zählte, ist es das Brett vom 25.');
  check(strangerApi.length === 0, `fünf Starts in einem fremden Browser, keine Anfrage an die Rangliste (${strangerApi.length})`);
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
  check(ended.level === `${plan.level} von 25`, `Tageskarte zeigt Level ${ended.level}`);
  check(ended.score === String(plan.score), `Tageskarte zeigt ${ended.score} Punkte`);
  check(ended.restartShown === false, 'die Tageskarte bietet keine neue Partie an');
  check(ended.dailyShown === true, 'sie zeigt stattdessen Ergebnis und Wartezeit');
  check(ended.bestShown === false, 'und keinen Bestwert aus dem freien Spiel');
  check(ended.seedShown === false, 'und keinen Seed, über den sich das Brett nachspielen ließe');
  // 14:00 in Berlin, so about ten hours are left of the day. Checked against
  // the page's own clock rather than against a fixed string: the faked clock
  // keeps ticking while the run is played, so the seconds have moved on by the
  // time the card appears, and the property worth asserting is that the
  // number really tracks the time to Berlin midnight — the moment the board
  // changes, not UTC's two hours later.
  const counted = await daily.evaluate((midnight) => {
    const shown = document.getElementById('countdown').textContent;
    const parts = shown.match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
    if (parts === null) return { shown, ok: false };
    const seconds = Number(parts[1]) * 3600 + Number(parts[2]) * 60 + Number(parts[3]);
    const left = (midnight - Date.now()) / 1000;
    return { shown, ok: Math.abs(seconds - left) < 90, left: Math.round(left) };
  }, berlinMidnight);
  check(counted.ok, `Zeit bis zum nächsten Brett: ${counted.shown}`
    + ` (bis Mitternacht in Berlin: ${counted.left}s)`);
  check(ended.stored?.day === dayName && ended.stored?.done === true,
    `gespeichert: ${dayName}, abgeschlossen`);
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
  // it however wrong it was. The header and the address, nothing between.
  const pointsWord = plan.score === 1 ? 'Punkt' : 'Punkte';
  // The name as the wordmark draws it, with the ring for the o.
  const expectedHeader = `funkl○ch 24.09. — in Level ${plan.level} von 25 gescheitert, ${plan.score} ${pointsWord}`;

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
  // Header and the game's address. Spelled out here rather than imported from
  // share.js, for the same reason as the header.
  check(lines.length === 2, `zwei Zeilen, keine Grafik (${lines.length})`);
  check(lines[0] === expectedHeader, `Kopfzeile: ${lines[0]}`);
  check(lines.at(-1) === 'https://funkloch.thssn.dev', `letzte Zeile: ${lines.at(-1)}`);
  check((viaSheet.sent ?? '').includes('https://funkloch.thssn.dev'), 'der geteilte Text enthält die URL als Link');
  check(!(viaSheet.sent ?? '').includes('vercel.app'), 'und nicht mehr die alte Vercel-Adresse');
  check(lines[0].includes('24.09.'), 'sie nennt das Datum');
  check(lines[0].includes(`in Level ${plan.level} von 25 gescheitert`), 'sie nennt das Level, in dem der Tag endete, und das Ziel');
  check(lines[0].includes(`${plan.score} ${pointsWord}`), `sie nennt die Punkte (${pointsWord}; „1 Punkt" prüft test/share.test.js)`);
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
  check(again.level === `${plan.level} von 25` && again.score === String(plan.score),
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
  check(denied.level === `${plan.level} von 25` && denied.score === String(plan.score),
    'und das Ergebnis bleibt stehen');
  check(denied.over === false, 'die Karte bleibt liegen');
  const spent = await openedOn(daily);
  check(spent.daily && spent.over, 'nach einem Neuladen mit verbrauchtem Versuch steht das Tagesbrett mit Ergebnis');

  // --- zurück ins freie Spiel ----------------------------------------------
  // From the spent day's card, in one tap: the switch has to be in view and
  // not covered by the card. A click without `force` is refused otherwise.
  check(await daily.isVisible('#mode-frei'), 'der Weg ins freie Spiel ist auf der Tageskarte zu sehen');
  await daily.click('#mode-frei', { timeout: 2000 });
  await daily.waitForSelector('.board .node');
  const back = await openedOn(daily);
  check(back.free, 'ein Tipp, und der Umschalter steht auf Frei');
  check(back.level === '1' && !back.over, 'und das freie Spiel fängt wieder an');
  const freeReading = await levelReading(daily);
  check(!freeReading.goalShown && freeReading.text === 'Level 1',
    `das freie Spiel hat kein Ziel in der Kopfzeile: „${freeReading.text}"`);

  // Left in free play with the day spent: still the daily result on reload,
  // not the free run.
  await daily.reload();
  await daily.waitForSelector('#over:not([hidden])', { timeout: 5000 });
  const spentAfterFree = await openedOn(daily);
  check(spentAfterFree.daily && spentAfterFree.over
    && await daily.textContent('#over-score') === String(plan.score),
    'nach einem Neuladen aus dem freien Spiel steht das Tagesergebnis (Versuch verbraucht)');
  check(await daily.evaluate(() => /^\d{1,2}:\d{2}:\d{2}$/.test(document.getElementById('countdown').textContent)),
    'mit Countdown bis zum nächsten Brett');
  const lostTitle = await daily.evaluate(() => ({
    text: document.getElementById('over-title').textContent,
    won: document.getElementById('over-title').classList.contains('is-won'),
  }));
  check(lostTitle.text === 'Keine Sender mehr.' && !lostTitle.won,
    `ein verlorener Tag endet auf „${lostTitle.text}"`);

  // --- Rangliste -----------------------------------------------------------
  // A whole day played, its card shown, shared, reloaded several times, the
  // switch flipped both ways: still not a single request. Reading waits for
  // the leaderboard to be opened or an entry to be made; writing for the click.
  check(board.requests.length === 0,
    `ein ganzer Tag ohne eine Anfrage, solange niemand die Rangliste öffnet (${board.requests.length})`);

  // First entry: no saved name, so the button asks for one.
  check(await daily.textContent('#enter') === 'In die Rangliste', 'ohne gespeicherten Namen: „In die Rangliste"');
  await daily.click('#enter');
  check(await daily.isVisible('#enter-name'), 'ein Klick öffnet das Namensfeld');
  check(board.requests.length === 0, 'das Öffnen des Felds trägt noch nichts ein');
  await daily.fill('#enter-name', 'A');
  await daily.click('#enter-send');
  check(await daily.evaluate(() => document.getElementById('enter-hint').classList.contains('is-wrong'))
    && board.requests.length === 0, 'ein Name mit einem Zeichen wird abgewiesen, ohne den Server zu fragen');
  await daily.fill('#enter-name', '  Ada ');
  await daily.click('#enter-send');
  await daily.waitForSelector('#enter-status:not([hidden])', { timeout: 5000 });
  await until(daily, () => document.getElementById('enter-status').textContent.includes('Platz'), 5000);
  const posts = board.requests.filter((r) => r.method === 'POST');
  const sent = JSON.parse(posts[0]?.body ?? '{}');
  check(posts.length === 1, `genau ein Eintrag geschickt (${posts.length})`);
  check(sent.date === dayName && sent.username === 'Ada' && sent.points === plan.score,
    `mit Datum ${sent.date}, Name „${sent.username}" und ${sent.points} Punkten`);
  check(sent.level === plan.cleared && sent.level !== plan.level,
    `mit ${sent.level} geschafften Level, nicht dem angezeigten Level ${plan.level}`);
  check(/^[0-9a-f-]{36}$/.test(sent.client_id ?? ''), 'und der Geräte-ID');
  const placeText = await daily.textContent('#enter-status');
  check(placeText === 'Eingetragen als Ada – Platz 13 von 13.', `die Karte meldet: ${placeText}`);
  check(await daily.isHidden('#enter') && await daily.isHidden('#enter-form'), 'und bietet kein zweites Eintragen an');
  const deviceShown = await daily.evaluate((id) => document.body.innerText.includes(id), sent.client_id);
  check(!deviceShown, 'die Geräte-ID steht nirgends auf der Seite');

  // The leaderboard: the top ten, the place, and the own row below a gap.
  await daily.click('#ranks-open');
  await until(daily, () => document.querySelectorAll('#ranks-list li').length > 0, 5000);
  const listed = await daily.evaluate(() => ({
    open: document.getElementById('ranks').open,
    date: document.getElementById('ranks-date').textContent,
    place: document.getElementById('ranks-place').textContent,
    rows: [...document.querySelectorAll('#ranks-list li')].map((li) => li.innerText.replace(/\s+/g, ' ').trim()),
    own: [...document.querySelectorAll('#ranks-list li.own')].map((li) => li.innerText.replace(/\s+/g, ' ').trim()),
    images: document.querySelectorAll('#ranks img').length,
    injected: window.__injected === 1,
  }));
  check(listed.open && listed.date === '24.09.', `die Rangliste öffnet für den ${listed.date}`);
  check(listed.place === 'Platz 13 von 13', `sie nennt den eigenen Platz: ${listed.place}`);
  check(listed.rows.length === 12 && listed.rows[10] === '…', `zehn Zeilen, „…", die eigene (${listed.rows.length})`);
  check(listed.rows[0] === '1. Spieler 1 20 Level, 60 Punkte', `erste Zeile: ${listed.rows[0]}`);
  check(listed.rows[2].startsWith('3. Gleich A') && listed.rows[3].startsWith('3. Gleich B')
    && listed.rows[4].startsWith('5. '), 'gleiches Level und gleiche Punkte teilen den Platz, der nächste ist 5.');
  check(listed.rows[6].startsWith('7. Viele Punkte') && listed.rows[7].startsWith('8. Wenig Punkte'),
    'bei gleichem Level entscheiden die Punkte');
  check(listed.own.length === 1 && listed.own[0] === `13. Ada ${plan.cleared} Level, ${plan.score} Punkte`,
    `die eigene Zeile: ${listed.own[0]}`);
  check(listed.rows[5].includes(injected) && listed.images === 0 && !listed.injected,
    'ein Name mit Markup steht als Text da und wird nie ausgeführt');
  check(!listed.rows.some((row) => row.includes('Gestern')), 'nur Einträge dieses Tages');
  await daily.click('#ranks-close');
  check(!(await daily.evaluate(() => document.getElementById('ranks').open)), '„Schließen" schließt sie');

  // A reload: the entry is remembered, and still nothing is asked on the way up.
  const beforeReload = board.requests.length;
  await daily.reload();
  await daily.waitForSelector('#over:not([hidden])', { timeout: 5000 });
  check(board.requests.length === beforeReload, 'ein Neuladen fragt nichts an, auch mit Eintrag');
  check(await daily.textContent('#enter-status') === 'Eingetragen als Ada.',
    'die Karte weiß nach dem Neuladen noch, dass eingetragen ist');

  // The server down: the leaderboard says so, and the game goes on.
  board.fail(true);
  await daily.click('#ranks-open');
  await until(daily, () => document.getElementById('ranks-status').textContent.includes('nicht erreichbar'), 7000);
  check((await daily.textContent('#ranks-status')) === 'Die Rangliste ist gerade nicht erreichbar.',
    'fällt der Server aus, sagt die Rangliste es dezent');
  await daily.keyboard.press('Escape');
  await daily.click('#mode-frei', { timeout: 2000 });
  await daily.waitForSelector('.board .node');
  check(await daily.textContent('#hud-level') === '1', 'und das Spiel bleibt bedienbar');
  await daily.click('#mode-taeglich');
  await daily.waitForSelector('#over:not([hidden])', { timeout: 5000 });
  board.fail(false);

  // --- durchgespielt ---------------------------------------------------------
  // The planner almost never clears all 25 levels (0.2 %), so the run played
  // through is the rollout bot's, on the first day from 2026-09-25 that it
  // wins. It is handed to the page as a stored attempt, which is the path a
  // reload takes anyway: 25 levels clicked one by one would test the clicks
  // a second time and nothing else.
  let winner = null;
  for (let offset = 0; offset < 10 && winner === null; offset++) {
    const at = Date.UTC(2026, 8, 25 + offset, 12);
    const run = planRun(dailySeed(at), DAILY_RUN, rolloutChoice);
    if (run.status === 'won') winner = { at, run, name: new Date(at).toISOString().slice(0, 10) };
  }
  check(winner !== null, 'der Rollout-Bot spielt eins von zehn Tagesbrettern durch');
  if (winner !== null) {
    const { at, run, name } = winner;
    console.log(`Durchgespielt am ${name}: ${run.cleared} Level, ${run.score} Punkte`);
    const throughContext = await browser.newContext({ viewport: { width: 560, height: 960 } });
    const throughBoard = fakeLeaderboard();
    await throughContext.route(API, throughBoard.handle);
    const through = await throughContext.newPage();
    const throughNoise = [];
    through.on('pageerror', (error) => throughNoise.push(String(error)));
    through.on('console', (message) => message.type() === 'error' && !fromLeaderboard(message)
      && throughNoise.push(message.text()));
    await through.clock.install({ time: new Date(at) });
    await through.goto(`http://127.0.0.1:${port}/index.html`);
    await through.waitForSelector('.board .node');
    await through.evaluate((attempt) => {
      localStorage.setItem('funkloch.taeglich', JSON.stringify(attempt));
      // Entered on an earlier day under this name: today is a follow-up entry.
      localStorage.setItem('funkloch.rangliste.name', 'Ada');
    }, {
      day: name,
      rules: 3,
      moves: run.script.map((step) => (step.go ? null : step.id)),
      levelsCleared: run.cleared,
      score: run.score,
      done: true,
    });
    await through.reload();
    await through.waitForSelector('#over:not([hidden])', { timeout: 10000 });
    const card = await through.evaluate(() => ({
      title: document.getElementById('over-title').textContent,
      won: document.getElementById('over-title').classList.contains('is-won'),
      level: document.getElementById('over-level').textContent,
      score: document.getElementById('over-score').textContent,
      hud: document.getElementById('hud-level').textContent,
      restartShown: !document.getElementById('restart').hidden,
      dailyShown: !document.getElementById('over-daily').hidden,
      countdown: document.getElementById('countdown').textContent,
    }));
    check(card.title === 'Alle 25 Level geschafft.' && card.won,
      `ein durchgespielter Tag endet auf „${card.title}", in der Signalfarbe`);
    check(card.level === '25 von 25' && card.score === String(run.score),
      `die Karte zeigt Level ${card.level} und ${card.score} Punkte`);
    check(card.hud === '25', 'die Kopfzeile bleibt auf Level 25 stehen, ein 26. gibt es nicht');
    const doneReading = await levelReading(through);
    check(doneReading.text === 'Level 25 von 25', `und liest „${doneReading.text}"`);
    // The widest the reading gets, on the narrowest phones: the row keeps to
    // one line and to the screen.
    for (const width of [320, 360]) {
      await through.setViewportSize({ width, height: 740 });
      const row = await through.evaluate(() => {
        const ledger = document.getElementById('hud-ledger');
        const one = Number.parseFloat(getComputedStyle(ledger).fontSize) * 2.2;
        return {
          oneLine: ledger.getBoundingClientRect().height <= one,
          fits: document.documentElement.scrollWidth <= window.innerWidth,
          height: Math.round(ledger.getBoundingClientRect().height),
        };
      });
      check(row.oneLine && row.fits,
        `bei ${width} px bleibt die Kopfzeile in einer Zeile und auf dem Schirm (${row.height} px hoch)`);
    }
    await through.screenshot({ path: `${shots}/ui-won-360.png` });
    await through.setViewportSize({ width: 560, height: 960 });
    check(!card.restartShown && card.dailyShown && /^\d{1,2}:\d{2}:\d{2}$/.test(card.countdown),
      'auch hier Ergebnis und Countdown statt einer neuen Partie');

    await through.evaluate(() => {
      Object.defineProperty(navigator, 'share', {
        configurable: true,
        value: async (data) => { window.__shared = data.text; },
      });
      Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true });
    });
    await through.click('#share');
    await until(through, () => typeof window.__shared === 'string', 2000);
    const sent = await through.evaluate(() => window.__shared ?? '');
    const [, month, date] = name.split('-');
    const words = run.score === 1 ? 'Punkt' : 'Punkte';
    check(sent.split('\n')[0] === `funkl○ch ${date}.${month}. — durchgespielt, alle 25 Level, ${run.score} ${words}`,
      `geteilt: ${sent.split('\n')[0]}`);
    await through.locator('#over').evaluate((element) =>
      Promise.all(element.getAnimations().map((animation) => animation.finished)));
    await through.screenshot({ path: `${shots}/ui-won.png` });

    // A follow-up entry: the saved name, one click, no field.
    check(throughBoard.requests.length === 0, 'auch hier keine Anfrage beim Start');
    check(await through.textContent('#enter') === 'Als Ada eintragen' && await through.isVisible('#enter-rename'),
      'mit gespeichertem Namen: „Als Ada eintragen" und „Namen ändern"');
    await through.click('#enter');
    await until(through, () => document.getElementById('enter-status').textContent.includes('Platz'), 5000);
    const followUp = JSON.parse(throughBoard.requests.find((r) => r.method === 'POST')?.body ?? '{}');
    check(followUp.username === 'Ada' && followUp.level === 25 && followUp.points === run.score,
      `durchgespielt trägt 25 Level ein (${followUp.level}), unter dem gespeicherten Namen`);
    check(await through.textContent('#enter-status') === 'Eingetragen als Ada – Platz 1 von 1.',
      `die Karte meldet: ${await through.textContent('#enter-status')}`);

    // The same device on the same day again, with the local note gone: the
    // server's unique index refuses it, and the card says so.
    await through.evaluate(() => localStorage.removeItem('funkloch.rangliste.eintrag'));
    await through.reload();
    await through.waitForSelector('#over:not([hidden])', { timeout: 10000 });
    await through.click('#enter');
    await until(through, () => !document.getElementById('enter-status').hidden, 5000);
    check(await through.textContent('#enter-status') === 'Von diesem Gerät heute schon eingetragen.',
      'ein zweiter Eintrag am selben Tag wird abgewiesen und so benannt');
    check(throughBoard.records.length === 1, 'und landet nicht in der Rangliste');
    await through.setViewportSize({ width: 360, height: 740 });
    await through.click('#ranks-open');
    await until(through, () => document.querySelectorAll('#ranks-list li').length > 0, 5000);
    await through.screenshot({ path: `${shots}/ui-ranks.png` });
    await through.keyboard.press('Escape');
    await through.setViewportSize({ width: 560, height: 960 });

    check(await through.isVisible('#mode-frei'), 'der Weg ins freie Spiel ist auch nach dem Durchspielen zu sehen');
    await through.click('#mode-frei', { timeout: 2000 });
    await through.waitForSelector('.board .node');
    check(await through.textContent('#hud-level') === '1', 'ein Tipp, und das freie Spiel fängt an');
    check(throughNoise.length === 0,
      `keine Konsolenfehler beim Durchspielen${throughNoise.length ? `: ${throughNoise.join(' | ')}` : ''}`);
    await throughContext.close();
  }

  check(dailyNoise.length === 0,
    `keine Konsolenfehler im Tagesmodus${dailyNoise.length ? `: ${dailyNoise.join(' | ')}` : ''}`);
  await context.close();
} finally {
  await browser?.close();
  server.kill();
}

console.log(failures.length === 0
  ? `\nAlles gut. Bilder in ${shots}/ui-board.png, ${shots}/ui-over.png, ${shots}/ui-daily.png,`
    + ` ${shots}/ui-won.png und ${shots}/ui-ranks.png`
  : `\n${failures.length} Prüfungen fehlgeschlagen.`);
process.exit(failures.length === 0 ? 0 : 1);
