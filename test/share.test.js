import test from 'node:test';
import assert from 'node:assert/strict';

import { advance, createRun, dailySeed, ENDLESS_RUN, place } from '../src/run.js';
import { GAME_NAME, GAME_URL, points, shareText } from '../src/share.js';
import { greedyChoice } from '../tools/bot.js';

/** A finished state without playing one: only the fields share.js reads. */
const finished = (lefts, score = 0) => ({
  config: ENDLESS_RUN,
  cleared: lefts.map((left, i) => ({ level: i + 1, left })),
  level: lefts.length + 1,
  status: 'lost',
  score,
});

const playOut = (seed) => {
  let run = createRun({ seed, config: ENDLESS_RUN });
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

  await t.test('heads with date, all levels cleared and the points', () => {
    const [header] = shareText(state, '2026-09-24').split('\n');
    assert.equal(header, 'funkl○ch 24.09. — 4 Level geschafft, 5 Punkte');
    assert.ok(header.startsWith(GAME_NAME));
    assert.match(shareText(finished([4, 1], 1), '2026-09-24'), /, 1 Punkt$/m);
  });

  await t.test('is the header and the address, with nothing in between', () => {
    const long = finished(Array.from({ length: 32 }, (_, i) => i % 4), 251);
    assert.equal(
      shareText(long, '2026-11-21'),
      'funkl○ch 21.11. — 32 Level geschafft, 251 Punkte\nhttps://funkloch.thssn.dev',
    );
  });

  await t.test('ends on the address of the game', () => {
    const lines = shareText(state, '2026-09-24').split('\n');
    assert.equal(lines.at(-1), GAME_URL);
    assert.equal(lines.filter((line) => line.includes(GAME_URL)).length, 1);
    assert.equal(GAME_URL, 'https://funkloch.thssn.dev');
  });

  await t.test('counts every level a played run cleared', () => {
    const run = playOut(dailySeed(Date.UTC(2026, 8, 24, 12)));
    const [header] = shareText(run, '2026-09-24').split('\n');
    assert.ok(header.includes(` ${run.level - 1} Level geschafft, `), header);
  });

  await t.test('gives nothing of the board away', () => {
    const run = playOut(3);
    const text = shareText(run, '2026-09-24');
    // Node ids look like r0c4; none of them, and nothing shaped like one.
    for (const node of run.graph.nodes) assert.ok(!text.includes(String(node.id)), String(node.id));
    assert.ok(!/r\d+c\d+/.test(text));
  });
});
