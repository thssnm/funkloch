import test from 'node:test';
import assert from 'node:assert/strict';

import { bfsWithin, bfsWithinAmplified, bfsWithinBlocked } from '../src/graph.js';
import * as run from '../src/run.js';
import {
  advance, createRun, DEFAULT_RUN, ENDLESS_RUN, place, snapshot, stageSpec,
} from '../src/run.js';
import { greedyChoice, playGreedy } from '../tools/bot.js';

/** A small, quick run for the tests. */
const tiny = { ...DEFAULT_RUN, stages: [12, 14], depotRatio: 0.5 };

test('createRun', async (t) => {
  await t.test('deals a board and a depot', () => {
    const run = createRun({ seed: 3, config: tiny });
    assert.equal(run.stage, 1);
    assert.equal(run.graph.nodes.length, 12);
    assert.equal(run.status, 'playing');
    assert.equal(run.score, 0);
    assert.equal(run.uncovered.length, 12);
    assert.equal(run.depot.length, 6);
    assert.equal(run.current, run.depot[0]);
    assert.deepEqual(run.preview, run.depot.slice(1, 3), 'the player sees exactly the next two');
    for (const radius of run.depot) assert.ok([1, 2, 3].includes(radius), `odd radius ${radius}`);
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
    assert.throws(() => createRun({ seed: 1, config: { ...tiny, stages: [] } }), RangeError);
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
    assert.equal(after.depot.length, run.depot.length - 1);
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

  await t.test('ends the run when the depot runs out on an unfinished board', () => {
    // Spend the whole depot on one corner of the board.
    let run = createRun({ seed: 5, config: { ...tiny, depotRatio: 0.25, composition: [[1, 1]] } });
    const order = run.graph.nodes.map((node) => node.id);
    let i = 0;
    while (run.status === 'playing') run = place(run, order[i++]);
    assert.equal(run.status, 'lost');
    assert.equal(run.depot.length, 0);
    assert.ok(run.uncovered.length > 0);
    assert.equal(place(run, order[i]), run, 'a finished run accepts nothing more');
  });
});

test('clearing stages', async (t) => {
  /** Plays greedily until the run ends, returning every state it passed. */
  const playOut = (seed, config) => {
    let run = createRun({ seed, config });
    const seen = [run];
    while (run.status === 'playing' || run.status === 'stageCleared') {
      run = run.status === 'stageCleared' ? advance(run) : place(run, greedyChoice(run));
      seen.push(run);
    }
    return seen;
  };

  await t.test('a cleared board pauses before the next one', () => {
    const generous = { ...DEFAULT_RUN, stages: [12, 14], depotRatio: 0.6 };
    const states = playOut(3, generous);
    const cleared = states.find((run) => run.status === 'stageCleared');
    assert.ok(cleared, 'expected a stage to be cleared');
    assert.equal(cleared.uncovered.length, 0);
    assert.equal(cleared.stage, 1);

    const next = advance(cleared);
    assert.equal(next.stage, 2);
    assert.equal(next.graph.nodes.length, 14);
    assert.equal(next.placed.length, 0);
    assert.equal(next.status, 'playing');
    assert.equal(next.score, cleared.score, 'the score carries over');
  });

  await t.test('leftovers are the score, and only on a cleared board', () => {
    const generous = { ...DEFAULT_RUN, stages: [12, 14], depotRatio: 0.6 };
    const states = playOut(3, generous);
    const cleared = states.find((run) => run.status === 'stageCleared');
    assert.equal(cleared.score, cleared.depot.length, 'stage 1 weighs its leftovers once');

    const midway = states.find((run) => run.status === 'playing' && run.placed.length === 1);
    assert.equal(midway.score, 0, 'nothing scores until the board is clear');
  });

  await t.test('leftovers are weighted by the stage they were saved on', () => {
    const generous = { ...DEFAULT_RUN, stages: [12, 14], depotRatio: 0.6 };
    const states = playOut(3, generous);
    const first = states.find((run) => run.status === 'stageCleared');
    const second = states.filter((run) => run.status === 'stageCleared' || run.status === 'won').at(-1);
    if (second === first) return; // the second board was not cleared on this seed

    // What the second stage added is its own leftovers, counted twice.
    assert.equal(second.stage, 2);
    assert.equal(second.score - first.score, 2 * second.depot.length);
  });

  await t.test('the run score is the sum of leftovers times stage', () => {
    const generous = { ...DEFAULT_RUN, stages: [12, 14], depotRatio: 0.6 };
    for (const seed of [3, 4, 5, 6, 7]) {
      const last = playOut(seed, generous).at(-1);
      const expected = last.cleared.reduce((sum, { stage, left }) => sum + left * stage, 0);
      assert.equal(last.score, expected, `seed ${seed}`);
    }
  });

  await t.test('the last stage ends the run rather than advancing', () => {
    const generous = { ...DEFAULT_RUN, stages: [12, 14], depotRatio: 0.7 };
    const states = playOut(3, generous);
    const last = states.at(-1);
    if (last.status !== 'won') return; // an unlucky board; the other tests cover losing
    assert.equal(last.stage, 2);
    assert.equal(advance(last), last, 'a won run stays won');
    assert.ok(last.score > 0);
  });

  await t.test('advance does nothing mid-stage', () => {
    const run = createRun({ seed: 3, config: tiny });
    assert.equal(advance(run), run);
  });
});

test('snapshots', async (t) => {
  await t.test('survive JSON and describe the run', () => {
    const run = place(createRun({ seed: 3, config: tiny }), createRun({ seed: 3, config: tiny }).graph.nodes[0].id);
    const json = JSON.parse(JSON.stringify(run));
    assert.deepEqual(json, snapshot(run));
    assert.equal(json.stage, 1);
    assert.equal(json.stages, 2);
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
    const result = playGreedy(2, { ...DEFAULT_RUN, depotRatio: 0.45 });
    assert.equal(result.won, true);
    assert.equal(typeof result.won, 'boolean');
    assert.ok(result.placements > 0);
    assert.ok(result.stagesCleared >= 0 && result.stagesCleared <= DEFAULT_RUN.stages.length);
    if (result.won) {
      assert.equal(result.stagesCleared, DEFAULT_RUN.stages.length, 'a won run clears every stage');
    }
  });

  await t.test('is deterministic', () => {
    assert.deepEqual(playGreedy(7, DEFAULT_RUN), playGreedy(7, DEFAULT_RUN));
  });

  await t.test('beats a depot that is plainly big enough', () => {
    let wins = 0;
    for (let seed = 1; seed <= 20; seed++) {
      if (playGreedy(seed, { ...DEFAULT_RUN, depotRatio: 0.45 }).won) wins++;
    }
    assert.equal(wins, 20, 'greedy should never lose with a generous depot');
  });
});

// ---------------------------------------------------------------------------
// The endless shape
// ---------------------------------------------------------------------------

/** A quick endless run: small boards, generous depots, the configured blocking. */
const endless = {
  ...ENDLESS_RUN,
  stageNodes: { start: 10, growth: 2, max: 14 },
  depotCurve: { start: 0.9, floor: 0.8, tau: 4 },
};

test('endless runs', async (t) => {
  await t.test('grow the board and shrink the depot along the curves', () => {
    const first = stageSpec(ENDLESS_RUN, 0);
    assert.equal(first.nodeCount, ENDLESS_RUN.stageNodes.start);
    assert.equal(first.ratio.toFixed(3), ENDLESS_RUN.depotCurve.start.toFixed(3));

    let previous = first;
    for (let index = 1; index < 40; index++) {
      const spec = stageSpec(ENDLESS_RUN, index);
      assert.ok(spec.nodeCount >= previous.nodeCount, 'boards never shrink');
      assert.ok(spec.ratio < previous.ratio, 'the depot ratio falls strictly');
      assert.ok(spec.ratio > ENDLESS_RUN.depotCurve.floor, 'and stays above the floor');
      previous = spec;
    }
    assert.equal(stageSpec(ENDLESS_RUN, 39).nodeCount, ENDLESS_RUN.stageNodes.max, 'board size caps');
  });

  await t.test('never end in a win: a cleared board leads to the next one', () => {
    let state = createRun({ seed: 4, config: endless });
    let stages = 0;
    while (stages < 6) {
      if (state.status === 'stageCleared') {
        state = advance(state);
        stages++;
        continue;
      }
      assert.equal(state.status, 'playing', 'the depots are large enough to clear these boards');
      state = place(state, greedyChoice(state));
    }
    assert.equal(state.stage, 7);
    assert.equal(state.cleared.length, 6, 'six boards behind it');
    assert.equal(snapshot(state).streak, 7, 'the streak is the stage being played');
    assert.equal(snapshot(state).stages, null, 'there is no stage count to report');
    assert.ok(state.score > 0, 'leftovers from every cleared stage add up');
    assert.equal(
      state.score,
      state.cleared.reduce((sum, { stage, left }) => sum + left * stage, 0),
      'and they add up weighted by their stage',
    );
  });

  await t.test('still end when a depot runs out', () => {
    const tight = { ...endless, depotCurve: { start: 0.12, floor: 0.1, tau: 4 } };
    let state = createRun({ seed: 4, config: tight });
    while (state.status === 'playing') state = place(state, greedyChoice(state));
    assert.equal(state.status, 'lost');
    assert.equal(state.score, 0, 'an unfinished board scores nothing');
  });

  await t.test('reject a config without curves', () => {
    assert.throws(() => createRun({ seed: 1, config: { endless: true } }), RangeError);
  });
});

test('impermeable nodes on a board', async (t) => {
  await t.test('are dealt at the configured density and stop the signal', () => {
    const config = { ...endless, stageNodes: { start: 30, growth: 0, max: 30 }, blockedRatio: 0.2 };
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

test('fillDepot hits the composition proportionally', async (t) => {
  /** Reads the depot of a stage-1 run with the given depot size. */
  const depotOf = (size) => createRun({
    seed: 11,
    config: {
      ...DEFAULT_RUN, stages: [40], depotRatio: size / 40, blockedRatio: 0,
    },
  }).depot;

  await t.test('keeps every radius within one of its exact share', () => {
    const total = DEFAULT_RUN.composition.reduce((sum, [, weight]) => sum + weight, 0);
    for (let size = 1; size <= 16; size++) {
      const depot = depotOf(size);
      assert.equal(depot.length, size, `depot of ${size}`);
      for (const [radius, weight] of DEFAULT_RUN.composition) {
        const exact = (size * weight) / total;
        const count = depot.filter((r) => r === radius).length;
        assert.ok(
          Math.abs(count - exact) < 1,
          `depot of ${size}: ${count}x radius ${radius}, exact share ${exact.toFixed(2)}`,
        );
      }
    }
  });

  await t.test('never lets a bigger depot carry less reach', () => {
    // Nominal ball sizes on these boards; the point is the ordering, not the
    // exact figure. The old truncating fill broke this between 8 and 9.
    const ball = { 1: 4, 2: 9, 3: 14 };
    let previous = 0;
    for (let size = 1; size <= 16; size++) {
      const reach = depotOf(size).reduce((sum, radius) => sum + ball[radius], 0);
      assert.ok(reach > previous, `depot of ${size} carries ${reach}, depot of ${size - 1} carried ${previous}`);
      previous = reach;
    }
  });
});

test('blocked density', async (t) => {
  const board = (blockedRatio, seed) => createRun({
    seed,
    config: {
      ...ENDLESS_RUN, stageNodes: { start: 40, growth: 0, max: 40 }, blockedRatio,
    },
  });
  const opaqueOf = (run) => run.graph.nodes.filter((node) => node.blocked === true).length;

  await t.test('a number applies to every stage', () => {
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
    assert.deepEqual(bare.depot, dense.depot, 'same depot');
    assert.equal(opaqueOf(bare), 0);
    assert.equal(opaqueOf(dense), 6);
  });

  await t.test('an array is drawn from, uniformly and per stage', () => {
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
      ...ENDLESS_RUN, stageNodes: { start: 40, growth: 0, max: 40 }, amplifierRatio,
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
    assert.deepEqual(bare.depot, rich.depot, 'same depot');
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
    assert.notDeepEqual(aware.depot, run.depot);
  });
});

test('the daily board', async (t) => {
  const noon = Date.UTC(2026, 8, 24, 12, 0, 0);

  await t.test('names the day in UTC, not in the local zone', () => {
    assert.equal(run.utcDay(noon), '2026-09-24');
    // The two moments a local date would get wrong: late on the 24th in UTC is
    // already the 25th east of the line, and just after midnight UTC is still
    // the 24th west of it. Both have to answer with the UTC day, or two players
    // comparing results would not have played the same board.
    assert.equal(run.utcDay(Date.UTC(2026, 8, 24, 23, 59, 59)), '2026-09-24');
    assert.equal(run.utcDay(Date.UTC(2026, 8, 25, 0, 0, 0)), '2026-09-25');
  });

  await t.test('takes a Date as readily as a timestamp', () => {
    assert.equal(run.utcDay(new Date(noon)), run.utcDay(noon));
    assert.equal(run.dailySeed(new Date(noon)), run.dailySeed(noon));
  });

  await t.test('refuses a moment that is not one', () => {
    for (const bad of [undefined, null, 'heute', new Date('kein Datum'), NaN]) {
      assert.throws(() => run.utcDay(bad), RangeError);
      assert.throws(() => run.dailySeed(bad), RangeError);
    }
  });

  await t.test('gives one seed per day, whatever the hour', () => {
    const early = run.dailySeed(Date.UTC(2026, 8, 24, 0, 0, 1));
    const late = run.dailySeed(Date.UTC(2026, 8, 24, 23, 59, 59));
    assert.equal(early, run.dailySeed(noon));
    assert.equal(late, run.dailySeed(noon));
    assert.notEqual(run.dailySeed(Date.UTC(2026, 8, 25, 12)), early);
  });

  await t.test('is a seed createRun will take', () => {
    const seed = run.dailySeed(noon);
    assert.ok(Number.isInteger(seed) && seed >= 0 && seed < 2 ** 32);
    assert.doesNotThrow(() => createRun({ seed, config: ENDLESS_RUN }));
  });

  await t.test('scatters neighbouring days', () => {
    // The point of hashing the day number: stage seeds are `seed + stage *
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
    // Two players, two clocks, two moments of the same UTC day: one board.
    const berlin = createRun({ seed: run.dailySeed(Date.UTC(2026, 8, 24, 7)), config: ENDLESS_RUN });
    const auckland = createRun({ seed: run.dailySeed(Date.UTC(2026, 8, 24, 21)), config: ENDLESS_RUN });
    assert.deepEqual(snapshot(auckland), snapshot(berlin));
  });

  await t.test('counts down to the next UTC midnight', () => {
    assert.equal(run.msUntilNextDay(noon), 12 * 3600000);
    assert.equal(run.msUntilNextDay(Date.UTC(2026, 8, 24, 23, 59, 59)), 1000);
    // At midnight exactly the day has already turned, so a whole one is ahead:
    // never zero, or the card would offer a board that is not there yet.
    assert.equal(run.msUntilNextDay(Date.UTC(2026, 8, 25, 0, 0, 0)), 86400000);
  });

  await t.test('works before 1970, where the day number goes negative', () => {
    assert.equal(run.utcDay(Date.UTC(1969, 6, 20, 20, 17)), '1969-07-20');
    assert.equal(run.msUntilNextDay(Date.UTC(1969, 6, 20, 20, 17)), 3600000 * 3 + 43 * 60000);
  });
});
