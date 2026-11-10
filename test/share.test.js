import test from 'node:test';
import assert from 'node:assert/strict';

import {
  advance, createRun, DAILY_RUN, dailySeed, ENDLESS_RUN, place,
} from '../src/run.js';
import { GAME_NAME, GAME_URL, points, shareText } from '../src/share.js';
import { greedyChoice } from '../tools/bot.js';

/** A finished daily state without playing one: only the fields share.js reads. */
const finished = (lefts, score = 0) => ({
  config: DAILY_RUN,
  cleared: lefts.map((left, i) => ({ level: i + 1, left })),
  level: lefts.length + 1,
  status: 'lost',
  score,
});

const playOut = (seed, config = ENDLESS_RUN) => {
  let run = createRun({ seed, config });
  while (run.status === 'playing' || run.status === 'levelCleared') {
    run = run.status === 'levelCleared' ? advance(run) : place(run, greedyChoice(run));
  }
  return run;
};

test('points', async (t) => {
  await t.test('says Punkt for one and Punkte otherwise', () => {
    assert.equal(points(1), '1 Punkt');
    assert.equal(points(0), '0 Punkte');
    assert.equal(points(2), '2 Punkte');
    assert.equal(points(21), '21 Punkte');
  });
});

test('shareText', async (t) => {
  const state = finished([4, 2, 0, 1], 5);

  await t.test('heads with date, the level the day ended in out of how many, and the points', () => {
    const [header] = shareText(state, '2026-09-24').split('\n');
    assert.equal(header, 'funkl○ch 24.09. — in Level 5 von 25 gescheitert, 5 Punkte');
    assert.ok(header.startsWith(GAME_NAME));
    assert.match(shareText(finished([4, 1], 1), '2026-09-24'), /, 1 Punkt$/m);
  });

  await t.test('is the header and the address, with nothing in between', () => {
    const long = finished(Array.from({ length: 20 }, (_, i) => i % 4), 251);
    assert.equal(
      shareText(long, '2026-11-21'),
      'funkl○ch 21.11. — in Level 21 von 25 gescheitert, 251 Punkte\nhttps://funkloch.thssn.dev',
    );
  });

  await t.test('leaves out the goal for a run that has none', () => {
    const endless = { ...state, config: ENDLESS_RUN };
    assert.equal(shareText(endless, '2026-09-24').split('\n')[0],
      'funkl○ch 24.09. — in Level 5 gescheitert, 5 Punkte');
  });

  await t.test('ends on the address of the game', () => {
    const lines = shareText(state, '2026-09-24').split('\n');
    assert.equal(lines.at(-1), GAME_URL);
    assert.equal(lines.filter((line) => line.includes(GAME_URL)).length, 1);
    assert.equal(GAME_URL, 'https://funkloch.thssn.dev');
  });

  await t.test('names the level a played run ended in', () => {
    const run = playOut(dailySeed(Date.UTC(2026, 8, 24, 12)), DAILY_RUN);
    assert.equal(run.status, 'lost');
    const [header] = shareText(run, '2026-09-24').split('\n');
    assert.ok(header.includes(` in Level ${run.level} von 25 gescheitert, `), header);
  });

  await t.test('says a run played through in words, not only in its count', () => {
    const through = { ...finished(Array.from({ length: 25 }, () => 1), 325), level: 25, status: 'won' };
    const stopped = finished(Array.from({ length: 24 }, () => 1), 300);
    assert.equal(
      shareText(through, '2026-11-10'),
      'funkl○ch 10.11. — durchgespielt, alle 25 Level, 325 Punkte\nhttps://funkloch.thssn.dev',
    );
    assert.equal(shareText(stopped, '2026-11-10').split('\n')[0],
      'funkl○ch 10.11. — in Level 25 von 25 gescheitert, 300 Punkte');
    assert.ok(!shareText(stopped, '2026-11-10').includes('durchgespielt'));
  });

  await t.test('gives nothing of the board away', () => {
    const run = playOut(3);
    const text = shareText(run, '2026-09-24');
    // Node ids look like r0c4; none of them, and nothing shaped like one.
    for (const node of run.graph.nodes) assert.ok(!text.includes(String(node.id)), String(node.id));
    assert.ok(!/r\d+c\d+/.test(text));
  });
});
