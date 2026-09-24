import test from 'node:test';
import assert from 'node:assert/strict';

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { coverage, validateGraph } from '../src/graph.js';
import { isUnique } from '../src/solver.js';
import {
  LATTICES,
  LevelGenerationError,
  MAX_JITTER,
  binomial,
  generateCandidate,
  generateLevel,
  hexLattice,
  mulberry32,
  nearMisses,
  rectLattice,
  reduce,
  strictlyDominates,
} from '../src/generator.js';

// ---------------------------------------------------------------------------
// Test-only planarity check.
//
// The generator claims planarity by construction, so it deliberately contains
// no crossing test. That claim is worth verifying here — with an independent,
// brute-force implementation that would be far too slow for production.
// ---------------------------------------------------------------------------

/** @returns {number} sign of the cross product (p→q→r turn direction) */
const turn = (p, q, r) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));

const onSegment = (p, q, r) =>
  Math.min(p.x, r.x) <= q.x && q.x <= Math.max(p.x, r.x) &&
  Math.min(p.y, r.y) <= q.y && q.y <= Math.max(p.y, r.y);

/** @returns {boolean} true when the two closed segments share any point */
function segmentsIntersect(a1, a2, b1, b2) {
  const d1 = turn(a1, a2, b1);
  const d2 = turn(a1, a2, b2);
  const d3 = turn(b1, b2, a1);
  const d4 = turn(b1, b2, a2);
  if (d1 !== d2 && d3 !== d4) return true;
  if (d1 === 0 && onSegment(a1, b1, a2)) return true;
  if (d2 === 0 && onSegment(a1, b2, a2)) return true;
  if (d3 === 0 && onSegment(b1, a1, b2)) return true;
  if (d4 === 0 && onSegment(b1, a2, b2)) return true;
  return false;
}

/** Asserts that no two edges cross anywhere but at a shared endpoint. */
function assertPlanar(graph, label = 'graph') {
  const pos = new Map(graph.nodes.map((node) => [node.id, { x: node.x, y: node.y }]));
  for (let i = 0; i < graph.edges.length; i++) {
    for (let j = i + 1; j < graph.edges.length; j++) {
      const [a1, a2] = graph.edges[i];
      const [b1, b2] = graph.edges[j];
      if (a1 === b1 || a1 === b2 || a2 === b1 || a2 === b2) continue; // shared endpoint
      assert.ok(
        !segmentsIntersect(pos.get(a1), pos.get(a2), pos.get(b1), pos.get(b2)),
        `${label}: edges ${a1}-${a2} and ${b1}-${b2} cross`,
      );
    }
  }
}

/** Asserts connectivity and that no node is stranded. */
function assertTidy(graph, label = 'graph') {
  const degree = new Map(graph.nodes.map((node) => [node.id, 0]));
  for (const [a, b] of graph.edges) {
    degree.set(a, degree.get(a) + 1);
    degree.set(b, degree.get(b) + 1);
  }
  for (const [id, count] of degree) {
    assert.ok(count > 0, `${label}: node ${id} is isolated`);
  }
  const seen = new Set([graph.nodes[0].id]);
  const queue = [graph.nodes[0].id];
  const adjacent = new Map(graph.nodes.map((node) => [node.id, []]));
  for (const [a, b] of graph.edges) {
    adjacent.get(a).push(b);
    adjacent.get(b).push(a);
  }
  while (queue.length > 0) {
    for (const next of adjacent.get(queue.pop())) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  assert.equal(seen.size, graph.nodes.length, `${label}: graph is disconnected`);
}

// ---------------------------------------------------------------------------

test('mulberry32', async (t) => {
  await t.test('is reproducible for the same seed', () => {
    const a = mulberry32(12345);
    const b = mulberry32(12345);
    const first = Array.from({ length: 20 }, () => a());
    const second = Array.from({ length: 20 }, () => b());
    assert.deepEqual(first, second);
  });

  await t.test('produces different streams for different seeds', () => {
    const a = Array.from({ length: 20 }, mulberry32(1));
    const b = Array.from({ length: 20 }, mulberry32(2));
    assert.notDeepEqual(a, b);
  });

  await t.test('stays within [0, 1)', () => {
    const rng = mulberry32(0);
    for (let i = 0; i < 1000; i++) {
      const value = rng();
      assert.ok(value >= 0 && value < 1, `out of range: ${value}`);
    }
  });

  await t.test('does not degenerate into a constant', () => {
    const rng = mulberry32(7);
    const values = new Set(Array.from({ length: 100 }, rng));
    assert.ok(values.size > 90, `too few distinct values: ${values.size}`);
  });
});

test('lattices', async (t) => {
  for (const kind of LATTICES) {
    const build = kind === 'hex' ? hexLattice : rectLattice;

    await t.test(`${kind}: has cols*rows nodes and valid structure`, () => {
      const graph = build({ cols: 5, rows: 4, spacing: 60, jitter: 0.15, rng: mulberry32(1) });
      assert.equal(graph.nodes.length, 20);
      validateGraph(graph);
      assertTidy(graph, kind);
    });

    await t.test(`${kind}: stays planar without and with maximum jitter`, () => {
      assertPlanar(build({ cols: 6, rows: 5, spacing: 60, jitter: 0, rng: mulberry32(2) }), `${kind} jitter=0`);
      for (let seed = 0; seed < 25; seed++) {
        const graph = build({ cols: 6, rows: 5, spacing: 60, jitter: MAX_JITTER, rng: mulberry32(seed) });
        assertPlanar(graph, `${kind} jitter=max seed=${seed}`);
      }
    });

    await t.test(`${kind}: is deterministic per seed`, () => {
      const options = { cols: 4, rows: 4, spacing: 50, jitter: 0.1 };
      const a = build({ ...options, rng: mulberry32(99) });
      const b = build({ ...options, rng: mulberry32(99) });
      assert.deepEqual(a, b);
    });

    await t.test(`${kind}: rejects impossible dimensions and unsafe jitter`, () => {
      assert.throws(() => build({ cols: 0, rows: 3, rng: mulberry32(1) }), RangeError);
      assert.throws(() => build({ cols: 3, rows: 1.5, rng: mulberry32(1) }), RangeError);
      assert.throws(() => build({ cols: 3, rows: 3, spacing: 0, rng: mulberry32(1) }), RangeError);
      assert.throws(
        () => build({ cols: 3, rows: 3, jitter: MAX_JITTER + 0.01, rng: mulberry32(1) }),
        /planar/,
      );
    });
  }

  await t.test('rect: connects exactly the 4-neighbourhood', () => {
    const graph = rectLattice({ cols: 3, rows: 2, jitter: 0, rng: mulberry32(1) });
    // 3*(2-1) vertical + 2*(3-1) horizontal
    assert.equal(graph.edges.length, 3 * 1 + 2 * 2);
  });

  await t.test('hex: offsets every second row', () => {
    const graph = hexLattice({ cols: 3, rows: 2, spacing: 100, jitter: 0, rng: mulberry32(1) });
    const at = (id) => graph.nodes.find((node) => node.id === id);
    assert.equal(at('r0c0').x, 0);
    assert.equal(at('r1c0').x, 50);
    assert.ok(at('r1c0').y > at('r0c0').y);
  });
});

test('generateCandidate', async (t) => {
  await t.test('returns tidy, planar, valid graphs of the requested size', () => {
    const rng = mulberry32(2024);
    let produced = 0;
    for (let i = 0; i < 60; i++) {
      const kind = LATTICES[i % LATTICES.length];
      const graph = generateCandidate({ nodeCount: 12, lattice: kind, rng });
      if (graph === null) continue; // discarded candidate — that is allowed
      produced++;
      assert.equal(graph.nodes.length, 12);
      validateGraph(graph);
      assertTidy(graph, `candidate ${i}`);
      assertPlanar(graph, `candidate ${i}`);
    }
    assert.ok(produced > 20, `expected a usable yield, got ${produced}/60`);
  });

  await t.test('is deterministic per seed', () => {
    const a = generateCandidate({ nodeCount: 10, lattice: 'hex', rng: mulberry32(5) });
    const b = generateCandidate({ nodeCount: 10, lattice: 'hex', rng: mulberry32(5) });
    assert.deepEqual(a, b);
  });

  await t.test('rejects bad arguments', () => {
    const rng = mulberry32(1);
    assert.throws(() => generateCandidate({ nodeCount: 1, rng }), RangeError);
    assert.throws(() => generateCandidate({ nodeCount: 8.5, rng }), RangeError);
    assert.throws(() => generateCandidate({ nodeCount: 8, lattice: 'triangle', rng }), RangeError);
    assert.throws(() => generateCandidate({ nodeCount: 8, edgeDeleteRatio: 1, rng }), RangeError);
  });
});

test('binomial', async (t) => {
  await t.test('computes exact coefficients', () => {
    assert.equal(binomial(5, 2), 10);
    assert.equal(binomial(30, 4), 27405);
    assert.equal(binomial(52, 5), 2598960);
  });

  await t.test('handles the edges', () => {
    assert.equal(binomial(0, 0), 1);
    assert.equal(binomial(7, 0), 1);
    assert.equal(binomial(7, 7), 1);
    assert.equal(binomial(3, 5), 0);
    assert.equal(binomial(3, -1), 0);
    assert.equal(binomial(3, 1.5), 0);
  });
});

const line = (ids) => ({
  nodes: ids.map((id, index) => ({ id, x: index * 10, y: 0 })),
  edges: ids.slice(1).map((id, index) => [ids[index], id]),
});

test('strictlyDominates', async (t) => {
  await t.test('finds the strictly contained balls', () => {
    // a-b-c at radius 1: B(a)={a,b}, B(b)={a,b,c}, B(c)={b,c}
    assert.deepEqual(strictlyDominates(line(['a', 'b', 'c']), 1), [
      ['a', 'b'],
      ['c', 'b'],
    ]);
  });

  await t.test('keeps symmetric pairs: B(v) === B(w) dominates neither way', () => {
    // A single edge: both endpoints supply exactly {a, b}.
    assert.deepEqual(strictlyDominates(line(['a', 'b']), 1), []);
    // A triangle at radius 1: every ball is the whole triangle.
    const triangle = {
      nodes: [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 1, y: 0 }, { id: 'c', x: 0, y: 1 }],
      edges: [['a', 'b'], ['b', 'c'], ['a', 'c']],
    };
    assert.deepEqual(strictlyDominates(triangle, 1), []);
  });

  await t.test('k = 0 makes every ball a distinct singleton', () => {
    assert.deepEqual(strictlyDominates(line(['a', 'b', 'c']), 0), []);
  });

  await t.test('handles the empty graph', () => {
    assert.deepEqual(strictlyDominates({ nodes: [], edges: [] }, 1), []);
  });

  await t.test('does not mutate the graph', () => {
    const graph = line(['a', 'b', 'c']);
    const snapshot = JSON.stringify(graph);
    strictlyDominates(graph, 1);
    assert.equal(JSON.stringify(graph), snapshot);
  });
});

test('reduce', async (t) => {
  await t.test('drives a-b-c-d-e at radius 1 to a fixpoint', () => {
    // a and e are dominated by b and d; constraints b, c, d fall away; the
    // remaining constraints a and e then force b and d.
    const result = reduce(line(['a', 'b', 'c', 'd', 'e']), 2, 1);
    assert.deepEqual(result.forced, ['b', 'd']);
    // Constraint a could be supplied by a or b; a is dominated away, so one
    // option has to be ruled out before b is inevitable. Same for e and d.
    assert.deepEqual(result.forcedTrace, [
      { node: 'b', round: 1, ruledOut: 1 },
      { node: 'd', round: 1, ruledOut: 1 },
    ]);
    assert.equal(result.hardestStep, 1);
    assert.equal(result.avgStep, 1);
    assert.equal(result.residualConstraints, 0);
    assert.deepEqual(result.candidates, ['c']);
    assert.equal(result.residualCandidates, 1);
    assert.equal(result.residualSpace, 1); // C(1, 2 - 2)
    assert.equal(result.rounds, 1);
  });

  await t.test('k = 0 forces every node without any deduction', () => {
    const result = reduce(line(['a', 'b', 'c']), 3, 0);
    assert.deepEqual(result.forced.sort(), ['a', 'b', 'c']);
    // Every node is its own only supplier from the start — nothing to rule out.
    assert.deepEqual(result.forcedTrace, [
      { node: 'a', round: 1, ruledOut: 0 },
      { node: 'b', round: 1, ruledOut: 0 },
      { node: 'c', round: 1, ruledOut: 0 },
    ]);
    assert.equal(result.hardestStep, 0);
    assert.equal(result.avgStep, 0);
    assert.equal(result.residualCandidates, 0);
    assert.equal(result.residualConstraints, 0);
    assert.equal(result.residualSpace, 1); // C(0, 0)
  });

  await t.test('isolated nodes are forced regardless of k', () => {
    const dust = { nodes: [{ id: 'p', x: 0, y: 0 }, { id: 'q', x: 9, y: 9 }], edges: [] };
    const result = reduce(dust, 2, 3);
    assert.deepEqual(result.forced.sort(), ['p', 'q']);
    assert.equal(result.residualSpace, 1);
  });

  await t.test('records the round in which each transmitter becomes forced', () => {
    // A path of nine at radius 1: the ends force their neighbours immediately,
    // the middle only opens up once those constraints are gone.
    const result = reduce(line(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i']), 3, 1);
    const rounds = result.forcedTrace.map((entry) => entry.round);
    assert.deepEqual(rounds, [...rounds].sort((x, y) => x - y), 'rounds must not go backwards');
    assert.equal(Math.max(...rounds), result.rounds);
    for (const entry of result.forcedTrace) {
      assert.ok(entry.round >= 1 && entry.round <= result.rounds);
      assert.ok(Number.isInteger(entry.ruledOut) && entry.ruledOut >= 0);
    }
    assert.equal(result.hardestStep, Math.max(...result.forcedTrace.map((e) => e.ruledOut)));
  });

  await t.test('leaves a genuine choice standing instead of collapsing it', () => {
    // One edge, one transmitter: a and b are interchangeable, so neither may be
    // struck and nothing is forced. Two real solutions remain.
    const result = reduce(line(['a', 'b']), 1, 1);
    assert.deepEqual(result.forced, []);
    assert.deepEqual(result.forcedTrace, []);
    assert.equal(result.hardestStep, 0);
    assert.equal(result.residualCandidates, 2);
    assert.equal(result.residualConstraints, 1);
    assert.equal(result.residualSpace, 2); // C(2, 1)
  });

  await t.test('reports zero rounds when nothing reduces', () => {
    // A 5-cycle at radius 1: every ball has three nodes and no two are
    // comparable, so no rule bites and the whole search space survives.
    const ids = [0, 1, 2, 3, 4].map((i) => `n${i}`);
    const cycle = {
      nodes: ids.map((id, i) => ({ id, x: Math.cos((i * 2 * Math.PI) / 5), y: Math.sin((i * 2 * Math.PI) / 5) })),
      edges: ids.map((id, i) => [id, ids[(i + 1) % 5]]),
    };
    const result = reduce(cycle, 2, 1);
    assert.equal(result.rounds, 0);
    assert.deepEqual(result.forced, []);
    assert.deepEqual(result.forcedTrace, []);
    assert.equal(result.hardestStep, 0);
    assert.equal(result.avgStep, 0);
    assert.equal(result.residualCandidates, 5);
    assert.equal(result.residualConstraints, 5);
    assert.equal(result.residualSpace, 10); // C(5, 2) — nothing gained
  });

  await t.test('k = 0 forces even a fully symmetric graph', () => {
    // Each node is its own only candidate, so symmetry does not help.
    const triangle = {
      nodes: [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 1, y: 0 }, { id: 'c', x: 0, y: 1 }],
      edges: [['a', 'b'], ['b', 'c'], ['a', 'c']],
    };
    const result = reduce(triangle, 3, 0);
    assert.deepEqual(result.forced.sort(), ['a', 'b', 'c']);
    assert.equal(result.rounds, 1);
  });

  await t.test('handles the empty graph and impossible counts', () => {
    assert.deepEqual(reduce({ nodes: [], edges: [] }, 0, 1), {
      forced: [],
      forcedTrace: [],
      hardestStep: 0,
      avgStep: 0,
      residualCandidates: 0,
      residualConstraints: 0,
      residualSpace: 1,
      rounds: 0,
      candidates: [],
      constraints: [],
    });
    // More forced transmitters than the level allows → no residual space.
    assert.equal(reduce(line(['a', 'b', 'c']), 2, 0).residualSpace, 0);
  });

  await t.test('terminates and does not mutate the graph', () => {
    const graph = line(['a', 'b', 'c', 'd', 'e']);
    const snapshot = JSON.stringify(graph);
    reduce(graph, 2, 1);
    assert.equal(JSON.stringify(graph), snapshot);
  });
});

test('nearMisses', async (t) => {
  await t.test('counts placements that leave exactly one node dark', () => {
    // a-b-c at radius 1: {a} and {c} each leave one node uncovered, {b} covers all.
    assert.equal(nearMisses(line(['a', 'b', 'c']), 1, 1), 2);
  });

  await t.test('k = 0 on a path leaves two dark, so nothing is a near miss', () => {
    assert.equal(nearMisses(line(['a', 'b', 'c']), 1, 0), 0);
  });

  await t.test('handles empty graphs and impossible counts', () => {
    assert.equal(nearMisses({ nodes: [], edges: [] }, 0, 1), 0);
    assert.equal(nearMisses(line(['a', 'b', 'c']), 9, 1), 0);
  });
});

// ---------------------------------------------------------------------------
// The two invariants. If one of these fails, the reduction rule is wrong — it
// must not be patched to make the test pass.
// ---------------------------------------------------------------------------

/**
 * (a) every forced transmitter is part of the level's solution, and
 * (b) no struck candidate is.
 */
function assertReductionInvariants(graph, count, k, solution, label) {
  const result = reduce(graph, count, k);
  const inSolution = new Set(solution);
  for (const transmitter of result.forced) {
    assert.ok(
      inSolution.has(transmitter),
      `${label}: forced transmitter ${transmitter} is missing from the solution ` +
        `[${solution.join(', ')}] (forced: [${result.forced.join(', ')}])`,
    );
  }
  const survived = new Set([...result.forced, ...result.candidates]);
  for (const transmitter of solution) {
    assert.ok(
      survived.has(transmitter),
      `${label}: solution uses ${transmitter}, which the reduction struck as dominated`,
    );
  }
}

test('reduction invariants hold on every generated level', async (t) => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const levelDir = join(root, 'levels');

  await t.test('the 30 built levels', () => {
    let files;
    try {
      files = readdirSync(levelDir).filter((name) => /^\d\d\.json$/.test(name)).sort();
    } catch {
      assert.fail(`${levelDir} is missing — run: node tools/build-levels.js`);
    }
    assert.equal(files.length, 30, 'expected 30 built levels');
    for (const file of files) {
      const level = JSON.parse(readFileSync(join(levelDir, file), 'utf8'));
      assertReductionInvariants(level.graph, level.count, level.k, level.solution, file);
      // Tier 1 is no longer expected to finish a level on its own — most of
      // the ladder deliberately needs the tier-2 packing bound, and that whole
      // deduction is checked in test/tiers.test.js. What must still hold here
      // is that tier 1's partial progress is sound.
      const result = reduce(level.graph, level.count, level.k);
      assert.ok(
        result.forced.length <= level.count,
        `${file}: tier 1 forced more transmitters than the level allows`,
      );
    }
  });

  await t.test('50 freshly generated levels', () => {
    const params = [
      [10, 3, 1],
      [11, 3, 1],
      [12, 4, 1],
      [12, 2, 2],
      [13, 2, 2],
      [14, 2, 2],
    ];
    for (let seed = 1; seed <= 50; seed++) {
      const [nodeCount, count, k] = params[seed % params.length];
      const level = generateLevel({ nodeCount, count, k, seed });
      assertReductionInvariants(
        level.graph,
        level.count,
        level.k,
        level.solution,
        `seed ${seed} (n=${nodeCount}, count=${count}, k=${k})`,
      );
    }
  });
});

test('generateLevel', async (t) => {
  const params = { nodeCount: 10, count: 3, k: 1, seed: 42 };

  await t.test('produces a uniquely solvable, tidy, planar level', () => {
    const level = generateLevel(params);
    assert.equal(level.graph.nodes.length, 10);
    validateGraph(level.graph);
    assertTidy(level.graph, 'level');
    assertPlanar(level.graph, 'level');
    assert.ok(isUnique(level.graph, level.count, level.k));
    assert.equal(level.solution.length, level.count);
    assert.equal(coverage(level.graph, level.solution, level.k).size, level.graph.nodes.length);
    assert.ok(level.attempts >= 1);
    assert.ok(LATTICES.includes(level.lattice));
    assert.deepEqual(level.reduction, reduce(level.graph, level.count, level.k));
    assert.equal(level.nearMisses, nearMisses(level.graph, level.count, level.k));
  });

  await t.test('is byte-for-byte reproducible from the seed', () => {
    const a = generateLevel(params);
    const b = generateLevel(params);
    assert.deepEqual(a, b);
    assert.equal(JSON.stringify(a), JSON.stringify(b));
    // Coordinates must survive a JSON round-trip, or stored levels would drift.
    assert.deepEqual(JSON.parse(JSON.stringify(a)), a);
  });

  await t.test('different seeds give different levels', () => {
    const a = generateLevel({ ...params, seed: 42 });
    const b = generateLevel({ ...params, seed: 43 });
    assert.notDeepEqual(a.graph, b.graph);
  });

  await t.test('honours an explicit lattice choice', () => {
    for (const kind of LATTICES) {
      assert.equal(generateLevel({ nodeCount: 12, count: 2, k: 2, seed: 9, lattice: kind }).lattice, kind);
    }
  });

  await t.test('throws a descriptive error instead of looping forever', () => {
    // k = 0 means every node must carry a transmitter, so one can never do.
    const attempt = () => generateLevel({ nodeCount: 6, count: 1, k: 0, seed: 3, maxAttempts: 25 });
    assert.throws(attempt, LevelGenerationError);
    assert.throws(attempt, /nodeCount=6/);
    assert.throws(attempt, /after 25 attempts/);
    assert.throws(attempt, /seed 3/);
    try {
      attempt();
    } catch (error) {
      assert.equal(error.attempts, 25);
      assert.equal(error.seed, 3);
      assert.equal(typeof error.rejected, 'number');
    }
  });

  await t.test('rejects invalid parameters up front', () => {
    assert.throws(() => generateLevel({ ...params, nodeCount: 1 }), RangeError);
    assert.throws(() => generateLevel({ ...params, count: 0 }), RangeError);
    assert.throws(() => generateLevel({ ...params, count: 99 }), /cannot exceed nodeCount/);
    assert.throws(() => generateLevel({ ...params, k: -1 }), RangeError);
    assert.throws(() => generateLevel({ ...params, seed: 1.5 }), RangeError);
    assert.throws(() => generateLevel({ ...params, maxAttempts: 0 }), RangeError);
    assert.throws(() => generateLevel({ ...params, lattice: 'spiral' }), RangeError);
  });
});
