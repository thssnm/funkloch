import test from 'node:test';
import assert from 'node:assert/strict';

import {
  advance, createRun, dailySeed, DEFAULT_RUN, ENDLESS_RUN, levelSpec, place,
} from '../src/run.js';
import {
  FAILED, GAME_NAME, GAME_URL, GROUP, levelMarks, points, RAMP, shareText, TEN_OR_MORE,
} from '../src/share.js';
import { greedyChoice } from '../tools/bot.js';

/**
 * A finished state without playing one: only the fields share.js reads. Level 1
 * is the onboarding level of the endless mode unless `config` says otherwise.
 */
const finished = (lefts, score = 0, config = ENDLESS_RUN) => ({
  config,
  cleared: lefts.map((left, i) => ({ level: i + 1, left })),
  level: lefts.length + 1,
  status: 'lost',
  score,
});

/** The strip lines of a shared text: between the header and the address. */
const strip = (text) => text.split('\n').slice(1, -1);

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

test('levelMarks', async (t) => {
  await t.test('one mark per level from level 2 on, on the ramp, a cross at the end', () => {
    assert.deepEqual(levelMarks(finished([4, 2, 0, 1])).map(({ mark }) => mark), ['●', '·', '○', FAILED]);
    assert.deepEqual(RAMP, ['·', '○', '●']);
  });

  await t.test('caps the ramp at two left over', () => {
    assert.deepEqual(levelMarks(finished([4, 2, 3, 8])).map(({ mark }) => mark), ['●', '●', '●', FAILED]);
  });

  await t.test('or one digit per level in the digit form', () => {
    assert.deepEqual(
      levelMarks(finished([4, 2, 0, 1]), { form: 'digits' }).map(({ mark }) => mark),
      ['2', '0', '1', FAILED],
    );
  });

  await t.test('leaves out the onboarding level, which every run clears', () => {
    assert.deepEqual(levelMarks(finished([4])).map(({ level }) => level), [2]);
  });

  await t.test('but shows the cross of a run that died on it', () => {
    assert.deepEqual(levelMarks(finished([])), [{ level: 1, mark: FAILED }]);
  });

  await t.test('keeps level 1 where it scores like any other', () => {
    const fixed = finished([3, 1], 0, DEFAULT_RUN);
    assert.deepEqual(levelMarks(fixed).map(({ mark }) => mark), ['●', '○', FAILED]);
  });

  await t.test('stays one character for ten or more in the digit form', () => {
    assert.deepEqual(
      levelMarks(finished([4, 12]), { form: 'digits' }).map(({ mark }) => mark),
      [TEN_OR_MORE, FAILED],
    );
  });

  await t.test('a run that was not lost carries no cross', () => {
    const won = { ...finished([1, 1], 3, DEFAULT_RUN), status: 'won', level: 2 };
    assert.ok(levelMarks(won).every(({ mark }) => mark !== FAILED));
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

  await t.test('groups the marks in fives, two groups to a line', () => {
    const long = finished([4, ...Array.from({ length: 23 }, (_, i) => i % 4)]);
    assert.deepEqual(strip(shareText(long, '2026-09-24')), ['·○●●· ○●●·○', '●●·○● ●·○●●', '·○●×']);
    assert.deepEqual(
      strip(shareText(long, '2026-09-24', { form: 'digits' })),
      ['01230 12301', '23012 30123', '012×'],
    );
    assert.equal(GROUP, 5);
  });

  await t.test('is one character per level, whatever the spaces do', () => {
    const run = finished([4, 2, 0, 1, 3, 1, 1, 0]);
    const glyphs = strip(shareText(run, '2026-09-24')).join('').replace(/\s/g, '');
    assert.equal([...glyphs].length, levelMarks(run).length);
  });

  await t.test('ends on the address of the game', () => {
    const lines = shareText(state, '2026-09-24').split('\n');
    assert.equal(lines.at(-1), GAME_URL);
    assert.equal(lines.filter((line) => line.includes(GAME_URL)).length, 1);
    assert.equal(GAME_URL, 'funkloch.vercel.app');
  });

  await t.test('matches what a played run actually spared', () => {
    const run = playOut(dailySeed(Date.UTC(2026, 8, 24, 12)));
    const glyphs = [...strip(shareText(run, '2026-09-24')).join('').replace(/\s/g, '')];
    const expected = [
      ...run.cleared.filter(({ level }) => level > 1).map(({ left }) => ['·', '○', '●'][Math.min(left, 2)]),
      FAILED,
    ];
    assert.deepEqual(glyphs, expected);
    assert.equal(run.level, glyphs.length + 1, 'every level but the onboarding one');
  });

  await t.test('gives nothing of the board away', () => {
    const run = playOut(3);
    const text = shareText(run, '2026-09-24');
    // Node ids look like r0c4; none of them, and nothing shaped like one.
    for (const node of run.graph.nodes) assert.ok(!text.includes(String(node.id)), String(node.id));
    assert.ok(!/r\d+c\d+/.test(text));
  });
});

// For the digit form, kept in case the decision for the ramp turns.
test('the curve never leaves two digits over', async (t) => {
  await t.test('deals at most ten senders on every level the strip shows', () => {
    // Clearing a board takes at least one sender, so with ten dealt at most
    // nine are left: one digit. If the curve ever deals more, the strip would
    // need TEN_OR_MORE in earnest — this is where that change gets noticed.
    for (let index = 1; index < 500; index++) {
      const { senders } = levelSpec(ENDLESS_RUN, index);
      assert.ok(senders <= 10, `level ${index + 1} deals ${senders}`);
    }
  });
});
