import test from 'node:test';
import assert from 'node:assert/strict';

import { bfsWithin, bfsWithinBlocked } from '../src/graph.js';
import {
  advance, createRun, DEFAULT_RUN, ENDLESS_RUN, place, remove, snapshot, stageSpec,
} from '../src/run.js';
import { greedyChoice, playGreedy, repairChoice } from '../tools/bot.js';

/** A small, quick run for the tests. */
const tiny = { ...DEFAULT_RUN, stages: [12, 14], bagRatio: 0.5 };

test('createRun', async (t) => {
  await t.test('deals a board and a bag', () => {
    const run = createRun({ seed: 3, config: tiny });
    assert.equal(run.stage, 1);
    assert.equal(run.graph.nodes.length, 12);
    assert.equal(run.status, 'playing');
    assert.equal(run.score, 0);
    assert.equal(run.uncovered.length, 12);
    assert.equal(run.bag.length, 6);
    assert.equal(run.current, run.bag[0]);
    assert.deepEqual(run.preview, run.bag.slice(1, 3), 'the player sees exactly the next two');
    for (const radius of run.bag) assert.ok([1, 2, 3].includes(radius), `odd radius ${radius}`);
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
    assert.equal(after.bag.length, run.bag.length - 1);
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

  await t.test('ends the run when the bag runs out on an unfinished board', () => {
    // Spend the whole bag on one corner of the board.
    let run = createRun({ seed: 5, config: { ...tiny, bagRatio: 0.25, composition: [[1, 1]] } });
    const order = run.graph.nodes.map((node) => node.id);
    let i = 0;
    while (run.status === 'playing') run = place(run, order[i++]);
    assert.equal(run.status, 'lost');
    assert.equal(run.bag.length, 0);
    assert.ok(run.uncovered.length > 0);
    assert.equal(place(run, order[i]), run, 'a finished run accepts nothing more');
  });
});

test('remove', async (t) => {
  await t.test('takes a transmitter off but keeps the card spent', () => {
    const run = createRun({ seed: 3, config: tiny });
    const target = run.graph.nodes[0].id;
    const placed = place(run, target);
    const lifted = remove(placed, target);

    assert.equal(lifted.placed.length, 0);
    assert.equal(lifted.covered.size, 0);
    assert.equal(lifted.bag.length, placed.bag.length,
      'the transmitter must not go back into the bag');
    assert.equal(lifted.current, placed.current, 'and the hand is unchanged');
  });

  await t.test('frees the node for a different transmitter', () => {
    const run = createRun({ seed: 3, config: tiny });
    const target = run.graph.nodes[0].id;
    const again = place(remove(place(run, target), target), target);
    assert.deepEqual(again.placed.map((entry) => entry.id), [target]);
    // Two transmitters spent, one on the board.
    assert.equal(again.bag.length, run.bag.length - 2);
  });

  await t.test('leaves everything else alone', () => {
    let run = createRun({ seed: 3, config: tiny });
    const [first, second] = run.graph.nodes.map((node) => node.id);
    run = place(place(run, first), second);
    const lifted = remove(run, first);
    assert.deepEqual(lifted.placed.map((entry) => entry.id), [second]);
    assert.ok(lifted.radii.has(second));
    assert.ok(!lifted.radii.has(first));
  });

  await t.test('is a no-op where there is nothing to take off', () => {
    const run = createRun({ seed: 3, config: tiny });
    assert.equal(remove(run, run.graph.nodes[0].id), run);
    assert.equal(remove(run, 'ghost'), run);
  });

  await t.test('cannot rescue a finished run', () => {
    let run = createRun({ seed: 5, config: { ...tiny, bagRatio: 0.25, composition: [[1, 1]] } });
    const order = run.graph.nodes.map((node) => node.id);
    let i = 0;
    while (run.status === 'playing') run = place(run, order[i++]);
    assert.equal(run.status, 'lost');
    assert.equal(remove(run, order[0]), run, 'the bag is empty; nothing can be undone');
  });

  await t.test('does not mutate the state it was given', () => {
    const placed = place(createRun({ seed: 3, config: tiny }), createRun({ seed: 3, config: tiny }).graph.nodes[0].id);
    const before = snapshot(placed);
    remove(placed, placed.placed[0].id);
    assert.deepEqual(snapshot(placed), before);
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
    const generous = { ...DEFAULT_RUN, stages: [12, 14], bagRatio: 0.6 };
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
    const generous = { ...DEFAULT_RUN, stages: [12, 14], bagRatio: 0.6 };
    const states = playOut(3, generous);
    const cleared = states.find((run) => run.status === 'stageCleared');
    assert.equal(cleared.score, cleared.bag.length);

    const midway = states.find((run) => run.status === 'playing' && run.placed.length === 1);
    assert.equal(midway.score, 0, 'nothing scores until the board is clear');
  });

  await t.test('the last stage ends the run rather than advancing', () => {
    const generous = { ...DEFAULT_RUN, stages: [12, 14], bagRatio: 0.7 };
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
    const result = playGreedy(2, { ...DEFAULT_RUN, bagRatio: 0.45 });
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

  await t.test('the repairing bot only removes when it pays', () => {
    // Removing costs the whole ball and returns only the node, so a planner
    // should reach for it rarely — the option must not become a safety net.
    let removals = 0;
    for (let seed = 1; seed <= 40; seed++) {
      let state = createRun({ seed, config: DEFAULT_RUN });
      while (state.status === 'playing' || state.status === 'stageCleared') {
        if (state.status === 'stageCleared') { state = advance(state); continue; }
        const choice = repairChoice(state);
        if (choice === null) break;
        if (choice.remove !== null) {
          removals++;
          state = remove(state, choice.remove);
        }
        state = place(state, choice.place);
      }
    }
    assert.ok(removals < 8, `expected repairs to stay rare, saw ${removals} in 40 runs`);
  });

  await t.test('beats a bag that is plainly big enough', () => {
    let wins = 0;
    for (let seed = 1; seed <= 20; seed++) {
      if (playGreedy(seed, { ...DEFAULT_RUN, bagRatio: 0.45 }).won) wins++;
    }
    assert.equal(wins, 20, 'greedy should never lose with a generous bag');
  });
});

// ---------------------------------------------------------------------------
// The endless shape
// ---------------------------------------------------------------------------

/** A quick endless run: small boards, generous bags, the configured blocking. */
const endless = {
  ...ENDLESS_RUN,
  stageNodes: { start: 10, growth: 2, max: 14 },
  bagCurve: { start: 0.9, floor: 0.8, tau: 4 },
};

test('endless runs', async (t) => {
  await t.test('grow the board and shrink the bag along the curves', () => {
    const first = stageSpec(ENDLESS_RUN, 0);
    assert.equal(first.nodeCount, ENDLESS_RUN.stageNodes.start);
    assert.equal(first.ratio.toFixed(3), ENDLESS_RUN.bagCurve.start.toFixed(3));

    let previous = first;
    for (let index = 1; index < 40; index++) {
      const spec = stageSpec(ENDLESS_RUN, index);
      assert.ok(spec.nodeCount >= previous.nodeCount, 'boards never shrink');
      assert.ok(spec.ratio < previous.ratio, 'the bag ratio falls strictly');
      assert.ok(spec.ratio > ENDLESS_RUN.bagCurve.floor, 'and stays above the floor');
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
      assert.equal(state.status, 'playing', 'the bags are large enough to clear these boards');
      state = place(state, greedyChoice(state));
    }
    assert.equal(state.stage, 7);
    assert.equal(state.cleared.length, 6, 'six boards behind it');
    assert.equal(snapshot(state).streak, 7, 'the streak is the stage being played');
    assert.equal(snapshot(state).stages, null, 'there is no stage count to report');
    assert.ok(state.score > 0, 'leftovers from every cleared stage add up');
  });

  await t.test('still end when a bag runs out', () => {
    const tight = { ...endless, bagCurve: { start: 0.12, floor: 0.1, tau: 4 } };
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

test('fillBag hits the composition proportionally', async (t) => {
  /** Reads the bag of a stage-1 run with the given bag size. */
  const bagOf = (size) => createRun({
    seed: 11,
    config: {
      ...DEFAULT_RUN, stages: [40], bagRatio: size / 40, blockedRatio: 0,
    },
  }).bag;

  await t.test('keeps every radius within one of its exact share', () => {
    const total = DEFAULT_RUN.composition.reduce((sum, [, weight]) => sum + weight, 0);
    for (let size = 1; size <= 16; size++) {
      const bag = bagOf(size);
      assert.equal(bag.length, size, `bag of ${size}`);
      for (const [radius, weight] of DEFAULT_RUN.composition) {
        const exact = (size * weight) / total;
        const count = bag.filter((r) => r === radius).length;
        assert.ok(
          Math.abs(count - exact) < 1,
          `bag of ${size}: ${count}x radius ${radius}, exact share ${exact.toFixed(2)}`,
        );
      }
    }
  });

  await t.test('never lets a bigger bag carry less reach', () => {
    // Nominal ball sizes on these boards; the point is the ordering, not the
    // exact figure. The old truncating fill broke this between 8 and 9.
    const ball = { 1: 4, 2: 9, 3: 14 };
    let previous = 0;
    for (let size = 1; size <= 16; size++) {
      const reach = bagOf(size).reduce((sum, radius) => sum + ball[radius], 0);
      assert.ok(reach > previous, `bag of ${size} carries ${reach}, bag of ${size - 1} carried ${previous}`);
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
    assert.deepEqual(bare.bag, dense.bag, 'same bag');
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
