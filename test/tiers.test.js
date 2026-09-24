import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { findAllSolutions } from '../src/solver.js';
import { generateLevel } from '../src/generator.js';
import { disjointBound, forbiddenExclusion, solveByTiers } from '../src/tiers.js';

const levelDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'levels');

const line = (ids) => ({
  nodes: ids.map((id, index) => ({ id, x: index * 10, y: 0 })),
  edges: ids.slice(1).map((id, index) => [ids[index], id]),
});

const cycle = (size) => {
  const ids = Array.from({ length: size }, (_, i) => `n${i}`);
  return {
    nodes: ids.map((id, i) => ({ id, x: Math.cos((i * 2 * Math.PI) / size), y: Math.sin((i * 2 * Math.PI) / size) })),
    edges: ids.map((id, i) => [id, ids[(i + 1) % size]]),
  };
};

test('disjointBound', async (t) => {
  await t.test('strikes candidates outside a family that fills the budget', () => {
    // a-b-c-d-e-f at radius 1 with two transmitters: B(a)={a,b} and
    // B(d)={c,d,e} are disjoint, so both transmitters live in there and f —
    // which lies in neither — is impossible. The unique solution is {b, e}.
    const result = disjointBound(line(['a', 'b', 'c', 'd', 'e', 'f']), 2, 1);
    assert.deepEqual(result.family, ['a', 'd']);
    assert.equal(result.size, 2);
    assert.equal(result.budget, 2);
    assert.deepEqual(result.ruledOut, ['f']);
  });

  await t.test('finds the maximum family, not just a maximal one', () => {
    // a-b-c-d-e-f-g needs three transmitters at radius 1: B(a), B(d), B(g)
    // are pairwise disjoint. That exceeds a budget of two, which says the
    // instance is unsatisfiable — so nothing is struck.
    const result = disjointBound(line(['a', 'b', 'c', 'd', 'e', 'f', 'g']), 2, 1);
    assert.equal(result.size, 3);
    assert.deepEqual(result.ruledOut, []);
  });

  await t.test('says nothing when the family falls short of the budget', () => {
    // On a 5-cycle every pair of balls overlaps, so the largest family is 1.
    const result = disjointBound(cycle(5), 2, 1);
    assert.equal(result.size, 1);
    assert.deepEqual(result.ruledOut, []);
  });

  await t.test('a family that exactly covers everything strikes nothing', () => {
    const result = disjointBound(line(['a', 'b', 'c', 'd', 'e']), 2, 1);
    assert.equal(result.size, 2);
    assert.deepEqual(result.ruledOut, []);
  });

  await t.test('k = 0 makes every ball a singleton', () => {
    const result = disjointBound(line(['a', 'b', 'c']), 3, 0);
    assert.equal(result.size, 3);
    assert.deepEqual(result.ruledOut, []);
  });

  await t.test('honours a residual state and its shrunken budget', () => {
    const graph = line(['a', 'b', 'c', 'd', 'e', 'f']);
    // One transmitter already placed: the budget drops to one, and only the
    // constraints and candidates handed in are considered.
    const result = disjointBound(graph, 2, 1, {
      candidates: ['c', 'd', 'e', 'f'],
      constraints: ['e', 'f'],
      forced: ['b'],
    });
    assert.equal(result.budget, 1);
    assert.equal(result.size, 1);
    assert.deepEqual(result.ruledOut.sort(), ['c']);
  });

  await t.test('handles the empty graph and a spent budget', () => {
    assert.deepEqual(disjointBound({ nodes: [], edges: [] }, 1, 1).ruledOut, []);
    assert.deepEqual(disjointBound(line(['a', 'b']), 0, 1).ruledOut, []);
  });

  await t.test('does not mutate the graph', () => {
    const graph = line(['a', 'b', 'c', 'd', 'e', 'f']);
    const snapshot = JSON.stringify(graph);
    disjointBound(graph, 2, 1);
    assert.equal(JSON.stringify(graph), snapshot);
  });
});

test('solveByTiers', async (t) => {
  await t.test('reports tier 1 when tier 1 is enough', () => {
    const result = solveByTiers(line(['a', 'b', 'c', 'd', 'e', 'f']), 2, 1);
    assert.equal(result.solved, true);
    assert.equal(result.maxTier, 1);
    assert.equal(result.tier2Steps, 0);
    assert.deepEqual(result.forced.sort(), ['b', 'e']);
    assert.ok(result.trace.every((step) => step.tier === 1));
  });

  await t.test('reports not solved when neither tier can move', () => {
    // A 5-cycle is symmetric enough to defeat both rules; it has five
    // solutions and deduction cannot pick one.
    const result = solveByTiers(cycle(5), 2, 1);
    assert.equal(result.solved, false);
    // Nothing contributed at all, so the highest contributing tier is none.
    assert.equal(result.maxTier, 0);
    assert.equal(result.tier0Steps, 0);
    assert.equal(result.tier2Steps, 0);
    assert.deepEqual(result.trace, []);
  });

  await t.test('reaches tier 2 on a level tier 1 cannot touch', () => {
    // The level the old reduce left with 120 open combinations.
    const level = generateLevel({ nodeCount: 10, count: 3, k: 1, seed: 25, edgeDeleteRatio: 0, maxAttempts: 300 });
    const result = solveByTiers(level.graph, level.count, level.k);
    assert.equal(result.solved, true);
    assert.equal(result.maxTier, 2);
    assert.ok(result.tier2Steps > 0);
    assert.deepEqual(result.forced.slice().sort(), level.solution.slice().sort());
  });

  await t.test('terminates and does not mutate the graph', () => {
    const graph = line(['a', 'b', 'c', 'd', 'e', 'f']);
    const snapshot = JSON.stringify(graph);
    solveByTiers(graph, 2, 1);
    assert.equal(JSON.stringify(graph), snapshot);
  });
});

// ---------------------------------------------------------------------------
// The tier-2 invariant. If this fails, the packing bound is unsound — it must
// not be patched to make the test pass.
// ---------------------------------------------------------------------------

/**
 * Asserts that nothing tier 2 struck appears in the level's solution.
 * @returns {boolean} whether tier 2 actually fired, so the caller can prove
 *   the check was not vacuous
 */
function assertTier2Invariant(graph, count, k, solution, label) {
  const result = solveByTiers(graph, count, k);
  const inSolution = new Set(solution);
  let fired = false;
  for (const step of result.trace) {
    if (step.tier !== 2) continue;
    fired = true;
    for (const struck of step.ruledOut) {
      assert.ok(
        !inSolution.has(struck),
        `${label}: tier 2 struck ${struck}, which the solution [${solution.join(', ')}] uses ` +
          `(family: [${step.family.join(', ')}])`,
      );
    }
  }
  for (const transmitter of result.forced) {
    assert.ok(inSolution.has(transmitter), `${label}: deduced ${transmitter}, not in the solution`);
  }
  return fired;
}

test('tier 2 never strikes a candidate the solution needs', async (t) => {
  await t.test('over every built level', () => {
    const files = readdirSync(levelDir).filter((name) => /^\d\d\.json$/.test(name)).sort();
    assert.ok(files.length > 0, 'no built levels — run: node tools/build-levels.js');
    for (const file of files) {
      const level = JSON.parse(readFileSync(join(levelDir, file), 'utf8'));
      assertTier2Invariant(level.graph, level.count, level.k, level.solution, file);
    }
  });

  await t.test('over 100 freshly generated levels', () => {
    // Parameters chosen from the pockets that actually produce tier-2 levels,
    // so this check cannot pass vacuously.
    const params = [
      [10, 3, 1],
      [14, 4, 1],
      [18, 5, 1],
      [24, 4, 2],
    ];
    let generated = 0;
    let tier2Levels = 0;
    for (let seed = 1; generated < 100 && seed <= 400; seed++) {
      const [nodeCount, count, k] = params[seed % params.length];
      let level;
      try {
        level = generateLevel({ nodeCount, count, k, seed, minDegree: 2, edgeDeleteRatio: 0.15, maxAttempts: 250 });
      } catch {
        continue; // this parameter/seed pair admits no unique level
      }
      generated++;
      const label = `seed ${seed} (n=${nodeCount}, count=${count}, k=${k})`;
      if (assertTier2Invariant(level.graph, level.count, level.k, level.solution, label)) tier2Levels++;
      // Cross-check the generator's uniqueness claim while we are here.
      assert.equal(findAllSolutions(level.graph, level.count, level.k).length, 1, `${label}: not unique`);
    }
    assert.equal(generated, 100, `only ${generated} levels generated`);
    assert.ok(tier2Levels > 0, 'tier 2 never fired — the invariant check would be vacuous');
    console.log(`      (tier 2 fired on ${tier2Levels} of ${generated} generated levels)`);
  });
});

test('tier 0: forbidden nodes', async (t) => {
  /** a - b - c - d - e at radius 1, with e off limits. */
  const guarded = {
    nodes: ['a', 'b', 'c', 'd', 'e'].map((id, index) => ({
      id,
      x: index * 10,
      y: 0,
      ...(id === 'e' ? { forbidden: true } : {}),
    })),
    edges: [['a', 'b'], ['b', 'c'], ['c', 'd'], ['d', 'e']],
  };

  await t.test('strikes every position whose signal would reach one', () => {
    const result = forbiddenExclusion(guarded, 1);
    assert.deepEqual(result.forbidden, ['e']);
    assert.deepEqual(result.ruledOut.sort(), ['d', 'e']);
  });

  await t.test('a forbidden node is never a legal position itself', () => {
    assert.ok(forbiddenExclusion(guarded, 0).ruledOut.includes('e'));
  });

  await t.test('strikes nothing on a graph without the flag', () => {
    const open = { nodes: guarded.nodes.map(({ forbidden, ...rest }) => rest), edges: guarded.edges };
    assert.deepEqual(forbiddenExclusion(open, 1), { forbidden: [], ruledOut: [] });
  });

  await t.test('honours a candidate list it is handed', () => {
    assert.deepEqual(forbiddenExclusion(guarded, 1, { candidates: ['a', 'b'] }).ruledOut, []);
  });

  await t.test('leads the trace and is never folded into the candidate list', () => {
    const result = solveByTiers(guarded, 2, 1);
    assert.equal(result.trace[0].tier, 0, 'tier 0 must be the first step of the trace');
    assert.deepEqual(result.trace[0].forbidden, ['e']);
    assert.deepEqual(result.trace[0].ruledOut.sort(), ['d', 'e']);
    assert.equal(result.tier0Steps, 2);
    assert.equal(result.solved, true);
    assert.equal(result.maxTier, 1, 'tier 0 alone never finishes a level');
    assert.deepEqual(result.forced.sort(), ['b', 'c']);
  });

  await t.test('does not appear at all without forbidden nodes', () => {
    const result = solveByTiers(line(['a', 'b', 'c', 'd', 'e', 'f']), 2, 1);
    assert.equal(result.tier0Steps, 0);
    assert.ok(result.trace.every((step) => step.tier !== 0));
  });

  await t.test('later tiers only ever see admissible positions', () => {
    // d and e are struck by tier 0, so nothing downstream may name them.
    const result = solveByTiers(guarded, 2, 1);
    for (const step of result.trace.slice(1)) {
      for (const id of [...(step.forced ?? []), ...(step.ruledOut ?? [])]) {
        assert.ok(id !== 'd' && id !== 'e', `tier ${step.tier} touched the inadmissible ${id}`);
      }
    }
    assert.ok(result.candidates.every((id) => id !== 'd' && id !== 'e'));
  });

  await t.test('does not mutate the graph', () => {
    const snapshot = JSON.stringify(guarded);
    solveByTiers(guarded, 2, 1);
    assert.equal(JSON.stringify(guarded), snapshot);
  });
});
