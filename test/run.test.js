import test from 'node:test';
import assert from 'node:assert/strict';

import { bfsWithin, bfsWithinAmplified, bfsWithinBlocked } from '../src/graph.js';
import * as run from '../src/run.js';
import {
  advance, createRun, DEFAULT_RUN, ENDLESS_RUN, place, snapshot, levelSpec,
} from '../src/run.js';
import { greedyChoice, playGreedy } from '../tools/bot.js';

/** A small, quick run for the tests. */
const tiny = { ...DEFAULT_RUN, levelSizes: [12, 14], senderRatio: 0.5 };

test('createRun', async (t) => {
  await t.test('deals a board and its senders', () => {
    const run = createRun({ seed: 3, config: tiny });
    assert.equal(run.level,1);
    assert.equal(run.graph.nodes.length, 12);
    assert.equal(run.status, 'playing');
    assert.equal(run.score, 0);
    assert.equal(run.uncovered.length, 12);
    assert.equal(run.senders.length, 6);
    assert.equal(run.current, run.senders[0]);
    assert.deepEqual(run.preview, run.senders.slice(1, 3), 'the player sees exactly the next two');
    for (const radius of run.senders) assert.ok([1, 2, 3].includes(radius), `odd radius ${radius}`);
  });

  await t.test('is reproducible from the seed alone', () => {
    assert.deepEqual(createRun({ seed: 9, config: tiny }), createRun({ seed: 9, config: tiny }));
    assert.notDeepEqual(
      createRun({ seed: 9, config: tiny }).graph,
      createRun({ seed: 10, config: tiny }).graph,
    );
  });

  await t.test('rejects a malformed setup', () => {
    assert.throws(() => createRun({ seed: 1.5, config: tiny }), RangeError);
    assert.throws(() => createRun({ seed: 1, config: { ...tiny, levelSizes: [] } }), RangeError);
  });
});

test('place', async (t) => {
  await t.test('lights the ball of the transmitter in hand', () => {
    const run = createRun({ seed: 3, config: tiny });
    const target = run.graph.nodes[0].id;
    const radius = run.current;
    const after = place(run, target);

    assert.deepEqual(after.placed, [{ id: target, radius }]);
    assert.equal(after.radii.get(target), radius);
    assert.equal(after.senders.length, run.senders.length - 1);
    for (const reached of bfsWithin(run.graph, target, radius)) {
      assert.ok(after.covered.has(reached), `${reached} should be lit`);
    }
  });

  await t.test('is final: the previous state is untouched', () => {
    const run = createRun({ seed: 3, config: tiny });
    const before = snapshot(run);
    place(run, run.graph.nodes[0].id);
    assert.deepEqual(snapshot(run), before);
    assert.equal(run.placed.length, 0);
  });

  await t.test('ignores a stray tap', () => {
    const run = createRun({ seed: 3, config: tiny });
    assert.equal(place(run, 'ghost'), run);
    const once = place(run, run.graph.nodes[0].id);
    assert.equal(place(once, run.graph.nodes[0].id), once, 'a node holds at most one transmitter');
  });

  await t.test('is the only way the board changes', () => {
    // Lifting a placed transmitter was measured and dropped: the planner used
    // it in 5.7% of runs for 0.5 percentage points of win rate. The rule is
    // now that a placement is final, and the module offers no way around it.
    assert.equal('remove' in run, false, 'run.js must not grow a remove() again');
  });

  await t.test('ends the run when the senders run out on an unfinished board', () => {
    // Spend every sender on one corner of the board.
    let run = createRun({ seed: 5, config: { ...tiny, senderRatio: 0.25, composition: [[1, 1]] } });
    const order = run.graph.nodes.map((node) => node.id);
    let i = 0;
    while (run.status === 'playing') run = place(run, order[i++]);
    assert.equal(run.status, 'lost');
    assert.equal(run.senders.length, 0);
    assert.ok(run.uncovered.length > 0);
    assert.equal(place(run, order[i]), run, 'a finished run accepts nothing more');
  });
});

test('clearing levels', async (t) => {
  /** Plays greedily until the run ends, returning every state it passed. */
  const playOut = (seed, config) => {
    let run = createRun({ seed, config });
    const seen = [run];
    while (run.status === 'playing' || run.status === 'levelCleared') {
      run = run.status === 'levelCleared' ? advance(run) : place(run, greedyChoice(run));
      seen.push(run);
    }
    return seen;
  };

  await t.test('a cleared board pauses before the next one', () => {
    const generous = { ...DEFAULT_RUN, levelSizes: [12, 14], senderRatio: 0.6 };
    const states = playOut(3, generous);
    const cleared = states.find((run) => run.status === 'levelCleared');
    assert.ok(cleared, 'expected a level to be cleared');
    assert.equal(cleared.uncovered.length, 0);
    assert.equal(cleared.level,1);

    const next = advance(cleared);
    assert.equal(next.level,2);
    assert.equal(next.graph.nodes.length, 14);
    assert.equal(next.placed.length, 0);
    assert.equal(next.status, 'playing');
    assert.equal(next.score, cleared.score, 'the score carries over');
  });

  await t.test('leftovers are the score, and only on a cleared board', () => {
    const generous = { ...DEFAULT_RUN, levelSizes: [12, 14], senderRatio: 0.6 };
    const states = playOut(3, generous);
    const cleared = states.find((run) => run.status === 'levelCleared');
    assert.equal(cleared.score, cleared.senders.length, 'level 1 weighs its leftovers once');

    const midway = states.find((run) => run.status === 'playing' && run.placed.length === 1);
    assert.equal(midway.score, 0, 'nothing scores until the board is clear');
  });

  await t.test('leftovers are weighted by the level they were saved on', () => {
    const generous = { ...DEFAULT_RUN, levelSizes: [12, 14], senderRatio: 0.6 };
    const states = playOut(3, generous);
    const first = states.find((run) => run.status === 'levelCleared');
    const second = states.filter((run) => run.status === 'levelCleared' || run.status === 'won').at(-1);
    if (second === first) return; // the second board was not cleared on this seed

    // What the second level added is its own leftovers, counted twice.
    assert.equal(second.level,2);
    assert.equal(second.score - first.score, 2 * second.senders.length);
  });

  await t.test('the run score is the sum of leftovers times level', () => {
    const generous = { ...DEFAULT_RUN, levelSizes: [12, 14], senderRatio: 0.6 };
    for (const seed of [3, 4, 5, 6, 7]) {
      const last = playOut(seed, generous).at(-1);
      const expected = last.cleared.reduce((sum, { level, left }) => sum + left * level, 0);
      assert.equal(last.score, expected, `seed ${seed}`);
    }
  });

  await t.test('the last level ends the run rather than advancing', () => {
    const generous = { ...DEFAULT_RUN, levelSizes: [12, 14], senderRatio: 0.7 };
    const states = playOut(3, generous);
    const last = states.at(-1);
    if (last.status !== 'won') return; // an unlucky board; the other tests cover losing
    assert.equal(last.level,2);
    assert.equal(advance(last), last, 'a won run stays won');
    assert.ok(last.score > 0);
  });

  await t.test('advance does nothing mid-level', () => {
    const run = createRun({ seed: 3, config: tiny });
    assert.equal(advance(run), run);
  });
});

test('snapshots', async (t) => {
  await t.test('survive JSON and describe the run', () => {
    const run = place(createRun({ seed: 3, config: tiny }), createRun({ seed: 3, config: tiny }).graph.nodes[0].id);
    const json = JSON.parse(JSON.stringify(run));
    assert.deepEqual(json, snapshot(run));
    assert.equal(json.level,1);
    assert.equal(json.levels, 2);
    assert.equal(json.placed.length, 1);
    assert.equal(typeof json.status, 'string');
  });
});

test('the greedy bot', async (t) => {
  await t.test('picks the placement that lights the most dark nodes', () => {
    const run = createRun({ seed: 3, config: tiny });
    const choice = greedyChoice(run);
    const gainOf = (id) => bfsWithin(run.graph, id, run.current).filter((n) => run.uncovered.includes(n)).length;
    const best = Math.max(...run.graph.nodes.map((node) => gainOf(node.id)));
    assert.equal(gainOf(choice), best);
  });

  await t.test('plays a whole run and reports the outcome', () => {
    // A seed greedy actually wins, so the won-run branch is exercised.
    const result = playGreedy(2, { ...DEFAULT_RUN, senderRatio: 0.45 });
    assert.equal(result.won, true);
    assert.equal(typeof result.won, 'boolean');
    assert.ok(result.placements > 0);
    assert.ok(result.levelsCleared >= 0 && result.levelsCleared <= DEFAULT_RUN.levelSizes.length);
    if (result.won) {
      assert.equal(result.levelsCleared, DEFAULT_RUN.levelSizes.length, 'a won run clears every level');
    }
  });

  await t.test('is deterministic', () => {
    assert.deepEqual(playGreedy(7, DEFAULT_RUN), playGreedy(7, DEFAULT_RUN));
  });

  await t.test('wins with plainly enough senders', () => {
    let wins = 0;
    for (let seed = 1; seed <= 20; seed++) {
      if (playGreedy(seed, { ...DEFAULT_RUN, senderRatio: 0.45 }).won) wins++;
    }
    assert.equal(wins, 20, 'greedy should never lose with generous senders');
  });
});

// ---------------------------------------------------------------------------
// The endless shape
// ---------------------------------------------------------------------------

/** The endless shape without its onboarding level, for tests about the curve. */
const { firstLevel: ONBOARDING, ...CURVE_ONLY } = ENDLESS_RUN;

/** A quick endless run: small boards, generous senders, the configured blocking. */
const endless = {
  ...CURVE_ONLY,
  levelNodes: { start: 10, growth: 2, max: 14 },
  senderCurve: { start: 0.9, floor: 0.8, tau: 4 },
};

test('endless runs', async (t) => {
  await t.test('grow the board and shrink the senders along the curves', () => {
    const first = levelSpec(CURVE_ONLY, 0);
    assert.equal(first.nodeCount, CURVE_ONLY.levelNodes.start);
    assert.equal(first.ratio.toFixed(3), CURVE_ONLY.senderCurve.start.toFixed(3));

    let previous = first;
    for (let index = 1; index < 40; index++) {
      const spec = levelSpec(CURVE_ONLY, index);
      assert.ok(spec.nodeCount >= previous.nodeCount, 'boards never shrink');
      assert.ok(spec.ratio < previous.ratio, 'the sender ratio falls strictly');
      assert.ok(spec.ratio > ENDLESS_RUN.senderCurve.floor, 'and stays above the floor');
      previous = spec;
    }
    assert.equal(levelSpec(ENDLESS_RUN, 39).nodeCount, ENDLESS_RUN.levelNodes.max, 'board size caps');
  });

  await t.test('never end in a win: a cleared board leads to the next one', () => {
    let state = createRun({ seed: 4, config: endless });
    let levels = 0;
    while (levels < 6) {
      if (state.status === 'levelCleared') {
        state = advance(state);
        levels++;
        continue;
      }
      assert.equal(state.status, 'playing', 'the senders are enough to clear these boards');
      state = place(state, greedyChoice(state));
    }
    assert.equal(state.level,7);
    assert.equal(state.cleared.length, 6, 'six boards behind it');
    assert.equal(snapshot(state).level, 7, 'the snapshot names the level being played');
    assert.equal(snapshot(state).levelsCleared, 6, 'and counts the ones behind it');
    assert.equal(snapshot(state).levels, null, 'there is no level count to report');
    assert.ok(state.score > 0, 'leftovers from every cleared level add up');
    assert.equal(
      state.score,
      state.cleared.reduce((sum, { level, left }) => sum + left * level, 0),
      'and they add up weighted by their level',
    );
  });

  await t.test('still end when the senders run out', () => {
    const tight = { ...endless, senderCurve: { start: 0.12, floor: 0.1, tau: 4 } };
    let state = createRun({ seed: 4, config: tight });
    while (state.status === 'playing') state = place(state, greedyChoice(state));
    assert.equal(state.status, 'lost');
    assert.equal(state.score, 0, 'an unfinished board scores nothing');
  });

  await t.test('reject a config without curves', () => {
    assert.throws(() => createRun({ seed: 1, config: { endless: true } }), RangeError);
  });
});

test('the onboarding level', async (t) => {
  await t.test('is a small board with senders to spare', () => {
    const spec = levelSpec(ENDLESS_RUN, 0);
    assert.deepEqual([spec.nodeCount, spec.senders], [9, 6]);
    const run = createRun({ seed: 5, config: ENDLESS_RUN });
    assert.equal(run.graph.nodes.length, 9);
    assert.equal(run.senders.length, 6);
    assert.ok(run.graph.nodes.every((node) => node.blocked !== true), 'no octagon on the first board');
  });

  await t.test('replaces level 1 and leaves every later board as the curve dealt it', () => {
    for (let index = 1; index < 6; index++) {
      assert.deepEqual(levelSpec(ENDLESS_RUN, index), levelSpec(CURVE_ONLY, index));
    }
    // Level 2 is drawn from seed + 7919 alone, so it is the same board with or
    // without the onboarding level in front of it.
    const clearFirst = (config) => {
      let state = createRun({ seed: 12, config });
      while (state.status === 'playing') state = place(state, greedyChoice(state));
      return advance(state);
    };
    const withIt = clearFirst(ENDLESS_RUN);
    const without = clearFirst(CURVE_ONLY);
    assert.equal(withIt.level, 2);
    assert.equal(without.level, 2);
    assert.deepEqual(withIt.graph, without.graph);
    assert.deepEqual(withIt.senders, without.senders);
  });

  await t.test('scores nothing, and every later level as before', () => {
    let state = createRun({ seed: 12, config: ENDLESS_RUN });
    while (state.status === 'playing') state = place(state, greedyChoice(state));
    assert.equal(state.status, 'levelCleared');
    assert.ok(state.senders.length > 0, 'senders were left over');
    assert.equal(state.score, 0, 'but the onboarding level hands out no points');
    assert.equal(state.cleared.length, 1, 'it still counts as cleared');

    while (state.status === 'playing' || state.status === 'levelCleared') {
      state = state.status === 'levelCleared' ? advance(state) : place(state, greedyChoice(state));
    }
    assert.equal(
      state.score,
      state.cleared.filter(({ level }) => level > 1).reduce((sum, { level, left }) => sum + left * level, 0),
      'level 2 on weighted exactly as before',
    );
  });

  await t.test('scores like any level in a mode that says so', () => {
    const counting = { ...ENDLESS_RUN, firstLevel: { ...ENDLESS_RUN.firstLevel, scores: true } };
    let state = createRun({ seed: 12, config: counting });
    while (state.status === 'playing') state = place(state, greedyChoice(state));
    assert.equal(state.score, state.senders.length);
  });

  await t.test('is never lost by the greedy bot', () => {
    // The bar from tools/onboarding.js, on a sample the test suite can afford:
    // a newcomer plays worse than greedy, so greedy must clear every board.
    for (let seed = 1; seed <= 300; seed++) {
      let state = createRun({ seed, config: ENDLESS_RUN });
      while (state.status === 'playing') state = place(state, greedyChoice(state));
      assert.equal(state.status, 'levelCleared', `seed ${seed}`);
    }
  });
});

test('impermeable nodes on a board', async (t) => {
  await t.test('are dealt at the configured density and stop the signal', () => {
    const config = { ...endless, levelNodes: { start: 30, growth: 0, max: 30 }, blockedRatio: 0.2 };
    const run = createRun({ seed: 8, config });
    const opaque = run.graph.nodes.filter((node) => node.blocked === true);
    assert.equal(opaque.length, 6, '20% of 30 nodes');

    // Coverage is computed with the blocking walk, not the plain one.
    const after = place(run, run.graph.nodes[0].id);
    const [{ id, radius }] = after.placed;
    assert.deepEqual(
      [...after.covered].sort(),
      [...bfsWithinBlocked(run.graph, id, radius)].sort(),
    );
  });

  await t.test('are absent at density 0', () => {
    const run = createRun({ seed: 8, config: { ...endless, blockedRatio: 0 } });
    assert.ok(run.graph.nodes.every((node) => node.blocked === undefined));
  });
});

test('fillSenders hits the composition proportionally', async (t) => {
  /** Reads the senders of a level-1 run dealt the given number of them. */
  const sendersOf = (size) => createRun({
    seed: 11,
    config: {
      ...DEFAULT_RUN, levelSizes: [40], senderRatio: size / 40, blockedRatio: 0,
    },
  }).senders;

  await t.test('keeps every radius within one of its exact share', () => {
    const total = DEFAULT_RUN.composition.reduce((sum, [, weight]) => sum + weight, 0);
    for (let size = 1; size <= 16; size++) {
      const senders = sendersOf(size);
      assert.equal(senders.length, size, `${size} senders`);
      for (const [radius, weight] of DEFAULT_RUN.composition) {
        const exact = (size * weight) / total;
        const count = senders.filter((r) => r === radius).length;
        assert.ok(
          Math.abs(count - exact) < 1,
          `${size} senders: ${count}x radius ${radius}, exact share ${exact.toFixed(2)}`,
        );
      }
    }
  });

  await t.test('never lets more senders carry less reach', () => {
    // Nominal ball sizes on these boards; the point is the ordering, not the
    // exact figure. The old truncating fill broke this between 8 and 9.
    const ball = { 1: 4, 2: 9, 3: 14 };
    let previous = 0;
    for (let size = 1; size <= 16; size++) {
      const reach = sendersOf(size).reduce((sum, radius) => sum + ball[radius], 0);
      assert.ok(reach > previous, `${size} senders carry ${reach}, ${size - 1} carried ${previous}`);
      previous = reach;
    }
  });
});

test('blocked density', async (t) => {
  const board = (blockedRatio, seed) => createRun({
    seed,
    config: {
      ...CURVE_ONLY, levelNodes: { start: 40, growth: 0, max: 40 }, blockedRatio,
    },
  });
  const opaqueOf = (run) => run.graph.nodes.filter((node) => node.blocked === true).length;

  await t.test('a number applies to every level', () => {
    for (let seed = 1; seed <= 5; seed++) assert.equal(opaqueOf(board(0.05, seed)), 2);
  });

  await t.test('two densities on one seed differ only in what is blocked', () => {
    const bare = board(0, 7);
    const dense = board(0.15, 7);
    assert.deepEqual(
      bare.graph.edges,
      dense.graph.edges,
      'same board',
    );
    assert.deepEqual(bare.senders, dense.senders, 'same senders');
    assert.equal(opaqueOf(bare), 0);
    assert.equal(opaqueOf(dense), 6);
  });

  await t.test('an array is drawn from, uniformly and per level', () => {
    const seen = new Map([[0, 0], [2, 0], [6, 0]]);
    for (let seed = 1; seed <= 600; seed++) {
      const count = opaqueOf(board([0, 0.05, 0.15], seed));
      assert.ok(seen.has(count), `unexpected count ${count}`);
      seen.set(count, seen.get(count) + 1);
    }
    for (const [count, times] of seen) {
      assert.ok(times > 130 && times < 270, `${count} blocked nodes came up ${times} times in 600`);
    }
  });

  await t.test('a mode without the field keeps its boards', () => {
    const { blockedRatio, ...unaware } = ENDLESS_RUN;
    const run = createRun({ seed: 3, config: unaware });
    assert.ok(run.graph.nodes.every((node) => node.blocked === undefined));
  });
});

test('amplifier nodes on a board', async (t) => {
  const board = (amplifierRatio, seed) => createRun({
    seed,
    config: {
      ...CURVE_ONLY, levelNodes: { start: 40, growth: 0, max: 40 }, amplifierRatio,
    },
  });
  const amplifiersOf = (run) => run.graph.nodes.filter((node) => node.amplifier === true).length;

  await t.test('are dealt at the configured density', () => {
    for (let seed = 1; seed <= 5; seed++) assert.equal(amplifiersOf(board(0.1, seed)), 4);
    assert.equal(amplifiersOf(board(0, 1)), 0);
  });

  await t.test('two densities on one seed differ only in what amplifies', () => {
    const bare = board(0, 7);
    const rich = board(0.15, 7);
    assert.deepEqual(bare.graph.edges, rich.graph.edges, 'same board');
    assert.deepEqual(bare.senders, rich.senders, 'same senders');
    assert.deepEqual(
      bare.graph.nodes.map((node) => node.blocked === true),
      rich.graph.nodes.map((node) => node.blocked === true),
      'same impermeable nodes',
    );
    assert.equal(amplifiersOf(rich), 6);
  });

  await t.test('a transmitter on one reaches one step further', () => {
    const run = board(0.15, 7);
    const amplifier = run.graph.nodes.find((node) => node.amplifier === true);
    const after = place(run, amplifier.id);
    const [{ id, radius }] = after.placed;
    assert.deepEqual(
      [...after.covered].sort(),
      [...bfsWithinAmplified(run.graph, id, radius)].sort(),
    );
    assert.ok(
      after.covered.size > bfsWithinBlocked(run.graph, id, radius).length
        || bfsWithinBlocked(run.graph, id, radius).length === run.graph.nodes.length,
      'the bonus actually bought something',
    );
  });

  await t.test('a mode without the field keeps its boards', () => {
    const run = createRun({ seed: 3, config: ENDLESS_RUN });
    assert.ok(run.graph.nodes.every((node) => node.amplifier === undefined));
    // And the board is the one the mode has always dealt: adding the field is
    // what moves the random stream, not leaving it off.
    const aware = createRun({ seed: 3, config: { ...ENDLESS_RUN, amplifierRatio: 0 } });
    assert.notDeepEqual(aware.senders, run.senders);
  });
});

/** dailySeed of 2026-09-24, as computed by the build before freeSeed existed. */
const DAILY_2026_09_24 = 207894553;

/**
 * dailySeed as it was while the board turned over at UTC midnight, copied
 * from that build: the UTC day number through the murmur3 finaliser. A date
 * has to keep its board across the move to Berlin midnight.
 */
const dailySeedAsItWas = (at) => {
  const day = Math.floor(at / 86400000);
  let hash = Math.imul(day ^ (day >>> 16), 0x85ebca6b) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35) >>> 0;
  return (hash ^ (hash >>> 16)) >>> 0;
};

test('the free-run seed', async (t) => {
  const at = Date.UTC(2026, 9, 12, 17, 4, 31, 250);

  await t.test('is a seed createRun will take, the same for the same moment', () => {
    const seed = run.freeSeed(at);
    assert.ok(Number.isInteger(seed) && seed >= 0 && seed < 2 ** 32);
    assert.equal(run.freeSeed(new Date(at)), seed);
    assert.deepEqual(
      snapshot(createRun({ seed, config: ENDLESS_RUN })),
      snapshot(createRun({ seed: run.freeSeed(at), config: ENDLESS_RUN })),
      'the seed shown is enough to deal the run again',
    );
  });

  await t.test('differs for every millisecond', () => {
    const seeds = new Set();
    for (let ms = 0; ms < 5000; ms++) seeds.add(run.freeSeed(at + ms));
    assert.equal(seeds.size, 5000);
  });

  await t.test('does not deal one run\'s boards to a run started 7919 ms later', () => {
    // The reason the timestamp is hashed: level i is drawn from seed + i * 7919,
    // so an unhashed clock would hand run B's first board to run A's second.
    const a = run.freeSeed(at);
    const b = run.freeSeed(at + 7919);
    assert.notEqual(b - a, 7919);
    assert.ok(Math.abs(b - a) > 7919 * 200, `${a} and ${b} lie ${Math.abs(b - a)} apart`);
  });

  await t.test('refuses a moment that is not one', () => {
    for (const bad of [undefined, null, NaN, new Date('kein Datum')]) {
      assert.throws(() => run.freeSeed(bad), RangeError);
    }
  });
});

test('the daily board', async (t) => {
  const noon = Date.UTC(2026, 8, 24, 12, 0, 0);

  // Instants are written in UTC on purpose and checked against what a Berlin
  // wall clock showed then — CEST (UTC+2) until 2026-10-25, CET (UTC+1) after.
  // Known facts, not the code's own arithmetic played back.
  const berlinMidnight25Sep = Date.UTC(2026, 8, 24, 22); // 2026-09-25 00:00 CEST

  await t.test('names the day on a Berlin wall clock, the same for everyone', () => {
    assert.equal(run.DAILY_TIME_ZONE, 'Europe/Berlin');
    assert.equal(run.boardDay(noon), '2026-09-24');
    // The change is at Berlin midnight, not at UTC midnight two hours later.
    assert.equal(run.boardDay(berlinMidnight25Sep - 1000), '2026-09-24');
    assert.equal(run.boardDay(berlinMidnight25Sep), '2026-09-25');
    assert.equal(run.boardDay(Date.UTC(2026, 8, 24, 23, 30)), '2026-09-25', 'UTC would still say the 24th');
    // In winter Berlin is only one hour ahead: midnight is 23:00 UTC.
    assert.equal(run.boardDay(Date.UTC(2026, 11, 31, 22, 59, 59)), '2026-12-31');
    assert.equal(run.boardDay(Date.UTC(2026, 11, 31, 23, 0, 0)), '2027-01-01');
  });

  await t.test('takes a Date as readily as a timestamp', () => {
    assert.equal(run.boardDay(new Date(noon)), run.boardDay(noon));
    assert.equal(run.dailySeed(new Date(noon)), run.dailySeed(noon));
  });

  await t.test('refuses a moment that is not one', () => {
    for (const bad of [undefined, null, 'heute', new Date('kein Datum'), NaN]) {
      assert.throws(() => run.boardDay(bad), RangeError);
      assert.throws(() => run.dailySeed(bad), RangeError);
      assert.throws(() => run.msUntilNextDay(bad), RangeError);
    }
  });

  await t.test('gives one seed per Berlin day, whatever the hour', () => {
    const first = run.dailySeed(berlinMidnight25Sep - 86400000); // 24th, 00:00
    const last = run.dailySeed(berlinMidnight25Sep - 1); // 24th, 23:59:59.999
    assert.equal(first, run.dailySeed(noon));
    assert.equal(last, run.dailySeed(noon));
    assert.notEqual(run.dailySeed(berlinMidnight25Sep), first);
    assert.equal(run.dailySeed(berlinMidnight25Sep), run.dailySeed(Date.UTC(2026, 8, 25, 12)));
  });

  await t.test('keeps the board each date always had', () => {
    // The seed hangs on the date, not the instant: moving the change to Berlin
    // midnight moved when a board comes, not which board a date has. At noon
    // UTC the two clocks agree on the date, so the seed must be the old one.
    for (let day = -2000; day < 2000; day += 7) {
      const at = day * 86400000 + 43200000;
      assert.equal(run.boardDay(at), new Date(at).toISOString().slice(0, 10));
      assert.equal(run.dailySeed(at), dailySeedAsItWas(at), new Date(at).toISOString());
    }
  });

  await t.test('is a seed createRun will take', () => {
    const seed = run.dailySeed(noon);
    assert.ok(Number.isInteger(seed) && seed >= 0 && seed < 2 ** 32);
    assert.doesNotThrow(() => createRun({ seed, config: ENDLESS_RUN }));
  });

  await t.test('scatters neighbouring days', () => {
    // The point of hashing the day number: level seeds are `seed + level *
    // 7919`, so days one apart must not land one apart, or Tuesday's first
    // board would be a near miss of Monday's second.
    const seeds = [];
    for (let day = 0; day < 40; day++) {
      seeds.push(run.dailySeed(Date.UTC(2026, 8, 1 + day, 12)));
    }
    assert.equal(new Set(seeds).size, seeds.length, 'no two days share a seed');
    for (let i = 1; i < seeds.length; i++) {
      assert.ok(Math.abs(seeds[i] - seeds[i - 1]) > 7919 * 200,
        `days ${i - 1} and ${i} land ${Math.abs(seeds[i] - seeds[i - 1])} apart`);
    }
  });

  await t.test('deals the same board to everyone on the same day', () => {
    // Two players, two moments of the same Berlin day — one of them in
    // Auckland, where it is long since the 25th: one board.
    const morning = createRun({ seed: run.dailySeed(Date.UTC(2026, 8, 24, 5)), config: ENDLESS_RUN });
    const evening = createRun({ seed: run.dailySeed(Date.UTC(2026, 8, 24, 21, 30)), config: ENDLESS_RUN });
    assert.deepEqual(snapshot(evening), snapshot(morning));
  });

  await t.test('counts down to the next Berlin midnight', () => {
    assert.equal(run.msUntilNextDay(noon), 10 * 3600000, 'noon UTC is 14:00 in Berlin');
    assert.equal(run.msUntilNextDay(berlinMidnight25Sep - 1000), 1000);
    // At midnight exactly the day has already turned, so a whole one is ahead:
    // never zero, or the card would offer a board that is not there yet.
    assert.equal(run.msUntilNextDay(berlinMidnight25Sep), 24 * 3600000);
  });

  await t.test('counts the countdown on the same clock as the change', () => {
    // Wherever the countdown lands, the date has just turned there, and a
    // millisecond before it had not.
    for (let hour = 0; hour < 24 * 400; hour += 7) {
      const at = Date.UTC(2026, 0, 1) + hour * 3600000;
      const next = at + run.msUntilNextDay(at);
      assert.notEqual(run.boardDay(next), run.boardDay(at), new Date(at).toISOString());
      assert.equal(run.boardDay(next - 1), run.boardDay(at), new Date(at).toISOString());
    }
  });

  await t.test('has a 23-hour and a 25-hour day', () => {
    // 2026-03-29: clocks go forward at 02:00 CET. The day runs from 23:00 UTC on
    // the 28th to 22:00 UTC on the 29th.
    const springStart = Date.UTC(2026, 2, 28, 23);
    assert.equal(run.boardDay(springStart), '2026-03-29');
    assert.equal(run.msUntilNextDay(springStart), 23 * 3600000);
    assert.equal(run.boardDay(Date.UTC(2026, 2, 29, 22)), '2026-03-30');
    // 2026-10-25: clocks go back at 03:00 CEST. From 22:00 UTC on the 24th to
    // 23:00 UTC on the 25th.
    const autumnStart = Date.UTC(2026, 9, 24, 22);
    assert.equal(run.boardDay(autumnStart), '2026-10-25');
    assert.equal(run.msUntilNextDay(autumnStart), 25 * 3600000);
    assert.equal(run.boardDay(Date.UTC(2026, 9, 25, 23)), '2026-10-26');
    // And the hour around each change counts down without a jump.
    assert.equal(run.msUntilNextDay(Date.UTC(2026, 2, 29, 1)), 21 * 3600000, '03:00 CEST, just after');
    assert.equal(run.msUntilNextDay(Date.UTC(2026, 9, 25, 0, 30)), 22.5 * 3600000, 'the first 02:30');
    assert.equal(run.msUntilNextDay(Date.UTC(2026, 9, 25, 1, 30)), 21.5 * 3600000, 'the second 02:30');
  });

  await t.test('keeps the seed it has always dealt', () => {
    // dailySeed now shares its mixer with freeSeed; the days already played
    // must not move. Values taken from the build before the split.
    assert.equal(run.dailySeed(noon), DAILY_2026_09_24);
  });

  await t.test('works before 1970, where the day number goes negative', () => {
    // 1969 had no summer time in Germany: 20:17 UTC was 21:17 in Berlin.
    assert.equal(run.boardDay(Date.UTC(1969, 6, 20, 20, 17)), '1969-07-20');
    assert.equal(run.msUntilNextDay(Date.UTC(1969, 6, 20, 20, 17)), 3600000 * 2 + 43 * 60000);
    assert.equal(run.dailySeed(Date.UTC(1969, 6, 20, 12)), dailySeedAsItWas(Date.UTC(1969, 6, 20, 12)));
  });
});
