import test from 'node:test';
import assert from 'node:assert/strict';

import { advance, createRun, dailySeed, ENDLESS_RUN, place } from '../src/run.js';
import {
  BLOCK, FAILED, GAME_URL, LEVELS_PER_LINE, levelMarks, NOTHING_LEFT, points, shareText,
} from '../src/share.js';
import { greedyChoice } from '../tools/bot.js';

/** A finished state without playing one: only the fields share.js reads. */
const finished = (lefts, score = 0) => ({
  cleared: lefts.map((left, i) => ({ level: i + 1, left })),
  level: lefts.length + 1,
  status: 'lost',
  score,
});

test('points', async (t) => {
  await t.test('says Punkt for one and Punkte otherwise', () => {
    assert.equal(points(1), '1 Punkt');
    assert.equal(points(0), '0 Punkte');
    assert.equal(points(2), '2 Punkte');
    assert.equal(points(21), '21 Punkte');
  });
});

test('levelMarks', async (t) => {
  await t.test('one block per leftover sender, a dot for none, a cross at the end', () => {
    assert.deepEqual(levelMarks(finished([2, 0, 1])).map(({ mark }) => mark), [
      BLOCK + BLOCK, NOTHING_LEFT, BLOCK, FAILED,
    ]);
  });

  await t.test('a run lost on its first board is a single cross', () => {
    assert.deepEqual(levelMarks(finished([])), [{ level: 1, mark: FAILED }]);
  });

  await t.test('a run that was not lost carries no cross', () => {
    const won = { ...finished([1, 1]), status: 'won', level: 2 };
    assert.ok(levelMarks(won).every(({ mark }) => mark !== FAILED));
  });
});

test('shareText', async (t) => {
  const state = finished([2, 0, 1], 5);

  await t.test('heads with date, levels cleared and points', () => {
    const [header] = shareText(state, '2026-09-24').split('\n');
    assert.equal(header, 'funkloch 24.09. — 3 Level geschafft, 5 Punkte');
    assert.match(shareText(finished([1], 1), '2026-09-24'), /, 1 Punkt$/m);
  });

  await t.test('the line form puts the marks in order on one line', () => {
    assert.equal(shareText(state, '2026-09-24').split('\n')[1],
      [BLOCK + BLOCK, NOTHING_LEFT, BLOCK, FAILED].join(' '));
  });

  await t.test('and starts a new line every ten levels', () => {
    const long = finished(Array.from({ length: 24 }, () => 1));
    const lines = shareText(long, '2026-09-24').split('\n').slice(1, -1);
    assert.deepEqual(lines.map((line) => line.split(' ').length), [10, 10, 5]);
    assert.equal(LEVELS_PER_LINE, 10);
  });

  await t.test('the rows form numbers every level, aligned', () => {
    const rows = shareText(finished(Array.from({ length: 10 }, () => 0)), '2026-09-24', { form: 'rows' })
      .split('\n').slice(1, -1);
    assert.equal(rows.length, 11);
    assert.equal(rows[0], ` ${'1'} ${NOTHING_LEFT}`);
    assert.equal(rows[10], `11 ${FAILED}`);
  });

  await t.test('ends on the address of the game, in both forms', () => {
    for (const form of ['line', 'rows']) {
      const lines = shareText(state, '2026-09-24', { form }).split('\n');
      assert.equal(lines.at(-1), GAME_URL, form);
      assert.equal(lines.filter((line) => line.includes(GAME_URL)).length, 1, `${form}: once, and last`);
    }
    assert.equal(GAME_URL, 'funkloch.vercel.app');
  });

  await t.test('has no ordinary space where a chat box could break a level apart', () => {
    for (const line of shareText(finished([3, 2, 0, 1, 2, 3, 1, 0, 2, 1, 1, 2]), '2026-09-24').split('\n').slice(1, -1)) {
      assert.ok(!line.includes(' '), `breakable space in ${JSON.stringify(line)}`);
    }
  });

  await t.test('matches what a played run actually spared', () => {
    let run = createRun({ seed: dailySeed(Date.UTC(2026, 8, 24, 12)), config: ENDLESS_RUN });
    while (run.status === 'playing' || run.status === 'levelCleared') {
      run = run.status === 'levelCleared' ? advance(run) : place(run, greedyChoice(run));
    }
    const groups = shareText(run, '2026-09-24').split('\n').slice(1, -1).join(' ').split(' ');
    assert.equal(groups.length, run.level);
    run.cleared.forEach(({ left }, i) => {
      assert.equal(groups[i], left > 0 ? BLOCK.repeat(left) : NOTHING_LEFT, `level ${i + 1}`);
    });
    assert.equal(groups.at(-1), FAILED);
  });

  await t.test('gives nothing of the board away', () => {
    let run = createRun({ seed: 3, config: ENDLESS_RUN });
    while (run.status === 'playing' || run.status === 'levelCleared') {
      run = run.status === 'levelCleared' ? advance(run) : place(run, greedyChoice(run));
    }
    const text = shareText(run, '2026-09-24');
    // Node ids look like r0c4; none of them, and nothing shaped like one.
    for (const node of run.graph.nodes) assert.ok(!text.includes(String(node.id)), String(node.id));
    assert.ok(!/r\d+c\d+/.test(text));
  });
});
