import test from 'node:test';
import assert from 'node:assert/strict';

import { findAllSolutions, isUnique } from '../src/solver.js';
import { generateExactCandidate, generateExactLevel, mulberry32 } from '../src/generator.js';
import {
  ballSizeStats,
  propagation,
  solveExactByTiers,
  sumBound,
  sumFeasible,
} from '../src/tiers-exact.js';
import { bfsWithin } from '../src/graph.js';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const line = (ids) => ({
  nodes: ids.map((id, index) => ({ id, x: index * 10, y: 0 })),
  edges: ids.slice(1).map((id, index) => [ids[index], id]),
});

/** a…i: nine nodes in a row. At radius 1 the only tiling is b | e | h. */
const path9 = line('abcdefghi'.split(''));

test('exact-cover solving', async (t) => {
  await t.test('finds the partition and nothing else', () => {
    assert.deepEqual(findAllSolutions(path9, 3, 1, 'exact'), [['b', 'e', 'h']]);
    assert.equal(isUnique(path9, 3, 1, 'exact'), true);
  });

  await t.test('rejects sets that overlap even though they cover', () => {
    // {b, d, h} covers everything, but c gets two signals.
    const covering = findAllSolutions(path9, 3, 1);
    assert.ok(covering.length >= 1);
    const exact = findAllSolutions(path9, 3, 1, 'exact');
    assert.ok(exact.length <= covering.length, 'exact mode can never admit more sets');
    for (const solution of exact) {
      const seen = new Set();
      for (const transmitter of solution) {
        for (const reached of bfsWithin(path9, transmitter, 1)) {
          assert.equal(seen.has(reached), false, `${reached} lit twice`);
          seen.add(reached);
        }
      }
      assert.equal(seen.size, path9.nodes.length, 'the balls must tile the graph');
    }
  });

  await t.test('a size that cannot tile has no solution at all', () => {
    // Two balls of at most three nodes cannot cover nine.
    assert.deepEqual(findAllSolutions(path9, 2, 1, 'exact'), []);
    // Four would need sizes summing to nine with none above three: 3+3+2+1 is
    // impossible here because no ball has size one.
    assert.deepEqual(findAllSolutions(path9, 4, 1, 'exact'), []);
  });

  await t.test('cover mode is untouched by any of this', () => {
    assert.deepEqual(findAllSolutions(line(['a', 'b', 'c']), 1, 1), [['b']]);
    assert.equal(isUnique(line(['a', 'b', 'c']), 1, 1), true);
  });

  await t.test('rejects an unknown mode', () => {
    assert.throws(() => findAllSolutions(path9, 3, 1, 'partition'), RangeError);
    assert.throws(() => isUnique(path9, 3, 1, 'whatever'), RangeError);
  });
});

test('tier E1: propagation', async (t) => {
  await t.test('cannot open a level on its own', () => {
    // Its forcing rule needs a node with a single candidate. At the start every
    // node is reachable from its whole ball, which has at least two members
    // whenever k >= 1 — so E1 has nothing to bite on until something else moves.
    const result = propagation(path9, 1);
    assert.deepEqual(result.chosen, []);
    assert.deepEqual(result.ruledOut, []);
    assert.equal(result.rounds, 0);
  });

  await t.test('cascades once something is on the board', () => {
    const result = propagation(path9, 1, { chosen: ['b'] });
    // a, b and c are lit, so anything reaching them would light them twice.
    for (const struck of ['a', 'c', 'd']) {
      assert.ok(result.ruledOut.includes(struck), `${struck} should have been struck`);
    }
    // d is now dark and only e can still reach it, which forces the cascade.
    assert.deepEqual(result.chosen, ['b', 'e', 'h']);
    assert.deepEqual(result.forcedTrace.map((entry) => entry.node), ['e', 'h']);
    assert.equal(result.forcedTrace[0].forcedBy, 'd');
    assert.equal(result.covered.length, 9);
  });

  await t.test('k = 0 makes every node its own single candidate', () => {
    // The one case where E1 does open a level: every ball is a singleton.
    const result = propagation(line(['a', 'b', 'c']), 0);
    assert.deepEqual(result.chosen.sort(), ['a', 'b', 'c']);
  });

  await t.test('does not mutate the graph', () => {
    const snapshot = JSON.stringify(path9);
    propagation(path9, 1, { chosen: ['b'] });
    assert.equal(JSON.stringify(path9), snapshot);
  });
});

test('tier E2: the sum bound', async (t) => {
  await t.test('strikes candidates no subset can sum around', () => {
    // Nine nodes, three transmitters. The end balls have size two, and no pair
    // of the remaining sizes adds up to the seven that would leave.
    const result = sumBound(path9, 3, 1);
    assert.equal(result.need, 3);
    assert.equal(result.target, 9);
    assert.deepEqual(result.ruledOut.sort(), ['a', 'i']);
  });

  await t.test('accounts for what is already placed', () => {
    const result = sumBound(path9, 3, 1, { chosen: ['b'], candidates: ['e', 'f', 'h', 'i'] });
    assert.equal(result.need, 2);
    assert.equal(result.target, 6, 'six nodes still dark');
  });

  await t.test('says nothing once the budget is spent', () => {
    assert.deepEqual(sumBound(path9, 1, 1, { chosen: ['b'] }).ruledOut, []);
  });

  await t.test('does not mutate the graph', () => {
    const snapshot = JSON.stringify(path9);
    sumBound(path9, 3, 1);
    assert.equal(JSON.stringify(path9), snapshot);
  });
});

test('solveExactByTiers', async (t) => {
  await t.test('E2 opens, E1 finishes', () => {
    const result = solveExactByTiers(path9, 3, 1);
    assert.equal(result.solved, true);
    assert.equal(result.trace[0].tier, 2, 'the sum bound has to go first');
    assert.equal(result.maxTier, 2);
    assert.equal(result.e1Steps, 3);
    assert.equal(result.e2Steps, 1);
    assert.deepEqual(result.chosen.slice().sort(), ['b', 'e', 'h']);
  });

  await t.test('agrees with the brute-force answer', () => {
    const result = solveExactByTiers(path9, 3, 1);
    assert.deepEqual(result.chosen.slice().sort(), findAllSolutions(path9, 3, 1, 'exact')[0]);
  });

  await t.test('reports not solved rather than guessing', () => {
    // A ring of six at radius 1: two balls of three tile it, but there are two
    // ways to do it, so deduction must stop.
    const ids = [0, 1, 2, 3, 4, 5].map((i) => `n${i}`);
    const ring = {
      nodes: ids.map((id, i) => ({ id, x: Math.cos(i), y: Math.sin(i) })),
      edges: ids.map((id, i) => [id, ids[(i + 1) % 6]]),
    };
    assert.ok(findAllSolutions(ring, 2, 1, 'exact').length > 1);
    assert.equal(solveExactByTiers(ring, 2, 1).solved, false);
  });

  await t.test('k = 0 is the one case E1 handles alone', () => {
    const result = solveExactByTiers(line(['a', 'b', 'c']), 3, 0);
    assert.equal(result.solved, true);
    assert.equal(result.maxTier, 1);
    assert.equal(result.e2Steps, 0);
  });
});

// ---------------------------------------------------------------------------
// The invariant. If it fails, one of the two rules is unsound and must be
// reported, not quietly adjusted.
// ---------------------------------------------------------------------------

test('neither exact tier strikes a candidate the solution needs', () => {
  let checked = 0;
  let e2Fired = 0;
  for (const [count, k] of [[2, 1], [3, 1], [4, 1], [2, 2], [3, 2]]) {
    for (let seed = 1; seed <= 8; seed++) {
      let level;
      try {
        level = generateExactLevel({ count, k, seed, maxAttempts: 250 });
      } catch {
        continue;
      }
      checked++;
      const inSolution = new Set(level.solution);
      const result = solveExactByTiers(level.graph, level.count, level.k);
      for (const step of result.trace) {
        if (step.tier === 2) e2Fired++;
        for (const struck of step.ruledOut ?? []) {
          assert.ok(
            !inSolution.has(struck),
            `tier E${step.tier} struck ${struck}, which the solution [${level.solution.join(', ')}] uses`,
          );
        }
      }
      for (const placed of result.chosen) {
        assert.ok(inSolution.has(placed), `deduced ${placed}, not in the solution`);
      }
    }
  }
  assert.ok(checked >= 20, `only ${checked} levels checked`);
  assert.ok(e2Fired > 0, 'the sum bound never fired — the check would be vacuous');
});

test('generateExactLevel', async (t) => {
  await t.test('produces a uniquely solvable partition', () => {
    const level = generateExactLevel({ count: 3, k: 1, seed: 7, maxAttempts: 300 });
    assert.equal(level.mode, 'exact');
    assert.equal(level.solution.length, 3);
    assert.equal(isUnique(level.graph, level.count, level.k, 'exact'), true);

    const seen = new Set();
    for (const transmitter of level.solution) {
      for (const reached of bfsWithin(level.graph, transmitter, level.k)) {
        assert.equal(seen.has(reached), false, `${reached} lit twice`);
        seen.add(reached);
      }
    }
    assert.equal(seen.size, level.graph.nodes.length, 'the balls must tile the whole graph');
  });

  await t.test('keeps the transmitters at least 2k+1 apart', () => {
    const level = generateExactLevel({ count: 3, k: 2, seed: 11, maxAttempts: 300 });
    for (const transmitter of level.solution) {
      const tooClose = new Set(bfsWithin(level.graph, transmitter, 2 * level.k));
      for (const other of level.solution) {
        if (other === transmitter) continue;
        assert.equal(tooClose.has(other), false, `${transmitter} and ${other} are too close`);
      }
    }
  });

  await t.test('is reproducible from the seed', () => {
    const options = { count: 3, k: 1, seed: 21, maxAttempts: 300 };
    assert.deepEqual(generateExactLevel(options), generateExactLevel(options));
  });

  await t.test('candidates always tile or come back null', () => {
    const rng = mulberry32(3);
    let made = 0;
    for (let i = 0; i < 25; i++) {
      const candidate = generateExactCandidate({ count: 3, k: 1, lattice: 'rect', rng });
      if (candidate === null) continue;
      made++;
      const seen = new Set();
      for (const transmitter of candidate.solution) {
        for (const reached of bfsWithin(candidate.graph, transmitter, 1)) {
          assert.equal(seen.has(reached), false);
          seen.add(reached);
        }
      }
      assert.equal(seen.size, candidate.graph.nodes.length);
    }
    assert.ok(made > 5, `expected a usable yield, got ${made}/25`);
  });

  await t.test('throws a descriptive error instead of looping', () => {
    assert.throws(
      () => generateExactLevel({ count: 3, k: 1, seed: 1, maxAttempts: 1, nodeCount: 2, tolerance: 0 }),
      /exact-cover level/,
    );
  });
});

test('sumFeasible and the ball-size spread', async (t) => {
  await t.test('counts every arithmetically plausible placement', () => {
    // Nine in a row at radius 1: sizes are 2,3,3,3,3,3,3,3,2. Three of them
    // add up to nine only as 3+3+3, so it is C(7,3) = 35 — of which exactly one,
    // b|e|h, also fits together geometrically.
    assert.equal(sumFeasible(path9, 3, 1), 35);
    assert.equal(findAllSolutions(path9, 3, 1, 'exact').length, 1);
  });

  await t.test('the solution is always one of them', () => {
    for (const [count, k] of [[3, 1], [2, 1]]) {
      const solutions = findAllSolutions(path9, count, k, 'exact');
      assert.ok(sumFeasible(path9, count, k) >= solutions.length,
        'the sum condition can never be stricter than the full rule');
    }
  });

  await t.test('is zero when no subset can add up', () => {
    // Two balls of at most three cannot reach nine.
    assert.equal(sumFeasible(path9, 2, 1), 0);
    assert.equal(sumFeasible(path9, -1, 1), 0);
  });

  await t.test('reports the spread and how many sizes occur', () => {
    const stats = ballSizeStats(path9, 1);
    assert.deepEqual(stats.sizes, [2, 3, 3, 3, 3, 3, 3, 3, 2]);
    assert.equal(stats.distinct, 2);
    assert.ok(stats.spread > 0 && stats.spread < 1, `unexpected spread ${stats.spread}`);
  });

  await t.test('flags the degenerate case where every ball is the same size', () => {
    // A ring of six at radius 1: every ball holds exactly three nodes, so the
    // sum condition is the same statement for every subset and says nothing.
    const ids = [0, 1, 2, 3, 4, 5].map((i) => `n${i}`);
    const ring = {
      nodes: ids.map((id, i) => ({ id, x: Math.cos(i), y: Math.sin(i) })),
      edges: ids.map((id, i) => [id, ids[(i + 1) % 6]]),
    };
    const stats = ballSizeStats(ring, 1);
    assert.equal(stats.distinct, 1);
    assert.equal(stats.spread, 0);
    // Every pair passes the sum test, so the rule cannot narrow anything down.
    assert.equal(sumFeasible(ring, 2, 1), 15); // C(6,2)
  });

  await t.test('handles the empty graph', () => {
    assert.deepEqual(ballSizeStats({ nodes: [], edges: [] }, 1), { spread: 0, distinct: 0, sizes: [] });
    assert.equal(sumFeasible({ nodes: [], edges: [] }, 0, 1), 1);
  });
});

test('the built exact set', async (t) => {
  const dir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'levels', 'exact');
  const files = readdirSync(dir).filter((name) => /^\d\d\.json$/.test(name)).sort();

  await t.test('is present and uniformly exact', () => {
    assert.equal(files.length, 12, 'run: node tools/build-exact-levels.js');
    for (const file of files) {
      const level = JSON.parse(readFileSync(join(dir, file), 'utf8'));
      assert.equal(level.mode, 'exact', `${file}: wrong mode`);
      assert.equal(isUnique(level.graph, level.count, level.k, 'exact'), true, `${file}: not unique`);
    }
  });

  await t.test('every stored solution really tiles its graph', () => {
    for (const file of files) {
      const level = JSON.parse(readFileSync(join(dir, file), 'utf8'));
      const seen = new Set();
      for (const transmitter of level.solution) {
        for (const reached of bfsWithin(level.graph, transmitter, level.k)) {
          assert.equal(seen.has(reached), false, `${file}: ${reached} lit twice`);
          seen.add(reached);
        }
      }
      assert.equal(seen.size, level.graph.nodes.length, `${file}: does not tile`);
    }
  });

  await t.test('is deducible and never degenerate', () => {
    for (const file of files) {
      const level = JSON.parse(readFileSync(join(dir, file), 'utf8'));
      const tiers = solveExactByTiers(level.graph, level.count, level.k);
      assert.equal(tiers.solved, true, `${file}: not solvable by deduction`);
      assert.deepEqual(tiers.chosen.slice().sort(), level.solution.slice().sort(), `${file}: wrong answer`);
      const stats = ballSizeStats(level.graph, level.k);
      assert.ok(stats.distinct > 1, `${file}: all balls the same size, the sum rule says nothing`);
      assert.equal(stats.distinct, level.ballSizesDistinct);
      assert.equal(stats.spread, level.ballSizeSpread);
      assert.equal(sumFeasible(level.graph, level.count, level.k), level.sumFeasible);
    }
  });

  await t.test('is ordered by the work the sum step costs', () => {
    const scores = files.map((file) => JSON.parse(readFileSync(join(dir, file), 'utf8')).sumFeasible);
    assert.deepEqual(scores, [...scores].sort((a, b) => a - b));
  });

  await t.test('opens with three levels the sum rule solves for free', () => {
    const openers = files.slice(0, 3).map((file) => JSON.parse(readFileSync(join(dir, file), 'utf8')));
    for (const level of openers) {
      assert.equal(level.sumFeasible, 1,
        `${level.id}: an opener must leave nothing to weigh up at the sum step`);
    }
  });

  await t.test('the rest sit inside the intended corridor', () => {
    const rest = files.slice(3).map((file) => JSON.parse(readFileSync(join(dir, file), 'utf8')));
    assert.equal(rest.length, 9);
    for (const level of rest) {
      assert.equal(level.k, 1, `${level.id}: k must be 1`);
      assert.ok(level.count >= 4 && level.count <= 5, `${level.id}: count ${level.count} out of range`);
      assert.ok(level.nodeCount <= 30, `${level.id}: ${level.nodeCount} nodes is too big`);
      assert.ok(level.sumFeasible >= 8 && level.sumFeasible <= 60,
        `${level.id}: sumFeasible ${level.sumFeasible} outside 8..60`);
      assert.ok(['hex', 'delaunay'].includes(level.lattice),
        `${level.id}: ${level.lattice} has too uniform a degree for the sum rule`);
    }
  });

  await t.test('never leans on one parameter slot', () => {
    const perSlot = new Map();
    for (const file of files.slice(3)) {
      const level = JSON.parse(readFileSync(join(dir, file), 'utf8'));
      const slot = `${level.count}/${level.lattice}`;
      perSlot.set(slot, (perSlot.get(slot) ?? 0) + 1);
    }
    for (const [slot, used] of perSlot) {
      assert.ok(used <= 3, `slot ${slot} appears ${used} times`);
    }
    assert.ok(perSlot.size >= 3, `expected several slots, got ${[...perSlot.keys()].join(' ')}`);
    // Both topologies have to show up, or the set is not mixed at all.
    const topologies = new Set([...perSlot.keys()].map((slot) => slot.split('/')[1]));
    assert.deepEqual([...topologies].sort(), ['delaunay', 'hex']);
  });

  await t.test('leaves the cover set alone', () => {
    const cover = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'levels');
    for (const file of readdirSync(cover).filter((name) => /^\d\d\.json$/.test(name))) {
      const level = JSON.parse(readFileSync(join(cover, file), 'utf8'));
      assert.equal(level.mode, undefined, `${file}: the cover levels must stay untouched`);
    }
  });
});
